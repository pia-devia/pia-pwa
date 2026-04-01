const { exec } = require('child_process');
const db = require('../db');

// ── Cron expression parser (minute hour dom month dow) ─────────────────────
function parseCronField(field, min, max) {
  if (field === '*') return null;
  const values = new Set();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const [, a, b] = rangeMatch;
      for (let i = parseInt(a, 10); i <= parseInt(b, 10); i++) values.add(i);
      continue;
    }
    const num = parseInt(part, 10);
    if (!isNaN(num)) values.add(num);
  }

  return values.size > 0 ? values : null;
}

function shouldRun(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minF, hourF, domF, monF, dowF] = parts;
  const checks = [
    [minF, date.getMinutes(), 0, 59],
    [hourF, date.getHours(), 0, 23],
    [domF, date.getDate(), 1, 31],
    [monF, date.getMonth() + 1, 1, 12],
    [dowF, date.getDay(), 0, 6],
  ];

  for (const [field, current, min, max] of checks) {
    const allowed = parseCronField(field, min, max);
    if (allowed && !allowed.has(current)) return false;
  }
  return true;
}

// ── Task executors ─────────────────────────────────────────────────────────
function executeScript(config) {
  return new Promise((resolve) => {
    const cmd = config.command;
    if (!cmd) return resolve({ ok: false, error: 'No command specified' });

    const start = Date.now();
    exec(cmd, { timeout: config.timeout || 120000, cwd: config.cwd || '/home/kai' }, (err, stdout, stderr) => {
      const duration = Date.now() - start;
      if (err) {
        resolve({ ok: false, error: err.message, stderr: stderr?.slice(-500), duration });
      } else {
        resolve({ ok: true, output: stdout?.slice(-500), duration });
      }
    });
  });
}

function executeHttp(config) {
  return new Promise(async (resolve) => {
    try {
      const start = Date.now();
      const res = await fetch(config.url, {
        method: config.method || 'GET',
        headers: config.headers || {},
        body: config.body ? JSON.stringify(config.body) : undefined,
      });
      const duration = Date.now() - start;
      const text = await res.text();
      resolve({ ok: res.ok, status: res.status, output: text.slice(-500), duration });
    } catch (err) {
      resolve({ ok: false, error: err.message, duration: 0 });
    }
  });
}

function executeEmail(config) {
  return new Promise((resolve) => {
    const { to, subject, body } = config;
    if (!to || !subject) return resolve({ ok: false, error: 'Missing to or subject' });

    const email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `From: kai.live.dev@gmail.com`,
      `Content-Type: text/plain; charset=utf-8`,
      '',
      body || '(sin contenido)',
    ].join('\n');

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tmpFile = path.join(os.tmpdir(), `kai-cron-mail-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, email, 'utf8');

    const start = Date.now();
    exec(`msmtp -a gmail "${to}" < "${tmpFile}"`, { timeout: 30000, shell: '/bin/bash' }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      const duration = Date.now() - start;
      if (err) {
        resolve({ ok: false, error: err.message, duration });
      } else {
        resolve({ ok: true, output: `Email enviado a ${to}`, duration });
      }
    });
  });
}

function executeKai(config) {
  return new Promise((resolve) => {
    const instruction = config.instruction;
    if (!instruction) return resolve({ ok: false, error: 'No instruction provided' });

    const start = Date.now();
    const body = JSON.stringify({ text: `[CRON TASK] ${instruction}`, mode: 'now' });

    const req = require('http').request({
      hostname: 'localhost',
      port: 18789,
      path: '/hooks/wake',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${process.env.OPENCLAW_HOOKS_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || ''}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const duration = Date.now() - start;
        resolve({ ok: res.statusCode < 400, output: data.slice(-500), duration });
      });
    });
    req.on('error', (err) => {
      const start2 = Date.now();
      exec(`openclaw cron wake "${instruction.replace(/"/g, '\\"')}"`, { timeout: 30000 }, (err2, stdout) => {
        const duration = Date.now() - start2;
        if (err2) resolve({ ok: false, error: `Gateway unreachable and CLI failed: ${err2.message}`, duration });
        else resolve({ ok: true, output: stdout?.slice(-500) || 'Sent to Kai', duration });
      });
    });
    req.write(body);
    req.end();
  });
}

