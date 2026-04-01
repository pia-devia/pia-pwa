const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const router = express.Router();

// ── Claude limits (Max subscription approximations)
// Output tokens per 5h session: ~50k on Max plan
// Output tokens per week: ~500k on Max plan
// Guille puede ajustar estos valores
const CLAUDE_LIMITS = {
  sessionOutputTokens: 50_000,   // tokens salida por sesión (5h)
  weeklyOutputTokens: 500_000,  // tokens salida por semana
};

// ── CPU: usar delta entre lecturas de /proc/stat ───────────────────────────
let _prevCpuStat = null;

function readProcStat() {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const vals = line.trim().split(/\s+/).slice(1).map(Number);
  // user, nice, system, idle, iowait, irq, softirq, steal, ...
  const idle  = (vals[3] || 0) + (vals[4] || 0); // idle + iowait
  const total = vals.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function getCpu() {
  try {
    const curr = readProcStat();
    let usage = 0;

    if (_prevCpuStat) {
      const dIdle  = curr.idle  - _prevCpuStat.idle;
      const dTotal = curr.total - _prevCpuStat.total;
      usage = dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10 : 0;
      usage = Math.min(100, Math.max(0, usage));
    }
    _prevCpuStat = curr;

    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const modelMatch = cpuinfo.match(/model name\s*:\s*(.+)/);
    const coreCount  = (cpuinfo.match(/^processor/gm) || []).length;

    return {
      usage,
      model: modelMatch ? modelMatch[1].trim() : 'Unknown',
      cores: coreCount,
    };
  } catch {
    return { usage: 0, model: 'Unknown', cores: 0 };
  }
}

// ── Disk: usar /workspace (Docker) o /home/kai (PM2/host) ─────────────────
function getDiskUsage() {
  try {
    const physicalGb = parseInt(process.env.PHYSICAL_DISK_GB || '0', 10);

    // Detect environment: /workspace exists in Docker, otherwise use home or root
    const diskPath = fs.existsSync('/workspace') ? '/workspace' : (process.env.HOME || '/');

    // BusyBox-compatible: df -B1 -P (POSIX)
    // Columns: Filesystem, 1-blocks(total), Used, Available, Capacity%, Mountpoint
    const raw = execSync(`df -B1 -P "${diskPath}"`, { timeout: 5000 })
      .toString().split('\n');
    const parts    = raw[1].trim().split(/\s+/);
    const usedBytes  = parseInt(parts[2], 10);
    const availBytes = parseInt(parts[3], 10);

    const usedGb  = Math.round(usedBytes / 1_073_741_824);
    const totalGb = physicalGb || Math.round((usedBytes + availBytes) / 1_073_741_824);
    const freeGb  = totalGb - usedGb;
    const percent = totalGb > 0 ? Math.round((usedGb / totalGb) * 100) : 0;

    return { used: usedGb, total: totalGb, free: freeGb, percent };
  } catch (err) {
    console.error('[disk] getDiskUsage error:', err.message);
    return { used: 0, total: 0, free: 0, percent: 0 };
  }
}

// ── Memory ─────────────────────────────────────────────────────────────────
function getMemory() {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)[1], 10) * 1024;
    const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)[1], 10) * 1024;
    const used  = total - avail;
    return {
      total:   Math.round(total / 1_048_576),
      used:    Math.round(used  / 1_048_576),
      percent: Math.round((used / total) * 100),
    };
  } catch {
    return { total: 0, used: 0, percent: 0 };
  }
}

// ── Uptime ─────────────────────────────────────────────────────────────────
function getUptime() {
  try {
    return Math.floor(parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]));
  } catch {
    return 0;
  }
}

// ── Hostname ───────────────────────────────────────────────────────────────
function getHostname() {
  try {
    return execSync('hostname', { timeout: 3000 }).toString().trim();
  } catch {
    return 'unknown';
  }
}

