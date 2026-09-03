// Service Worker do app — cache-first da "casca" inteira, para funcionar 100%
// offline depois da primeira visita. Não há nenhuma API/backend para chamar:
// todos os dados ficam no IndexedDB do próprio aparelho.

const CACHE_NAME = 'hidrometros-cache-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/utils.js',
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
  './js/screens/importar.js',
  './js/screens/config.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;

      return network.then((response) => response || caches.match('./index.html'));
    })
  );
});
