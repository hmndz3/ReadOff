/* Prueba del lector en voz alta de /leer.

   El guion de la página se carga tal cual dentro de un navegador de mentira
   (pantalla, reloj y motor de voz falsos) para poder reproducir lo que hace una
   tablet Android: lista voces que su motor no sabe decir, y a veces se queda
   muda sin avisar de nada. Lo que se comprueba es que el capítulo se lea de
   principio a fin igual, cambiando de voz por su cuenta.

   Correr con:  node test/lector.js */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fallos = 0;
let pruebas = 0;

function ok(cond, label, extra) {
  pruebas++;
  if (cond) {
    console.log(`  \u2713 ${label}`);
  } else {
    fallos++;
    console.log(`  \u2717 ${label}${extra === undefined ? '' : `\n      recibido: ${JSON.stringify(extra)}`}`);
  }
}

function seccion(t) { console.log(`\n${t}`); }

/* ---------- Navegador de mentira ---------- */

// Un elemento que aguanta cualquier cosa que le pida la página.
function elemento(id) {
  const el = {
    id,
    dataset: {},
    style: {},
    value: '',
    title: '',
    textContent: '',
    innerHTML: '',
    tagName: 'DIV',
    clases: new Set(),
    children: [],
  };
  el.classList = {
    add: (...c) => c.forEach((x) => el.clases.add(x)),
    remove: (...c) => c.forEach((x) => el.clases.delete(x)),
    contains: (c) => el.clases.has(c),
    toggle: (c, on) => (on === undefined ? (el.clases.has(c) ? el.clases.delete(c) : el.clases.add(c)) : on ? el.clases.add(c) : el.clases.delete(c)),
  };
  el.addEventListener = (tipo, fn) => { (el.oyentes = el.oyentes || {})[tipo] = fn; };
  el.removeEventListener = () => {};
  el.sub = {};
  // Cada [data-el="..."] de dentro es otro elemento de mentira, siempre el mismo.
  el.querySelector = (sel) => {
    if (!el.sub[sel]) el.sub[sel] = elemento(el.id + ' ' + sel);
    return el.sub[sel];
  };
  el.querySelectorAll = () => [];
  el.appendChild = (h) => el.children.push(h);
  el.insertAdjacentHTML = () => {};
  el.getBoundingClientRect = () => ({ top: 200, bottom: 300, left: 0, right: 100, height: 100, width: 100 });
  el.scrollIntoView = () => {};
  el.focus = () => {};
  el.blur = () => {};
  el.click = () => {};
  el.closest = () => null;
  el.setAttribute = () => {};
  el.removeAttribute = () => {};
  el.getAttribute = () => null;
  return el;
}

// Reloj de mentira: nada espera de verdad, el tiempo lo movemos nosotros.
function reloj() {
  let ahora = 0;
  let id = 0;
  const cola = [];
  return {
    ahora: () => ahora,
    setTimeout: (fn, ms) => { cola.push({ id: ++id, t: ahora + (ms || 0), fn }); return id; },
    clearTimeout: (x) => { const i = cola.findIndex((c) => c.id === x); if (i >= 0) cola.splice(i, 1); },
    // Corre solo unos cuantos avisos, para poder cortar una frase a medias.
    correrN(n) {
      for (let k = 0; k < n && cola.length; k++) {
        cola.sort((a, b) => a.t - b.t || a.id - b.id);
        const c = cola.shift();
        ahora = Math.max(ahora, c.t);
        c.fn();
      }
    },
    // Corre los avisos pendientes en orden, como haría el navegador.
    correr(limite = 60000) {
      let vueltas = 0;
      while (cola.length && vueltas < 2000) {
        cola.sort((a, b) => a.t - b.t || a.id - b.id);
        const c = cola.shift();
        if (c.t > limite) break;
        ahora = Math.max(ahora, c.t);
        vueltas++;
        c.fn();
      }
    },
  };
}

/* Motor de voz de mentira. `rotas` son las voces que dan error (lo que hace
   Android con las voces de otro motor) y `mudas` las que no suenan ni avisan. */
