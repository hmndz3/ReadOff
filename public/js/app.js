/* Helpers compartidos de ReadOff */

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
