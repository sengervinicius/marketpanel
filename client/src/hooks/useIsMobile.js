import { useState, useEffect, useCallback } from 'react';

/**
 * useIsMobile — single source of truth for mobile detection.
 *
 * Uses BOTH matchMedia AND window.innerWidth as a cross-check:
 * if EITHER method says desktop (≥1024px), we treat as desktop.
 * This prevents false mobile detection when DevTools is docked
 * or CSS hasn't fully applied yet.
 *
 * Threshold: 1024px (matches existing app behavior).
 */
const DESKTOP_MQ = '(min-width: 1024px)';

export function useIsMobile() {
  const detectMobile = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const mqDesktop = typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_MQ).matches
      : false;
    const widthDesktop = window.innerWidth >= 1024;
    // If EITHER method says desktop, treat as desktop
    return !(mqDesktop || widthDesktop);
  }, []);

  const [isMobile, setIsMobile] = useState(detectMobile);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Sync on mount (layout may have changed since useState initializer)
    setIsMobile(detectMobile());

    const handler = () => setIsMobile(detectMobile());

    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia(DESKTOP_MQ);
      mql.addEventListener('change', handler);
      window.addEventListener('resize', handler);
      return () => {
        mql.removeEventListener('change', handler);
        window.removeEventListener('resize', handler);
      };
    }

    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [detectMobile]);

  return isMobile;
}