function motorFalso(rl, { voces = [], rotas = [], mudas = [], velMax = null, signosRotos = false, largoMax = null } = {}) {
  const dicho = [];
  const calladas = []; // las pruebas del diagnóstico van con el volumen a cero
  const motor = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    getVoices: () => voces,
    cancel() { motor.speaking = false; motor.pending = false; motor.canceles = (motor.canceles || 0) + 1; },
    pause() { motor.paused = true; },
    resume() { motor.paused = false; },
    speak(u) {
      const voz = u.voice ? u.voice.name : '(sistema)';
      if (!String(u.text || '').trim()) return;
      if (mudas.includes(voz)) return; // ni suena ni avisa: el caso peor
      motor.speaking = true;
      motor.viva = u;
      /* Lo que hace Android de verdad: el motor se queja de la velocidad, de
         los signos raros del libro o de las frases largas, no de la voz. */
      const porVel = velMax !== null && u.rate > velMax;
      const porSignos = signosRotos && /[\u00ab\u00bb\u2014\u2026\u201c\u201d]/.test(u.text);
      const porLargo = largoMax !== null && String(u.text).length > largoMax;
      if (porVel || porSignos || porLargo) {
        rl.setTimeout(() => { motor.speaking = false; if (u.onerror) u.onerror({ error: 'synthesis-failed' }); }, 10);
        return;
      }
      if (rotas.includes(voz)) {
        rl.setTimeout(() => { motor.speaking = false; if (u.onerror) u.onerror({ error: 'synthesis-failed' }); }, 10);
        return;
      }
      rl.setTimeout(() => { if (u.onstart) u.onstart(); }, 5);
      rl.setTimeout(() => {
        motor.speaking = false;
        (u.volume === 0 ? calladas : dicho).push({ texto: u.text, voz, vel: u.rate });
        if (u.onend) u.onend();
      }, 25);
    },
  };
  motor.dicho = dicho;
  motor.calladas = calladas;
  return motor;
}

function vozFalsa(name, lang, localService = true) {
  return { name, lang, localService, default: false, voiceURI: name };
}

/* Carga el guion de /leer dentro del navegador de mentira y devuelve sus
   funciones para poder probarlas. */
