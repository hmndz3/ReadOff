const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { db, DATA_DIR, UPLOADS_DIR } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Secret: env var en producción; si no existe, se genera y persiste en el volumen.
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  const secretFile = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
  SECRET = fs.readFileSync(secretFile, 'utf8').trim();
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// ---------- Auth helpers ----------
function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '90d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 90 * 24 * 3600 * 1000,
  });
}

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, display_name, created_at, tz FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}

// Solo se acepta un nombre IANA que el ICU de Node reconozca; cualquier otra
// cosa cae en UTC antes de tocar la base.
function safeTz(value) {
  const tz = String(value || '').trim();
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function saveTz(userId, value) {
  const tz = safeTz(value);
  if (tz) db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(tz, userId);
}

// ---------- Auth routes ----------
app.post('/api/auth/register', (req, res) => {
  const { username, displayName, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  const uname = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,20}$/.test(uname))
    return res.status(400).json({ error: 'El usuario debe tener 3–20 caracteres (letras, números, _ . -)' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return res.status(409).json({ error: 'Ese usuario ya existe' });
  const hash = bcrypt.hashSync(String(password), 10);
  const name = String(displayName || '').trim() || uname;
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, tz) VALUES (?, ?, ?, ?)')
    .run(uname, name, hash, safeTz((req.body || {}).tz) || 'UTC');
  const user = { id: info.lastInsertRowid, username: uname, display_name: name };
  setAuthCookie(res, user);
  res.json({ user: { id: user.id, username: user.username, displayName: user.display_name } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  saveTz(user.id, (req.body || {}).tz);
  setAuthCookie(res, user);
  res.json({ user: { id: user.id, username: user.username, displayName: user.display_name } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    user: { id: req.user.id, username: req.user.username, displayName: req.user.display_name, tz: req.user.tz || 'UTC' },
  });
});

// La sesión dura 90 días, así que quien ya estaba dentro no vuelve a pasar por
// el login: el cliente manda su zona aquí en cuanto detecta que no coincide.
app.post('/api/me/tz', auth, (req, res) => {
  const tz = safeTz((req.body || {}).tz);
  if (!tz) return res.status(400).json({ error: 'Zona horaria no válida' });
  db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(tz, req.user.id);
  res.json({ tz });
});

// ---------- Covers ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, crypto.randomBytes(10).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Formato no válido. Usa JPG, PNG o WebP.'));
  },
});

// ---------- Duel helpers ----------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin caracteres confusos
function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!db.prepare('SELECT id FROM duels WHERE code = ?').get(code)) return code;
  }
  throw new Error('No se pudo generar un código');
}

const DAY_MS = 86400000;
const PACE_WINDOW_DAYS = 14; // ventana movil para medir el ritmo actual

function toMs(iso) {
  return new Date(iso.replace(' ', 'T') + 'Z').getTime();
}

// ---------- Dias locales ----------
// read_at se guarda en UTC. Agrupar por dia UTC corre un dia la lectura
// nocturna (las 19:00 en Mexico ya son del dia siguiente en UTC), asi que
// rachas, semanas y horas se calculan con el reloj que vio el lector.
const _fmtCache = new Map();
function partsFormatter(tz) {
  let f = _fmtCache.get(tz);
  if (f) return f;
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' };
  try {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, ...opts });
  } catch {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', ...opts }); // tz guardada invalida
  }
  _fmtCache.set(tz, f);
  return f;
}

// { day: 'YYYY-MM-DD', hour: 0-23 } en la zona del lector.
function localParts(ms, tz) {
  const p = {};
  for (const part of partsFormatter(tz).formatToParts(ms)) p[part.type] = part.value;
  return { day: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24 };
}

function localDay(iso, tz) {
  return localParts(toMs(iso), tz).day;
}

function todayLocal(tz) {
  return localParts(Date.now(), tz).day;
}

// Dia de la semana con lunes = 0, a partir de una clave 'YYYY-MM-DD'.
function weekdayOf(dayKey) {
  return (new Date(dayKey + 'T00:00:00Z').getUTCDay() + 6) % 7;
}

