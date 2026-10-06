/* Adaptador de la fuente en español (novelaenespanol.com).
   A diferencia de chikari, que expone una API JSON y URLs por número, aquí las
   direcciones incluyen el título del capítulo, así que hace falta recorrer la
   cadena "siguiente" una vez y guardar el índice de direcciones. */
const { db } = require('./db');

const ES_SOURCE = 'novelaenespanol';
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};
// Ritmo de indexación. El sitio responde 503 si se le piden muchas páginas
// seguidas, así que se va despacio, por tramos cortos y con esperas crecientes
// cuando corta. El índice se construye una vez y no hay ninguna prisa.
const PAUSA_MS = 5000;
const LOTE_POR_TANDA = 40;
const REINTENTOS = 3;

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
async function leerPaginaEs(url, reintentos = REINTENTOS) {
  if (!esUrlValida(url)) throw new Error('URL no válida');
  let r;
  for (let intento = 0; ; intento++) {
    r = await fetch(url, { headers: UA });
    if (r.ok) break;
    if (r.status === 404) throw new Error('Ese capítulo no existe en la fuente en español');
    // 503/429: el sitio nos está frenando. Esperamos cada vez más antes de insistir.
    const frenado = r.status === 503 || r.status === 429;
    if (!frenado || intento >= reintentos)
      throw new Error(`La web en español respondió ${r.status}${frenado ? ' (nos está limitando el ritmo)' : ''}`);
    await new Promise((x) => setTimeout(x, 15000 * (intento + 1)));
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
  };
}

const trabajos = new Map();

/* Recorre la cadena de capítulos guardando cada dirección. Reanudable: si ya
   hay capítulos indexados, sigue desde el último en vez de empezar de cero. */
async function construirIndice(slug, startUrl, hasta) {
  if (trabajos.get(slug)?.corriendo) return estadoIndice(slug);
  const job = { corriendo: true, error: null };
  trabajos.set(slug, job);

  (async () => {
    try {
      const ultimo = maxIdx.get(ES_SOURCE, slug).n || 0;
      let url = startUrl;
      let n = 1;
      if (ultimo > 0) {
        const fila = urlDeCapitulo(slug, ultimo);
        if (fila) {
          const pag = await leerPaginaEs(fila.url);
          if (!pag.next) { job.corriendo = false; return; }
          url = pag.next;
          n = ultimo + 1;
        }
      }
      let hechos = 0;
      while (url && n <= hasta && hechos < LOTE_POR_TANDA) {
        const pag = await leerPaginaEs(url);
        const num = numeroDeUrl(url) || n;
        insIdx.run(ES_SOURCE, slug, num, url, pag.title);
        hechos++;
        n = num + 1;
        url = pag.next;
        if (url && n <= hasta && hechos < LOTE_POR_TANDA) await new Promise((r) => setTimeout(r, PAUSA_MS));
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
