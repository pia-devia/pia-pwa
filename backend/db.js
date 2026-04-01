const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'kai_doc.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Migrations ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'BACKLOG',
    priority    TEXT    DEFAULT 'Medio',
    effort      TEXT    DEFAULT 'Medio',
    task_type   TEXT    DEFAULT '',
    project     TEXT    DEFAULT '',
    assignee    TEXT    DEFAULT '',
    started_at  TEXT,
    finished_at TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    time        TEXT    DEFAULT NULL,
    end_time    TEXT    DEFAULT NULL,
    color       TEXT    DEFAULT NULL,
    note        TEXT    DEFAULT NULL,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  -- Acumulado diario de tokens de Claude
  CREATE TABLE IF NOT EXISTS claude_daily_usage (
    date          TEXT PRIMARY KEY,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0
  );

  -- Historial del chat PWA
  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,   -- 'user' | 'assistant'
    content    TEXT NOT NULL,
    agent_id   TEXT NOT NULL DEFAULT 'kai',  -- 'kai' | 'po-kai'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Último snapshot leído de sessions.json (para calcular deltas)
  CREATE TABLE IF NOT EXISTS claude_usage_snapshot (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    captured_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Límites manuales de claude.ai (el usuario los actualiza desde settings)
  CREATE TABLE IF NOT EXISTS claude_web_limits (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    session_pct              INTEGER NOT NULL DEFAULT 0,
    weekly_all_pct           INTEGER NOT NULL DEFAULT 0,
    weekly_sonnet_pct        INTEGER NOT NULL DEFAULT 0,
    session_resets_in        TEXT    DEFAULT '',
    weekly_resets_at         TEXT    DEFAULT '',
    estimated_weekly_limit   INTEGER DEFAULT NULL,
    calibrated_at            TEXT    DEFAULT NULL,
    updated_at               TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Runtime migrations (ALTER TABLE para columnas añadidas después) ──────
const alterMigrations = [
  `ALTER TABLE claude_web_limits ADD COLUMN estimated_weekly_limit INTEGER DEFAULT NULL`,
  `ALTER TABLE claude_web_limits ADD COLUMN calibrated_at TEXT DEFAULT NULL`,
  `ALTER TABLE claude_web_limits ADD COLUMN session_expired INTEGER DEFAULT 0`,
  `ALTER TABLE claude_web_limits ADD COLUMN session_key TEXT DEFAULT NULL`,
  // Vault PIN storage
  `CREATE TABLE IF NOT EXISTS vault_config (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash   TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Multi-agent support: add agent_id column to chat_messages
  `ALTER TABLE chat_messages ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'kai'`,
  // Mode isolation: add mode column to tasks and events
  `ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'CORE'`,
  // events migration removed — new schema
  // Vault PIN for PO mode (separate table — vault_config has CHECK(id=1))
  `CREATE TABLE IF NOT EXISTS vault_config_po (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash   TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Multi-profile Claude usage (personal, ntasys)
  `CREATE TABLE IF NOT EXISTS claude_web_limits_profiles (
    profile              TEXT PRIMARY KEY,
    session_pct          INTEGER NOT NULL DEFAULT 0,
    weekly_all_pct       INTEGER NOT NULL DEFAULT 0,
    weekly_sonnet_pct    INTEGER NOT NULL DEFAULT 0,
    session_resets_in    TEXT    DEFAULT '',
    weekly_resets_at     TEXT    DEFAULT '',
    session_expired      INTEGER DEFAULT 0,
    session_key          TEXT    DEFAULT NULL,
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  // Budget calculation columns for profiles
  `ALTER TABLE claude_web_limits_profiles ADD COLUMN weekly_resets_at_iso TEXT DEFAULT NULL`,
  `ALTER TABLE claude_web_limits_profiles ADD COLUMN weekly_available_pct REAL DEFAULT 0`,
  `ALTER TABLE claude_web_limits_profiles ADD COLUMN weekly_hours_until_reset REAL DEFAULT 0`,
  `ALTER TABLE claude_web_limits_profiles ADD COLUMN weekly_daily_budget_pct REAL DEFAULT 0`,
  // Agent settings: color, future display overrides
  `CREATE TABLE IF NOT EXISTS agent_settings (
    agent_id   TEXT PRIMARY KEY,
    color      TEXT NOT NULL DEFAULT '#00d4aa',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Agent runtime status: live | working | offline + optional task description
  `CREATE TABLE IF NOT EXISTS agent_status (
    agent_id   TEXT PRIMARY KEY,
    state      TEXT NOT NULL DEFAULT 'offline',
    task       TEXT DEFAULT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Briefing: daily news articles
  `CREATE TABLE IF NOT EXISTS briefing_articles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    title      TEXT NOT NULL,
    source     TEXT NOT NULL,
    url        TEXT NOT NULL,
    image      TEXT DEFAULT NULL,
    summary    TEXT DEFAULT NULL,
    category   TEXT DEFAULT 'tech',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];
for (const sql of alterMigrations) {
  try { db.exec(sql); } catch { /* column already exists — ignore */ }
}

// ─── Cleanup ───────────────────────────────────────────────────────────────
db.prepare("DELETE FROM otp_codes WHERE expires_at < datetime('now')").run();

// ─── Seed ──────────────────────────────────────────────────────────────────
// Events seed removed — new calendar events schema

// ── Cron Jobs ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cron_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    schedule    TEXT    NOT NULL DEFAULT '*/30 * * * *',
    task_type   TEXT    NOT NULL DEFAULT 'script',
    task_config TEXT    NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    status      TEXT    NOT NULL DEFAULT 'idle',
    last_run    TEXT    DEFAULT NULL,
    last_result TEXT    DEFAULT NULL,
    last_duration_ms INTEGER DEFAULT NULL,
    run_count   INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration: add starts_at column
try { db.exec(`ALTER TABLE cron_jobs ADD COLUMN starts_at TEXT DEFAULT NULL`); } catch {}

// Seed: sync de perfiles Claude
const cronCount = db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get();
if (cronCount.c === 0) {
  db.prepare(`
    INSERT INTO cron_jobs (name, description, schedule, task_type, task_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Sync Claude (DEVIA)',
    'Sincroniza consumo del perfil personal de claude.ai',
    '*/30 * * * *',
    'script',
    JSON.stringify({ command: 'node /home/kai/scripts/sync-claude-usage.js --profile personal' })
  );
  db.prepare(`
    INSERT INTO cron_jobs (name, description, schedule, task_type, task_config)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Sync Claude (NTASYS)',
    'Sincroniza consumo del perfil ntasys de claude.ai',
    '*/30 * * * *',
    'script',
    JSON.stringify({ command: 'node /home/kai/scripts/sync-claude-usage.js --profile ntasys' })
  );
  console.log('📦 DB seeded: cron jobs created');
}

// ── Projects ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'idea',
    domain      TEXT DEFAULT NULL,
    port        INTEGER DEFAULT NULL,
    stack       TEXT DEFAULT '[]',
    repo        TEXT DEFAULT NULL,
    path        TEXT DEFAULT NULL,
    color       TEXT DEFAULT NULL,
    priority    INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Seed projects if empty
const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects').get();
if (projectCount.c === 0) {
  const ins = db.prepare(`INSERT INTO projects (slug, name, description, status, domain, port, stack, repo, path, priority) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  ins.run('pwa','PWA Kai','Panel de control personal — chat, ficheros, proyectos, monitorización','active','kai.devia.team',80,'["React","Node","SQLite"]','git@github.com:kai-devia/pwa.git','/home/kai/projects/pwa',10);
  ins.run('pmp','PMP Trainer','App de preparación PMP con IA, preguntas adaptativas y analytics','active','pmp.devia.team',3002,'["React","Node","SQLite","OpenAI"]',null,'/home/kai/projects/pmp',8);
  ins.run('devia','Devia Web','Landing page y portal de devia.team','active','devia.team',3003,'["React","Vite"]','git@github.com:kai-devia/devia-web.git','/home/kai/projects/devia',6);
  ins.run('pia','Pia','IA personal de Paula — asistente con personalidad propia','active','pia.devia.team',3001,'["Node","OpenClaw"]',null,'/home/kai/projects/pia',7);
  ins.run('stockvision','StockVision','Análisis de mercados con IA — predicciones y alertas inteligentes','idea',null,null,'["Python","React","APIs"]',null,'/home/kai/projects/stockvision',3);
  ins.run('nas','NAS Setup','Configuración NAS doméstico — almacenamiento y backups','paused',null,null,'["Docker","Linux"]',null,'/home/kai/projects/nas',2);
  console.log('📦 DB seeded: 6 projects created');
}

console.log(`✅ SQLite ready at ${dbPath}`);

module.exports = db;

// ── Agent Capabilities ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (agent_id, capability)
  )
`);

// Default capabilities
const DEFAULT_CAPABILITIES = {
  core: ['mail', 'jira', 'github'],
  po:   ['jira'],
  fe:   ['jira', 'github'],
  be:   ['jira', 'github'],
  ux:   ['jira'],
  qa:   ['jira', 'github'],
};

// Seed defaults if table is empty
const count = db.prepare('SELECT COUNT(*) as c FROM agent_capabilities').get();
if (count.c === 0) {
  const insert = db.prepare('INSERT OR IGNORE INTO agent_capabilities (agent_id, capability, enabled) VALUES (?, ?, 1)');
  for (const [agentId, caps] of Object.entries(DEFAULT_CAPABILITIES)) {
    for (const cap of caps) {
      insert.run(agentId, cap);
    }
  }
}

// ── Cron execution history ────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cron_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT    NOT NULL,
    job_name    TEXT    NOT NULL,
    job_type    TEXT    NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'legacy',
    status      TEXT    NOT NULL DEFAULT 'ok',
    duration_ms INTEGER DEFAULT 0,
    result_text TEXT    DEFAULT '',
    executed_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cron_history_executed ON cron_history(executed_at);

  CREATE TABLE IF NOT EXISTS native_cron_starts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    native_job_id  TEXT    NOT NULL,
    starts_at      TEXT    NOT NULL,
    activated      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);
