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

-- Sesiones de lectura: tiempo real medido en el lector. Solo cuenta el tiempo
-- con la pestaña visible y con actividad reciente, asi que active_ms siempre
-- subestima antes que inflar. Un capitulo puede tener varias sesiones.
CREATE TABLE IF NOT EXISTS reading_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  active_ms INTEGER NOT NULL,
  scroll_pct INTEGER,
  words INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON reading_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_chapter ON reading_sessions(user_id, duel_id, chapter);

-- Preguntas sobre un fragmento subrayado del libro. quote guarda el texto
-- citado y para_index/char_offset su posicion, para volver a pintar la marca en
-- el lector aunque la fuente cambie una palabra. author_chapter es el progreso
-- de quien pregunta en ese momento: deja constancia de cuanto iba adelantado.
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter INTEGER NOT NULL,
  text TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  para_index INTEGER,
  char_offset INTEGER,
  author_chapter INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_questions_duel ON questions(duel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(duel_id, chapter);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  is_best INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id, created_at);

-- Quien destapo una pregunta que le llegaba como spoiler, y cuando. El texto de
-- una pregunta tapada no se manda al cliente hasta que se pide destaparla, asi
-- que esta tabla es el registro fiable de quien la leyo.
CREATE TABLE IF NOT EXISTS question_reveals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  revealed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(question_id, user_id)
);

-- Subrayados privados: solo los ve quien los hizo, y viajan entre dispositivos.
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  chapter INTEGER NOT NULL,
  quote TEXT NOT NULL,
  para_index INTEGER,
  char_offset INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_highlights_chapter ON highlights(duel_id, user_id, chapter);

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

// Zona horaria del lector (nombre IANA). read_at se guarda en UTC, asi que sin
// esto una lectura de las 19:00 en Mexico cae en el dia siguiente y descuadra
// las rachas y los resumenes semanales de quien lee de noche.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('tz')) db.exec("ALTER TABLE users ADD COLUMN tz TEXT NOT NULL DEFAULT 'UTC'");

module.exports = { db, DATA_DIR, UPLOADS_DIR };
