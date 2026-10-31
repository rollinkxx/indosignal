const CACHE = 'indo-signal-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || new Response('Data lama tidak tersedia.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
});
