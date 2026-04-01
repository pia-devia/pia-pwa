const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middlewares/auth');
const db = require('../db');

const router = express.Router();
router.use(authMiddleware);

// ── Last activity detection ───────────────────────────────────────────────
function getLastActivity(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return null;

  let gitDate = null;
  let fsDate = null;

  // Git: check code/ subfolder first, then root
  const gitCandidates = [
    path.join(projectPath, 'code'),
    projectPath,
  ];
  for (const dir of gitCandidates) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      try {
        const raw = execSync('git log -1 --format=%aI 2>/dev/null', {
          cwd: dir, encoding: 'utf8', timeout: 3000,
        }).trim();
        if (raw) { gitDate = { date: raw, source: 'git' }; break; }
      } catch { /* ignore */ }
    }
  }

  // Filesystem: most recent mtime (skip node_modules/dist/.git)
  try {
    const raw = execSync(
      `find "${projectPath}" -type f \\( -name "*.md" -o -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.json" -o -name "*.css" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -printf '%T@\\n' | sort -rn | head -1`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (raw) {
      fsDate = { date: new Date(parseFloat(raw) * 1000).toISOString(), source: 'fs' };
    }
  } catch { /* ignore */ }

  // Return the most recent of both
  if (gitDate && fsDate) {
    return new Date(gitDate.date) >= new Date(fsDate.date) ? gitDate : fsDate;
  }
  return gitDate || fsDate || null;
}

function getLastActivityForDir(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return null;

  // Git (if .git exists in this dir)
  let gitDate = null;
  if (fs.existsSync(path.join(dirPath, '.git'))) {
    try {
      const raw = execSync('git log -1 --format=%aI 2>/dev/null', {
        cwd: dirPath, encoding: 'utf8', timeout: 3000,
      }).trim();
      if (raw) gitDate = { date: raw, source: 'git' };
    } catch { /* ignore */ }
  }

  // Filesystem
  let fsDate = null;
  try {
    const raw = execSync(
      `find "${dirPath}" -type f \\( -name "*.md" -o -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.json" -o -name "*.css" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -printf '%T@\\n' | sort -rn | head -1`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (raw) fsDate = { date: new Date(parseFloat(raw) * 1000).toISOString(), source: 'fs' };
  } catch { /* ignore */ }

  if (gitDate && fsDate) {
    return new Date(gitDate.date) >= new Date(fsDate.date) ? gitDate : fsDate;
  }
  return gitDate || fsDate || null;
}

// ── GET /api/projects ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status } = req.query;
  let rows;
  if (status && status !== 'all') {
    rows = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY priority DESC, updated_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM projects ORDER BY priority DESC, updated_at DESC').all();
  }

  const enriched = rows.map(r => {
    const activity = getLastActivity(r.path);
    const docActivity = r.path ? getLastActivityForDir(path.join(r.path, 'doc')) : null;
    const codeActivity = r.path ? getLastActivityForDir(path.join(r.path, 'code')) : null;
    return {
      ...r,
      stack: JSON.parse(r.stack || '[]'),
      last_activity: activity?.date || r.updated_at,
      activity_source: activity?.source || 'db',
      doc_activity: docActivity?.date || null,
      code_activity: codeActivity?.date || null,
      has_doc: r.path ? fs.existsSync(path.join(r.path, 'doc')) : false,
      has_code: r.path ? fs.existsSync(path.join(r.path, 'code')) : false,
    };
  });

  res.json(enriched);
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? OR slug = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ ...row, stack: JSON.parse(row.stack || '[]') });
});

// ── POST /api/projects ────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { slug, name, description, status, domain, port, stack, repo, path, color, priority } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug y name son requeridos' });

  try {
    const result = db.prepare(`
      INSERT INTO projects (slug, name, description, status, domain, port, stack, repo, path, color, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      slug, name,
      description || '',
      status || 'idea',
      domain || null,
      port || null,
      JSON.stringify(stack || []),
      repo || null,
      path || null,
      color || null,
      priority || 0
    );
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.json({ ...row, stack: JSON.parse(row.stack || '[]') });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Slug ya existe' });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/projects/:id ─────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ? OR slug = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const fields = ['name', 'description', 'status', 'domain', 'port', 'repo', 'path', 'color', 'priority', 'slug'];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  // Stack needs JSON serialization
  if (req.body.stack !== undefined) {
    updates.push('stack = ?');
    values.push(JSON.stringify(req.body.stack));
  }

  if (updates.length === 0) return res.json({ ...row, stack: JSON.parse(row.stack || '[]') });

  updates.push("updated_at = datetime('now')");
  values.push(row.id);

  try {
    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id);
    res.json({ ...updated, stack: JSON.parse(updated.stack || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM projects WHERE id = ? OR slug = ?').run(req.params.id, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
  res.json({ ok: true });
});

module.exports = router;
