const CACHE_NAME = 'app-futeba-v11';
const ASSETS = [
  '/',
  '/domingo',
  '/athletes',
  '/domingo/athletes',
  '/confirmados',
  '/domingo/confirmados',
  '/partida',
  '/domingo/partida',
  '/partidas',
  '/domingo/partidas',
  '/ranking',
  '/domingo/ranking',
  '/goleadores',
  '/domingo/goleadores',
  '/garcons',
  '/domingo/garcons',
  '/melhores-defensores',
  '/domingo/melhores-defensores',
  '/participacoes',
  '/domingo/participacoes',
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
  '/melhores-defensores.js',
  '/melhores-defensores-domingo.js',
  '/participacoes.js',
  '/participacoes-domingo.js',
  '/confirmados.js',
  '/partida.js',
  '/partidas.js',
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

function shouldBypassApiCache(request, url) {
  return request.cache === 'no-store' || url.searchParams.has('_ts');
}

async function cacheApiResponse(request, cacheExpiration = 30000) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const bypassCache = shouldBypassApiCache(request, url);

  try {
    const response = await fetch(request);

    if (!bypassCache && response.ok) {
      const clonedResponse = response.clone();
      const data = await clonedResponse.json();
      const timestampedData = { ...data, __cached_at: Date.now() };
      const timestampedResponse = new Response(JSON.stringify(timestampedData), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      cache.put(request, timestampedResponse);
    }
    
    return response;
  } catch (error) {
    if (bypassCache) {
      throw error;
    }

    const cached = await cache.match(request);
    if (cached) {
      try {
        const data = await cached.json();
        const cachedAt = data.__cached_at || 0;
        if (Date.now() - cachedAt < cacheExpiration) {
          return cached;
        }
      } catch (e) {
        return cached;
      }
    }
    
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET') {
      event.respondWith(cacheApiResponse(request, 60000));
    }
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
