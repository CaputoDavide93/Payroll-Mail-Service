import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// All persistent state lives under DATA_DIR so it survives container/app restarts.
export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'mail-service.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    smtp_host    TEXT    NOT NULL DEFAULT 'smtp.gmail.com',
    smtp_port    INTEGER NOT NULL DEFAULT 465,
    smtp_secure  INTEGER NOT NULL DEFAULT 1,
    smtp_user    TEXT    NOT NULL DEFAULT '',
    smtp_pass    TEXT    NOT NULL DEFAULT '',
    from_email   TEXT    NOT NULL DEFAULT '',
    from_name    TEXT    NOT NULL DEFAULT '',
    daily_limit  INTEGER NOT NULL DEFAULT 1800,
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO settings (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS campaigns (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    name                   TEXT    NOT NULL,
    subject                TEXT    NOT NULL,
    body                   TEXT    NOT NULL,
    from_name              TEXT    NOT NULL DEFAULT '',
    from_email             TEXT    NOT NULL DEFAULT '',
    attachment_path        TEXT,
    attachment_name        TEXT,
    batch_size             INTEGER NOT NULL DEFAULT 10,
    batch_interval_seconds INTEGER NOT NULL DEFAULT 60,
    scheduled_start        TEXT,
    status                 TEXT    NOT NULL DEFAULT 'draft',
    next_batch_at          TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at             TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS recipients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    email       TEXT    NOT NULL,
    name        TEXT    NOT NULL DEFAULT '',
    fields_json TEXT    NOT NULL DEFAULT '{}',
    status      TEXT    NOT NULL DEFAULT 'pending',
    error       TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    sent_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON recipients(campaign_id, status);
  CREATE INDEX IF NOT EXISTS idx_recipients_sent_at  ON recipients(sent_at);
`);

// Migrations — safe to run on every boot; silently no-ops if already applied.
const migrate = (sql) => { try { db.prepare(sql).run(); } catch { /* column already exists */ } };
migrate('ALTER TABLE recipients ADD COLUMN attachment_path TEXT');
migrate('ALTER TABLE settings ADD COLUMN anthropic_api_key TEXT NOT NULL DEFAULT \'\'')

export default db;
