/**
 * useSymbolSectors — FEAT-3: lazy per-session sector buckets for watchlist
 * EQUITIES sub-grouping.
 *
 * Fetches GET /api/market/sectors?symbols= for symbols not yet resolved,
 * at most once per symbol per session (module-level cache — server caches
 * 7d on top of this). Failures degrade silently: unresolved symbols group
 * under "Other" / flat rendering.
 */
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';

// One per SPA session (survives panel unmounts, not reloads).
const sessionSectors = new Map();   // SYM → bucket string
const requestedSectors = new Set(); // SYMs already asked this session

export const SECTOR_BUCKET_ORDER = [
  'Tech', 'Financials', 'Healthcare', 'Retail/Consumer', 'Energy',
  'Industrials', 'Comms', 'Materials', 'Utilities', 'RE', 'Other',
];

export const SECTOR_BUCKET_LABELS = {
  Tech: 'TECH',
  Financials: 'FINANCIALS',
  Healthcare: 'HEALTHCARE',
  'Retail/Consumer': 'RETAIL/CONSUMER',
  Energy: 'ENERGY',
  Industrials: 'INDUSTRIALS',
  Comms: 'COMMS',
  Materials: 'MATERIALS',
  Utilities: 'UTILITIES',
  RE: 'REAL ESTATE',
  Other: 'OTHER',
};

export function useSymbolSectors(symbols) {
  const [version, setVersion] = useState(0);
  const key = symbols.join(',');

  useEffect(() => {
    const missing = symbols.filter(s => !requestedSectors.has(s));
    if (missing.length === 0) return undefined;
    missing.forEach(s => requestedSectors.add(s));
    let alive = true;
    (async () => {
      try {
        // Server caps at 60 symbols per call.
        for (let i = 0; i < missing.length; i += 60) {
          const chunk = missing.slice(i, i + 60);
          const res = await apiFetch(`/api/market/sectors?symbols=${encodeURIComponent(chunk.join(','))}`);
          if (!res.ok) continue;
          const json = await res.json();
          for (const [sym, info] of Object.entries(json?.sectors || {})) {
            sessionSectors.set(sym, info?.bucket || 'Other');
          }
        }
        if (alive) setVersion(v => v + 1);
      } catch { /* sector grouping degrades to flat/Other */ }
    })();
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    const map = {};
    for (const s of symbols) map[s] = sessionSectors.get(s) || null;
    return map;
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