const EXECUTORS = {
  script: executeScript,
  http: executeHttp,
  email: executeEmail,
  kai: executeKai,
};

// ── Error notification ─────────────────────────────────────────────────────
function buildErrorEmailHtml(job, errorText, config) {
  const now = new Date().toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    dateStyle: 'long',
    timeStyle: 'short',
  });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:20px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background-color:#dc2626;padding:28px 32px;">
          <h1 style="margin:0;font-size:22px;font-weight:600;color:#ffffff;">⚠️ Error en Cron Job</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px 0;font-size:13px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Información del Job</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="padding:6px 0;"><span style="display:inline-block;min-width:110px;font-weight:600;color:#6b7280;font-size:14px;">Nombre:</span><span style="color:#1f2937;font-size:14px;font-weight:600;">${esc(job.name)}</span></td></tr>
            <tr><td style="padding:6px 0;"><span style="display:inline-block;min-width:110px;font-weight:600;color:#6b7280;font-size:14px;">Descripción:</span><span style="color:#1f2937;font-size:14px;">${esc(job.description || '(sin descripción)')}</span></td></tr>
            <tr><td style="padding:6px 0;"><span style="display:inline-block;min-width:110px;font-weight:600;color:#6b7280;font-size:14px;">Tipo:</span><span style="color:#1f2937;font-size:14px;">${esc(job.task_type)}</span></td></tr>
            <tr><td style="padding:6px 0;"><span style="display:inline-block;min-width:110px;font-weight:600;color:#6b7280;font-size:14px;">Hora:</span><span style="color:#1f2937;font-size:14px;">${now}</span></td></tr>
          </table>
          <h2 style="margin:0 0 12px 0;font-size:13px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Error</h2>
          <div style="background-color:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin-bottom:24px;">
            <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:13px;color:#991b1b;white-space:pre-wrap;word-break:break-word;">${esc(errorText)}</pre>
          </div>
          <h2 style="margin:0 0 12px 0;font-size:13px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.5px;">Configuración</h2>
          <div style="background-color:#f9fafb;border:1px solid #e5e7eb;padding:16px;border-radius:4px;">
            <pre style="margin:0;font-family:'Courier New',Courier,monospace;font-size:12px;color:#374151;white-space:pre;overflow-x:auto;">${esc(JSON.stringify(config, null, 2))}</pre>
          </div>
        </td></tr>
        <tr><td style="border-top:1px solid #e5e7eb;padding:20px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">Kai Cron Service • ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendErrorNotification(job, errorText, config) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const htmlContent = buildErrorEmailHtml(job, errorText, config);
  const to = 'guillermo.lucia.dev@gmail.com';
  const subject = `⚠️ Error en cron job: ${job.name}`;

  // Build raw email with MIME headers for HTML
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const rawEmail = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `From: Kai <kai.live.dev@gmail.com>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    `Error en cron job: ${job.name}\n${errorText}`,
    '',
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    htmlContent,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const tmpFile = path.join(os.tmpdir(), `kai-cron-mail-${Date.now()}.eml`);
  fs.writeFileSync(tmpFile, rawEmail, 'utf8');

  return new Promise((resolve) => {
    exec(`msmtp -a gmail "${to}" < "${tmpFile}"`, { timeout: 30000, shell: '/bin/bash' }, (err) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) {
        console.error('[cron:notify] Failed to send error email:', err.message);
      } else {
        console.log('[cron:notify] Error email sent successfully');
      }
      resolve();
    });
  });
}

// ── Job state management ───────────────────────────────────────────────────
function markJobRunning(jobId) {
  db.prepare(`UPDATE cron_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`).run(jobId);
}

function updateJobAfterRun(jobId, result, resultText) {
  // Read fresh state from DB to get current error_count
  const current = db.prepare('SELECT error_count FROM cron_jobs WHERE id = ?').get(jobId);
  const currentErrorCount = current?.error_count || 0;

  const NOTIFY_AFTER_CONSECUTIVE_ERRORS = 3;

  const newStatus = result.ok ? 'idle' : 'error';
  const newErrorCount = result.ok ? 0 : currentErrorCount + 1;
  const shouldNotifyError = !result.ok && newErrorCount === NOTIFY_AFTER_CONSECUTIVE_ERRORS;

  db.prepare(`
    UPDATE cron_jobs SET
      status = ?,
      last_run = datetime('now'),
      last_result = ?,
      last_duration_ms = ?,
      run_count = run_count + 1,
      error_count = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(newStatus, resultText, result.duration || 0, newErrorCount, jobId);

  // Log to cron_history
  const jobInfo = db.prepare('SELECT name, task_type FROM cron_jobs WHERE id = ?').get(jobId);
  db.prepare(`
    INSERT INTO cron_history (job_id, job_name, job_type, source, status, duration_ms, result_text)
    VALUES (?, ?, ?, 'legacy', ?, ?, ?)
  `).run(
    String(jobId),
    jobInfo?.name || `Job ${jobId}`,
    jobInfo?.task_type || 'unknown',
    result.ok ? 'ok' : 'error',
    result.duration || 0,
    (resultText || '').slice(0, 500)
  );

  console.log(`[cron:state] Job ${jobId}: status=${newStatus}, error_count: ${currentErrorCount} -> ${newErrorCount}, notify=${shouldNotifyError}`);

  // Auto-disable one-shot jobs after successful run
  if (result.ok) {
    const fullJob = db.prepare('SELECT one_shot FROM cron_jobs WHERE id = ?').get(jobId);
    if (fullJob?.one_shot) {
      db.prepare('UPDATE cron_jobs SET enabled = 0, updated_at = datetime(\'now\') WHERE id = ?').run(jobId);
      console.log(`[cron:one-shot] Job ${jobId} disabled after successful one-shot run`);
    }
  }

  return { shouldNotifyError, newErrorCount, newStatus };
}

