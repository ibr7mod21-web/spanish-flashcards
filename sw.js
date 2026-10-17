// Bump CACHE_VERSION on every app change (html/css/js/icons/manifest).
const CACHE_VERSION = 'v10';
const CACHE = 'sf-' + CACHE_VERSION;

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'grading.js',
  'scheduler.js',
  'feedback.js',
  'settings.js',
  'sync.js',
  'app.js',
  'manifest.webmanifest',
  'deck.json',
  'icons/icon.svg',
  'icons/raven-white.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sf-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // deck.json: network-first, fall back to cache when offline.
  if (url.pathname.endsWith('/deck.json')) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('deck.json', copy));
          }
          return res;
        })
        .catch(() => caches.match('deck.json'))
    );
    return;
  }

  // App shell: cache-first. Page navigations get index.html.
  event.respondWith(
    caches.match(req.mode === 'navigate' ? 'index.html' : req, { ignoreSearch: true })
      .then((hit) => hit || fetch(req))
  );
});
