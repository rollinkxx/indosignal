const CACHE = 'indo-signal-shell-v2';
const SHELL = ['/', '/performa', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(caches.match(event.request).then((cached) => fetch(event.request).then((response) => {
    if (response.ok && (event.request.mode === 'navigate' || SHELL.includes(url.pathname))) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => cached || new Response('Data lama tidak tersedia.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
});