function shiftDay(dayKey, days) {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Lunes de la semana a la que pertenece el dia.
function weekStart(dayKey) {
  return shiftDay(dayKey, -weekdayOf(dayKey));
}

// Racha de dias consecutivos con lectura, terminando hoy o ayer.
function streakFrom(daySet, tz) {
  const today = todayLocal(tz);
  let cursor = daySet.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (daySet.has(cursor)) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

// Racha mas larga de la historia.
function recordStreakOf(daySet) {
  const days = [...daySet].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  return best;
}

// Ritmo de lectura en capitulos/dia.
// Se mide sobre la actividad real del lector (desde su primera lectura) y no
// sobre el tiempo que el duelo lleva abierto, para no penalizar a quien se une
// tarde. Con lecturas recientes usa una ventana movil, que refleja el ritmo
// con el que se va ahora; si lleva tiempo sin leer, cae al promedio historico.
function paceOf(rows, nowMs) {
  if (!rows.length) return { pace: 0, basis: null };
  const times = rows.map((r) => toMs(r.read_at));
  const first = Math.min(...times);
  // Minimo de un dia: en las primeras horas no hay base para extrapolar.
  const activeDays = Math.max(1, (nowMs - first) / DAY_MS);
  const recent = times.filter((t) => t >= nowMs - PACE_WINDOW_DAYS * DAY_MS).length;
  if (recent > 0) return { pace: recent / Math.min(PACE_WINDOW_DAYS, activeDays), basis: 'recent' };
  return { pace: rows.length / activeDays, basis: 'overall' };
}

// Ritmos bajos necesitan mas precision para que la proyeccion sea verificable.
function roundPace(p) {
  return p >= 1 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100;
}

function tzOf(userId) {
  const row = db.prepare('SELECT tz FROM users WHERE id = ?').get(userId);
  return (row && row.tz) || 'UTC';
}

function userStats(duel, userId, tz) {
  const zone = tz || tzOf(userId);
  const rows = db
    .prepare('SELECT chapter, read_at FROM progress WHERE duel_id = ? AND user_id = ? ORDER BY chapter')
    .all(duel.id, userId);
  const count = rows.length;
  const pct = duel.total_chapters ? Math.round((count / duel.total_chapters) * 100) : 0;
  const nowMs = duel.finished_at ? toMs(duel.finished_at) : Date.now();
  const { pace, basis: paceBasis } = paceOf(rows, nowMs);

  // Racha: días consecutivos con lectura, terminando hoy o ayer, en la zona
  // del lector (no en UTC, que corre un día la lectura nocturna).
  const daySet = new Set(rows.map((r) => localDay(r.read_at, zone)));
  const streak = streakFrom(daySet, zone);

  // Proyección de fin
  let projection = null;
  let daysLeft = null;
  const remaining = duel.total_chapters - count;
  if (remaining > 0 && pace > 0) {
    daysLeft = remaining / pace;
    projection = new Date(Date.now() + daysLeft * DAY_MS).toISOString().slice(0, 10);
  }
  const lastRead = rows.length ? rows[rows.length - 1].read_at : null;
  return {
    chaptersRead: count,
    pct,
    pace: roundPace(pace),
    paceBasis,
    paceWindowDays: PACE_WINDOW_DAYS,
    daysLeft: daysLeft === null ? null : Math.round(daysLeft),
    streak,
    projection,
    lastRead,
  };
}

function publicUser(u) {
  return u ? { id: u.id, username: u.username, displayName: u.display_name } : null;
}

function duelPayload(duel, meId) {
  const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(duel.creator_id);
  const opponent = duel.opponent_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(duel.opponent_id) : null;
  const iAmCreator = duel.creator_id === meId;
  const me = iAmCreator ? creator : opponent;
  const rival = iAmCreator ? opponent : creator;

  const myStats = me ? userStats(duel, me.id, me.tz) : null;
  const rivalStats = rival ? userStats(duel, rival.id, rival.tz) : null;

  return {
    id: duel.id,
    code: duel.code,
    bookTitle: duel.book_title,
    author: duel.author,
    genre: duel.genre,
    totalChapters: duel.total_chapters,
    coverUrl: duel.cover_file ? '/uploads/' + duel.cover_file : null,
    sourceSlug: duel.source_slug || null,
    deadline: duel.deadline,
    status: duel.status,
    winnerId: duel.winner_id,
    createdAt: duel.created_at,
    startedAt: duel.started_at,
    finishedAt: duel.finished_at,
    me: publicUser(me),
    rival: publicUser(rival),
    myStats,
    rivalStats,
    iWon: duel.status === 'finished' && duel.winner_id === meId,
  };
}

// ---------- Duel routes ----------
app.post('/api/duels', auth, upload.single('cover'), async (req, res) => {
  const { title, author, genre, chapters, deadline, coverUrl, sourceSlug } = req.body || {};
  const total = parseInt(chapters, 10);
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'El título del libro es obligatorio' });
  if (!Number.isInteger(total) || total < 1 || total > 2500)
    return res.status(400).json({ error: 'Los capítulos deben ser un número entre 1 y 2500' });
  let coverFile = req.file ? req.file.filename : null;
  if (!coverFile && coverUrl) coverFile = await downloadCover(coverUrl);
  const code = generateCode();
  const info = db
    .prepare(
      `INSERT INTO duels (code, book_title, author, genre, total_chapters, cover_file, deadline, creator_id, source_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      code,
      String(title).trim(),
      String(author || '').trim(),
      String(genre || '').trim(),
      total,
      coverFile,
      deadline || null,
      req.user.id,
      parseChikariSlug(sourceSlug)
    );
  const duel = db.prepare('SELECT * FROM duels WHERE id = ?').get(info.lastInsertRowid);
  res.json({ duel: duelPayload(duel, req.user.id) });
});

// Vista previa de un duelo por código (antes de unirse)
app.get('/api/duels/code/:code', auth, (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  const duel = db.prepare('SELECT * FROM duels WHERE code = ?').get(code);
  if (!duel) return res.status(404).json({ error: 'No existe ningún duelo con ese código' });
  const creator = db.prepare('SELECT * FROM users WHERE id = ?').get(duel.creator_id);
  const creatorStats = userStats(duel, duel.creator_id, creator && creator.tz);
  res.json({
    duel: {
      id: duel.id,
      code: duel.code,
      bookTitle: duel.book_title,
      author: duel.author,
      genre: duel.genre,
      totalChapters: duel.total_chapters,
      coverUrl: duel.cover_file ? '/uploads/' + duel.cover_file : null,
      status: duel.status,
      creator: publicUser(creator),
      creatorStats,
      isMine: duel.creator_id === req.user.id,
      hasOpponent: !!duel.opponent_id,
      iAmIn: duel.creator_id === req.user.id || duel.opponent_id === req.user.id,
    },
  });
});

app.post('/api/duels/join', auth, (req, res) => {
  const code = String((req.body || {}).code || '').toUpperCase().trim();
  const duel = db.prepare('SELECT * FROM duels WHERE code = ?').get(code);
  if (!duel) return res.status(404).json({ error: 'No existe ningún duelo con ese código' });
  if (duel.creator_id === req.user.id) return res.status(400).json({ error: 'No puedes unirte a tu propio duelo' });
  if (duel.opponent_id === req.user.id) return res.json({ duel: duelPayload(duel, req.user.id) });
  if (duel.opponent_id) return res.status(409).json({ error: 'Este duelo ya tiene rival' });
  db.prepare("UPDATE duels SET opponent_id = ?, status = 'active', started_at = datetime('now') WHERE id = ?").run(
    req.user.id,
    duel.id
  );
  const updated = db.prepare('SELECT * FROM duels WHERE id = ?').get(duel.id);
  res.json({ duel: duelPayload(updated, req.user.id) });
});

app.get('/api/duels', auth, (req, res) => {
  const duels = db
    .prepare('SELECT * FROM duels WHERE creator_id = ? OR opponent_id = ? ORDER BY created_at DESC')
    .all(req.user.id, req.user.id);
  res.json({ duels: duels.map((d) => duelPayload(d, req.user.id)) });
});

function getMyDuel(req, res) {
  const duel = db.prepare('SELECT * FROM duels WHERE id = ?').get(req.params.id);
  if (!duel) {
    res.status(404).json({ error: 'Duelo no encontrado' });
    return null;
  }
  if (duel.creator_id !== req.user.id && duel.opponent_id !== req.user.id) {
    res.status(403).json({ error: 'No participas en este duelo' });
    return null;
  }
  return duel;
}

app.get('/api/duels/:id', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const activity = db
    .prepare(
      `SELECT p.chapter, p.read_at, u.id AS user_id, u.display_name, u.username
       FROM progress p JOIN users u ON u.id = p.user_id
       WHERE p.duel_id = ? ORDER BY p.read_at DESC, p.chapter DESC LIMIT 12`
    )
    .all(duel.id)
    .map((r) => ({
      chapter: r.chapter,
      readAt: r.read_at,
      user: { id: r.user_id, displayName: r.display_name, username: r.username },
    }));
  res.json({ duel: duelPayload(duel, req.user.id), activity });
});

// Marcar el siguiente capítulo como leído
app.post('/api/duels/:id/read', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (duel.status === 'waiting') return res.status(400).json({ error: 'Espera a que tu rival se una para empezar' });
  const row = db
    .prepare('SELECT MAX(chapter) AS last FROM progress WHERE duel_id = ? AND user_id = ?')
    .get(duel.id, req.user.id);
  const next = (row.last || 0) + 1;
  if (next > duel.total_chapters) return res.status(400).json({ error: 'Ya terminaste el libro' });
  db.prepare('INSERT INTO progress (duel_id, user_id, chapter) VALUES (?, ?, ?)').run(duel.id, req.user.id, next);
  if (next === duel.total_chapters && duel.status !== 'finished') {
    db.prepare("UPDATE duels SET status = 'finished', winner_id = ?, finished_at = datetime('now') WHERE id = ?").run(
      req.user.id,
      duel.id
    );
  }
  const updated = db.prepare('SELECT * FROM duels WHERE id = ?').get(duel.id);
  res.json({ duel: duelPayload(updated, req.user.id) });
});

// Revertir el último capítulo marcado
app.post('/api/duels/:id/revert', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const row = db
    .prepare('SELECT id, chapter FROM progress WHERE duel_id = ? AND user_id = ? ORDER BY chapter DESC LIMIT 1')
    .get(duel.id, req.user.id);
  if (!row) return res.status(400).json({ error: 'No tienes capítulos que revertir' });
  db.prepare('DELETE FROM progress WHERE id = ?').run(row.id);
  // Si el duelo estaba ganado por este usuario al marcar el último capítulo, se reabre.
  if (duel.status === 'finished' && duel.winner_id === req.user.id && row.chapter === duel.total_chapters) {
    db.prepare("UPDATE duels SET status = 'active', winner_id = NULL, finished_at = NULL WHERE id = ?").run(duel.id);
  }
  const updated = db.prepare('SELECT * FROM duels WHERE id = ?').get(duel.id);
  res.json({ duel: duelPayload(updated, req.user.id) });
});

// Cambiar o quitar la fecha límite. Cualquiera de los dos participantes puede.
app.post('/api/duels/:id/deadline', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const raw = (req.body || {}).deadline;
  // Cadena vacía o null la quita.
  if (!raw) {
    db.prepare('UPDATE duels SET deadline = NULL WHERE id = ?').run(duel.id);
    return res.json({ deadline: null });
  }
  const value = String(raw).trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return res.status(400).json({ error: 'Fecha no válida' });
  const d = new Date(value + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    return res.status(400).json({ error: 'Fecha no válida' });
  db.prepare('UPDATE duels SET deadline = ? WHERE id = ?').run(value, duel.id);
  res.json({ deadline: value });
});

// Eliminar un duelo. Cualquiera de los dos participantes puede hacerlo:
// se borra para ambos junto con su progreso y sus comentarios (cascade).
app.delete('/api/duels/:id', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  db.prepare('DELETE FROM duels WHERE id = ?').run(duel.id);
  // La portada subida deja de tener dueño: la quitamos del disco.
  if (duel.cover_file) {
    try {
      fs.unlinkSync(path.join(UPLOADS_DIR, duel.cover_file));
    } catch {}
  }
  res.json({ ok: true, bookTitle: duel.book_title });
});

// ---------- Comentarios por capítulo ----------
app.get('/api/duels/:id/comments', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const comments = db
    .prepare(
      `SELECT c.id, c.chapter, c.text, c.created_at, u.id AS user_id, u.display_name, u.username
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.duel_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 200`
    )
    .all(duel.id)
    .map((c) => ({
      id: c.id,
      chapter: c.chapter,
      text: c.text,
      createdAt: c.created_at,
      user: { id: c.user_id, displayName: c.display_name, username: c.username },
    }));
  res.json({ comments });
});

app.post('/api/duels/:id/comments', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const { chapter, text } = req.body || {};
  const ch = parseInt(chapter, 10);
  const body = String(text || '').trim();
  if (!Number.isInteger(ch) || ch < 1 || ch > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo inválido' });
  if (!body) return res.status(400).json({ error: 'Escribe algo antes de comentar' });
  if (body.length > 280) return res.status(400).json({ error: 'Máximo 280 caracteres' });
  const info = db
    .prepare('INSERT INTO comments (duel_id, user_id, chapter, text) VALUES (?, ?, ?, ?)')
    .run(duel.id, req.user.id, ch, body);
  const row = db.prepare('SELECT created_at FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json({
    comment: {
      id: info.lastInsertRowid,
      chapter: ch,
      text: body,
      createdAt: row.created_at,
      user: { id: req.user.id, displayName: req.user.display_name, username: req.user.username },
    },
  });
});

// ---------- Preguntas sobre un fragmento ----------
// Una pregunta nace de un subrayado dentro del capítulo y vive en la pantalla de
// preguntas del duelo. La regla de spoiler es el progreso real de cada uno: si
// el capítulo de la pregunta va por delante de lo que el otro lleva leído, le
// llega tapada, y el texto no sale del servidor hasta que pide destaparla. Así
// el registro de quién la abrió es fiable y no se puede espiar la respuesta.
const MAX_QUESTION = 500;
const MAX_ANSWER = 1000;
const MAX_QUOTE = 300;

function chaptersReadBy(duelId, userId) {
  if (!userId) return 0;
  return (
    db.prepare('SELECT MAX(chapter) AS last FROM progress WHERE duel_id = ? AND user_id = ?').get(duelId, userId).last || 0
  );
}

function rivalIdOf(duel, meId) {
  return duel.creator_id === meId ? duel.opponent_id : duel.creator_id;
}

// Contexto de un duelo para decidir spoilers: cuánto lleva cada uno y quién va
// adelante. ventaja > 0 significa que quien mira va por delante de su rival.
function spoilerContext(duel, meId) {
  const rivalId = rivalIdOf(duel, meId);
  const rival = rivalId ? db.prepare('SELECT * FROM users WHERE id = ?').get(rivalId) : null;
  const myRead = chaptersReadBy(duel.id, meId);
  const rivalRead = rival ? chaptersReadBy(duel.id, rival.id) : null;
  return {
    myRead,
    rival: publicUser(rival),
    rivalRead,
    lead: rivalRead === null ? null : myRead - rivalRead,
  };
}

// Posición dentro del texto: el párrafo y el desplazamiento dentro de él. Sin
// esto la marca se perdería en cuanto la fuente cambiara una palabra.
function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= 0 && n < 1e7 ? n : null;
}

function answersOf(questionIds) {
  const byQuestion = new Map();
  if (!questionIds.length) return byQuestion;
  const marks = questionIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT a.id, a.question_id, a.text, a.is_best, a.created_at, u.id AS user_id, u.display_name, u.username
       FROM answers a JOIN users u ON u.id = a.user_id
       WHERE a.question_id IN (${marks}) ORDER BY a.is_best DESC, a.created_at ASC`
    )
    .all(...questionIds);
  for (const r of rows) {
    if (!byQuestion.has(r.question_id)) byQuestion.set(r.question_id, []);
    byQuestion.get(r.question_id).push({
      id: r.id,
      text: r.text,
      isBest: !!r.is_best,
      createdAt: r.created_at,
      user: { id: r.user_id, displayName: r.display_name, username: r.username },
    });
  }
  return byQuestion;
}

// Una pregunta tal y como la ve `meId`. Si le llega tapada, el texto y la cita
// salen en null: lo único que viaja es el capítulo, para avisar de qué se trata.
function questionPayload(q, meId, ctx, extras = {}) {
  const mine = q.user_id === meId;
  const spoiler = !mine && q.chapter > ctx.myRead;
  const revealed = !!extras.revealedAt;
  const hidden = spoiler && !revealed;
  const answers = extras.answers || [];
  const out = {
    id: q.id,
    chapter: q.chapter,
    createdAt: q.created_at,
    mine,
    spoiler,
    revealed,
    hidden,
    revealedAt: extras.revealedAt || null,
    authorChapter: q.author_chapter,
    user: { id: q.user_id, displayName: q.display_name, username: q.username },
    text: hidden ? null : q.text,
    quote: hidden ? null : q.quote || '',
    paraIndex: hidden ? null : q.para_index,
    charOffset: hidden ? null : q.char_offset,
    answerCount: extras.answerCount ?? answers.length,
    answers: hidden ? [] : answers,
  };
  // En las propias se ve el otro lado: si al rival le llegó tapada y si la abrió.
  if (mine && ctx.rival) {
    out.spoilerForRival = ctx.rivalRead !== null && q.chapter > ctx.rivalRead;
    out.rivalRead = ctx.rivalRead;
    out.rivalRevealedAt = extras.rivalRevealedAt || null;
  }
  return out;
}

function listQuestions(duel, meId, chapter) {
  const ctx = spoilerContext(duel, meId);
  const rows = chapter
    ? db
        .prepare(
          `SELECT q.*, u.display_name, u.username FROM questions q JOIN users u ON u.id = q.user_id
           WHERE q.duel_id = ? AND q.chapter = ? ORDER BY q.created_at DESC, q.id DESC LIMIT 200`
        )
        .all(duel.id, chapter)
    : db
        .prepare(
          `SELECT q.*, u.display_name, u.username FROM questions q JOIN users u ON u.id = q.user_id
           WHERE q.duel_id = ? ORDER BY q.created_at DESC, q.id DESC LIMIT 300`
        )
        .all(duel.id);

  const ids = rows.map((r) => r.id);
  const answers = answersOf(ids);
  const myReveals = new Map();
  const rivalReveals = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    for (const r of db
      .prepare(`SELECT question_id, user_id, revealed_at FROM question_reveals WHERE question_id IN (${marks})`)
      .all(...ids)) {
      if (r.user_id === meId) myReveals.set(r.question_id, r.revealed_at);
      else rivalReveals.set(r.question_id, r.revealed_at);
    }
  }

  const questions = rows.map((q) =>
    questionPayload(q, meId, ctx, {
      answers: answers.get(q.id) || [],
      answerCount: (answers.get(q.id) || []).length,
      revealedAt: myReveals.get(q.id) || null,
      rivalRevealedAt: rivalReveals.get(q.id) || null,
    })
  );
  return { questions, ctx };
}