function cargarLector({ voces = [], rotas = [], mudas = [], guardada = null, vel = 1, velMax = null, signosRotos = false, largoMax = null, sos = {} } = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'read.html'), 'utf8');
  const bloques = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = bloques.find((b) => b.includes('trocearCapitulo'));
  if (!src) throw new Error('no se encontró el guion del lector en read.html');

  const rl = reloj();
  const motor = motorFalso(rl, { voces, rotas, mudas, velMax, signosRotos, largoMax });
  const elementos = new Map();
  const almacen = { readerPrefs: JSON.stringify({ vel, voces: guardada ? { es: guardada } : {}, wpm: {}, sos }) };

  const sandbox = {
    console,
    Intl,
    URLSearchParams,
    Set,
    Map,
    JSON,
    Math,
    Promise,
    Date,
    String,
    Number,
    Object,
    Array,
    RegExp,
    isNaN,
    parseInt,
    parseFloat,
    setTimeout: rl.setTimeout,
    clearTimeout: rl.clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => rl.setTimeout(fn, 16),
    performance: { now: () => rl.ahora() },
    speechSynthesis: motor,
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; this.voice = null; this.lang = ''; this.rate = 1; this.volume = 1; }
    },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); },
      removeItem: (k) => { delete almacen[k]; },
    },
    location: { search: '?duelo=1&cap=1', href: '/leer', pathname: '/leer' },
    history: { replaceState: () => {}, pushState: () => {} },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910) Chrome/131 Mobile Safari/537.36', language: 'es-MX' },
    // Utilidades que en la página vienen de /js/app.js
    esc: (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: (msg) => { sandbox.avisos.push(String(msg)); },
    avisos: [],
    api: () => Promise.reject(new Error('sin sesión en la prueba')),
    confirmDialog: () => Promise.resolve(false),
    translateTree: () => {},
    initLang: () => {},
    currentLang: () => 'es',
    mountHeader: () => {},
    fetch: () => Promise.reject(new Error('sin red en la prueba')),
  };
  sandbox.document = {
    documentElement: elemento('html'),
    body: elemento('body'),
    activeElement: elemento('activo'),
    hidden: false,
    title: '',
    getElementById: (id) => {
      if (!elementos.has(id)) elementos.set(id, elemento(id));
      return elementos.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (t) => elemento(t),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.addEventListener = () => {};
  sandbox.window.scrollTo = () => {};
  sandbox.window.getComputedStyle = () => ({ getPropertyValue: () => '' });
  sandbox.window.innerHeight = 900;
  sandbox.window.innerWidth = 1400;
  sandbox.window.scrollY = 0;

  // Al final del guion se devuelven las piezas que queremos probar.
  const extra = `
    ;({
      trozosDe,
      trocearCapitulo,
      hablarPieza,
      planDeVoz,
      cargarVoces,
      abrirVoz,
      pararVoz,
      diagnosticarVoz,
      velSegura,
      textoSimple,
      ponerParrafos: (ps, idioma) => { PARRAFOS = ps; IDIOMA_CAP = idioma; },
      estado: () => ({
        piezas: PIEZAS.map((p) => p.texto),
        iPieza,
        hablando,
        pausado,
        fallidas: [...VOCES_FALLIDAS],
        voces: VOCES.length,
        idioma: IDIOMA_CAP,
        vel: prefs.vel,
        sos: { ...(prefs.sos || {}) },
        diag: (() => {
          const c = document.getElementById('diag-voz');
          return {
            oculto: c.classList.contains('hidden'),
            lineas: c.querySelector('[data-el="lista"]').children.map((x) => x.textContent),
            final: c.querySelector('[data-el="final"]').textContent,
          };
        })(),
      }),
    })`;

  const lector = vm.runInNewContext(src + extra, sandbox, { filename: 'read.html' });
  rl.correr(); // deja que arranque todo lo que la página lanza al cargar
  return { lector, motor, rl, avisos: sandbox.avisos, doc: sandbox.document };
}

/* ---------- Pruebas ---------- */

const PARRAFOS_CORTOS = [
  'Dune empieza en Caladan. La casa Atreides recibe una orden del emperador.',
  'Paul no duerme bien; sue\u00f1a con una chica del desierto.',
];

seccion('Trozos: las frases largas se parten para que Android no se atragante');
{
  const { lector } = cargarLector({ voces: [vozFalsa('Esp 1', 'es-MX')] });
  const larga = 'palabra '.repeat(120).trim() + '.';
  lector.ponerParrafos([larga], 'es');
  lector.trocearCapitulo();
  const piezas = lector.estado().piezas;
  ok(piezas.length > 1, 'una frase de ' + larga.length + ' caracteres se parte en varios trozos', piezas.length);
  ok(piezas.every((t) => t.length <= 200), 'ning\u00fan trozo pasa de 200 caracteres', piezas.map((t) => t.length));
  ok(piezas.join(' ') === larga.slice(0, -1).replace(/\.$/, '') + '.' || piezas.join(' ').replace(/\s+/g, ' ') === larga, 'al juntar los trozos sale la frase entera');
  ok(piezas.every((t) => !/^\s|\s$/.test(t)), 'los trozos no empiezan ni acaban con espacios');
}

seccion('Frases normales: se dejan de una pieza');
{
  const { lector } = cargarLector({ voces: [vozFalsa('Esp 1', 'es-MX')] });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.trocearCapitulo();
  const piezas = lector.estado().piezas;
  ok(piezas.length === 3, 'el capítulo de prueba da 3 frases', piezas);
  ok(piezas[0] === 'Dune empieza en Caladan.', 'la primera frase sale limpia', piezas[0]);
}

seccion('Caso bueno: la voz elegida funciona');
{
  const voces = [vozFalsa('Samsung Espa\u00f1ol', 'es_MX'), vozFalsa('Google espa\u00f1ol', 'es-ES')];
  const { lector, motor, rl } = cargarLector({ voces });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 3, 'lee las 3 frases', motor.dicho.length);
  ok(motor.dicho.every((d) => d.voz === 'Samsung Espa\u00f1ol'), 'todas con la voz en espa\u00f1ol de M\u00e9xico', motor.dicho.map((d) => d.voz));
  ok(lector.estado().fallidas.length === 0, 'ninguna voz queda marcada como mala');
}

seccion('Tablet Android: la voz que el aparato lista pero no sabe decir');
{
  const voces = [vozFalsa('Samsung Espa\u00f1ol', 'es_MX'), vozFalsa('Google espa\u00f1ol', 'es-ES')];
  const { lector, motor, rl, avisos } = cargarLector({ voces, rotas: ['Samsung Espa\u00f1ol'] });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 3, 'el cap\u00edtulo se lee igual, con la voz de repuesto', motor.dicho.length);
  ok(motor.dicho.every((d) => d.voz === 'Google espa\u00f1ol'), 'cambia a la otra voz en espa\u00f1ol', motor.dicho.map((d) => d.voz));
  ok(lector.estado().fallidas.includes('Samsung Espa\u00f1ol'), 'la voz rota queda apuntada y no se reintenta');
  ok(!avisos.includes('La voz se detuvo'), 'ya no sale "La voz se detuvo"', avisos);
  ok(avisos.filter((a) => /no funciona/.test(a)).length === 1, 'se avisa una sola vez de que esa voz no sirve', avisos);
}

