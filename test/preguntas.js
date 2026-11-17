/* Prueba de punta a punta del módulo de preguntas.
   Levanta el servidor con una base vacía en una carpeta temporal, crea dos
   lectores con progresos distintos y comprueba lo que de verdad importa: que
   una pregunta de un capítulo al que el otro no llegó le llegue tapada, que su
   texto no salga del servidor hasta destaparla, y que quede registrado quién la
   abrió.

   Correr con:  node test/preguntas.js   (o npm test) */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3177;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'readoff-test-'));

let fallos = 0;
let pruebas = 0;

function ok(cond, label, extra) {
  pruebas++;
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    fallos++;
    console.log(`  ✗ ${label}${extra === undefined ? '' : `\n      recibido: ${JSON.stringify(extra)}`}`);
  }
}

function seccion(titulo) {
  console.log(`\n${titulo}`);
}

/* Cada lector tiene su propio tarro de cookies, como dos navegadores distintos. */
function nuevoLector(nombre) {
  return { nombre, cookie: '' };
}

async function pedir(lector, metodo, ruta, cuerpo) {
  const opts = { method: metodo, headers: {} };
  if (lector.cookie) opts.headers.cookie = lector.cookie;
  if (cuerpo !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(cuerpo);
  }
  const res = await fetch(BASE + ruta, opts);
  const puestas = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of puestas) {
    if (c.startsWith('token=')) lector.cookie = c.split(';')[0];
  }
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data, crudo: JSON.stringify(data) };
}