// ── Claude usage — tracking con deltas + acumulado diario ─────────────────
function readSessionsFile() {
  const p = path.join(
    process.env.HOME || '/home/kai',
    '.openclaw/agents/main/sessions/sessions.json'
  );
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getClaudeUsage() {
  try {
    const sessions = readSessionsFile();
    if (!sessions) return null;

    const models = new Set();
    let currentIn  = 0;
    let currentOut = 0;
    let mainContextTokens = 0;
    let mainOut = 0;

    for (const [key, sess] of Object.entries(sessions)) {
      if (typeof sess !== 'object' || !sess) continue;
      currentIn  += sess.inputTokens  || 0;
      currentOut += sess.outputTokens || 0;
      if (sess.model) models.add(sess.model);
      if (key === 'agent:main:main') {
        mainContextTokens = sess.totalTokens  || 0;
        mainOut           = sess.outputTokens || 0;
      }
    }

    // ── Delta tracking ──────────────────────────────────────────────────
    const today    = new Date().toISOString().slice(0, 10);
    const snapshot = db.prepare('SELECT * FROM claude_usage_snapshot WHERE id = 1').get();
    const prevIn   = snapshot?.input_tokens  || 0;
    const prevOut  = snapshot?.output_tokens || 0;
    const deltaIn  = Math.max(0, currentIn  - prevIn);
    const deltaOut = Math.max(0, currentOut - prevOut);

    if (deltaIn > 0 || deltaOut > 0) {
      db.prepare(`
        INSERT INTO claude_daily_usage (date, input_tokens, output_tokens)
        VALUES (?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          input_tokens  = input_tokens  + excluded.input_tokens,
          output_tokens = output_tokens + excluded.output_tokens
      `).run(today, deltaIn, deltaOut);

      db.prepare(`
        INSERT INTO claude_usage_snapshot (id, input_tokens, output_tokens, captured_at)
        VALUES (1, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          captured_at  = excluded.captured_at
      `).run(currentIn, currentOut);
    }

    // ── Aggregates ──────────────────────────────────────────────────────
    const todayRow = db.prepare('SELECT * FROM claude_daily_usage WHERE date = ?').get(today);
    const weekRow  = db.prepare(`
      SELECT SUM(input_tokens) as in_sum, SUM(output_tokens) as out_sum
      FROM claude_daily_usage
      WHERE date >= date('now', '-6 days')
    `).get();

    const todayIn  = todayRow?.input_tokens  || 0;
    const todayOut = todayRow?.output_tokens || 0;
    const weekIn   = weekRow?.in_sum  || 0;
    const weekOut  = weekRow?.out_sum || 0;

    // ── Usar límite calibrado si existe ────────────────────────────────
    const webLimits = db.prepare('SELECT * FROM claude_web_limits WHERE id = 1').get();
    const calibratedWeeklyLimit = webLimits?.estimated_weekly_limit || null;
    const weekTotal = weekIn + weekOut;
    const weekPct = calibratedWeeklyLimit
      ? Math.min(100, Math.round((weekTotal / calibratedWeeklyLimit) * 100))
      : null;

    return {
      session: {
        contextTokens: mainContextTokens,
        outputTokens:  mainOut,
      },
      today: {
        inputTokens:  todayIn,
        outputTokens: todayOut,
        total:        todayIn + todayOut,
      },
      week: {
        inputTokens:  weekIn,
        outputTokens: weekOut,
        total:        weekTotal,
        limit:        calibratedWeeklyLimit,
        percent:      weekPct,
      },
      models: [...models],
      calibrated: !!calibratedWeeklyLimit,
    };
  } catch (err) {
    console.error('claude-usage error:', err.message);
    return null;
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/metrics', (req, res) => {
  try {
    res.json({
      hostname: getHostname(),
      cpu:      getCpu(),
      memory:   getMemory(),
      disk:     getDiskUsage(),
      uptime:   getUptime(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/subagents', (req, res) => {
  res.json({ count: 0 });
});

// ── claude.ai manual limits (multi-profile) ────────────────────────────────
const CLAUDE_PROFILES = ['personal', 'ntasys'];

router.post('/claude-web-sync', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    execSync('node /home/kai/scripts/sync-claude-usage.js --profile personal', { timeout: 15000 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/claude-web-limits', (req, res) => {
  try {
    // Return all profiles with budget calculations
    const profiles = {};
    for (const profile of CLAUDE_PROFILES) {
      const row = db.prepare(`
        SELECT session_pct, weekly_all_pct, weekly_sonnet_pct, session_resets_in, weekly_resets_at,
               weekly_resets_at_iso, weekly_available_pct, weekly_hours_until_reset, weekly_daily_budget_pct,
               updated_at, session_expired
        FROM claude_web_limits_profiles WHERE profile = ?
      `).get(profile);
      profiles[profile] = row || {
        session_pct: 0, weekly_all_pct: 0, weekly_sonnet_pct: 0,
        session_resets_in: '', weekly_resets_at: '', 
        weekly_resets_at_iso: null, weekly_available_pct: 100, weekly_hours_until_reset: 0, weekly_daily_budget_pct: 0,
        updated_at: null, session_expired: 0,
      };
    }
    
    // Calculate recommended profile (the one with more daily budget)
    const personalBudget = profiles.personal?.weekly_daily_budget_pct || 0;
    const ntasysBudget = profiles.ntasys?.weekly_daily_budget_pct || 0;
    const recommended = personalBudget >= ntasysBudget ? 'personal' : 'ntasys';
    
    // Also return legacy single-profile for backwards compat
    const legacy = db.prepare(
      'SELECT session_pct, weekly_all_pct, weekly_sonnet_pct, session_resets_in, weekly_resets_at, updated_at, session_expired FROM claude_web_limits WHERE id = 1'
    ).get();
    
    res.json({
      profiles,
      recommended,
      // Legacy fields (backwards compat)
      ...(legacy || {
        session_pct: 0, weekly_all_pct: 0, weekly_sonnet_pct: 0,
        session_resets_in: '', weekly_resets_at: '', updated_at: null, session_expired: 0,
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/claude-web-limits', (req, res) => {
  try {
    const { 
      profile, session_pct, weekly_all_pct, weekly_sonnet_pct, session_resets_in, weekly_resets_at,
      weekly_resets_at_iso, weekly_available_pct, weekly_hours_until_reset, weekly_daily_budget_pct
    } = req.body;
    
    // If profile is specified, update that specific profile
    if (profile && CLAUDE_PROFILES.includes(profile)) {
      db.prepare(`
        INSERT INTO claude_web_limits_profiles
          (profile, session_pct, weekly_all_pct, weekly_sonnet_pct, session_resets_in, weekly_resets_at,
           weekly_resets_at_iso, weekly_available_pct, weekly_hours_until_reset, weekly_daily_budget_pct, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(profile) DO UPDATE SET
          session_pct               = excluded.session_pct,
          weekly_all_pct            = excluded.weekly_all_pct,
          weekly_sonnet_pct         = excluded.weekly_sonnet_pct,
          session_resets_in         = excluded.session_resets_in,
          weekly_resets_at          = excluded.weekly_resets_at,
          weekly_resets_at_iso      = excluded.weekly_resets_at_iso,
          weekly_available_pct      = excluded.weekly_available_pct,
          weekly_hours_until_reset  = excluded.weekly_hours_until_reset,
          weekly_daily_budget_pct   = excluded.weekly_daily_budget_pct,
          updated_at                = excluded.updated_at
      `).run(
        profile,
        session_pct               ?? 0,
        weekly_all_pct            ?? 0,
        weekly_sonnet_pct         ?? 0,
        session_resets_in         || '',
        weekly_resets_at          || '',
        weekly_resets_at_iso      || null,
        weekly_available_pct      ?? 0,
        weekly_hours_until_reset  ?? 0,
        weekly_daily_budget_pct   ?? 0,
      );
      
      return res.json({ ok: true, profile });
    }

    // Legacy: update single-profile table + auto-calibrate
    let estimated_weekly_limit = null;
    if (weekly_all_pct > 0) {
      const row = db.prepare(`
        SELECT SUM(input_tokens) + SUM(output_tokens) as total
        FROM claude_daily_usage
      `).get();
      const currentTokens = row?.total || 0;
      if (currentTokens > 0) {
        estimated_weekly_limit = Math.round(currentTokens / (weekly_all_pct / 100));
      }
    }

    db.prepare(`
      INSERT INTO claude_web_limits
        (id, session_pct, weekly_all_pct, weekly_sonnet_pct, session_resets_in, weekly_resets_at,
         estimated_weekly_limit, calibrated_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        session_pct              = excluded.session_pct,
        weekly_all_pct           = excluded.weekly_all_pct,
        weekly_sonnet_pct        = excluded.weekly_sonnet_pct,
        session_resets_in        = excluded.session_resets_in,
        weekly_resets_at         = excluded.weekly_resets_at,
        estimated_weekly_limit   = COALESCE(excluded.estimated_weekly_limit, claude_web_limits.estimated_weekly_limit),
        calibrated_at            = CASE WHEN excluded.estimated_weekly_limit IS NOT NULL THEN datetime('now') ELSE claude_web_limits.calibrated_at END,
        updated_at               = excluded.updated_at
    `).run(
      session_pct       ?? 0,
      weekly_all_pct    ?? 0,
      weekly_sonnet_pct ?? 0,
      session_resets_in || '',
      weekly_resets_at  || '',
      estimated_weekly_limit,
      estimated_weekly_limit,
    );

    res.json({ ok: true, estimated_weekly_limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual sync trigger → calls host sync-bridge ─────────────────────────
router.post('/sync-claude', async (req, res) => {
  try {
    // Run sync scripts directly (no bridge needed)
    const { exec } = require('child_process');
    const runSync = (profile) => new Promise((resolve) => {
      exec(`node /home/kai/scripts/sync-claude-usage.js --profile ${profile}`,
        { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) resolve({ ok: false, profile, error: err.message });
          else resolve({ ok: true, profile, output: stdout?.slice(-200) });
        });
    });

    const [personal, ntasys] = await Promise.all([
      runSync('personal'),
      runSync('ntasys'),
    ]);

    return res.json({ ok: true, personal, ntasys });
  } catch (err) {
    res.status(500).json({ error: `Sync failed: ${err.message}` });
  }
});

// ── Update sessionKey + trigger sync ─────────────────────────────────────
router.post('/claude-session-key', async (req, res) => {
  const { sessionKey } = req.body;
  if (!sessionKey || !sessionKey.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'sessionKey inválido' });
  }

  try {
    // Store in DB (accessible from both Docker and host via shared volume)
    db.prepare(`
      INSERT INTO claude_web_limits (id, session_key, session_expired, updated_at)
      VALUES (1, ?, 0, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        session_key = excluded.session_key,
        session_expired = 0
    `).run(sessionKey);

    // Trigger sync via bridge
    try {
      const bridgeRes = await fetch(`${BRIDGE_URL}/sync`, {
        method: 'POST',
        headers: { 'x-sync-secret': 'kai-sync-secret-2026' },
      });
      const syncData = await bridgeRes.json();
      if (syncData.error === 'SESSION_EXPIRED') {
        db.prepare(`UPDATE claude_web_limits SET session_expired = 1 WHERE id = 1`).run();
      }
      res.json({ ok: true, sync: syncData });
    } catch {
      res.json({ ok: true, sync: null, note: 'Key guardada, sync pendiente' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/claude-usage', (req, res) => {
  try {
    const usage = getClaudeUsage();
    res.json(usage || {
      session: { contextTokens: 0, outputTokens: 0, limit: CLAUDE_LIMITS.sessionOutputTokens, percent: 0 },
      today:   { inputTokens: 0, outputTokens: 0, total: 0 },
      week:    { inputTokens: 0, outputTokens: 0, total: 0, limit: CLAUDE_LIMITS.weeklyOutputTokens, percent: 0 },
      models:  [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auth profile management (native OpenClaw CLI) ─────────────────────────
const AUTH_PROFILES_PATH = path.join(
  process.env.HOME || '/home/kai',
  '.openclaw/agents/main/agent/auth-profiles.json'
);

function readAuthProfiles() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PROFILES_PATH, 'utf8'));
  } catch {
    return { profiles: {}, order: {}, lastGood: {} };
  }
}

router.get('/auth-profile', (req, res) => {
  try {
    const data = readAuthProfiles();
    const order = data.order?.anthropic || [];
    const active = order[0] || data.lastGood?.anthropic || 'anthropic:personal';
    res.json({ active, profiles: Object.keys(data.profiles || {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth-profile', (req, res) => {
  const { profile } = req.body;
  // profile comes as "anthropic:personal" or "anthropic:ntasys"
  const profileId = profile?.startsWith('anthropic:') ? profile : `anthropic:${profile}`;

  try {
    // 1. Update auth-profiles.json store order via CLI
    execSync(
      `openclaw models auth order set --provider anthropic ${profileId}`,
      { timeout: 10000, encoding: 'utf8' }
    );
    // 2. Patch openclaw.json auth.order — this is what the gateway reads in real-time
    const configPath = path.join(process.env.HOME || '/home/kai', '.openclaw/openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.auth = config.auth || {};
    config.auth.order = config.auth.order || {};
    config.auth.order.anthropic = [profileId];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    res.json({ ok: true, active: profileId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent settings (color, etc.) ───────────────────────────────────────────

const AGENT_DEFAULTS = {
  core: '#00C8FF',
  po:   '#00C8FF',
  fe:   '#00C8FF',
  be:   '#00C8FF',
  ux:   '#00C8FF',
  qa:   '#00C8FF',
};

router.get('/agent-settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT agent_id, color FROM agent_settings').all();
    const settings = {};
    // Seed defaults for any missing agent
    for (const [agentId, defaultColor] of Object.entries(AGENT_DEFAULTS)) {
      const row = rows.find(r => r.agent_id === agentId);
      settings[agentId] = { color: row?.color || defaultColor };
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/agent-settings/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { color } = req.body;

  if (!agentId || !AGENT_DEFAULTS[agentId]) {
    return res.status(400).json({ error: 'agentId inválido' });
  }
  if (!color || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return res.status(400).json({ error: 'color inválido' });
  }

  try {
    db.prepare(`
      INSERT INTO agent_settings (agent_id, color, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        color      = excluded.color,
        updated_at = excluded.updated_at
    `).run(agentId, color);
    res.json({ ok: true, agentId, color });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent status (self-reported by agents + force-reset + restart) ─────────

const AGENT_STATUS_DEFAULTS = {
  core: 'live',
  po:   'live',
  fe:   'offline',
  be:   'offline',
  ux:   'offline',
  qa:   'offline',
};

// Mapeo de agentId a nombre de contenedor Docker
const AGENT_CONTAINERS = {
  core: 'agent-core',
  po:   'agent-po',
  fe:   'agent-fe',
  be:   'agent-be',
  ux:   'agent-ux',
  qa:   'agent-qa',
};

// Verificar estado real de un contenedor Docker
function getDockerContainerState(containerName) {
  try {
    const result = execSync(
      `docker inspect --format='{{.State.Status}}' ${containerName} 2>/dev/null`,
      { timeout: 5000 }
    ).toString().trim();
    // Docker states: running, paused, exited, dead, etc.
    if (result === 'running') return 'live';
    if (result === 'paused') return 'paused';
    return 'offline';
  } catch {
    return 'offline';
  }
}

// GET /api/system/agents-status
router.get('/agents-status', (req, res) => {
  try {
    const rows = db.prepare('SELECT agent_id, state, task, updated_at FROM agent_status').all();
    const result = {};
    for (const [agentId, defaultState] of Object.entries(AGENT_STATUS_DEFAULTS)) {
      const row = rows.find(r => r.agent_id === agentId);
      
      // Para agentes con contenedor Docker, verificar estado real
      let realState = row?.state || defaultState;
      if (AGENT_CONTAINERS[agentId]) {
        realState = getDockerContainerState(AGENT_CONTAINERS[agentId]);
      }
      
      result[agentId] = {
        state:      realState,
        task:       row?.task       || null,
        updated_at: row?.updated_at || null,
        hasContainer: !!AGENT_CONTAINERS[agentId],
      };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/system/agents-status/:agentId
// Agents self-report their state. No auth required (internal only).
router.put('/agents-status/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { state, task } = req.body;

  if (!Object.hasOwn(AGENT_STATUS_DEFAULTS, agentId)) {
    return res.status(400).json({ error: 'agentId inválido' });
  }
  if (!['live', 'working', 'offline'].includes(state)) {
    return res.status(400).json({ error: 'state debe ser: live | working | offline' });
  }

  try {
    db.prepare(`
      INSERT INTO agent_status (agent_id, state, task, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        state      = excluded.state,
        task       = excluded.task,
        updated_at = excluded.updated_at
    `).run(agentId, state, task || null);
    res.json({ ok: true, agentId, state, task: task || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/agents-control/:agentId/:action
// Control Docker containers: start, stop, restart, pause, unpause
router.post('/agents-control/:agentId/:action', (req, res) => {
  const { agentId, action } = req.params;
  
  const containerName = AGENT_CONTAINERS[agentId];
  if (!containerName) {
    return res.status(400).json({ error: `Agent '${agentId}' no tiene contenedor Docker asociado` });
  }
  
  const validActions = ['start', 'stop', 'restart', 'pause', 'unpause'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Acción inválida. Usar: ${validActions.join(', ')}` });
  }
  
  try {
    execSync(`docker ${action} ${containerName}`, { timeout: 30000 });
    const newState = getDockerContainerState(containerName);
    
    // Actualizar DB con el nuevo estado
    const dbState = newState === 'live' ? 'live' : 'offline';
    db.prepare(`
      INSERT INTO agent_status (agent_id, state, task, updated_at)
      VALUES (?, ?, NULL, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        state      = excluded.state,
        task       = NULL,
        updated_at = datetime('now')
    `).run(agentId, dbState);
    
    res.json({ ok: true, agentId, action, state: newState });
  } catch (err) {
    res.status(500).json({ error: `Docker ${action} failed: ${err.message}` });
  }
});

// POST /api/system/agents-force-reset/:agentId
// Force an agent's status back to 'live' — clears stuck 'working' states.
router.post('/agents-force-reset/:agentId', (req, res) => {
  const { agentId } = req.params;

  if (!Object.hasOwn(AGENT_STATUS_DEFAULTS, agentId)) {
    return res.status(400).json({ error: 'agentId inválido' });
  }

  try {
    db.prepare(`
      INSERT INTO agent_status (agent_id, state, task, updated_at)
      VALUES (?, 'live', NULL, datetime('now'))
      ON CONFLICT(agent_id) DO UPDATE SET
        state      = 'live',
        task       = NULL,
        updated_at = datetime('now')
    `).run(agentId);
    res.json({ ok: true, agentId, state: 'live' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/agents-restart
// Restart the OpenClaw gateway via bridge (affects all agents).
router.post('/agents-restart', async (req, res) => {
  try {
    const response = await fetch(`${BRIDGE_URL}/restart-gateway`, {
      method: 'POST',
      headers: { 'x-sync-secret': BRIDGE_SECRET },
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: `Bridge error: ${text}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: `Cannot reach bridge: ${err.message}` });
  }
});

// ── Model selector (via OpenClaw CLI) ───────────────────────────────────────

router.get('/model', (req, res) => {
  try {
    const out = execSync('openclaw models status --json 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const data = JSON.parse(out);
    res.json({ model: data.defaultModel || data.resolvedDefault || 'unknown' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/model', async (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: 'model required' });
  try {
    // Change model via openclaw CLI (updates config + restarts gateway)
    execSync(`openclaw models set "${model}" 2>/dev/null`, { encoding: 'utf8', timeout: 10000 });
    res.json({ ok: true, model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agent model management ─────────────────────────────────────────────────

router.get('/agent-models', async (req, res) => {
  try {
    const response = await fetch(`${BRIDGE_URL}/agent-models`, {
      method: 'GET',
      headers: { 'x-sync-secret': BRIDGE_SECRET },
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: `Bridge error: ${text}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: `Cannot reach bridge: ${err.message}` });
  }
});

router.post('/agent-models', async (req, res) => {
  const { agentId, model } = req.body;
  try {
    const response = await fetch(`${BRIDGE_URL}/agent-models`, {
      method: 'POST',
      headers: {
        'x-sync-secret': BRIDGE_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ agentId, model }),
    });
    if (!response.ok) {
      const text = await response.text();
      return res.status(502).json({ error: `Bridge error: ${text}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: `Cannot reach bridge: ${err.message}` });
  }
});

// ── Agent Capabilities (permissions) ───────────────────────────────────────

const ALL_CAPABILITIES = ['mail', 'jira', 'github'];
const CAPABILITY_INFO = {
  mail:   { name: 'Email', icon: 'Mail' },
  jira:   { name: 'Jira', icon: 'Ticket' },
  github: { name: 'GitHub', icon: 'Github' },
};

// GET /api/system/agent-capabilities
router.get('/agent-capabilities', (req, res) => {
  try {
    const rows = db.prepare('SELECT agent_id, capability, enabled FROM agent_capabilities').all();
    
    // Build response grouped by agent
    const result = {};
    for (const agentId of Object.keys(AGENT_STATUS_DEFAULTS)) {
      result[agentId] = {};
      for (const cap of ALL_CAPABILITIES) {
        result[agentId][cap] = false; // default off
      }
    }
    
    // Apply DB values
    for (const row of rows) {
      if (result[row.agent_id]) {
        result[row.agent_id][row.capability] = Boolean(row.enabled);
      }
    }
    
    res.json({
      capabilities: result,
      available: ALL_CAPABILITIES,
      info: CAPABILITY_INFO,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/system/agent-capabilities/:agentId/:capability
router.put('/agent-capabilities/:agentId/:capability', (req, res) => {
  const { agentId, capability } = req.params;
  const { enabled } = req.body;
  
  if (!Object.hasOwn(AGENT_STATUS_DEFAULTS, agentId)) {
    return res.status(400).json({ error: 'agentId inválido' });
  }
  if (!ALL_CAPABILITIES.includes(capability)) {
    return res.status(400).json({ error: `capability inválida. Usar: ${ALL_CAPABILITIES.join(', ')}` });
  }
  
  try {
    db.prepare(`
      INSERT INTO agent_capabilities (agent_id, capability, enabled, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id, capability) DO UPDATE SET
        enabled    = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(agentId, capability, enabled ? 1 : 0);
    
    res.json({ ok: true, agentId, capability, enabled: Boolean(enabled) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/system/capability-action
// Execute an action (email, jira comment, etc.) — checks permissions first
router.post('/capability-action', (req, res) => {
  const { agentId, capability, action, payload } = req.body;
  
  if (!agentId || !capability || !action) {
    return res.status(400).json({ error: 'agentId, capability, and action required' });
  }
  
  // Check permission
  const row = db.prepare(
    'SELECT enabled FROM agent_capabilities WHERE agent_id = ? AND capability = ?'
  ).get(agentId, capability);
  
  if (!row || !row.enabled) {
    return res.status(403).json({ 
      error: `Agent '${agentId}' no tiene permiso para '${capability}'`,
      code: 'PERMISSION_DENIED'
    });
  }
  
  // Execute the action based on capability + action + payload
  try {
    switch (capability) {
      case 'mail': {
        if (action !== 'send') {
          return res.status(400).json({ error: `Mail action '${action}' not supported. Use 'send'.` });
        }
        
        const { to, subject, body } = payload || {};
        if (!to || !subject) {
          return res.status(400).json({ error: 'Mail requires: to, subject (body optional)' });
        }
        
        // Format subject with agent prefix: KAI CORE - Subject
        const agentLabel = agentId.toUpperCase();
        const fullSubject = `KAI ${agentLabel} - ${subject}`;
        const mailBody = body || '(sin contenido)';
        
        // Build email with proper headers
        const email = [
          `To: ${to}`,
          `Subject: ${fullSubject}`,
          `From: kai.live.dev@gmail.com`,
          `Content-Type: text/plain; charset=utf-8`,
          '',
          mailBody
        ].join('\n');
        
        // Send via msmtp using temp file (avoids shell escaping issues)
        const { execSync } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        const tmpFile = path.join(os.tmpdir(), `kai-mail-${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, email, 'utf8');
        
        try {
          execSync(`msmtp -a gmail "${to}" < "${tmpFile}"`, {
            timeout: 30000,
            shell: '/bin/bash'
          });
        } finally {
          fs.unlinkSync(tmpFile); // Clean up
        }
        
        console.log(`[MAIL] Sent from ${agentId}: "${fullSubject}" -> ${to}`);
        
        return res.json({ 
          ok: true, 
          agentId, 
          capability,
          action,
          details: { to, subject: fullSubject }
        });
      }
      
      case 'github': {
        const { execSync } = require('child_process');
        const { repo, message, branch, files } = payload || {};
        
        // Validate repo path exists
        if (!repo) {
          return res.status(400).json({ error: 'GitHub requires: repo (path to repository)' });
        }
        
        // Security: only allow repos under /home/kai
        const repoPath = repo.startsWith('/') ? repo : `/home/kai/projects/${repo}`;
        if (!repoPath.startsWith('/home/kai/')) {
          return res.status(403).json({ error: 'Repository must be under /home/kai/' });
        }
        
        // Check repo exists
        const fs = require('fs');
        if (!fs.existsSync(repoPath)) {
          return res.status(404).json({ error: `Repository not found: ${repoPath}` });
        }
        
        const agentLabel = agentId.toUpperCase();
        const gitEnv = {
          GIT_SSH_COMMAND: 'ssh -i /home/kai/.ssh/github_kai -o StrictHostKeyChecking=no'
        };
        const execOpts = { 
          cwd: repoPath, 
          timeout: 60000, 
          encoding: 'utf8',
          env: { ...process.env, ...gitEnv }
        };
        
        let result = {};
        
        switch (action) {
          case 'status': {
            const status = execSync('git status --porcelain', execOpts).trim();
            const branch = execSync('git branch --show-current', execOpts).trim();
            result = { branch, changes: status.split('\n').filter(Boolean) };
            break;
          }
          
          case 'commit': {
            if (!message) {
              return res.status(400).json({ error: 'Commit requires: message' });
            }
            const commitMsg = `[${agentLabel}] ${message}`;
            
            // Add files (specific or all)
            if (files && Array.isArray(files)) {
              for (const f of files) {
                execSync(`git add "${f}"`, execOpts);
              }
            } else {
              execSync('git add -A', execOpts);
            }
            
            const commitOut = execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, execOpts);
            console.log(`[GITHUB] Commit from ${agentId} in ${repoPath}: "${commitMsg}"`);
            result = { committed: true, message: commitMsg };
            break;
          }
          
          case 'push': {
            const targetBranch = branch || 'main';
            const pushOut = execSync(`git push origin ${targetBranch}`, execOpts);
            console.log(`[GITHUB] Push from ${agentId} in ${repoPath} to ${targetBranch}`);
            result = { pushed: true, branch: targetBranch };
            break;
          }
          
          case 'commit-push': {
            if (!message) {
              return res.status(400).json({ error: 'Commit-push requires: message' });
            }
            const commitMsg = `[${agentLabel}] ${message}`;
            const targetBranch = branch || 'main';
            
            // Add files
            if (files && Array.isArray(files)) {
              for (const f of files) {
                execSync(`git add "${f}"`, execOpts);
              }
            } else {
              execSync('git add -A', execOpts);
            }
            
            // Commit
            execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, execOpts);
            
            // Push
            execSync(`git push origin ${targetBranch}`, execOpts);
            
            console.log(`[GITHUB] Commit+Push from ${agentId} in ${repoPath}: "${commitMsg}" -> ${targetBranch}`);
            result = { committed: true, pushed: true, message: commitMsg, branch: targetBranch };
            break;
          }
          
          case 'pull': {
            const targetBranch = branch || 'main';
            execSync(`git pull origin ${targetBranch}`, execOpts);
            console.log(`[GITHUB] Pull from ${agentId} in ${repoPath} from ${targetBranch}`);
            result = { pulled: true, branch: targetBranch };
            break;
          }
          
          case 'clone': {
            const { url, dest } = payload || {};
            if (!url) {
              return res.status(400).json({ error: 'Clone requires: url' });
            }
            const destPath = dest || `/home/kai/projects/${url.split('/').pop().replace('.git', '')}`;
            execSync(`git clone "${url}" "${destPath}"`, { ...execOpts, cwd: '/home/kai/projects' });
            console.log(`[GITHUB] Clone from ${agentId}: ${url} -> ${destPath}`);
            result = { cloned: true, path: destPath };
            break;
          }
          
          default:
            return res.status(400).json({ 
              error: `GitHub action '${action}' not supported. Use: status, commit, push, commit-push, pull, clone` 
            });
        }
        
        return res.json({ ok: true, agentId, capability, action, details: result });
      }
      
      case 'jira':
      case 'telegram':
      case 'slack':
        return res.status(501).json({ 
          error: `Capability '${capability}' action '${action}' not implemented yet`,
          code: 'NOT_IMPLEMENTED'
        });
      
      default:
        return res.status(400).json({ error: `Unknown capability: ${capability}` });
    }
  } catch (err) {
    console.error(`[CAPABILITY ERROR] ${capability}/${action}:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Inbox (IMAP) ───────────────────────────────────────────────────────────
const mailService = require('../services/mailService');

router.get('/inbox', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 15;
    const data = await mailService.fetchInbox(limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inbox/:uid', async (req, res) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    if (!uid) return res.status(400).json({ error: 'invalid uid' });
    const data = await mailService.fetchEmail(uid);
    if (!data) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/inbox/:uid/read', async (req, res) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    if (!uid) return res.status(400).json({ error: 'invalid uid' });
    await mailService.markAsRead(uid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/inbox/:uid', async (req, res) => {
  try {
    const uid = parseInt(req.params.uid, 10);
    if (!uid) return res.status(400).json({ error: 'invalid uid' });
    await mailService.deleteEmail(uid);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