// ── Run a specific job ─────────────────────────────────────────────────────
async function runJob(job) {
  const executor = EXECUTORS[job.task_type];
  if (!executor) {
    console.error(`[cron] Unknown task_type: ${job.task_type} for job ${job.id}`);
    return;
  }

  console.log(`[cron] Running: ${job.name} (${job.schedule})`);
  markJobRunning(job.id);

  let config;
  try { config = JSON.parse(job.task_config); } catch { config = {}; }

  const result = await executor(config);

  const resultText = result.ok
    ? (result.output || 'OK').slice(-500)
    : (result.error || result.stderr || 'Error').slice(-500);

  const { shouldNotifyError } = updateJobAfterRun(job.id, result, resultText);

  console.log(`[cron] ${job.name}: ${result.ok ? 'OK' : 'FAIL'} (${result.duration}ms)`);

  // Notify only after 3 consecutive errors (avoids spam on intermittent failures)
  if (shouldNotifyError) {
    sendErrorNotification(job, resultText, config);
  }
}

// ── Scheduler tick (called every minute) ───────────────────────────────────
let _tickInterval = null;

function tick() {
  const now = new Date();
  const nowIso = now.toISOString();

  // Safety: reset jobs stuck in 'running' for more than 5 minutes
  const stuckJobs = db.prepare(`
    SELECT * FROM cron_jobs WHERE status = 'running'
    AND updated_at < datetime('now', '-5 minutes')
  `).all();
  for (const job of stuckJobs) {
    console.warn(`[cron] Unsticking job "${job.name}" (stuck since ${job.updated_at})`);
    db.prepare(`
      UPDATE cron_jobs SET status = 'error', last_result = 'Timeout: job stuck in running state',
      error_count = error_count + 1, updated_at = datetime('now') WHERE id = ?
    `).run(job.id);
  }

  // Auto-activate jobs whose starts_at has arrived
  const pending = db.prepare(`SELECT * FROM cron_jobs WHERE enabled = 0 AND starts_at IS NOT NULL AND starts_at <= ?`).all(nowIso);
  for (const job of pending) {
    console.log(`[cron] Activating scheduled job: ${job.name} (starts_at: ${job.starts_at})`);
    db.prepare(`UPDATE cron_jobs SET enabled = 1, starts_at = NULL, status = 'idle', updated_at = datetime('now') WHERE id = ?`).run(job.id);
  }

  // Auto-activate native cron jobs whose starts_at has arrived
  const pendingNative = db.prepare(`SELECT * FROM native_cron_starts WHERE activated = 0 AND starts_at <= ?`).all(nowIso);
  for (const entry of pendingNative) {
    console.log(`[cron] Activating native job: ${entry.native_job_id} (starts_at: ${entry.starts_at})`);
    const GW_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1';
    const GW_PORT = process.env.OPENCLAW_CORE_PORT || 18789;
    const GW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
    fetch(`http://${GW_HOST}:${GW_PORT}/tools/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GW_TOKEN}` },
      body: JSON.stringify({ tool: 'cron', args: { action: 'update', jobId: entry.native_job_id, patch: { enabled: true } } }),
    }).then(() => {
      db.prepare('UPDATE native_cron_starts SET activated = 1 WHERE id = ?').run(entry.id);
      console.log(`[cron] Native job ${entry.native_job_id} activated`);
    }).catch(err => console.error(`[cron] Failed to activate native job ${entry.native_job_id}:`, err.message));
  }

  // Run enabled jobs that match current time
  const jobs = db.prepare(`SELECT * FROM cron_jobs WHERE enabled = 1 AND status != 'running'`).all();
  for (const job of jobs) {
    if (shouldRun(job.schedule, now)) {
      runJob(job).catch(err => console.error(`[cron] Job ${job.id} error:`, err));
    }
  }
}