app.get('/api/duels/:id/questions', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  let chapter = null;
  if (req.query.chapter !== undefined) {
    chapter = parseInt(req.query.chapter, 10);
    if (!Number.isInteger(chapter) || chapter < 1) return res.status(400).json({ error: 'Capítulo inválido' });
  }
  const { questions, ctx } = listQuestions(duel, req.user.id, chapter);
  res.json({
    questions,
    me: { chaptersRead: ctx.myRead },
    rival: ctx.rival,
    rivalRead: ctx.rivalRead,
    lead: ctx.lead,
    totalChapters: duel.total_chapters,
    bookTitle: duel.book_title,
  });
});

app.post('/api/duels/:id/questions', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const b = req.body || {};
  const ch = parseInt(b.chapter, 10);
  const text = String(b.text || '').trim();
  const quote = String(b.quote || '').trim().slice(0, MAX_QUOTE);
  if (!Number.isInteger(ch) || ch < 1 || ch > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo inválido' });
  if (!text) return res.status(400).json({ error: 'Escribe tu pregunta antes de publicarla' });
  if (text.length > MAX_QUESTION) return res.status(400).json({ error: `Máximo ${MAX_QUESTION} caracteres` });

  const info = db
    .prepare(
      `INSERT INTO questions (duel_id, user_id, chapter, text, quote, para_index, char_offset, author_chapter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(duel.id, req.user.id, ch, text, quote, intOrNull(b.paraIndex), intOrNull(b.charOffset), chaptersReadBy(duel.id, req.user.id));

  const q = db
    .prepare('SELECT q.*, u.display_name, u.username FROM questions q JOIN users u ON u.id = q.user_id WHERE q.id = ?')
    .get(info.lastInsertRowid);
  const ctx = spoilerContext(duel, req.user.id);
  res.json({ question: questionPayload(q, req.user.id, ctx, {}) });
});

// Carga una pregunta comprobando que quien pide participa en su duelo.
function getQuestion(req, res) {
  const q = db
    .prepare('SELECT q.*, u.display_name, u.username FROM questions q JOIN users u ON u.id = q.user_id WHERE q.id = ?')
    .get(req.params.id);
  if (!q) {
    res.status(404).json({ error: 'Pregunta no encontrada' });
    return null;
  }
  const duel = db.prepare('SELECT * FROM duels WHERE id = ?').get(q.duel_id);
  if (!duel || (duel.creator_id !== req.user.id && duel.opponent_id !== req.user.id)) {
    res.status(403).json({ error: 'No participas en este duelo' });
    return null;
  }
  return { q, duel };
}

// Destapar un spoiler. Queda registrado: quien preguntó verá que ya se abrió.
app.post('/api/questions/:id/reveal', auth, (req, res) => {
  const found = getQuestion(req, res);
  if (!found) return;
  const { q, duel } = found;
  if (q.user_id !== req.user.id) {
    db.prepare('INSERT OR IGNORE INTO question_reveals (question_id, user_id) VALUES (?, ?)').run(q.id, req.user.id);
  }
  const row = db
    .prepare('SELECT revealed_at FROM question_reveals WHERE question_id = ? AND user_id = ?')
    .get(q.id, req.user.id);
  const ctx = spoilerContext(duel, req.user.id);
  const answers = answersOf([q.id]).get(q.id) || [];
  const rivalRevealed = db
    .prepare('SELECT revealed_at FROM question_reveals WHERE question_id = ? AND user_id != ?')
    .get(q.id, req.user.id);
  res.json({
    question: questionPayload(q, req.user.id, ctx, {
      answers,
      revealedAt: (row && row.revealed_at) || new Date().toISOString().slice(0, 19).replace('T', ' '),
      rivalRevealedAt: (rivalRevealed && rivalRevealed.revealed_at) || null,
    }),
  });
});

app.delete('/api/questions/:id', auth, (req, res) => {
  const found = getQuestion(req, res);
  if (!found) return;
  if (found.q.user_id !== req.user.id) return res.status(403).json({ error: 'Solo puedes borrar tus preguntas' });
  db.prepare('DELETE FROM questions WHERE id = ?').run(found.q.id);
  res.json({ ok: true });
});

// Responder. No se puede responder a lo que todavía te llega tapado: primero se
// destapa, y entonces queda constancia de que se leyó.
app.post('/api/questions/:id/answers', auth, (req, res) => {
  const found = getQuestion(req, res);
  if (!found) return;
  const { q, duel } = found;
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Escribe tu respuesta' });
  if (text.length > MAX_ANSWER) return res.status(400).json({ error: `Máximo ${MAX_ANSWER} caracteres` });
  const ctx = spoilerContext(duel, req.user.id);
  const revealed = db
    .prepare('SELECT 1 AS y FROM question_reveals WHERE question_id = ? AND user_id = ?')
    .get(q.id, req.user.id);
  if (q.user_id !== req.user.id && q.chapter > ctx.myRead && !revealed)
    return res.status(409).json({ error: 'Destapa la pregunta antes de responderla' });

  const info = db.prepare('INSERT INTO answers (question_id, user_id, text) VALUES (?, ?, ?)').run(q.id, req.user.id, text);
  const row = db.prepare('SELECT created_at FROM answers WHERE id = ?').get(info.lastInsertRowid);
  res.json({
    answer: {
      id: info.lastInsertRowid,
      text,
      isBest: false,
      createdAt: row.created_at,
      user: { id: req.user.id, displayName: req.user.display_name, username: req.user.username },
    },
  });
});

app.delete('/api/answers/:id', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM answers WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Respuesta no encontrada' });
  if (a.user_id !== req.user.id) return res.status(403).json({ error: 'Solo puedes borrar tus respuestas' });
  db.prepare('DELETE FROM answers WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// Marcar la mejor respuesta: solo quien preguntó, y solo una por pregunta.
app.post('/api/questions/:id/best', auth, (req, res) => {
  const found = getQuestion(req, res);
  if (!found) return;
  if (found.q.user_id !== req.user.id)
    return res.status(403).json({ error: 'Solo quien preguntó puede elegir la mejor respuesta' });
  const answerId = parseInt((req.body || {}).answerId, 10);
  const a = Number.isInteger(answerId)
    ? db.prepare('SELECT * FROM answers WHERE id = ? AND question_id = ?').get(answerId, found.q.id)
    : null;
  if (answerId && !a) return res.status(404).json({ error: 'Esa respuesta no es de esta pregunta' });
  db.transaction(() => {
    db.prepare('UPDATE answers SET is_best = 0 WHERE question_id = ?').run(found.q.id);
    if (a) db.prepare('UPDATE answers SET is_best = 1 WHERE id = ?').run(a.id);
  })();
  res.json({ bestAnswerId: a ? a.id : null });
});

// ---------- Subrayados privados ----------
app.get('/api/duels/:id/highlights', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const ch = parseInt(req.query.chapter, 10);
  const rows = Number.isInteger(ch)
    ? db
        .prepare(
          `SELECT id, chapter, quote, para_index, char_offset, created_at FROM highlights
           WHERE duel_id = ? AND user_id = ? AND chapter = ? ORDER BY id`
        )
        .all(duel.id, req.user.id, ch)
    : db
        .prepare(
          `SELECT id, chapter, quote, para_index, char_offset, created_at FROM highlights
           WHERE duel_id = ? AND user_id = ? ORDER BY chapter, id LIMIT 500`
        )
        .all(duel.id, req.user.id);
  res.json({
    highlights: rows.map((h) => ({
      id: h.id,
      chapter: h.chapter,
      quote: h.quote,
      paraIndex: h.para_index,
      charOffset: h.char_offset,
      createdAt: h.created_at,
    })),
  });
});

app.post('/api/duels/:id/highlights', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const b = req.body || {};
  const ch = parseInt(b.chapter, 10);
  const quote = String(b.quote || '').trim().slice(0, MAX_QUOTE);
  if (!Number.isInteger(ch) || ch < 1 || ch > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo inválido' });
  if (!quote) return res.status(400).json({ error: 'No hay nada subrayado' });
  const info = db
    .prepare('INSERT INTO highlights (duel_id, user_id, chapter, quote, para_index, char_offset) VALUES (?, ?, ?, ?, ?, ?)')
    .run(duel.id, req.user.id, ch, quote, intOrNull(b.paraIndex), intOrNull(b.charOffset));
  res.json({
    highlight: {
      id: info.lastInsertRowid,
      chapter: ch,
      quote,
      paraIndex: intOrNull(b.paraIndex),
      charOffset: intOrNull(b.charOffset),
    },
  });
});

app.delete('/api/highlights/:id', auth, (req, res) => {
  const h = db.prepare('SELECT * FROM highlights WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Subrayado no encontrado' });
  if (h.user_id !== req.user.id) return res.status(403).json({ error: 'Solo puedes borrar tus subrayados' });
  db.prepare('DELETE FROM highlights WHERE id = ?').run(h.id);
  res.json({ ok: true });
});

// ---------- Autoconfiguración desde chikari.moe ----------
const CHIKARI = 'https://chikari.moe';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ReadOff personal duel app)' };

function parseChikariSlug(input) {
  const s = String(input || '').trim();
  let m = s.match(/chikari\.moe\/novels\/([a-z0-9-]+)/i);
  if (!m && /^[a-z0-9-]{2,80}$/i.test(s)) m = [null, s];
  return m ? m[1].toLowerCase() : null;
}

app.get('/api/novel-info', auth, async (req, res) => {
  const slug = parseChikariSlug(req.query.url);
  if (!slug) return res.status(400).json({ error: 'URL no válida. Pega el enlace de la novela en chikari.moe' });
  try {
    const r = await fetch(`${CHIKARI}/api/novels/${slug}`, { headers: UA });
    if (!r.ok) return res.status(404).json({ error: 'No se encontró esa novela en chikari.moe' });
    const n = await r.json();
    // authors/genres llegan como objeto suelto o lista de objetos {name, slug}
    const names = (v, max) =>
      (Array.isArray(v) ? v : v ? [v] : [])
        .map((x) => (typeof x === 'string' ? x : x && x.name) || '')
        .filter(Boolean)
        .slice(0, max);
    res.json({
      novel: {
        slug,
        title: n.title,
        authors: names(n.authors, 3).join(', '),
        genres: names(n.genres, 2).join(' · '),
        chapters: n.latest_number || n.chapter_count || null,
        coverUrl: n.cover_url || null,
        status: n.status,
      },
    });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo consultar chikari.moe. Intenta de nuevo.' });
  }
});

// Descarga una portada desde chikari y la guarda como archivo local. Devuelve el nombre o null.
async function downloadCover(coverUrl) {
  try {
    const u = new URL(coverUrl);
    if (!/(^|\.)chikari\.moe$/.test(u.hostname)) return null;
    const r = await fetch(u, { headers: UA });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0];
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[type];
    if (!ext) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    const name = crypto.randomBytes(10).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    return name;
  } catch {
    return null;
  }
}

// Enlaza (o desenlaza) un duelo ya creado con una novela de la fuente
app.post('/api/duels/:id/source', auth, async (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const raw = (req.body || {}).url;
  if (!raw) {
    db.prepare('UPDATE duels SET source_slug = NULL WHERE id = ?').run(duel.id);
    return res.json({ sourceSlug: null });
  }
  const slug = parseChikariSlug(raw);
  if (!slug) return res.status(400).json({ error: 'URL no válida. Pega el enlace de la novela en chikari.moe' });
  try {
    const r = await fetch(`${CHIKARI}/api/novels/${slug}`, { headers: UA });
    if (!r.ok) return res.status(404).json({ error: 'No se encontró esa novela en chikari.moe' });
    const n = await r.json();
    db.prepare('UPDATE duels SET source_slug = ? WHERE id = ?').run(slug, duel.id);
    res.json({ sourceSlug: slug, title: n.title, chapters: n.latest_number || n.chapter_count || null });
  } catch {
    res.status(502).json({ error: 'No se pudo consultar chikari.moe. Intenta de nuevo.' });
  }
});

// ---------- Lector de capítulos (caché local) ----------
// El texto se descarga de la fuente una sola vez por capítulo y queda guardado.
async function fetchChapter(slug, number) {
  const cached = db.prepare('SELECT * FROM chapters WHERE slug = ? AND number = ?').get(slug, number);
  if (cached) return cached;
  const r = await fetch(`${CHIKARI}/api/novels/${slug}/chapters/${number}/read`, { headers: UA });
  if (!r.ok) throw new Error(r.status === 404 ? 'Ese capítulo no existe todavía' : 'No se pudo obtener el capítulo');
  const c = await r.json();
  if (c.locked) throw new Error(c.lock_reason || 'Ese capítulo aún no está disponible');
  db.prepare(
    `INSERT OR REPLACE INTO chapters (slug, number, title, body, next_number, prev_number)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, number, c.title || '', c.body || '', c.next_number ?? null, c.prev_number ?? null);
  return db.prepare('SELECT * FROM chapters WHERE slug = ? AND number = ?').get(slug, number);
}

app.get('/api/duels/:id/chapters/:n', auth, async (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (!duel.source_slug)
    return res.status(400).json({ error: 'Este duelo no está enlazado a una novela de chikari.moe' });
  const n = parseInt(req.params.n, 10);
  if (!Number.isInteger(n) || n < 1 || n > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo fuera de rango' });
  try {
    const c = await fetchChapter(duel.source_slug, n);
    const myRead = db
      .prepare('SELECT MAX(chapter) AS last FROM progress WHERE duel_id = ? AND user_id = ?')
      .get(duel.id, req.user.id).last || 0;
    res.json({
      chapter: {
        number: c.number,
        title: c.title,
        body: c.body,
        hasNext: n < duel.total_chapters,
        hasPrev: n > 1,
      },
      duel: {
        id: duel.id,
        bookTitle: duel.book_title,
        totalChapters: duel.total_chapters,
        status: duel.status,
        myRead,
        wpm: wpmOf(req.user.id).value, // para estimar los minutos del capítulo
      },
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Marca capítulos leídos hasta `upTo` (usado al avanzar de capítulo en el lector)
app.post('/api/duels/:id/read-upto', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (duel.status === 'waiting') return res.status(400).json({ error: 'Espera a que tu rival se una para empezar' });
  const upTo = parseInt((req.body || {}).upTo, 10);
  if (!Number.isInteger(upTo) || upTo < 1 || upTo > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo fuera de rango' });
  const last = db
    .prepare('SELECT MAX(chapter) AS last FROM progress WHERE duel_id = ? AND user_id = ?')
    .get(duel.id, req.user.id).last || 0;
  if (upTo > last) {
    const insert = db.prepare('INSERT OR IGNORE INTO progress (duel_id, user_id, chapter) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (let ch = last + 1; ch <= upTo; ch++) insert.run(duel.id, req.user.id, ch);
    })();
    if (upTo === duel.total_chapters && duel.status !== 'finished') {
      db.prepare("UPDATE duels SET status = 'finished', winner_id = ?, finished_at = datetime('now') WHERE id = ?").run(
        req.user.id,
        duel.id
      );
    }
  }
  const updated = db.prepare('SELECT * FROM duels WHERE id = ?').get(duel.id);
  res.json({ duel: duelPayload(updated, req.user.id) });
});

// ---------- Tiempo de lectura medido ----------
const MAX_SESSION_MS = 4 * 3600 * 1000; // más que esto es basura o un reloj roto
const MIN_SESSION_MS = 5000; // abrir y cerrar el capítulo no es una lectura

// El lector manda aquí el tiempo que estuvo leyendo de verdad: solo cuenta con
// la pestaña visible y con scroll o toques recientes, así que subestima antes
// que inflar. Llega por sendBeacon al cerrar o al ocultar la pestaña.
app.post('/api/duels/:id/reading-session', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const b = req.body || {};
  const chapter = parseInt(b.chapter, 10);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo fuera de rango' });

  const activeMs = Math.round(Number(b.activeMs));
  if (!Number.isFinite(activeMs) || activeMs < MIN_SESSION_MS) return res.json({ stored: false });
  const ms = Math.min(activeMs, MAX_SESSION_MS);

  const pct = Math.round(Number(b.scrollPct));
  const scrollPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null;
  const w = Math.round(Number(b.words));
  const words = Number.isFinite(w) && w > 0 && w < 200000 ? w : null;

  // Las marcas de tiempo son del servidor: el reloj del cliente no es fiable.
  // started_at se deriva del tiempo activo, así que es el inicio de la lectura
  // efectiva, no el momento en que se abrió la pestaña.
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(
    `INSERT INTO reading_sessions (duel_id, user_id, chapter, started_at, ended_at, active_ms, scroll_pct, words)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(duel.id, req.user.id, chapter, iso(now - ms), iso(now), ms, scrollPct, words);
  res.json({ stored: true });
});

// ---------- Estadísticas ----------
const CHARS_PER_WORD = 6; // medido sobre el caché: ~13.900 caracteres ≈ ~2.300 palabras
const DEFAULT_WPM = 240;
const FALLBACK_CHARS = 13900;
const HEATMAP_WEEKS = 26; // medio año: con menos columnas las celdas salen enormes
const WEEKLY_WEEKS = 8; // historial semanal: dos meses caben sin scroll en móvil
const MIN_WPM_SAMPLES = 3;

// Palabras por minuto reales del lector, a partir de las sesiones medidas. Con
// pocas muestras no es fiable, así que se usa el valor por defecto; se descartan
// los extremos por si alguna sesión quedó mal cerrada.
function wpmOf(userId) {
  const row = db
    .prepare(
      `SELECT SUM(words) AS words, SUM(active_ms) AS ms, COUNT(*) AS n
       FROM reading_sessions WHERE user_id = ? AND words > 0 AND active_ms >= 60000`
    )
    .get(userId);
  if (!row || row.n < MIN_WPM_SAMPLES || !row.ms) return { value: DEFAULT_WPM, measured: false };
  const value = Math.round(row.words / (row.ms / 60000));
  if (value < 60 || value > 1200) return { value: DEFAULT_WPM, measured: false };
  return { value, measured: true };
}

app.get('/api/stats', auth, (req, res) => {
  const tz = req.user.tz || 'UTC';
  const userId = req.user.id;

  // Una fila por capítulo leído, con el tamaño del capítulo si está en caché.
  const rows = db
    .prepare(
      `SELECT p.duel_id, p.chapter, p.read_at, d.source_slug, length(c.body) AS body_len
       FROM progress p
       JOIN duels d ON d.id = p.duel_id
       LEFT JOIN chapters c ON c.slug = d.source_slug AND c.number = p.chapter
       WHERE p.user_id = ?
       ORDER BY p.read_at`
    )
    .all(userId);

  // Tiempo medido por capítulo (un capítulo puede tener varias sesiones).
  const measured = new Map();
  for (const s of db
    .prepare(
      'SELECT duel_id, chapter, SUM(active_ms) AS ms FROM reading_sessions WHERE user_id = ? GROUP BY duel_id, chapter'
    )
    .all(userId))
    measured.set(s.duel_id + ':' + s.chapter, s.ms);

  const lectorWpm = wpmOf(userId);
  const wpm = lectorWpm.value;

  // Para estimar capítulos que no pasaron por el lector: media de la novela y,
  // si tampoco la hay, media global del caché.
  const slugAvg = new Map();
  for (const r of db.prepare('SELECT slug, AVG(length(body)) AS avg FROM chapters GROUP BY slug').all())
    slugAvg.set(r.slug, r.avg);
  const globalAvg = db.prepare('SELECT AVG(length(body)) AS avg FROM chapters').get().avg || FALLBACK_CHARS;

  function minutesOf(row) {
    const ms = measured.get(row.duel_id + ':' + row.chapter);
    if (ms) return { minutes: ms / 60000, measured: true };
    const chars = row.body_len || slugAvg.get(row.source_slug) || globalAvg;
    return { minutes: chars / CHARS_PER_WORD / wpm, measured: false };
  }

  const byDay = new Map();
  const byWeek = new Map();
  const weekday = Array.from({ length: 7 }, () => ({ chapters: 0, minutes: 0 }));
  const hours = Array.from({ length: 24 }, () => ({ chapters: 0, minutes: 0 }));
  let totalMinutes = 0;
  let totalMeasured = 0;

  const bucket = (map, key, extra = {}) => {
    let b = map.get(key);
    if (!b) {
      b = { chapters: 0, minutes: 0, measuredChapters: 0, ...extra };
      map.set(key, b);
    }
    return b;
  };

  for (const row of rows) {
    const { day, hour } = localParts(toMs(row.read_at), tz);
    const { minutes, measured: isMeasured } = minutesOf(row);
    totalMinutes += minutes;
    if (isMeasured) totalMeasured++;

    const d = bucket(byDay, day);
    d.chapters++;
    d.minutes += minutes;
    if (isMeasured) d.measuredChapters++;

    const w = bucket(byWeek, weekStart(day));
    w.chapters++;
    w.minutes += minutes;
    if (isMeasured) w.measuredChapters++;

    const wd = weekday[weekdayOf(day)];
    wd.chapters++;
    wd.minutes += minutes;
    const h = hours[hour];
    h.chapters++;
    h.minutes += minutes;
  }

  const round1 = (n) => Math.round(n * 10) / 10;
  const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
  const summary = (b, extra = {}) =>
    b
      ? { chapters: b.chapters, minutes: Math.round(b.minutes), measuredPct: pctOf(b.measuredChapters, b.chapters), ...extra }
      : { chapters: 0, minutes: 0, measuredPct: 0, ...extra };

  const today = todayLocal(tz);
  const thisWeek = weekStart(today);
  const prevWeek = shiftDay(thisWeek, -7);

  // Variación semanal: null cuando la semana pasada fue cero, porque un
  // porcentaje sobre cero no dice nada.
  const change = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
  const cur = byWeek.get(thisWeek);
  const prev = byWeek.get(prevWeek);

  // Rejilla completa de 12 semanas (incluye los días en cero) para que el
  // cliente la pinte sin rellenar huecos.
  const heatFrom = shiftDay(thisWeek, -7 * (HEATMAP_WEEKS - 1));
  const days = [];
  let heatMax = 0;
  for (let i = 0; i < HEATMAP_WEEKS * 7; i++) {
    const day = shiftDay(heatFrom, i);
    const b = byDay.get(day);
    const chapters = b ? b.chapters : 0;
    if (chapters > heatMax) heatMax = chapters;
    days.push({ day, chapters, minutes: b ? Math.round(b.minutes) : 0, future: day > today });
  }

  // Historial de las últimas semanas, con los ceros incluidos: el cliente las
  // pinta en fila sin tener que rellenar huecos.
  const weekly = [];
  for (let i = WEEKLY_WEEKS - 1; i >= 0; i--) {
    const start = shiftDay(thisWeek, -7 * i);
    weekly.push({ start, end: shiftDay(start, 6), ...summary(byWeek.get(start)) });
  }

  let bestDay = null;
  for (const [day, b] of byDay) if (!bestDay || b.chapters > bestDay.chapters) bestDay = { day, ...b };
  let bestWeek = null;
  for (const [start, b] of byWeek) if (!bestWeek || b.chapters > bestWeek.chapters) bestWeek = { start, ...b };

  const daySet = new Set(byDay.keys());
  const perChapterMeasured = totalMeasured >= MIN_WPM_SAMPLES && totalMeasured / (rows.length || 1) >= 0.5;

  res.json({
    tz,
    week: { start: thisWeek, ...summary(cur) },
    prevWeek: { start: prevWeek, ...summary(prev) },
    delta: {
      chapters: change(cur ? cur.chapters : 0, prev ? prev.chapters : 0),
      minutes: change(cur ? cur.minutes : 0, prev ? prev.minutes : 0),
    },
    heatmap: { from: heatFrom, to: today, weeks: HEATMAP_WEEKS, max: heatMax, days },
    byWeekday: weekday.map((b, i) => ({ weekday: i, chapters: b.chapters, minutes: Math.round(b.minutes) })),
    byHour: hours.map((b, hour) => ({ hour, chapters: b.chapters, minutes: Math.round(b.minutes) })),
    weekly,
    best: {
      day: bestDay ? { day: bestDay.day, ...summary(bestDay) } : null,
      week: bestWeek ? { start: bestWeek.start, ...summary(bestWeek) } : null,
    },
    streak: { current: streakFrom(daySet, tz), record: recordStreakOf(daySet) },
    perChapter: {
      minutes: rows.length ? round1(totalMinutes / rows.length) : 0,
      measured: perChapterMeasured,
      samples: totalMeasured,
    },
    wpm: lectorWpm,
    totals: {
      chapters: rows.length,
      minutes: Math.round(totalMinutes),
      hours: round1(totalMinutes / 60),
      measuredPct: pctOf(totalMeasured, rows.length),
      activeDays: daySet.size,
    },
  });
});

// ---------- Perfil ----------
app.get('/api/profile', auth, (req, res) => {
  const me = req.user;
  const duels = db
    .prepare('SELECT * FROM duels WHERE creator_id = ? OR opponent_id = ? ORDER BY created_at DESC')
    .all(me.id, me.id);
  const finished = duels.filter((d) => d.status === 'finished');
  const wins = finished.filter((d) => d.winner_id === me.id).length;
  const losses = finished.length - wins;
  const totalChapters = db.prepare('SELECT COUNT(*) AS c FROM progress WHERE user_id = ?').get(me.id).c;

  // Mayor racha global (días consecutivos con al menos un capítulo leído),
  // contada en la zona del lector igual que las rachas de cada duelo.
  const zone = me.tz || 'UTC';
  const daySet = new Set(
    db
      .prepare('SELECT read_at FROM progress WHERE user_id = ?')
      .all(me.id)
      .map((r) => localDay(r.read_at, zone))
  );
  const longestStreak = recordStreakOf(daySet);


  res.json({
    user: { id: me.id, username: me.username, displayName: me.display_name, memberSince: me.created_at },
    stats: {
      wins,
      losses,
      totalDuels: duels.length,
      finishedDuels: finished.length,
      winRate: finished.length ? Math.round((wins / finished.length) * 100) : 0,
      totalChapters,
      longestStreak,
    },
    finishedDuels: finished.map((d) => duelPayload(d, me.id)),
  });
});
// ---------- Errores y páginas ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'La portada supera el límite de 5MB' });
  if (err) return res.status(400).json({ error: err.message || 'Error inesperado' });
  next();
});
const pages = { '/duelo': 'duel.html', '/nuevo': 'new.html', '/unirse': 'join.html', '/perfil': 'profile.html', '/duelos': 'dashboard.html', '/leer': 'read.html', '/preguntas': 'questions.html' };
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file)));
}

app.listen(PORT, () => console.log(`ReadOff corriendo en http://localhost:${PORT}`));
