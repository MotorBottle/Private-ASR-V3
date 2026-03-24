const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../../runtime');
const mediaDir = path.join(dataDir, 'media');

fs.mkdirSync(mediaDir, { recursive: true });

const dbPath = path.join(dataDir, 'private-asr-v3.db');
const db = new sqlite3.Database(dbPath);

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function ensureColumn(tableName, columnName, definition) {
  const columns = await allQuery(`PRAGMA table_info(${tableName})`);
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  await runQuery(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function initDatabase() {
  await runQuery('PRAGMA journal_mode = WAL');
  await runQuery('PRAGMA foreign_keys = ON');

  await runQuery(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await runQuery(`CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded',
    source_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    source_mime TEXT,
    transcript TEXT DEFAULT '',
    summary TEXT,
    brief_summary TEXT DEFAULT '',
    brief_summary_initialized INTEGER NOT NULL DEFAULT 0,
    hotwords TEXT DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    duration_seconds REAL DEFAULT 0,
    language_hint TEXT,
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  await ensureColumn('records', 'brief_summary', "TEXT DEFAULT ''");
  await ensureColumn('records', 'brief_summary_initialized', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('records', 'hotwords', "TEXT DEFAULT ''");
  await runQuery("UPDATE records SET brief_summary = '' WHERE brief_summary IS NULL");
  await runQuery('UPDATE records SET brief_summary_initialized = 0 WHERE brief_summary_initialized IS NULL');
  await runQuery("UPDATE records SET hotwords = '' WHERE hotwords IS NULL");

  await runQuery(`CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    segment_index INTEGER NOT NULL,
    start_ms INTEGER NOT NULL DEFAULT 0,
    end_ms INTEGER NOT NULL DEFAULT 0,
    original_speaker_label TEXT DEFAULT 'spk0',
    speaker_label TEXT DEFAULT 'spk0',
    text TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (record_id) REFERENCES records (id) ON DELETE CASCADE
  )`);

  await runQuery(`CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    input_json TEXT DEFAULT '{}',
    output_json TEXT DEFAULT '{}',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (record_id) REFERENCES records (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`);

  await runQuery('CREATE INDEX IF NOT EXISTS idx_records_user_id ON records (user_id)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_records_status ON records (status)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_jobs_record_id ON jobs (record_id)');
  await runQuery('CREATE INDEX IF NOT EXISTS idx_segments_record_id ON segments (record_id)');
}

module.exports = {
  db,
  dataDir,
  mediaDir,
  initDatabase,
  runQuery,
  getQuery,
  allQuery
};