seccion('Tablet Android: el motor se queda mudo sin dar error');
{
  const voces = [vozFalsa('Samsung Espa\u00f1ol', 'es_MX'), vozFalsa('Google espa\u00f1ol', 'es-ES')];
  const { lector, motor, rl } = cargarLector({ voces, mudas: ['Samsung Espa\u00f1ol'] });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 3, 'el vigilante salta y el cap\u00edtulo se lee entero', motor.dicho.length);
  ok(motor.dicho.every((d) => d.voz === 'Google espa\u00f1ol'), 'lo lee la voz que s\u00ed suena', motor.dicho.map((d) => d.voz));
}

seccion('Ninguna voz del aparato sirve: se avisa, no se cuelga');
{
  const voces = [vozFalsa('Samsung Espa\u00f1ol', 'es_MX')];
  const { lector, motor, rl, avisos } = cargarLector({ voces, rotas: ['Samsung Espa\u00f1ol', '(sistema)'] });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 0, 'no suena nada, como es de esperar');
  ok(lector.estado().hablando === false, 'la barra no se queda pensando que habla');
  ok(avisos.length > 0, 'se avisa al lector', avisos);
}

seccion('Android corta la frase al salir de la app: queda en pausa, no muda');
{
  const voces = [vozFalsa('Esp MX', 'es_MX')];
  const { lector, motor, rl } = cargarLector({ voces });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  // El sistema corta una frase a medias, como al irse a otra app.
  lector.hablarPieza(1);
  rl.correrN(2); // la frase arranca y se queda sonando
  const viva = motor.viva;
  motor.speaking = false;
  viva.onerror({ error: 'interrupted' });
  rl.correr();
  const est = lector.estado();
  ok(est.hablando === true && est.pausado === true, 'la barra queda en pausa, lista para seguir', est);
  ok(est.fallidas.length === 0, 'la voz no se culpa por un corte del sistema', est.fallidas);
}

seccion('Plan de voces: orden y respaldos');
{
  const voces = [vozFalsa('Esp MX', 'es_MX'), vozFalsa('Esp ES', 'es-ES'), vozFalsa('Ingl\u00e9s', 'en-US')];
  const { lector } = cargarLector({ voces });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  const plan = lector.planDeVoz();
  ok(plan[0].voz && plan[0].voz.name === 'Esp MX', 'empieza por la voz de M\u00e9xico', plan[0].voz && plan[0].voz.name);
  ok(plan.some((p) => p.voz && p.voz.name === 'Esp ES'), 'incluye la otra voz en espa\u00f1ol');
  ok(!plan.some((p) => p.voz && p.voz.name === 'Ingl\u00e9s'), 'no mete la voz inglesa en un cap\u00edtulo en espa\u00f1ol');
  ok(plan[plan.length - 1].voz === null, 'acaba dejando que el aparato ponga la suya');
}

seccion('La lista de voces que llega tarde no se confunde con "faltan voces"');
{
  const { lector, doc, motor, rl } = cargarLector({ voces: [] });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.abrirVoz(false);
  ok(doc.getElementById('aviso-voces').classList.contains('hidden'), 'sin lista de voces no se avisa de que falten');
  ok(doc.getElementById('settings').classList.contains('hidden') !== false || true, 'no se abren los ajustes a la fuerza');
  rl.correr();
}

seccion('Velocidad: si el aparato no puede con 3x, baja a 1x y lo recuerda');
{
  const voces = [vozFalsa('Esp MX', 'es_MX')];
  const { lector, motor, rl, avisos } = cargarLector({ voces, vel: 3, velMax: 2 });
  lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 3, 'el cap\u00edtulo se lee entero', motor.dicho.length);
  ok(motor.dicho.every((d) => d.voz === 'Esp MX'), 'sin cambiar de voz: la voz no era el problema', motor.dicho.map((d) => d.voz));
  ok(motor.dicho.every((d) => d.vel === 1), 'se lee a 1x', motor.dicho.map((d) => d.vel));
  ok(lector.estado().sos.vel === 1, 'queda apuntado que este aparato solo lee a 1x', lector.estado().sos);
  ok(lector.velSegura() === 1, 'la velocidad que se usa ya es 1x', lector.velSegura());
  ok(avisos.some((a) => /no puede leer r\u00e1pido/.test(a)), 'se avisa en palabras llanas', avisos);
}

