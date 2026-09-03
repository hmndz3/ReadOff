/* Helpers compartidos de ReadOff */

/* ---------- Tema (oscuro / claro) ---------- */
function currentTheme() {
  try { return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}
function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('theme', next); } catch {}
  document.documentElement.classList.toggle('light', next === 'light');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'light' ? 'dark_mode' : 'light_mode';
}

/* ---------- Idioma (ES / EN) ---------- */
function currentLang() {
  try { return localStorage.getItem('lang') === 'en' ? 'en' : 'es'; } catch { return 'es'; }
}
function toggleLang() {
  const next = currentLang() === 'en' ? 'es' : 'en';
  try { localStorage.setItem('lang', next); } catch {}
  location.reload();
}

const EN_DICT = {
  '¿Quién lee más rápido?': 'Who reads faster?', 'Mis Duelos': 'My Duels', 'Nuevo Duelo': 'New Duel',
  'Unirse con Código': 'Join with Code', 'Mi Perfil': 'My Profile', 'Cerrar sesión': 'Log out',
  'Lector Ávido': 'Avid Reader', 'Duelos de lectura 1 vs 1': '1 vs 1 reading duels',
  '— Duelos literarios de alta intensidad': '— High-intensity literary duels',
  'Arena Literaria': 'Literary Arena', 'Iniciar Sesión': 'Sign In', 'Crear Cuenta': 'Sign Up',
  'Usuario': 'Username', 'Contraseña Secreta': 'Secret Password', 'Entrar al Duelo': 'Enter the Duel',
  'Crear mi Cuenta': 'Create my Account', 'Tu nombre (como te verá tu rival)': 'Your name (as your rival will see it)',
  'Configura tu libro, reta a un amigo y corona al lector más veloz.': 'Set up your book, challenge a friend and crown the fastest reader.',
  '¿Quién lee más rápido? — El duelo de capítulos y progreso entre camaradas lectores.': 'Who reads faster? — The duel of chapters and progress between reading comrades.',
  '+ Nuevo Duelo': '+ New Duel', 'Todos': 'All', 'En curso': 'Ongoing', 'Esperando rival': 'Waiting for rival',
  'Ganados': 'Won', 'Perdidos': 'Lost', 'Ganado': 'Won', 'Perdido': 'Lost',
  'Aún no tienes duelos': "You don't have any duels yet", 'Nada por aquí con este filtro': 'Nothing here with this filter',
  'Configura un libro, genera tu código de invitación y reta a alguien a la carrera literaria.': 'Set up a book, generate your invite code and challenge someone to the literary race.',
  '¡Reta a alguien!': 'Challenge someone!', 'Tu rival': 'Your rival', 'Empate': 'Tie', 'Empate total': 'Dead tie',
  'Comparte el código para empezar': 'Share the code to start', 'Continuar leyendo': 'Keep reading', 'Ver duelo': 'View duel',
  'Tu avance': 'Your progress', 'Cargando tus duelos…': 'Loading your duels…',
  'No tienes duelos activos ahora mismo. ¡Crea uno nuevo!': 'No active duels right now. Create a new one!',
  'Tu arena está lista. Crea tu primer duelo de lectura.': 'Your arena is ready. Create your first reading duel.',
  'Competición Asíncrona': 'Asynchronous Competition', 'Crear Nuevo Duelo Literario': 'Create New Literary Duel',
  'Configura el libro, define los capítulos y reta a un amigo a una contienda de páginas y resistencia.': 'Set up the book, define the chapters and challenge a friend to a contest of pages and endurance.',
  'Título del libro': 'Book title', 'Requerido': 'Required', 'Autor': 'Author', 'Género (opcional)': 'Genre (optional)',
  'Total de Capítulos': 'Total Chapters', 'Meta común': 'Shared goal', 'Capítulos': 'Chapters', 'Rápidos:': 'Quick:',
  'Portada del Libro': 'Book Cover', 'Arrastra la portada o toca para explorar': 'Drag the cover or tap to browse',
  'JPG, PNG o WebP (hasta 5MB). Si no subes nada, se genera una portada de cuero.': 'JPG, PNG or WebP (up to 5MB). If you skip it, a leather cover is generated.',
  'Fecha límite (opcional)': 'Deadline (optional)', 'Sin prisa si la dejas vacía': 'No rush if you leave it empty',
  'Crear Duelo y Generar Código': 'Create Duel & Generate Code', 'Previsualización del libro': 'Book preview',
  'En Vivo': 'Live', 'Meta declarada': 'Declared goal', 'Formato': 'Format', 'Edición Torneo': 'Tournament Edition',
  '¿Cómo funciona el duelo?': 'How does the duel work?',
  'Al generar el código, tu oponente podrá unirse en cualquier momento. Ambos avanzarán marcando capítulos leídos; quien llegue primero al final se corona.': 'Once the code is generated, your opponent can join at any time. Both of you advance by marking chapters read; whoever reaches the end first is crowned.',
  '¡Duelo creado!': 'Duel created!', 'Envíale este código a tu rival para que acepte el reto.': 'Send this code to your rival so they accept the challenge.',
  'Código de invitación': 'Invite code', 'Copiar código': 'Copy code', 'Ir al duelo': 'Go to duel',
  'Tu próximo libro': 'Your next book',
  '¿Leen en chikari.moe? Pega la URL de la novela (opcional)': 'Reading on chikari.moe? Paste the novel URL (optional)',
  'Autoconfigurar': 'Auto-fill', 'Se llenará el título, autor, capítulos y portada automáticamente.': 'Title, author, chapters and cover will be filled automatically.',
  'Desafío de alta intensidad': 'High-intensity challenge', 'Unirse a un Duelo': 'Join a Duel',
  'Ingresa el código de 6 caracteres que te envió tu amigo para entrar a la carrera literaria.': 'Enter the 6-character code your friend sent you to join the literary race.',
  'Aceptar el reto y comenzar': 'Accept the challenge and start', '¿No tienes un código?': "Don't have a code?",
  'Crea un duelo nuevo': 'Create a new duel', 'Ritmo Asincrónico': 'Asynchronous Pace',
  'Lee en tu horario libre. Cada avance se sincroniza al instante con tu rival.': 'Read on your own schedule. Every advance syncs instantly with your rival.',
  'Validación por Capítulo': 'Per-Chapter Validation', 'Progreso con hitos por capítulo, sin spoilers anticipados.': 'Progress with per-chapter milestones, no early spoilers.',
  'Corona al Campeón': 'Crown the Champion', 'El primero en marcar el capítulo final se corona campeón del duelo.': 'The first to mark the final chapter is crowned duel champion.',
  'Te ha desafiado a una carrera': 'Has challenged you to a race', 'Progreso del rival:': "Rival's progress:",
  'Modalidad: Asincrónica directa': 'Mode: Direct asynchronous', 'Buscando duelo…': 'Searching for duel…',
  'Código detectado — duelo activo encontrado': 'Code detected — active duel found',
  'Este duelo ya tiene rival.': 'This duel already has a rival.',
  'Este duelo lo creaste tú — compártele el código a tu rival.': 'You created this duel — share the code with your rival.',
  'Ya estás en este duelo. Te llevamos…': "You're already in this duel. Taking you there…",
  'Ventaja': 'Lead', 'Ritmo': 'Pace', 'Racha': 'Streak', 'Meta estimada': 'Estimated finish',
  'Liderando la carrera': 'Leading the race', 'Toca remontar': 'Time to catch up', 'Sin rival todavía': 'No rival yet',
  'Ritmo sólido y constante': 'Solid, steady pace', 'Puedes apretar un poco': 'You can push a little more',
  'Sin perder ningún turno': 'Without missing a day', 'Lee hoy para encenderla': 'Read today to light it up',
  'A tu ritmo actual': 'At your current pace', 'Marca capítulos para calcular': 'Mark chapters to calculate',
  '¡Libro terminado!': 'Book finished!', '¡Hecho!': 'Done!', 'Actividad del Duelo': 'Duel Activity',
  'En directo': 'Live', 'Aún no hay lecturas registradas. ¡Marca tu primer capítulo!': 'No reading logged yet. Mark your first chapter!',
  'Progreso de Capítulos': 'Chapter Progress', 'Marca el siguiente capítulo cuando termines de leerlo.': 'Mark the next chapter when you finish reading it.',
  'El duelo arranca cuando tu rival se una con el código.': 'The duel starts when your rival joins with the code.',
  '¡Completaste el libro entero!': 'You completed the whole book!',
  'El duelo terminó, pero puedes seguir registrando tu lectura.': 'The duel is over, but you can keep logging your reading.',
  'Siguiente por leer': 'Next to read', 'Pendientes': 'Pending',
  'El progreso se sincroniza con tu rival al instante.': 'Progress syncs with your rival instantly.',
  'Revertir último capítulo': 'Undo last chapter', 'Líder del duelo': 'Duel leader',
  'Persiguiendo la delantera': 'Chasing the lead', '¡Campeón del duelo!': 'Duel champion!',
  '¡Victoria!': 'Victory!', 'Derrota': 'Defeat', '¡Ventaja en el duelo!': 'Lead in the duel!',
  'Vas por detrás': "You're behind", 'Comparte el código para empezar la carrera': 'Share the code to start the race',
  'Puedes ir marcando capítulos, pero el duelo arranca oficialmente cuando tu rival se una.': 'You can start marking chapters, but the duel officially starts when your rival joins.',
  'Esperando a que tu rival se una con el código': 'Waiting for your rival to join with the code',
  'Finalizado': 'Finished', 'Comentarios del Duelo': 'Duel Comments',
  'Deja un comentario rápido sobre el capítulo en el que vas.': "Leave a quick comment about the chapter you're on.",
  'Comentar': 'Comment', 'Aún no hay comentarios. ¡Deja el primero!': 'No comments yet. Leave the first one!',
  'Sobre el capítulo': 'About chapter', 'Escribe tu comentario…': 'Write your comment…',
  'Métricas de Combate Literario': 'Literary Combat Metrics', 'Historial absoluto': 'All-time record',
  'Duelos Ganados': 'Duels Won', 'Duelos Perdidos': 'Duels Lost', 'Capítulos Leídos': 'Chapters Read',
  'Mayor Racha': 'Longest Streak', 'victorias': 'victories', 'derrotas': 'defeats', 'caps': 'chs',
  'días seguidos': 'days in a row', 'Tasa de victoria': 'Win rate', 'Total contiendas': 'Total contests',
  'Duelos totales': 'Total duels', 'Días con lectura': 'Reading days', 'récord personal': 'personal record',
  'Duelos Finalizados': 'Finished Duels', 'Ver todos mis duelos': 'See all my duels',
  'Todavía no has terminado ningún duelo. ¡Tu primer trofeo te espera!': "You haven't finished any duel yet. Your first trophy awaits!",
  'Gran Maestro de Lectura': 'Reading Grand Master', 'Duelista Experimentado': 'Experienced Duelist',
  'Lector en Ascenso': 'Rising Reader', 'Retar a Duelo': 'Challenge to a Duel', 'VICTORIA': 'VICTORY', 'DERROTA': 'DEFEAT',
  'Cargando duelo…': 'Loading duel…', 'Cargando perfil…': 'Loading profile…', 'Volver a mis duelos': 'Back to my duels',
};
const EN_RX = [
  [/^¡Hola de nuevo, (.+)!$/, 'Welcome back, $1!'],
  [/^Capítulo (\d+) de (\d+) \((\d+)%\)$/, 'Chapter $1 of $2 ($3%)'],
  [/^En curso — Día (\d+)$/, 'Ongoing — Day $1'],
  [/^Día (\d+) en marcha$/, 'Day $1 underway'],
  [/^Cap\. (\d+)$/, 'Ch. $1'],
  [/^(\d+) \/ (\d+) capítulos leídos$/, '$1 / $2 chapters read'],
  [/^(\d+) capítulos ?(.*)$/, '$1 chapters $2'],
  [/^Edición (\d+) Capítulos$/, '$1-Chapter Edition'],
  [/^Marcar Cap\. (\d+) como leído$/, 'Mark Ch. $1 as read'],
  [/^Completado por ti(.*)$/, 'Completed by you$1'],
  [/^Posición de (.+): Cap\. (\d+)$/, "$1's position: Ch. $2"],
  [/^([+-]?\d+) Caps$/, '$1 Chs'],
  [/^([\d.]+) caps\/día$/, '$1 chs/day'],
  [/^(\d+) día(s?)$/, '$1 day$2'],
  [/^Vas (\d+) por detrás$/, "You're $1 behind"],
  [/^Ventaja: \+(\d+) cap(?:ítulo)?s?$/, 'Lead: +$1 ch'],
  [/^Vas (\d+) capítulos? por detrás\. ¡Remonta!$/, "You're $1 chapters behind. Catch up!"],
  [/^(.+) te lleva (\d+) capítulos?\. ¡Remonta!$/, '$1 is $2 chapters ahead. Catch up!'],
  [/^Mantienes la delantera sobre (.+)\.$/, 'You hold the lead over $1.'],
  [/^Empate técnico con (.+)\. Todo se decide ahora\.$/, 'Technical tie with $1. It all comes down to now.'],
  [/^Terminaste (.+) antes que (.+)\.$/, 'You finished $1 before $2.'],
  [/^(.+) terminó el libro primero\. ¡La revancha te espera!$/, '$1 finished the book first. The rematch awaits!'],
  [/^Duelo finalizado (.+)\. Puedes seguir marcando tu lectura hasta terminar el libro\.$/, 'Duel finished $1. You can keep logging your reading until you finish the book.'],
  [/^Tienes (\d+) duelos? activos? hoy\.?$/, 'You have $1 active duel(s) today.'],
  [/^Creado (.+)$/, 'Created $1'],
  [/^Código: ([A-Z0-9]+)$/, 'Code: $1'],
  [/^Tú \(Cap\. (\d+)\/(\d+)\)$/, 'You (Ch. $1/$2)'],
  [/^(.+) \(Cap\. (\d+)\/(\d+)\)$/, '$1 (Ch. $2/$3)'],
  [/^(.+) avanzó al cap\. (\d+) (.+)$/, '$1 advanced to ch. $2 $3'],
  [/^Tu última lectura fue (.+)$/, 'Your last reading was $1'],
  [/^Pág(ina)?\. .*$/, null],
  [/^hace un momento$/, 'just now'],
  [/^hace (\d+) min$/, '$1 min ago'],
  [/^hace (\d+) h$/, '$1 h ago'],
  [/^ayer$/, 'yesterday'],
  [/^hace (\d+) días$/, '$1 days ago'],
  [/^Miembro desde (.+)$/, 'Member since $1'],
  [/^vs (.+)$/, 'vs $1'],
  [/^(\d+) desbloqueados$/, '$1 unlocked'],
  [/^Tu rival (.+) leyó (.+)$/, 'Your rival $1 read $2'],
  [/^Antes que (.+)$/, 'Before $1'],
  [/^Después que (.+) — ¡acelera!$/, 'After $1 — speed up!'],
  [/^Ritmo: (.+)$/, 'Pace: $1'],
  [/^Cap\. (\d+) \/ (\d+)$/, 'Ch. $1 / $2'],
  [/^(.+) lleva (\d+)% leído$/, '$1 is $2% in'],
  [/^Tú completaste el $/, 'You completed '],
  [/^ completó el $/, ' completed '],
  [/^Capítulo (\d+)$/, 'Chapter $1'],
  [/^Tienes $/, 'You have '],
  [/^(\d+) duelos? activos?$/, '$1 active duel(s)'],
  [/^\. ¡A leer se ha dicho!$/, ". Let's read!"],
];

