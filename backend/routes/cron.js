const express = require('express');
const cronService = require('../services/cronService');
const router = express.Router();

// GET /api/cron — list all jobs
router.get('/', (req, res) => {
  try {
    const jobs = cronService.listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/history — execution history (BEFORE /:id to avoid conflict)
router.get('/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const db = require('../db');
    const conditions = [];
    const params = [];

    if (req.query.status && req.query.status !== 'all') {
      conditions.push('status = ?');
      params.push(req.query.status);
    }
    if (req.query.from) {
      conditions.push('executed_at >= ?');
      params.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push('executed_at <= ?');
      params.push(req.query.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const rows = db.prepare(`
      SELECT * FROM cron_history
      ${where}
      ORDER BY executed_at DESC
      LIMIT ?
    `).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/:id — get single job
router.get('/:id', (req, res) => {
  try {
    const job = cronService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron — create job
router.post('/', (req, res) => {
  try {
    const { name, description, schedule, task_type, task_config, enabled, one_shot, starts_at } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const job = cronService.createJob({ name, description, schedule, task_type, task_config, enabled, one_shot, starts_at });
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cron/:id — update job
router.patch('/:id', (req, res) => {
  try {
    const job = cronService.updateJob(req.params.id, req.body);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cron/:id — delete job
router.delete('/:id', (req, res) => {
  try {
    cronService.deleteJob(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cron/:id/run — trigger job manually
router.post('/:id/run', async (req, res) => {
  try {
    const job = cronService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Run async, respond immediately
    cronService.runJob(job).catch(err => console.error('[cron] manual run error:', err));
    res.json({ ok: true, message: `Job "${job.name}" triggered` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
