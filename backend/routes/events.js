const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

function getDb() {
  return new Database(path.join(__dirname, '..', 'data', 'kai_doc.db'));
}

// GET /upcoming — MUST be before /:id
router.get('/upcoming', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  const today = new Date().toISOString().substring(0, 10);
  const db = getDb();
  try {
    const events = db.prepare(`
      SELECT * FROM events 
      WHERE (date >= ? AND end_date IS NULL)
         OR (end_date >= ?)
      ORDER BY date ASC, time ASC
      LIMIT ?
    `).all(today, today, limit);
    res.json({ events });
  } finally { db.close(); }
});

// GET /?date=YYYY-MM-DD or ?month=YYYY-MM
router.get('/', (req, res) => {
  const db = getDb();
  try {
    if (req.query.date) {
      const d = req.query.date;
      const events = db.prepare(`
        SELECT * FROM events 
        WHERE (date = ? AND end_date IS NULL)
           OR (date <= ? AND end_date >= ?)
        ORDER BY time ASC, created_at ASC
      `).all(d, d, d);
      return res.json({ events });
    }
    if (req.query.month) {
      const monthStart = `${req.query.month}-01`;
      const monthEnd = `${req.query.month}-31`;
      const events = db.prepare(`
        SELECT * FROM events 
        WHERE (date LIKE ? || '%' AND end_date IS NULL)
           OR (date <= ? AND end_date >= ?)
        ORDER BY date ASC, time ASC
      `).all(req.query.month, monthEnd, monthStart);
      return res.json({ events });
    }
    const events = db.prepare('SELECT * FROM events ORDER BY date ASC, time ASC LIMIT 100').all();
    res.json({ events });
  } finally { db.close(); }
});

// POST /
router.post('/', (req, res) => {
  const { title, date, end_date, time, color, note, notify } = req.body;
  if (!title?.trim() || !date) return res.status(400).json({ error: 'title and date required' });

  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO events (title, date, end_date, time, color, note, notify) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(title.trim(), date, end_date || null, time || null, color || null, note || null, notify ? 1 : 0);

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(event);
  } finally { db.close(); }
});

// PATCH /:id
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const fields = [];
    const values = [];

    if (req.body.notify !== undefined) {
      fields.push('notify = ?');
      values.push(req.body.notify ? 1 : 0);
    }
    for (const key of ['title', 'date', 'end_date', 'time', 'end_time', 'color', 'note']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(req.body[key] || null);
      }
    }

    if (fields.length === 0) return res.json(existing);

    values.push(id);
    db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    res.json(updated);
  } finally { db.close(); }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const db = getDb();
  try {
    const result = db.prepare('DELETE FROM events WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } finally { db.close(); }
});

module.exports = router;
