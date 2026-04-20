/**
 * lazyWithRetry.js — resilient React.lazy wrapper.
 *
 * Why this exists (2026-04-20 incident):
 *   Vite builds chunk-hashed JS (e.g. WelcomeTour-lDkfabdA.js). Each deploy
 *   invalidates the hash. A browser tab loaded BEFORE a deploy still holds
 *   the old hash in its index.html bundle; when it lazy-imports a panel it
 *   tries to fetch a chunk that no longer exists on the CDN → the import
 *   rejects with "Failed to fetch dynamically imported module" and React's
 *   Suspense bubbles the error into the boundary as a whole-page crash.
 *
 *   The previous in-file `lazyRetry` used a single sessionStorage flag
 *   (`chunk_reload`) as a "have we reloaded yet?" gate. That flag was
 *   sticky across deploys: once set, a second deploy same-day could hit
 *   a chunk error and immediately throw instead of reloading, because
 *   the flag from the earlier deploy was still present. Same shape across
 *   three files (App.jsx, InstrumentDetailPage.jsx, and a bare lazy() in
 *   AppLayoutHelpers.jsx with NO retry at all). This consolidates them.
 *
 * Design:
 *   1. Only treat chunk-load-ish errors as retriable. Syntax errors in an
 *      already-loaded chunk are real bugs and must surface to the boundary.
 *   2. Silent in-memory retry first (350 ms). Transient network blips
 *      don't need a page reload.
 *   3. If the silent retry also fails, reload once — BUT gate on a
 *      timestamp cooldown (5 min) rather than a boolean. If we just
 *      reloaded for this reason, don't enter a loop; let the boundary
 *      show the crash UI.
 *   4. Also listen for Vite's `vite:preloadError` event at module scope —
 *      that covers bare `lazy()` calls anywhere else in the tree and any
 *      modulepreload links failing before React even mounts.
 */

import { lazy } from 'react';

const RELOAD_COOLDOWN_MS   = 5 * 60_000;   // 5 minutes
const SILENT_RETRY_DELAY_MS = 350;
const STORAGE_KEY          = 'particle_chunk_last_reload';

/**
 * Heuristic: is this error likely a stale-deploy chunk failure?
 * We want to reload the tab for these, not for real code bugs.
 */
function isChunkLoadError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg  = String(err.message || '');
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /dynamically imported module/i.test(msg)
  );
}

/**
 * Check the stored last-reload timestamp. If we reloaded for a chunk
 * error in the last RELOAD_COOLDOWN_MS, don't reload again — let the
 * error boundary catch it. This prevents an infinite reload loop if
 * the server genuinely no longer serves the chunk.
 */
function shouldReload() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return true;
    return (Date.now() - ts) > RELOAD_COOLDOWN_MS;
  } catch {
    // Private mode / disabled storage — default to reload, it's the safer path.
    return true;
  }
}

function markReload() {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch { /* storage disabled — reload still happens */ }
}

/**
 * Wrap an import-returning function in React.lazy with retry semantics.
 *
 *   const WelcomeTour = lazyWithRetry(() => import('./WelcomeTour'));
 */
export function lazyWithRetry(importFn) {
  return lazy(() =>
    importFn().catch((err) => {
      if (!isChunkLoadError(err)) {
        // Not a stale-chunk failure — surface the real error.
        throw err;
      }
      // Silent in-memory retry first.
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          importFn().then(resolve).catch((err2) => {
            if (!isChunkLoadError(err2)) return reject(err2);
            if (shouldReload()) {
              markReload();
              // Hard reload — browser will fetch fresh index.html and new chunk hashes.
              window.location.reload();
              // Return a never-resolving promise so Suspense doesn't flash an error.
              return;
            }
            // Already reloaded recently — surface to the boundary.
            reject(err2);
          });
        }, SILENT_RETRY_DELAY_MS);
      });
    })
  );
}

/**
 * Install a global listener for Vite's `vite:preloadError`. This fires
 * when a <link rel="modulepreload"> or a dynamic import rejects before
 * React's lazy boundary can catch it. Behaves like lazyWithRetry: honors
 * the same cooldown so we don't thrash.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (!isChunkLoadError(event?.payload)) return;
    if (!shouldReload()) return;
    event.preventDefault?.(); // tell Vite we're handling it
    markReload();
    window.location.reload();
  });
}

export default lazyWithRetry;
