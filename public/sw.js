const CACHE_NAME = 'app-futeba-v3';
const ASSETS = [
  '/',
  '/domingo',
  '/athletes',
  '/domingo/athletes',
  '/ranking',
  '/domingo/ranking',
  '/goleadores',
  '/domingo/goleadores',
  '/garcons',
  '/domingo/garcons',
  '/style.css',
  '/login.js',
  '/login-domingo.js',
  '/athletes.js',
  '/athletes-domingo.js',
  '/ranking.js',
  '/ranking-domingo.js',
  '/goleadores.js',
  '/goleadores-domingo.js',
  '/garcons.js',
  '/garcons-domingo.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackPath = '/') {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return caches.match(fallbackPath);
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    const fallbackPath = url.pathname.startsWith('/domingo') ? '/domingo' : '/';
    event.respondWith(networkFirst(request, fallbackPath));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, '/'));
  }
});
