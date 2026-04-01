/**
 * Senger Market — Service Worker
 *
 * Strategy:
 *   - App shell (HTML, JS, CSS) → cache-first, network-update in background
 *   - API calls → network-first, cache fallback for read endpoints
 *   - Offline fallback page when both network and cache miss
 */

const CACHE_NAME = 'senger-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/favicon.svg',
];

// ── Install: precache app shell + offline page ──────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first with cache fallback ────────────────────────────────
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Skip cross-origin requests (analytics, external APIs)
  if (url.origin !== self.location.origin) return;

  // API calls: network-first, cache read responses for offline
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Cache successful GET API responses
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Navigation requests: network-first, fall back to cached shell or offline page
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