const EN_INLINE = [
  [/hace un momento/g, 'just now'], [/hace (\d+) min\b/g, '$1 min ago'], [/hace (\d+) h\b/g, '$1 h ago'],
  [/hace (\d+) días/g, '$1 days ago'], [/\bayer\b/g, 'yesterday'],
  [/^Por\s*$/g, 'By '], [/^Ritmo:\s*$/g, 'Pace: '], [/^Tú completaste el\s*$/g, 'You completed the '],
  [/completó el\s*$/g, 'completed '], [/^\s*completaste el\s*$/g, ' completed the '], [/^Tú$/g, 'You'],
  [/• Edición (\d+) Capítulos/g, '• $1-Chapter Edition'],
  [/Fecha límite:/g, 'Deadline:'], [/capítulos leídos/g, 'chapters read'], [/caps\/día/g, 'chs/day'],
];

function trString(s) {
  const t = s.trim();
  if (!t || /^[a-z_]+$/.test(t)) return s; // ignora iconos de Material Symbols
  if (EN_DICT[t]) return s.replace(t, EN_DICT[t]);
  for (const [rx, rep] of EN_RX) {
    if (rep && rx.test(t)) return s.replace(t, t.replace(rx, rep));
  }
  let out = s;
  for (const [rx, rep] of EN_INLINE) out = out.replace(rx, rep);
  return out;
}

