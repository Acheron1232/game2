// Service worker: keeps game assets (/assets/... with a ?v= content hash) in the Cache API,
// so the second visit loads them from disk. Files with a new hash are new URLs, so old
// cached copies never come back by mistake. Everything else goes to the network as usual.

const CACHE = 'temple-wars-assets-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (!url.pathname.startsWith('/assets/') || !url.searchParams.has('v')) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }),
  );
});