function start() {
  if (_tickInterval) return;
  console.log('[cron] Scheduler started');
  const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000;
  setTimeout(() => {
    tick();
    _tickInterval = setInterval(tick, 60_000);
  }, msUntilNextMinute);
}

function stop() {
  if (_tickInterval) {
    clearInterval(_tickInterval);
    _tickInterval = null;
  }
}

// ── CRUD helpers ───────────────────────────────────────────────────────────
function listJobs() {
  return db.prepare('SELECT * FROM cron_jobs ORDER BY enabled DESC, name ASC').all();
}

function getJob(id) {
  return db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id);
}

function createJob({ name, description, schedule, task_type, task_config, enabled, starts_at, one_shot }) {
  const actualEnabled = starts_at ? 0 : (enabled !== undefined ? (enabled ? 1 : 0) : 1);
  const actualStatus = starts_at ? 'scheduled' : 'idle';

  const result = db.prepare(`
    INSERT INTO cron_jobs (name, description, schedule, task_type, task_config, enabled, starts_at, status, one_shot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description || '',
    schedule || '*/30 * * * *',
    task_type || 'script',
    typeof task_config === 'string' ? task_config : JSON.stringify(task_config || {}),
    actualEnabled,
    starts_at || null,
    actualStatus,
    one_shot ? 1 : 0
  );
  return getJob(result.lastInsertRowid);
}

function updateJob(id, updates) {
  const job = getJob(id);
  if (!job) return null;

  const fields = [];
  const values = [];

  for (const key of ['name', 'description', 'schedule', 'task_type', 'task_config', 'enabled', 'starts_at', 'one_shot']) {
    if (updates[key] !== undefined) {
      let val = updates[key];
      if (key === 'task_config' && typeof val !== 'string') val = JSON.stringify(val);
      if (key === 'enabled') val = val ? 1 : 0;
      fields.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0) return job;

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  db.prepare(`UPDATE cron_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getJob(id);
}

function deleteJob(id) {
  db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
}

module.exports = { start, stop, tick, listJobs, getJob, createJob, updateJob, deleteJob, runJob };