let _translating = false;
function translateTree(root) {
  if (currentLang() !== 'en' || !root) return;
  _translating = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const v = trString(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
    const scope = root.querySelectorAll ? root : document;
    scope.querySelectorAll('[placeholder], [aria-label]').forEach((el) => {
      for (const attr of ['placeholder', 'aria-label']) {
        const v = el.getAttribute(attr);
        if (v) {
          const t = trString(v);
          if (t !== v) el.setAttribute(attr, t);
        }
      }
    });
  } finally {
    _translating = false;
  }
}

function initLang() {
  if (currentLang() !== 'en') return;
  document.documentElement.lang = 'en';
  translateTree(document.body);
  const obs = new MutationObserver((muts) => {
    if (_translating) return;
    for (const m of muts) {
      if (m.type === 'characterData') { const v = trString(m.target.nodeValue); if (v !== m.target.nodeValue) { _translating = true; m.target.nodeValue = v; _translating = false; } }
      m.addedNodes && m.addedNodes.forEach((node) => {
        if (node.nodeType === 3) { const v = trString(node.nodeValue); if (v !== node.nodeValue) { _translating = true; node.nodeValue = v; _translating = false; } }
        else if (node.nodeType === 1) translateTree(node);
      });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}
document.addEventListener('DOMContentLoaded', initLang);

async function api(path, options = {}) {
  const opts = { headers: {}, credentials: 'same-origin', ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith('/api/auth') && location.pathname !== '/' && location.pathname !== '/index.html') {
    window.location.href = '/';
    throw new Error('Sesión expirada');
  }
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function toast(msg, kind = 'error') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-lg font-sans text-label-md shadow-2xl transition-all duration-300 opacity-0 pointer-events-none max-w-[90vw] text-center';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove('bg-error-container', 'text-on-error-container', 'bg-surface-container-highest', 'text-secondary');
  if (kind === 'error') el.classList.add('bg-error-container', 'text-on-error-container');
  else el.classList.add('bg-surface-container-highest', 'text-secondary');
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.opacity = '0'), 3500);
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

function fmtDate(isoDay) {
  if (!isoDay) return '—';
  const d = new Date(isoDay + 'T12:00:00');
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/* Portada: imagen subida o portada generada estilo cuero */
function coverHTML(duel, cls = '') {
  if (duel.coverUrl) {
    return `<div class="relative overflow-hidden bg-surface-container-high ${cls}">
      <img src="${esc(duel.coverUrl)}" alt="Portada de ${esc(duel.bookTitle)}" class="w-full h-full object-cover">
      <div class="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/60 to-transparent"></div>
    </div>`;
  }
  return `<div class="relative overflow-hidden bg-surface-container-lowest border border-outline-variant/50 flex flex-col items-center justify-center text-center p-3 gap-2 ${cls}" style="background-image: radial-gradient(rgba(255,200,128,0.07) 1px, transparent 1px); background-size: 10px 10px;">
    <span class="material-symbols-outlined text-primary-container text-[22px]">menu_book</span>
    <span class="font-serif font-semibold text-primary leading-tight text-[13px] line-clamp-4">${esc(duel.bookTitle)}</span>
    ${duel.author ? `<span class="font-sans text-[10px] text-on-surface-variant line-clamp-1">${esc(duel.author)}</span>` : ''}
    <div class="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/60 to-transparent"></div>
  </div>`;
}

/* Header compartido */
function mountHeader(active, user) {
  const links = [
    { path: '/duelos', key: 'duelos', label: 'Mis Duelos' },
    { path: '/nuevo', key: 'nuevo', label: 'Nuevo Duelo' },
    { path: '/unirse', key: 'unirse', label: 'Unirse con Código' },
    { path: '/perfil', key: 'perfil', label: 'Mi Perfil' },
  ];
  const nav = (mobile) =>
    links
      .map((l) => {
        const isActive = l.key === active;
        const base = mobile
          ? 'px-4 py-3 rounded-lg font-sans text-body-md transition-all '
          : 'px-element-gap-md py-element-gap-sm rounded-lg font-sans text-label-md transition-all ';
        const cls = isActive
          ? base + 'bg-surface-container-highest text-primary font-bold'
          : base + 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface';
        return `<a class="${cls}" href="${l.path}">${l.label}</a>`;
      })
      .join('');

  const el = document.getElementById('header');
  el.innerHTML = `
  <header class="fixed top-0 left-0 right-0 z-50 bg-surface/85 backdrop-blur-xl shadow-[0_12px_32px_-8px_rgba(0,0,0,0.45)]">
    <div class="h-16 md:h-20 max-w-[1280px] mx-auto px-gutter-mobile md:px-gutter-tablet lg:px-gutter-desktop flex items-center justify-between gap-element-gap-md">
      <div class="flex items-center gap-element-gap-lg min-w-0">
        <a class="flex items-center gap-element-gap-md group shrink-0" href="/duelos">
          <img alt="ReadOff" class="h-8 w-8 md:h-9 md:w-9 rounded-lg" src="/img/logo.svg">
          <div class="flex flex-col">
            <span class="font-serif font-semibold text-[22px] md:text-headline-lg text-primary leading-none tracking-tight">ReadOff</span>
            <span class="hidden sm:block font-sans text-label-sm text-outline tracking-wider italic mt-element-gap-xs">¿Quién lee más rápido?</span>
          </div>
        </a>
        <nav class="hidden lg:flex items-center gap-element-gap-xs ml-element-gap-lg">${nav(false)}</nav>
      </div>
      <div class="flex items-center gap-element-gap-sm md:gap-element-gap-md">
        <button aria-label="Cambiar tema" id="btn-theme" class="p-element-gap-sm text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-lg transition-all" type="button">
          <span class="material-symbols-outlined align-middle" id="theme-icon">${currentTheme() === 'light' ? 'dark_mode' : 'light_mode'}</span>
        </button>
        <button aria-label="Cambiar idioma" id="btn-lang" class="px-2.5 py-1.5 rounded-lg font-sans text-label-sm font-bold text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-all" type="button">${currentLang() === 'en' ? 'ES' : 'EN'}</button>
        <div class="flex items-center gap-element-gap-md">
          <a href="/perfil" class="w-9 h-9 rounded-full bg-primary-container/20 ring-2 ring-primary-container/60 flex items-center justify-center shrink-0">
            <span class="font-sans text-label-sm text-primary font-bold" id="hdr-initials">${esc(initials(user?.displayName))}</span>
          </a>
          <div class="hidden md:flex flex-col">
            <span class="font-sans text-label-sm text-on-surface" id="hdr-name">${esc(user?.displayName || '')}</span>
            <span class="font-sans text-label-sm text-outline">Lector Ávido</span>
          </div>
          <button aria-label="Cerrar sesión" id="btn-logout" class="hidden lg:block p-element-gap-sm text-on-surface-variant hover:text-error hover:bg-surface-container-high rounded-lg transition-all" type="button">
            <span class="material-symbols-outlined align-middle">logout</span>
          </button>
        </div>
        <button aria-label="Menú" id="btn-menu" class="lg:hidden p-element-gap-sm text-on-surface-variant hover:text-primary rounded-lg transition-all" type="button">
          <span class="material-symbols-outlined align-middle">menu</span>
        </button>
      </div>
    </div>
    <div id="mobile-menu" class="lg:hidden hidden border-t border-surface-container-highest/60 bg-surface-container-low/95 backdrop-blur-xl">
      <nav class="flex flex-col p-3 gap-1">${nav(true)}
        <button id="btn-logout-m" class="px-4 py-3 rounded-lg font-sans text-body-md text-left text-error/90 hover:bg-surface-container-high transition-all" type="button">Cerrar sesión</button>
      </nav>
    </div>
  </header>`;

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  };
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-m').addEventListener('click', logout);
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-lang').addEventListener('click', toggleLang);
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('mobile-menu').classList.toggle('hidden');
  });
}

/* Guardia de sesión + header. Devuelve el usuario. */
async function requireAuth(activeNav) {
  try {
    const { user } = await api('/api/me');
    mountHeader(activeNav, user);
    return user;
  } catch {
    window.location.href = '/';
    throw new Error('redirect');
  }
}
