// Offline app shell: cache-first for our own files, network for everything else.
const CACHE = 'books-library-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'config.js', 'js/store.js', 'js/sync.js', 'js/lookup.js', 'js/scanner.js', 'js/app.js', 'vendor/zxing.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'seed-books.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Stale-while-revalidate so updates arrive on the next open.
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
