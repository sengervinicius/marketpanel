/**
 * useSessionBadge — #292 F2
 *
 * The one badge for a data panel's header, derived from the panel's own
 * newest quote time and the exchange session — never from the WebSocket's
 * connection level (which read "L1 REAL-TIME" whenever a socket was open,
 * even over Friday's prices).
 *
 *   const badge = useSessionBadge('US', data);   // data: {sym: {asOf}} | [{asOf}]
 *   → { text: 'LIVE' | 'DELAYED 3m' | 'STALE · FRI 17:00' | 'OPENS 10:00 · LAST FRI 17:00' | 'CLOSED · …' | 'TIME UNKNOWN',
 *       color, bg, title, state, asOf }
 */
import { useMemo, useState, useEffect } from 'react';
import { describeQuote } from '../utils/marketSession';

export default function useSessionBadge(group, data, { error = null } = {}) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 30_000); return () => clearInterval(id); }, []);
  return useMemo(() => {
    if (error) return { text: 'FEED DOWN', color: '#ff4d4d', bg: '#2a0a0a', title: String(error), state: 'ERROR', asOf: null };
    const rows = Array.isArray(data) ? data : Object.values(data || {});
    let newest = 0;
    for (const r of rows) {
      const t = r?.asOf ?? r?._meta?.asOf ?? null;
      const ms = typeof t === 'number' ? t : (t ? Date.parse(t) : NaN);
      if (Number.isFinite(ms) && ms > newest) newest = ms;
    }
    if (!rows.length) return { text: 'NO DATA', color: '#9aa0a6', bg: '#161616', title: 'Nothing received yet', state: 'EMPTY', asOf: null };
    const d = describeQuote(group || 'US', newest || null);
    return { text: d.badge, color: d.color, bg: d.bg, title: d.detail, state: d.state, asOf: newest || null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, data, error, Math.floor(Date.now() / 30000)]);
}
