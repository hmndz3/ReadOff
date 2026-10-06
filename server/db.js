const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'readoff.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  book_title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  total_chapters INTEGER NOT NULL,
  cover_file TEXT,
  deadline TEXT,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  opponent_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | active | finished
  winner_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter INTEGER NOT NULL,
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(duel_id, user_id, chapter)
);
CREATE INDEX IF NOT EXISTS idx_progress_duel ON progress(duel_id, user_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_duel ON comments(duel_id, created_at);

-- Caché local de capítulos: cada capítulo se descarga de la fuente una sola vez.
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  next_number INTEGER,
  prev_number INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slug, number)
);
`);

// Vínculo opcional entre un duelo y una novela de la fuente externa
const duelCols = db.prepare('PRAGMA table_info(duels)').all().map((c) => c.name);
if (!duelCols.includes('source_slug')) db.exec('ALTER TABLE duels ADD COLUMN source_slug TEXT');

module.exports = { db, DATA_DIR, UPLOADS_DIR };