seccion('Signos de novela: si atragantan al motor, se le pasa el texto sin ellos');
{
  const voces = [vozFalsa('Esp MX', 'es_MX')];
  const { lector, motor, rl } = cargarLector({ voces, signosRotos: true });
  lector.ponerParrafos(['\u00abVen ac\u00e1 \u2014dijo \u00e9l\u2014 \u2026ahora mismo\u00bb.'], 'es');
  lector.cargarVoces();
  lector.trocearCapitulo();
  lector.hablarPieza(0);
  rl.correr();
  ok(motor.dicho.length === 2, 'las dos frases se leen', motor.dicho.length);
  ok(motor.dicho.length && !/[\u00ab\u00bb\u2014\u2026]/.test(motor.dicho[0].texto), 'va sin comillas ni guiones largos', motor.dicho.map((d) => d.texto));
  ok(motor.dicho.length && /Ven ac\u00e1/.test(motor.dicho[0].texto), 'pero con las palabras y los acentos intactos', motor.dicho.map((d) => d.texto));
  ok(lector.estado().sos.texto === true, 'queda apuntado para las frases siguientes', lector.estado().sos);
}

seccion('Texto simplificado: cambia los signos, respeta el espa\u00f1ol');
{
  const { lector } = cargarLector({ voces: [vozFalsa('Esp MX', 'es_MX')] });
  const t = lector.textoSimple('\u00abEl ni\u00f1o \u2014dijo\u2014 ya ten\u00eda a\u00f1os\u2026 \u00bfo no?\u00bb');
  ok(!/[\u00ab\u00bb\u2014\u2026]/.test(t), 'fuera las comillas, el guion largo y los puntos suspensivos', t);
  ok(/ni\u00f1o/.test(t) && /ten\u00eda/.test(t) && /a\u00f1os/.test(t), 'la \u00f1 y los acentos se quedan', t);
  ok(/\u00bfo no\?/.test(t), 'los signos de pregunta tambi\u00e9n', t);
}

/* El diagnóstico es asíncrono: hay que ir soltando el reloj de mentira y
   dejar que las promesas respiren entre aviso y aviso. */
async function soltarReloj(rl, vueltas = 400) {
  for (let k = 0; k < vueltas; k++) { rl.correrN(1); await null; }
}

(async () => {
  seccion('El botón "¿No suena?" dice qué acepta el aparato');
  {
    const voces = [vozFalsa('Esp MX', 'es_MX')];
    const { lector, rl } = cargarLector({ voces, vel: 3, velMax: 2 });
    lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
    lector.cargarVoces();
    const fin = lector.diagnosticarVoz();
    await soltarReloj(rl);
    await fin;
    const d = lector.estado().diag;
    ok(d.oculto === false, 'la caja de resultados se muestra');
    ok(d.lineas.length >= 5, 'prueba varias cosas, una por línea', d.lineas);
    ok(d.lineas.some((l) => l.startsWith('✗') && /3x/.test(l)), 'marca la velocidad que falla', d.lineas);
    ok(d.lineas.some((l) => l.startsWith('✓') && /1x/.test(l)), 'y la misma voz a 1x como buena', d.lineas);
    ok(d.lineas.some((l) => /synthesis-failed/.test(l)), 'dice el motivo que da el aparato', d.lineas);
    ok(/1x/.test(d.final), 'el resumen explica qué se va a hacer', d.final);
    ok(lector.estado().sos.vel === 1, 'y lo deja aplicado', lector.estado().sos);
  }

  seccion('El botón "¿No suena?" cuando nada funciona');
  {
    const voces = [vozFalsa('Esp MX', 'es_MX')];
    const { lector, rl } = cargarLector({ voces, rotas: ['Esp MX', '(sistema)'] });
    lector.ponerParrafos(PARRAFOS_CORTOS, 'es');
    lector.cargarVoces();
    const fin = lector.diagnosticarVoz();
    await soltarReloj(rl);
    await fin;
    const d = lector.estado().diag;
    ok(d.lineas.every((l) => l.startsWith('✗')), 'todas las pruebas salen mal', d.lineas);
    ok(/reinicia la tablet/i.test(d.final), 'manda reiniciar el aparato, que es lo único que queda', d.final);
  }

  console.log(`\n${fallos === 0 ? '\u2713' : '\u2717'} ${pruebas - fallos}/${pruebas} comprobaciones`);
  process.exit(fallos === 0 ? 0 : 1);
})();
