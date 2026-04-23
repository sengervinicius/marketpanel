import { useState, useEffect } from 'react';

/**
 * useIsMobile — single source of truth for mobile detection.
 *
 * #247 / P2.5 — SSR/early-mount safety:
 *   Earlier versions computed the initial value synchronously inside the
 *   useState initializer by reading window.matchMedia. That is safe in
 *   Vite's SPA bundle today, but any future SSR path, any non-DOM
 *   test harness, or a very early mount before window is decorated
 *   threw "window is not defined" / ReferenceError before the typeof
 *   guard kicked in (caused by minifier reordering in some builds).
 *
 *   New contract:
 *     - initial state is always `false` (desktop-first, matches our
 *       server-rendered markup if we ever add SSR)
 *     - the real detection happens inside useEffect, which only runs
 *       in the browser
 *     - first paint may briefly show desktop markup on a phone; the
 *       effect flips isMobile on the next commit (same tick)
 *
 * Threshold: 768px (matches existing app behaviour).
 */
const DESKTOP_MQ = '(min-width: 768px)';

function detectMobileFromWindow() {
  if (typeof window === 'undefined') return false;
  let mqDesktop = false;
  try {
    if (typeof window.matchMedia === 'function') {
      mqDesktop = window.matchMedia(DESKTOP_MQ).matches;
    }
  } catch { /* matchMedia missing / throws in old JSDOM */ }
  const widthDesktop = (window.innerWidth || 0) >= 768;
  // If EITHER method says desktop, treat as desktop.
  return !(mqDesktop || widthDesktop);
}

export function useIsMobile() {
  // Always start as non-mobile. The effect below flips this on the
  // first client commit. This keeps the hook safe under SSR, tests,
  // and any pre-window mount path.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Sync on mount
    setIsMobile(detectMobileFromWindow());

    const handler = () => setIsMobile(detectMobileFromWindow());

    let mql = null;
    try {
      if (typeof window.matchMedia === 'function') {
        mql = window.matchMedia(DESKTOP_MQ);
        // Safari < 14 uses the legacy addListener/removeListener API.
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', handler);
        } else if (typeof mql.addListener === 'function') {
          mql.addListener(handler);
        }
      }
    } catch { /* matchMedia unavailable — fall through to resize listener */ }

    window.addEventListener('resize', handler);

    return () => {
      try {
        if (mql) {
          if (typeof mql.removeEventListener === 'function') {
            mql.removeEventListener('change', handler);
          } else if (typeof mql.removeListener === 'function') {
            mql.removeListener(handler);
          }
        }
      } catch { /* no-op — detach best-effort */ }
      window.removeEventListener('resize', handler);
    };
  }, []);

  return isMobile;
}
