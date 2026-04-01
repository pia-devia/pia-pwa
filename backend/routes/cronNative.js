const express = require('express');
const router = express.Router();

const GW_HOST = process.env.OPENCLAW_GATEWAY_HOST || '127.0.0.1';
const GW_PORT = process.env.OPENCLAW_CORE_PORT || 18789;
const GW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const GW_URL = `http://${GW_HOST}:${GW_PORT}/tools/invoke`;

async function invokeCron(args) {
  const res = await fetch(GW_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GW_TOKEN}`,
    },
    body: JSON.stringify({ tool: 'cron', args }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    const msg = data?.error?.message || data?.error || 'Gateway error';
    throw new Error(msg);
  }
  // The result is wrapped in content[0].text as JSON string
  const content = data.result?.content;
  if (content?.[0]?.text) {
    try { return JSON.parse(content[0].text); } catch {}
  }
  return data.result;
}

// GET /api/cron-native — list all native cron jobs
router.get('/', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'list', includeDisabled: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron-native/status — scheduler status
router.get('/status', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'status' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron-native — create a native cron job
router.post('/', async (req, res) => {
  try {
    const { name, schedule, type, text, message, session, tz, every, at, model, thinking, disabled, startAt } = req.body;

    const job = {
      name: name || undefined,
      sessionTarget: (type === 'agent') ? 'isolated' : 'main',
      enabled: startAt ? false : !disabled,
    };

    // Schedule
    if (schedule) {
      job.schedule = { kind: 'cron', expr: schedule, tz: tz || 'Europe/Madrid' };
    } else if (every) {
      const ms = parseDurationToMs(every);
      job.schedule = { kind: 'every', everyMs: ms };
    } else if (at) {
      // Convert relative duration (e.g. "5m", "1h") to absolute ISO timestamp
      const atMs = parseDurationToMs(at);
      const atDate = new Date(Date.now() + atMs);
      job.schedule = { kind: 'at', at: atDate.toISOString() };
      job.deleteAfterRun = false;
    }

    // Payload
    if (type === 'system-event' || type === 'kai') {
      job.payload = { kind: 'systemEvent', text: text || '' };
    } else if (type === 'agent') {
      job.payload = { kind: 'agentTurn', message: message || '' };
      if (model) job.payload.model = model;
      if (thinking) job.payload.thinking = thinking;
    }

    const result = await invokeCron({ action: 'add', job });

    // If startAt provided, store in native_cron_starts for auto-activation
    if (startAt && result?.id) {
      const db = require('../db');
      db.prepare('INSERT INTO native_cron_starts (native_job_id, starts_at) VALUES (?, ?)').run(result.id, startAt);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cron-native/:id — update a native cron job
router.patch('/:id', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'update', jobId: req.params.id, patch: req.body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cron-native/:id — remove a native cron job
router.delete('/:id', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'remove', jobId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron-native/:id/run — trigger a job now
router.post('/:id/run', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'run', jobId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron-native/:id/enable — enable a job
router.post('/:id/enable', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'update', jobId: req.params.id, patch: { enabled: true } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron-native/:id/disable — disable a job
router.post('/:id/disable', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'update', jobId: req.params.id, patch: { enabled: false } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron-native/:id/runs — get run history
router.get('/:id/runs', async (req, res) => {
  try {
    const result = await invokeCron({ action: 'runs', jobId: req.params.id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper ─────────────────────────────────────────────────────────────────
// GET /api/cron-native/runs — fetch execution history for all native jobs
router.get('/runs', async (req, res) => {
  try {
    // First get all native jobs
    const listResult = await invokeCron({ action: 'list', includeDisabled: true });
    const jobs = listResult.jobs || [];

    // Fetch runs for each job in parallel
    const allRuns = [];
    await Promise.all(jobs.map(async (job) => {
      try {
        const runsResult = await invokeCron({ action: 'runs', jobId: job.id });
        const entries = runsResult.entries || [];
        for (const entry of entries) {
          if (entry.action !== 'finished') continue;
          const payload = job.payload || {};
          const type = payload.kind === 'agentTurn' ? 'kai-agent' : 'kai';
          allRuns.push({
            id: allRuns.length + 1,
            job_id: job.id,
            job_name: job.name || '(sin nombre)',
            job_type: type,
            source: 'native',
            status: entry.status === 'ok' ? 'ok' : 'error',
            duration_ms: entry.durationMs || 0,
            result_text: entry.summary || '',
            executed_at: new Date(entry.runAtMs).toISOString().replace('T', ' ').replace('Z', ''),
          });
        }
      } catch {}
    }));

    // Sort by executed_at descending
    allRuns.sort((a, b) => b.executed_at.localeCompare(a.executed_at));
    res.json(allRuns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseDurationToMs(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 1800000; // default 30m
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60000;
    case 'h': return n * 3600000;
    case 'd': return n * 86400000;
    default: return 1800000;
  }
}

module.exports = router;
