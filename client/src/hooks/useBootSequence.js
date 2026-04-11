import { useState, useEffect } from 'react';

/**
 * useBootSequence — parallel boot.
 * Ready as soon as auth check is done AND settings are loaded (if logged in).
 * Emergency timeout forces ready after 3 seconds (reduced from 5).
 */
export function useBootSequence({ authReady, user, settingsLoaded }) {
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    if (isReady) return;
    // Auth must be done; settings only needed for logged-in users
    if (authReady && (settingsLoaded || !user)) {
      setReady(true);
    }
  }, [authReady, user, settingsLoaded, isReady]);

  // Emergency timeout — reduced to 3s since boot is now parallel
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(t);
  }, []);

  return { isReady, bootState: isReady ? 'READY' : 'BOOTING', BOOT: { READY: 'READY' } };
}