async function esperarServidor(hijo) {
  for (let i = 0; i < 100; i++) {
    if (hijo.exitCode !== null) throw new Error('El servidor murió al arrancar');
    try {
      const r = await fetch(BASE + '/api/me');
      if (r.status === 401 || r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('El servidor no respondió en 15 s');
}

async function main() {
  const hijo = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, SESSION_SECRET: 'secreto-de-prueba', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  hijo.stdout.on('data', (d) => (salida += d));
  hijo.stderr.on('data', (d) => (salida += d));

  try {
    await esperarServidor(hijo);
    console.log(`Servidor de prueba en ${BASE} · datos en ${DATA_DIR}`);

    const ana = nuevoLector('Ana');
    const beto = nuevoLector('Beto');

    seccion('Preparar el duelo');
    let r = await pedir(ana, 'POST', '/api/auth/register', { username: 'ana', displayName: 'Ana Prueba', password: 'secreto123' });
    ok(r.status === 200, 'se registra Ana', r.data);
    r = await pedir(beto, 'POST', '/api/auth/register', { username: 'beto', displayName: 'Beto Prueba', password: 'secreto123' });
    ok(r.status === 200, 'se registra Beto', r.data);

    r = await pedir(ana, 'POST', '/api/duels', { title: 'Dune', chapters: 20 });
    ok(r.status === 200 && r.data.duel, 'Ana crea un duelo de 20 capítulos', r.data);
    const duelo = r.data.duel.id;
    const codigo = r.data.duel.code;

    r = await pedir(beto, 'POST', '/api/duels/join', { code: codigo });
    ok(r.status === 200, 'Beto se une con el código', r.data);

    r = await pedir(ana, 'POST', `/api/duels/${duelo}/read-upto`, { upTo: 12 });
    ok(r.status === 200 && r.data.duel.myStats.chaptersRead === 12, 'Ana va por el capítulo 12', r.data.duel && r.data.duel.myStats);
    r = await pedir(beto, 'POST', `/api/duels/${duelo}/read-upto`, { upTo: 3 });
    ok(r.status === 200 && r.data.duel.myStats.chaptersRead === 3, 'Beto va por el capítulo 3', r.data.duel && r.data.duel.myStats);

    seccion('Quién va adelante');
    r = await pedir(ana, 'GET', `/api/duels/${duelo}/questions`);
    ok(r.data.lead === 9, 'Ana ve que lleva 9 capítulos de ventaja', r.data.lead);
    ok(r.data.rivalRead === 3, 'Ana ve el progreso de Beto', r.data.rivalRead);
    r = await pedir(beto, 'GET', `/api/duels/${duelo}/questions`);
    ok(r.data.lead === -9, 'Beto ve que va 9 por detrás', r.data.lead);

    seccion('Una pregunta por delante del rival');
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/questions`, {
      chapter: 10,
      text: '¿El agua funciona como moneda de verdad?',
      quote: 'Nadie regala agua en este planeta',
      paraIndex: 2,
      charOffset: 48,
    });
    ok(r.status === 200, 'Ana pregunta sobre el capítulo 10', r.data);
    const pregunta = r.data.question.id;
    ok(r.data.question.authorChapter === 12, 'queda guardado que Ana iba por el 12 al preguntar', r.data.question.authorChapter);
    ok(r.data.question.spoilerForRival === true, 'Ana ve que a Beto le llegará tapada', r.data.question);
    ok(r.data.question.rivalRevealedAt === null, 'y que todavía no la ha abierto', r.data.question.rivalRevealedAt);

    r = await pedir(beto, 'GET', `/api/duels/${duelo}/questions`);
    const vistaBeto = r.data.questions.find((q) => q.id === pregunta);
    ok(!!vistaBeto, 'Beto ve que existe la pregunta', r.data.questions);
    ok(vistaBeto.spoiler === true && vistaBeto.hidden === true, 'le llega marcada como spoiler', vistaBeto);
    ok(vistaBeto.text === null && vistaBeto.quote === null, 'sin texto ni cita', vistaBeto);
    ok(vistaBeto.chapter === 10, 'pero sí sabe de qué capítulo es', vistaBeto.chapter);
    ok(!r.crudo.includes('moneda'), 'el texto no viaja en la respuesta', r.crudo.slice(0, 200));

    seccion('Responder exige destapar primero');
    r = await pedir(beto, 'POST', `/api/questions/${pregunta}/answers`, { text: 'Es literal, el agua se comercia.' });
    ok(r.status === 409, 'no se puede responder a ciegas', r);

    r = await pedir(beto, 'POST', `/api/questions/${pregunta}/reveal`);
    ok(r.status === 200 && r.data.question.text.includes('moneda'), 'al destaparla llega el texto', r.data.question);
    ok(r.data.question.revealed === true && !!r.data.question.revealedAt, 'y queda marcada como abierta', r.data.question);

    r = await pedir(ana, 'GET', `/api/duels/${duelo}/questions`);
    const mia = r.data.questions.find((q) => q.id === pregunta);
    ok(!!mia.rivalRevealedAt, 'Ana ve que Beto abrió su spoiler', mia);

    r = await pedir(beto, 'POST', `/api/questions/${pregunta}/answers`, { text: 'Es literal, el agua se comercia.' });
    ok(r.status === 200, 'ahora sí puede responder', r.data);
    const respuesta = r.data.answer.id;

    r = await pedir(ana, 'POST', `/api/questions/${pregunta}/best`, { answerId: respuesta });
    ok(r.status === 200 && r.data.bestAnswerId === respuesta, 'Ana marca la mejor respuesta', r.data);
    r = await pedir(beto, 'POST', `/api/questions/${pregunta}/best`, { answerId: respuesta });
    ok(r.status === 403, 'Beto no puede elegir la mejor respuesta de otro', r);

    seccion('Una pregunta de un capítulo ya leído');
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/questions`, { chapter: 2, text: '¿Quién narra el prólogo?' });
    const vieja = r.data.question.id;
    ok(r.data.question.spoilerForRival === false, 'Ana ve que esa no es spoiler para Beto', r.data.question);
    r = await pedir(beto, 'GET', `/api/duels/${duelo}/questions`);
    const abierta = r.data.questions.find((q) => q.id === vieja);
    ok(abierta.hidden === false && abierta.text.includes('prólogo'), 'Beto la ve completa', abierta);

    seccion('Filtro por capítulo y permisos');
    r = await pedir(ana, 'GET', `/api/duels/${duelo}/questions?chapter=10`);
    ok(r.data.questions.length === 1 && r.data.questions[0].id === pregunta, 'el lector pide solo su capítulo', r.data.questions);
    r = await pedir(beto, 'DELETE', `/api/questions/${pregunta}`);
    ok(r.status === 403, 'nadie borra preguntas ajenas', r);

    seccion('Subrayados privados');
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/highlights`, { chapter: 10, quote: 'el ritmo irregular', paraIndex: 0, charOffset: 12 });
    ok(r.status === 200, 'Ana subraya una frase', r.data);
    const subrayado = r.data.highlight.id;
    r = await pedir(ana, 'GET', `/api/duels/${duelo}/highlights?chapter=10`);
    ok(r.data.highlights.length === 1, 'Ana recupera su subrayado', r.data.highlights);
    r = await pedir(beto, 'GET', `/api/duels/${duelo}/highlights?chapter=10`);
    ok(r.data.highlights.length === 0, 'Beto no ve los subrayados de Ana', r.data.highlights);
    r = await pedir(beto, 'DELETE', `/api/highlights/${subrayado}`);
    ok(r.status === 403, 'ni los puede borrar', r);
    r = await pedir(ana, 'DELETE', `/api/highlights/${subrayado}`);
    ok(r.status === 200, 'Ana sí borra el suyo', r.data);

    seccion('Validaciones');
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/questions`, { chapter: 99, text: 'fuera de rango' });
    ok(r.status === 400, 'rechaza un capítulo fuera del libro', r);
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/questions`, { chapter: 5, text: '   ' });
    ok(r.status === 400, 'rechaza una pregunta vacía', r);
    r = await pedir(ana, 'POST', `/api/duels/${duelo}/questions`, { chapter: 5, text: 'x'.repeat(501) });
    ok(r.status === 400, 'rechaza una pregunta larguísima', r);

    const ajeno = nuevoLector('Carla');
    await pedir(ajeno, 'POST', '/api/auth/register', { username: 'carla', displayName: 'Carla', password: 'secreto123' });
    r = await pedir(ajeno, 'GET', `/api/duels/${duelo}/questions`);
    ok(r.status === 403, 'quien no participa no ve las preguntas del duelo', r);

    seccion('Borrar el duelo se lleva sus preguntas');
    r = await pedir(ana, 'DELETE', `/api/duels/${duelo}`);
    ok(r.status === 200, 'Ana borra el duelo', r.data);
    r = await pedir(ana, 'POST', `/api/questions/${pregunta}/reveal`);
    ok(r.status === 404, 'la pregunta ya no existe', r);
  } catch (e) {
    fallos++;
    console.log('\n✗ La prueba se rompió:', e.message);
    if (salida.trim()) console.log('Salida del servidor:\n' + salida.trim());
  } finally {
    hijo.kill();
  }

  console.log(`\n${fallos === 0 ? 'TODO BIEN' : 'HAY FALLOS'} — ${pruebas - fallos}/${pruebas} comprobaciones pasaron`);
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
  process.exit(fallos === 0 ? 0 : 1);
}

main();
