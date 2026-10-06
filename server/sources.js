/* Adaptador de la fuente en español (novelaenespanol.com).
   A diferencia de chikari, que expone una API JSON y URLs por número, aquí las
   direcciones incluyen el título del capítulo, así que hace falta recorrer la
   cadena "siguiente" una vez y guardar el índice de direcciones. */
const { db } = require('./db');

const ES_SOURCE = 'novelaenespanol';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
// Ritmo de indexación. El sitio limita el tráfico automático: cuando se pasa
// responde 503 con "Retry-After: 3600", es decir, "vuelve en una hora". Así que
// se va muy despacio y, si corta, se espera exactamente lo que pide. El índice
// tarda, pero avanza solo y sin molestar al sitio.
const PAUSA_MS = 60000; // una página por minuto
const ESPERA_503_POR_DEFECTO = 3600000;
const REINTENTOS = 2;

function esUrlValida(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && /(^|\.)novelaenespanol\.com$/.test(x.hostname);
  } catch {
    return false;
  }
}

function numeroDeUrl(u) {
  const m = String(u).match(/capitulo-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function decodificar(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#8217;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8212;|&mdash;|&#8211;|&ndash;/g, '—')
    .replace(/&#8230;|&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-zA-Z]+;/g, ' ');
}

/* Descarga una página de capítulo y devuelve título, texto y enlace al siguiente. */
/* Los reintentos largos sólo valen para la indexación en segundo plano. En una
   petición del lector hay que fallar rápido: más vale un aviso que una página
   cargando eternamente. Por eso todo fetch lleva timeout. */
async function leerPaginaEs(url, { reintentos = 0, timeoutMs = 12000 } = {}) {
  if (!esUrlValida(url)) throw new Error('URL no válida');
  let r;
  for (let intento = 0; ; intento++) {
    try {
      r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (intento >= reintentos) throw new Error('La web en español no respondió a tiempo');
      await new Promise((x) => setTimeout(x, 10000 * (intento + 1)));
      continue;
    }
    if (r.ok) break;
    if (r.status === 404) throw new Error('Ese capítulo no existe en la fuente en español');
    const frenado = r.status === 503 || r.status === 429;
    if (!frenado || intento >= reintentos) {
      const err = new Error(
        `La web en español respondió ${r.status}${frenado ? ' (nos está limitando el ritmo)' : ''}`
      );
      if (frenado) {
        // El propio servidor dice cuánto hay que esperar.
        const ra = parseInt(r.headers.get('retry-after') || '', 10);
        err.esperar = Number.isFinite(ra) ? Math.min(ra * 1000, 2 * ESPERA_503_POR_DEFECTO) : ESPERA_503_POR_DEFECTO;
      }
      throw err;
    }
    await new Promise((x) => setTimeout(x, 10000 * (intento + 1)));
  }
  const html = await r.text();

  let title = (html.match(/<title>([^<]*)<\/title>/i) || [, ''])[1];
  title = decodificar(title).replace(/\s*novela\s+Español\s*$/i, '').replace(/\s+/g, ' ').trim();

  // El sitio marca el botón "siguiente" como rel='>' y usa comillas simples.
  const nx = html.match(/href=['"]([^'"]*capitulo-\d+[^'"]*)['"][^>]*rel=['"]\s*>\s*['"]/i);
  const next = nx && esUrlValida(nx[1]) ? nx[1].split('#')[0] : null;

  // El texto vive en .entry-content; cortamos antes del bloque de comentarios.
  const ini = html.search(/class=['"][^'"]*entry-content[^'"]*['"]/i);
  const fin = html.search(/id=['"]comments['"]|class=['"][^'"]*comment-(respond|list|form)/i);
  const bloque = ini >= 0 ? html.slice(ini, fin > ini ? fin : undefined) : '';
  const parrafos = [...bloque.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) =>
      decodificar(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter((t) => t.length > 0);

  return { title, body: parrafos.join('\n\n'), next };
}

/* ---------- Índice de direcciones ---------- */
const selUrl = db.prepare('SELECT url, title FROM source_index WHERE source = ? AND slug = ? AND number = ?');
const insIdx = db.prepare('INSERT OR REPLACE INTO source_index (source, slug, number, url, title) VALUES (?, ?, ?, ?, ?)');
const maxIdx = db.prepare('SELECT MAX(number) AS n, COUNT(*) AS c FROM source_index WHERE source = ? AND slug = ?');

function urlDeCapitulo(slug, number) {
  return selUrl.get(ES_SOURCE, slug, number) || null;
}

function estadoIndice(slug) {
  const r = maxIdx.get(ES_SOURCE, slug);
  const job = trabajos.get(slug);
  return {
    indexados: r.c || 0,
    ultimo: r.n || 0,
    corriendo: !!job && job.corriendo,
    error: job ? job.error : null,
    esperandoHasta: job && job.esperandoHasta ? job.esperandoHasta : null,
  };
}

const trabajos = new Map();
const MAX_PAUSAS_SEGUIDAS = 12; // ~12 h de espera antes de darse por vencido

/* Lee una página aguantando los frenazos del sitio: si responde 503 con
   "Retry-After", espera lo que pide y vuelve a intentarlo. */
async function leerConPausa(job, url) {
  for (let pausas = 0; ; pausas++) {
    try {
      return await leerPaginaEs(url, { reintentos: REINTENTOS, timeoutMs: 20000 });
    } catch (e) {
      if (!e.esperar || pausas >= MAX_PAUSAS_SEGUIDAS) throw e;
      job.esperandoHasta = Date.now() + e.esperar;
      await new Promise((r) => setTimeout(r, e.esperar));
      job.esperandoHasta = null;
    }
  }
}

/* Recorre la cadena de capítulos guardando cada dirección. Reanudable: si ya
   hay capítulos indexados, sigue desde el último en vez de empezar de cero. */
async function construirIndice(slug, startUrl, hasta) {
  if (trabajos.get(slug)?.corriendo) return estadoIndice(slug);
  const job = { corriendo: true, error: null, esperandoHasta: null };
  trabajos.set(slug, job);

  (async () => {
    try {
      const ultimo = maxIdx.get(ES_SOURCE, slug).n || 0;
      let url = startUrl;
      let n = 1;
      if (ultimo > 0) {
        const fila = urlDeCapitulo(slug, ultimo);
        if (fila) {
          const pag = await leerConPausa(job, fila.url);
          if (!pag.next) { job.corriendo = false; return; }
          url = pag.next;
          n = ultimo + 1;
        }
      }
      while (url && n <= hasta) {
        const pag = await leerConPausa(job, url);
        const num = numeroDeUrl(url) || n;
        insIdx.run(ES_SOURCE, slug, num, url, pag.title);
        n = num + 1;
        url = pag.next;
        if (url && n <= hasta) await new Promise((r) => setTimeout(r, PAUSA_MS));
      }
    } catch (e) {
      job.error = e.message;
    } finally {
      job.corriendo = false;
    }
  })();

  return estadoIndice(slug);
}

module.exports = { ES_SOURCE, esUrlValida, numeroDeUrl, leerPaginaEs, urlDeCapitulo, estadoIndice, construirIndice };

/* Al arrancar, retoma los índices que quedaron a medias. El proceso puede
   reiniciarse (un despliegue nuevo, por ejemplo) y el índice tarda horas. */
function reanudarPendientes() {
  try {
    const filas = db
      .prepare("SELECT id, source_slug, es_start_url, total_chapters FROM duels WHERE es_start_url IS NOT NULL")
      .all();
    for (const d of filas) {
      const slug = d.source_slug || String(d.id);
      const est = estadoIndice(slug);
      if (est.ultimo < d.total_chapters) construirIndice(slug, d.es_start_url, d.total_chapters);
    }
  } catch {}
}

module.exports.reanudarPendientes = reanudarPendientes;
