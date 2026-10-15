// Service Worker da interface. A casca do app fica em cache, mas a base de
// hidrômetros é consultada no Google Sheets e requer conexão.

const RELEASE = 'v11';
const CACHE_NAME = 'hidrometros-cache-' + RELEASE;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/utils.js',
  './js/sheets-config.js',
  './js/services/hidrometros-service.js',
  './js/services/sheets-source.js',
  './js/services/sheets-write.js',
  './js/services/embalagem.js',
  './js/services/recuperacao-service.js',
  './js/screens/recuperar.js',
  './js/lib/xlsx.full.min.js',
  './js/services/import-service.js',
  './js/services/conferencia-service.js',
  './js/services/export-service.js',
  './js/screens/home.js',
  './js/screens/nova-conferencia.js',
  './js/screens/conferencia.js',
  './js/screens/pendentes.js',
  './js/screens/conferidos.js',
  './js/screens/resumo.js',
  './js/screens/historico.js',
  './js/screens/base.js',
  './js/screens/config.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Monta a versão inteira antes de ativar, sem reutilizar JS do cache HTTP.
      await Promise.all(PRECACHE_URLS.map(async path => {
        const url = new URL(path, self.registration.scope);
        url.searchParams.set('release', RELEASE);
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error('Falha ao atualizar ' + path);
        await cache.put(new URL(path, self.registration.scope).href, response);
      }));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hidrometros-cache-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      // A página de reparo funciona mesmo quando o aplicativo está desatualizado.
      if (new URL(request.url).pathname.endsWith('/atualizar.html')) return fetch(request, { cache: 'reload' });
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      // Cada versão mantém um conjunto estável de módulos. JS ausente não recebe HTML.
      return fetch(request);
    })
  );
});
