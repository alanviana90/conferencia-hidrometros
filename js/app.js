// @ts-check
/**
 * Bootstrap do app: registra o service worker e liga o roteador (hash-based,
 * sem framework/build step).
 */

import { openDatabase } from './db.js';

/**
 * @typedef {Object} Route
 * @property {RegExp} pattern
 * @property {string[]} paramNames
 * @property {() => Promise<{render: (container: HTMLElement, params: Record<string,string>, search: URLSearchParams) => Promise<void>|void}>} load
 */

/** @type {{path: string, load: Route['load']}[]} */
const ROUTE_DEFS = [
  { path: '/', load: () => import('./screens/home.js') },
  { path: '/nova', load: () => import('./screens/nova-conferencia.js') },
  { path: '/conferencia/:id', load: () => import('./screens/conferencia.js') },
  { path: '/conferencia/:id/pendentes', load: () => import('./screens/pendentes.js') },
  { path: '/conferencia/:id/conferidos', load: () => import('./screens/conferidos.js') },
  { path: '/conferencia/:id/resumo', load: () => import('./screens/resumo.js') },
  { path: '/historico', load: () => import('./screens/historico.js') },
  { path: '/base', load: () => import('./screens/base.js') },
  { path: '/importar', load: () => import('./screens/importar.js') },
  { path: '/config', load: () => import('./screens/config.js') },
];

/** @type {Route[]} */
const ROUTES = ROUTE_DEFS.map((r) => {
  const paramNames = [];
  const pattern = new RegExp(
    '^' +
      r.path.replace(/:[a-zA-Z]+/g, (m) => {
        paramNames.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  return { pattern, paramNames, load: r.load };
});

/** @param {string} path */
export function navigate(path) {
  location.hash = '#' + path;
}

function currentPath() {
  const hash = location.hash || '#/';
  const raw = hash.slice(1) || '/';
  const [path, query] = raw.split('?');
  return { path: path || '/', search: new URLSearchParams(query || '') };
}

async function renderRoute() {
  const { path, search } = currentPath();
  const app = document.getElementById('app');
  if (!app) return;

  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;

    /** @type {Record<string,string>} */
    const params = {};
    route.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));

    app.innerHTML = '<div class="loading">Carregando…</div>';
    try {
      const mod = await route.load();
      app.scrollTop = 0;
      window.scrollTo(0, 0);
      await mod.render(app, params, search);
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="content"><div class="card"><strong>Erro ao carregar a tela.</strong><p class="muted">${err instanceof Error ? err.message : String(err)}</p><a class="btn btn-outline" href="#/">Voltar ao início</a></div></div>`;
    }
    return;
  }

  app.innerHTML = '<div class="content"><div class="card">Tela não encontrada.<br><a class="btn btn-outline" href="#/">Voltar ao início</a></div></div>';
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    // Falha ao registrar SW (ex.: rodando em HTTP puro na rede local) não deve
    // impedir o app de funcionar — só o cache offline "de verdade" fica indisponível.
    console.warn('Service worker não registrado:', err);
  }
}

async function boot() {
  await openDatabase();
  await registerServiceWorker();
  window.addEventListener('hashchange', renderRoute);
  await renderRoute();
}

boot();
