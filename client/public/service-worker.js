/**
 * service-worker.js — SELF-DESTRUCT kill switch.
 *
 * A legacy stale-while-revalidate SW got stuck controlling some browsers and
 * kept serving old bundles (deploys never appeared, reloads didn't help).
 * Serving this file at the SAME path means those browsers fetch it on their
 * next SW update check (which happens on navigation), install it, and it
 * immediately: clears ALL caches, unregisters itself, and force-reloads every
 * open tab so they pull the current bundle from the network. After this runs
 * once, no service worker remains and the site behaves like a normal static
 * site (fresh on every deploy).
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) { /* ignore */ }
    try { await self.registration.unregister(); } catch (e) { /* ignore */ }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        try { client.navigate(client.url); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  })());
});

// Never intercept fetches — go straight to network so nothing stale is served.
self.addEventListener('fetch', () => {});
