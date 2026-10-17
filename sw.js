// Offline app shell: cache-first for our own files, network for everything else.
const CACHE = 'books-library-v36';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'config.js', 'view.html', 'js/view.js', 'js/cover.js', 'js/store.js', 'js/sync.js', 'js/lookup.js', 'js/scanner.js', 'js/app.js', 'vendor/zxing.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'seed-books.json', 'js/reader.js', 'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so a new version shows up on the next open; the cache is the offline fallback.
  e.respondWith(caches.open(CACHE).then(async c => {
    try {
      const r = await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (err) {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  }));
});
