import { useState, useEffect } from 'react';

const BOOT = {
  INIT: 'INIT',
  AUTH_PENDING: 'AUTH_PENDING',
  AUTH_DONE: 'AUTH_DONE',
  SETTINGS_PENDING: 'SETTINGS_PENDING',
  READY: 'READY',
};

/**
 * useBootSequence — manages the app boot state machine.
 * Transitions: INIT → AUTH_PENDING → AUTH_DONE → SETTINGS_PENDING → READY
 * Emergency timeout forces READY after 5 seconds.
 */
export function useBootSequence({ authReady, user, settingsLoaded }) {
  const [bootState, setBootState] = useState(BOOT.INIT);

  // Boot state transitions
  useEffect(() => {
    let mounted = true;
    if (bootState === BOOT.INIT) {
      setBootState(BOOT.AUTH_PENDING);
    } else if (bootState === BOOT.AUTH_PENDING && authReady) {
      setBootState(BOOT.AUTH_DONE);
    } else if (bootState === BOOT.AUTH_DONE) {
      if (user) {
        setBootState(BOOT.SETTINGS_PENDING);
      } else {
        setBootState(BOOT.READY);
      }
    } else if (bootState === BOOT.SETTINGS_PENDING && settingsLoaded) {
      if (!mounted) return;
      setBootState(BOOT.READY);
    }
    return () => { mounted = false; };
  }, [bootState, authReady, user, settingsLoaded]);

  // Emergency boot timeout
  useEffect(() => {
    const timeout = setTimeout(() => {
      setBootState(prev => prev !== BOOT.READY ? BOOT.READY : prev);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  return { bootState, isReady: bootState === BOOT.READY, BOOT };
}
