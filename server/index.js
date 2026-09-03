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

function daysBetween(fromIso, toDate) {
  const from = new Date(fromIso.replace(' ', 'T') + 'Z');
  return Math.max(1, Math.ceil((toDate - from) / 86400000));
}

function userStats(duel, userId) {
  const rows = db
    .prepare('SELECT chapter, read_at FROM progress WHERE duel_id = ? AND user_id = ? ORDER BY chapter')
    .all(duel.id, userId);
  const count = rows.length;
  const pct = duel.total_chapters ? Math.round((count / duel.total_chapters) * 100) : 0;
  const sinceIso = duel.started_at || duel.created_at;
  const endDate = duel.finished_at ? new Date(duel.finished_at.replace(' ', 'T') + 'Z') : new Date();
  const days = daysBetween(sinceIso, endDate);
  const pace = count / days;

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
  const remaining = duel.total_chapters - count;
  if (remaining > 0 && pace > 0) {
    const p = new Date(Date.now() + (remaining / pace) * 86400000);
    projection = p.toISOString().slice(0, 10);
  }
  const lastRead = rows.length ? rows[rows.length - 1].read_at : null;
  return { chaptersRead: count, pct, pace: Math.round(pace * 10) / 10, streak, projection, lastRead };
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

// Eliminar un duelo (solo el creador, solo si está esperando rival)
app.delete('/api/duels/:id', auth, (req, res) => {
  const duel = getMyDuel(req, res);
  if (!duel) return;
  if (duel.creator_id !== req.user.id) return res.status(403).json({ error: 'Solo el creador puede eliminar el duelo' });
  if (duel.status !== 'waiting') return res.status(400).json({ error: 'Solo puedes eliminar duelos sin rival' });
  db.prepare('DELETE FROM duels WHERE id = ?').run(duel.id);
  res.json({ ok: true });
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
