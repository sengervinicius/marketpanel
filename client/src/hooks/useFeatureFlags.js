/**
 * useFeatureFlags.js — W6.1 client-side flag evaluator.
 *
 * Fetches `/api/flags` once on mount, refreshes every 60s, and exposes:
 *   - flags: {name: boolean}  (memoized)
 *   - isOn(name, defaultValue=false): convenience accessor
 *
 * Usage:
 *   const { isOn } = useFeatureFlags();
 *   if (!isOn('ai_chat_enabled')) return <DisabledCTA />;
 *
 * Fail-closed: if the /api/flags call errors, the map is empty, so `isOn`
 * returns the `defaultValue` (which should almost always be `false` for
 * new features and `true` only for legacy surfaces you haven't yet gated).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';

const REFRESH_MS = 60_000;

let _shared = {
  flags: {},
  loadedAt: 0,
  inFlight: null,
  listeners: new Set(),
};

async function _load() {
  if (_shared.inFlight) return _shared.inFlight;
  _shared.inFlight = (async () => {
    try {
      const res = await apiFetch('/api/flags');
      const data = res && typeof res.json === 'function' ? await res.json() : res;
      _shared.flags = data?.flags || {};
      _shared.loadedAt = Date.now();
      for (const fn of _shared.listeners) try { fn(_shared.flags); } catch {}
    } catch {
      // fail closed — keep previous map (if any); empty by default
    } finally {
      _shared.inFlight = null;
    }
    return _shared.flags;
  })();
  return _shared.inFlight;
}

export function useFeatureFlags() {
  const [flags, setFlags] = useState(_shared.flags);
  const timerRef = useRef(null);

  useEffect(() => {
    const sub = (next) => setFlags({ ...next });
    _shared.listeners.add(sub);

    // Initial load if stale
    if (Date.now() - _shared.loadedAt > REFRESH_MS) _load();

    // Periodic refresh so a flag flipped by an admin propagates without
    // requiring the user to refresh the page.
    timerRef.current = setInterval(() => _load(), REFRESH_MS);

    return () => {
      _shared.listeners.delete(sub);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const isOn = useCallback((name, defaultValue = false) => {
    if (name in flags) return Boolean(flags[name]);
    return defaultValue;
  }, [flags]);

  return useMemo(() => ({ flags, isOn, refresh: _load }), [flags, isOn]);
}

export default useFeatureFlags;
