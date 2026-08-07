const BUILD_FINGERPRINT = '__APP_BUILD_FINGERPRINT__';
const CACHE_NAME = `kangkang-local-${BUILD_FINGERPRINT}`;
const LOCAL_SHELL = [
  './', './index.html', './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('kangkang-local-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map(client => client.navigate(client.url).catch(() => null)));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // The service worker never turns an external request into a runtime
    // dependency. AI traffic is handled by the native bridge, not this worker.
    event.respondWith(Promise.resolve(new Response('', { status: 503 })));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
