const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /api/briefing/today — get today's articles
router.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const articles = db.prepare(
    'SELECT * FROM briefing_articles WHERE date = ? ORDER BY id ASC'
  ).all(today);
  res.json({ date: today, articles });
});

// GET /api/briefing/latest — get most recent articles (any date)
router.get('/latest', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const articles = db.prepare(
    'SELECT * FROM briefing_articles ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
  res.json({ articles });
});

// GET /api/briefing/:id — get single article
router.get('/:id', (req, res) => {
  const article = db.prepare(
    'SELECT * FROM briefing_articles WHERE id = ?'
  ).get(req.params.id);
  if (!article) return res.status(404).json({ error: 'not found' });
  res.json(article);
});

// POST /api/briefing — add articles (used by cron/Kai)
router.post('/', (req, res) => {
  const { articles, date } = req.body;
  if (!articles || !Array.isArray(articles)) {
    return res.status(400).json({ error: 'articles array required' });
  }
  const d = date || new Date().toISOString().slice(0, 10);
  const insert = db.prepare(
    'INSERT INTO briefing_articles (date, title, source, url, image, summary, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((items) => {
    // Clean: remove existing articles for this date (replace, not accumulate)
    db.prepare('DELETE FROM briefing_articles WHERE date = ?').run(d);
    // Purge: remove articles older than 30 days
    db.prepare("DELETE FROM briefing_articles WHERE date < date('now', '-30 days')").run();
    for (const a of items) {
      insert.run(d, a.title, a.source || '', a.url || '', a.image || null, a.summary || null, a.category || 'tech');
    }
  });
  tx(articles);
  res.json({ ok: true, count: articles.length, replaced: true });
});

module.exports = router;
