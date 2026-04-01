const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

function getDb() {
  return new Database(path.join(__dirname, '..', 'data', 'kai_doc.db'));
}

// GET / — list tasks (active first, then done)
router.get('/', (req, res) => {
  const db = getDb();
  try {
    let sql = 'SELECT * FROM todos';
    const params = [];
    if (req.query.done !== undefined) {
      sql += ' WHERE done = ?';
      params.push(+req.query.done);
    }
    sql += ' ORDER BY done ASC, completed_at DESC, position ASC, created_at DESC';
    const tasks = db.prepare(sql).all(...params);
    res.json({ tasks });
  } finally { db.close(); }
});

// POST / — create task
router.post('/', (req, res) => {
  const { text, tag, due_at, notified, priority } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  const db = getDb();
  try {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) as m FROM todos WHERE done = 0').get();
    const result = db.prepare(
      'INSERT INTO todos (text, tag, due_at, notified, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(text.trim(), tag || null, due_at || null, notified ?? 1, priority || 'baja', (maxPos.m || 0) + 1);

    const task = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(task);
  } finally { db.close(); }
});

// PATCH /:id — update task
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const fields = [];
    const values = [];

    if (req.body.text !== undefined) { fields.push('text = ?'); values.push(req.body.text); }
    if (req.body.tag !== undefined) { fields.push('tag = ?'); values.push(req.body.tag || null); }
    if (req.body.due_at !== undefined) { fields.push('due_at = ?'); values.push(req.body.due_at || null); }
    if (req.body.position !== undefined) { fields.push('position = ?'); values.push(req.body.position); }
    if (req.body.notified !== undefined) { fields.push('notified = ?'); values.push(req.body.notified ? 1 : 0); }
    if (req.body.priority !== undefined) { fields.push('priority = ?'); values.push(req.body.priority || 'baja'); }
    if (req.body.done !== undefined) {
      fields.push('done = ?');
      values.push(req.body.done ? 1 : 0);
      if (req.body.done) {
        fields.push("completed_at = datetime('now')");
      } else {
        fields.push('completed_at = NULL');
      }
    }

    if (fields.length === 0) return res.json(existing);

    values.push(id);
    db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    res.json(updated);
  } finally { db.close(); }
});

// DELETE /:id — delete task
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const db = getDb();
  try {
    const result = db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } finally { db.close(); }
});

// GET /due — tasks with due_at passed and not notified
router.get('/due', (req, res) => {
  const db = getDb();
  try {
    const tasks = db.prepare(`
      SELECT * FROM todos 
      WHERE done = 0 AND due_at IS NOT NULL AND notified = 0 
      AND due_at <= datetime('now')
      ORDER BY due_at ASC
    `).all();
    res.json({ tasks });
  } finally { db.close(); }
});

// POST /:id/notified — mark as notified
router.post('/:id/notified', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  try {
    db.prepare('UPDATE todos SET notified = 1 WHERE id = ?').run(id);
    res.json({ ok: true });
  } finally { db.close(); }
});

// ── Day notes ───────────────────────────────────────────────────────────────
// GET /days/:date
router.get('/days/:date', (req, res) => {
  const db = getDb();
  try {
    const note = db.prepare('SELECT * FROM day_notes WHERE date = ?').get(req.params.date);
    res.json(note || { date: req.params.date, color: null, icon: null, note: null });
  } finally { db.close(); }
});

// GET /days?month=2026-03 — all notes for a month
router.get('/days', (req, res) => {
  const month = req.query.month;
  if (!month) return res.json({ days: [] });
  const db = getDb();
  try {
    const days = db.prepare("SELECT * FROM day_notes WHERE date LIKE ? || '%'").all(month);
    res.json({ days });
  } finally { db.close(); }
});

// PUT /days/:date
router.put('/days/:date', (req, res) => {
  const { color, icon, note } = req.body;
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO day_notes (date, color, icon, note) VALUES (?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET color=excluded.color, icon=excluded.icon, note=excluded.note
    `).run(req.params.date, color || null, icon || null, note || null);

    // Clean up empty entries
    if (!color && !icon && !note) {
      db.prepare('DELETE FROM day_notes WHERE date = ?').run(req.params.date);
    }

    res.json({ ok: true });
  } finally { db.close(); }
});

module.exports = router;
