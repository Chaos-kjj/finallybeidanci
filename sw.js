const CACHE_NAME = 'kangkang-local-v1';
const LOCAL_SHELL = [
  './', './index.html', './manifest.webmanifest', './src/main.js',
  './reader-text-cleaner.js', './reader-epub-parser.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(LOCAL_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
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
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match('./index.html'))));
});
