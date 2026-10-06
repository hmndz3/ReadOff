const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { db, DATA_DIR, UPLOADS_DIR } = require('./db');
const fuentes = require('./sources');

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
    const user = db.prepare('SELECT id, username, display_name, created_at FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
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
  const info = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)').run(uname, name, hash);
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
  setAuthCookie(res, user);
  res.json({ user: { id: user.id, username: user.username, displayName: user.display_name } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, displayName: req.user.display_name } });
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

function userStats(duel, userId) {
  const rows = db
    .prepare('SELECT chapter, read_at FROM progress WHERE duel_id = ? AND user_id = ? ORDER BY chapter')
    .all(duel.id, userId);
  const count = rows.length;
  const pct = duel.total_chapters ? Math.round((count / duel.total_chapters) * 100) : 0;
  const nowMs = duel.finished_at ? toMs(duel.finished_at) : Date.now();
  const { pace, basis: paceBasis } = paceOf(rows, nowMs);

  // Racha: días consecutivos con lectura, terminando hoy o ayer (UTC).
  const daySet = new Set(rows.map((r) => r.read_at.slice(0, 10)));
  let streak = 0;
  const d = new Date();
  const todayKey = d.toISOString().slice(0, 10);
  if (!daySet.has(todayKey)) d.setUTCDate(d.getUTCDate() - 1);
  while (daySet.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }

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

  const myStats = me ? userStats(duel, me.id) : null;
  const rivalStats = rival ? userStats(duel, rival.id) : null;

  return {
    id: duel.id,
    code: duel.code,
    bookTitle: duel.book_title,
    author: duel.author,
    genre: duel.genre,
    totalChapters: duel.total_chapters,
    coverUrl: duel.cover_file ? '/uploads/' + duel.cover_file : null,
    sourceSlug: duel.source_slug || null,
    esSource: duel.es_start_url
      ? { url: duel.es_start_url, ...fuentes.estadoIndice(duel.source_slug || String(duel.id)) }
      : null,
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
  const creatorStats = userStats(duel, duel.creator_id);
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

// Identificador del caché en español: mismo almacén que el inglés, con el slug
// prefijado para que las dos versiones de un capítulo convivan sin chocar.
function slugEs(duel) {
  return 'es:' + (duel.source_slug || String(duel.id));
}

async function fetchChapterEs(duel, number) {
  const clave = slugEs(duel);
  const cached = db.prepare('SELECT * FROM chapters WHERE slug = ? AND number = ?').get(clave, number);
  if (cached) return cached;
  const slug = duel.source_slug || String(duel.id);
  const fila = fuentes.urlDeCapitulo(slug, number);
  if (!fila) {
    const est = fuentes.estadoIndice(slug);
    throw new Error(
      est.corriendo
        ? `El índice en español va por el capítulo ${est.ultimo}. Espera un momento y vuelve a intentarlo.`
        : 'Ese capítulo todavía no está en el índice en español.'
    );
  }
  const pag = await fuentes.leerPaginaEs(fila.url);
  if (!pag.body) throw new Error('No se pudo extraer el texto de ese capítulo en español');
  db.prepare(
    `INSERT OR REPLACE INTO chapters (slug, number, title, body, next_number, prev_number)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(clave, number, pag.title || fila.title || '', pag.body, number + 1, number > 1 ? number - 1 : null);
  return db.prepare('SELECT * FROM chapters WHERE slug = ? AND number = ?').get(clave, number);
}

// Ajustar el total de capítulos del duelo (p. ej. para igualarlo a lo que
// existe en ambos idiomas). No puede quedar por debajo de lo ya leído.
app.post('/api/duels/:id/total', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const total = parseInt((req.body || {}).total, 10);
  if (!Number.isInteger(total) || total < 1 || total > 2500)
    return res.status(400).json({ error: 'Los capítulos deben ser un número entre 1 y 2500' });
  const leido = db.prepare('SELECT MAX(chapter) AS n FROM progress WHERE duel_id = ?').get(duel.id).n || 0;
  if (total < leido)
    return res.status(400).json({ error: `No puede ser menor que el capítulo ${leido}, que ya está marcado como leído` });
  db.prepare('UPDATE duels SET total_chapters = ? WHERE id = ?').run(total, duel.id);
  // Si alguien ya estaba en la nueva meta, el duelo queda ganado.
  const ganador = db
    .prepare('SELECT user_id FROM progress WHERE duel_id = ? AND chapter = ? LIMIT 1')
    .get(duel.id, total);
  if (ganador && duel.status === 'active') {
    db.prepare("UPDATE duels SET status = 'finished', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
      .run(ganador.user_id, duel.id);
  }
  const updated = db.prepare('SELECT * FROM duels WHERE id = ?').get(duel.id);
  res.json({ duel: duelPayload(updated, req.user.id) });
});

// Enlazar la lectura en español y arrancar la construcción del índice
app.post('/api/duels/:id/es-source', auth, async (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const url = (req.body || {}).url;
  if (!url) {
    db.prepare('UPDATE duels SET es_start_url = NULL WHERE id = ?').run(duel.id);
    return res.json({ esSource: null });
  }
  if (!fuentes.esUrlValida(url))
    return res.status(400).json({ error: 'Pega la URL de un capítulo de novelaenespanol.com' });
  if (fuentes.numeroDeUrl(url) !== 1)
    return res.status(400).json({ error: 'Tiene que ser la URL del capítulo 1, desde ahí se recorre el resto' });
  let pag;
  try {
    pag = await fuentes.leerPaginaEs(url);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
  if (!pag.body) return res.status(502).json({ error: 'No se pudo extraer el texto de esa página' });
  db.prepare('UPDATE duels SET es_start_url = ? WHERE id = ?').run(url, duel.id);
  const slug = duel.source_slug || String(duel.id);
  fuentes.construirIndice(slug, url, duel.total_chapters);
  res.json({ ok: true, titulo: pag.title, estado: fuentes.estadoIndice(slug) });
});

// Estado del índice, y reanudarlo si se quedó a medias
app.get('/api/duels/:id/es-index', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  const slug = duel.source_slug || String(duel.id);
  res.json({ enlazado: !!duel.es_start_url, estado: fuentes.estadoIndice(slug), total: duel.total_chapters });
});

app.post('/api/duels/:id/es-index/resume', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (!duel.es_start_url) return res.status(400).json({ error: 'Este duelo no tiene lectura en español enlazada' });
  const slug = duel.source_slug || String(duel.id);
  fuentes.construirIndice(slug, duel.es_start_url, duel.total_chapters);
  res.json({ estado: fuentes.estadoIndice(slug) });
});

app.get('/api/duels/:id/chapters/:n', auth, async (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (!duel.source_slug)
    return res.status(400).json({ error: 'Este duelo no está enlazado a una novela de chikari.moe' });
  const n = parseInt(req.params.n, 10);
  if (!Number.isInteger(n) || n < 1 || n > duel.total_chapters)
    return res.status(400).json({ error: 'Capítulo fuera de rango' });
  const enEspanol = req.query.lang === 'es' && !!duel.es_start_url;
  try {
    const c = enEspanol ? await fetchChapterEs(duel, n) : await fetchChapter(duel.source_slug, n);
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
        lang: enEspanol ? 'es' : 'en',
      },
      duel: {
        id: duel.id,
        bookTitle: duel.book_title,
        totalChapters: duel.total_chapters,
        status: duel.status,
        myRead,
        hasEs: !!duel.es_start_url,
        esIndexed: duel.es_start_url ? fuentes.estadoIndice(duel.source_slug || String(duel.id)).ultimo : 0,
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

  // Mayor racha global (días consecutivos con al menos un capítulo leído)
  const days = db
    .prepare("SELECT DISTINCT substr(read_at, 1, 10) AS day FROM progress WHERE user_id = ? ORDER BY day")
    .all(me.id)
    .map((r) => r.day);
  let longestStreak = 0;
  let current = 0;
  let prev = null;
  for (const day of days) {
    if (prev && new Date(day) - new Date(prev) === 86400000) current++;
    else current = 1;
    longestStreak = Math.max(longestStreak, current);
    prev = day;
  }

  
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
const pages = { '/duelo': 'duel.html', '/nuevo': 'new.html', '/unirse': 'join.html', '/perfil': 'profile.html', '/duelos': 'dashboard.html', '/leer': 'read.html' };
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', file)));
}

app.listen(PORT, () => console.log(`ReadOff corriendo en http://localhost:${PORT}`));
