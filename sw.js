/* ==========================================================================
   Verity - PWA Service Worker
   - API calls (/api/*) are never touched: prices, history, statements and KAP data must be fresh.
   - App files and data (HTML, JS, CSS, JSON): network first, cached copy only when offline,
     so a new deploy is never mixed with stale scripts.
   - Libraries and icons (versioned, immutable): cache first.
   ========================================================================== */

// The build replaces this with a hash of the deployed files, so every deploy gets a fresh cache
const CACHE_NAME = 'verity-dev';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/lib/chart.min.js',
  './assets/lib/fa/all.min.css?v=2',
  './assets/icons/icon-192.svg?v=2',
  './assets/icons/icon-512.svg?v=2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA] Cache pre-fill partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined))
    )).then(() => self.clients.claim())
  );
});

// Alert notifications (app.js notifyAlert): a click brings the site forward on that stock
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ticker = event.notification.data && event.notification.data.ticker;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (client) {
        client.postMessage({ type: 'open-stock', ticker });
        return client.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;     // third-party requests go straight to the network
  if (url.pathname.startsWith('/api/')) return;        // live data: always the network

  // Our own JS/CSS carry a content hash (?v=...) from the build, so they can be cache-first too
  const fingerprinted = /^\/assets\/(js|css)\//.test(url.pathname) && url.searchParams.has('v');
  const immutable = fingerprinted || url.pathname.startsWith('/assets/lib/') || url.pathname.startsWith('/assets/icons/');

  if (immutable) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(async (cache) => {
            if (fingerprinted) {
              // Drop older builds of the same file so the cache doesn't grow with every deploy
              for (const old of await cache.keys()) {
                if (new URL(old.url).pathname === url.pathname) await cache.delete(old);
              }
            }
            return cache.put(event.request, copy);
          });
        }
        return res;
      }))
    );
    return;
  }

  // Network first; fall back to the cache when offline
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request).then((cached) => {
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return undefined;
    }))
  );
});