/**
 * useFreshness.js — #289 part 2
 *
 * Hook that asks the server "when did this symbol last get fresh data?"
 * Returns { ageMs, source, asOf, level } where level is one of:
 *   'fresh' (green)  : ageMs <= 30s
 *   'stale' (amber)  : 30s < ageMs <= 5min
 *   'frozen' (red)   : ageMs > 5min
 *   'unknown'        : no record yet, server hasn't seen this symbol
 *
 * Polls /api/data-freshness/:symbol every 30s. Cheap on the server side —
 * the freshness ledger is an in-memory Map lookup. Cheap on the client —
 * one small JSON object per ticker per 30s. Self-cancelling on unmount.
 *
 * Usage:
 *   const fresh = useFreshness('SPY');
 *   <span style={{ color: dotColor(fresh.level) }}>●</span>
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

const POLL_INTERVAL_MS = 30 * 1000;

// Threshold tiers. Match the server-side OVERLAY_STALE_MS in
// useWebSocketTicks.js so the dot agrees with the merge layer.
const FRESH_MS  = 30 * 1000;
const STALE_MS  = 5 * 60 * 1000;

function level(ageMs) {
  if (ageMs == null) return 'unknown';
  if (ageMs <= FRESH_MS) return 'fresh';
  if (ageMs <= STALE_MS) return 'stale';
  return 'frozen';
}

/**
 * @param {string} symbol — canonical ticker, e.g. 'SPY', 'X:BTCUSD'.
 * @returns {{ageMs: number|null, level: string, source: string|null, asOf: number|null}}
 */
export function useFreshness(symbol) {
  const [state, setState] = useState({ ageMs: null, level: 'unknown', source: null, asOf: null });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!symbol) return;

    let timer = null;
    const fetchOnce = async () => {
      try {
        const res = await apiFetch(`/api/data-freshness/${encodeURIComponent(symbol)}`);
        if (!aliveRef.current) return;
        if (res.status === 404) {
          // Server has no record for this symbol yet — treat as unknown
          // rather than red. The dot just stays grey.
          setState(s => (s.level === 'unknown' ? s : { ageMs: null, level: 'unknown', source: null, asOf: null }));
          return;
        }
        if (!res.ok) return; // swallow transient errors; next tick will retry
        const json = await res.json();
        if (!aliveRef.current || !json?.ok) return;
        // Recompute ageMs locally from asOf so the dot ages between polls
        // without waiting for the next round-trip.
        const ageMs = json.asOf ? Date.now() - json.asOf : null;
        setState({
          ageMs,
          level: level(ageMs),
          source: json.source || null,
          asOf: json.asOf || null,
        });
      } catch (_) { /* ignore — try again next tick */ }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, POLL_INTERVAL_MS);

    // Also tick the level locally every 5s so a 'fresh' entry naturally
    // ages into 'stale' / 'frozen' visually without waiting for the next
    // server round-trip.
    const localTick = setInterval(() => {
      if (!aliveRef.current) return;
      setState(s => {
        if (!s.asOf) return s;
        const ageMs = Date.now() - s.asOf;
        const next = level(ageMs);
        return next === s.level ? s : { ...s, ageMs, level: next };
      });
    }, 5 * 1000);

    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
      clearInterval(localTick);
    };
  }, [symbol]);

  return state;
}

/**
 * Dot colour for a given freshness level. Used by FreshnessDot and
 * any ad-hoc renderers that want to match the colour scheme.
 */
export function freshnessColor(lvl) {
  switch (lvl) {
    case 'fresh':   return 'var(--price-up, #16c784)';
    case 'stale':   return 'var(--semantic-warn, #ff9900)';
    case 'frozen':  return 'var(--price-down, #ea3943)';
    default:        return 'var(--text-faint, #555)';
  }
}

export default useFreshness;
