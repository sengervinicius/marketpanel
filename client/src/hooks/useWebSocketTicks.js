import { useState, useCallback, useRef, useMemo } from 'react';

/**
 * useWebSocketTicks — manages live WebSocket overlay + tick buffering.
 *
 * Extracted from App.jsx. Handles:
 * - Feed status tracking (stocks, forex, crypto connection state)
 * - Snapshot ingestion (full market state on WS connect)
 * - Tick buffering with 250ms throttle
 * - Merging live overlay onto REST data
 */
export function useWebSocketTicks(restData) {
  const [feedStatus, setFeedStatus] = useState({ stocks: 'connecting', forex: 'connecting', crypto: 'connecting' });
  const liveOverlayRef = useRef({});
  const tickBufferRef = useRef([]);
  const throttleTimerRef = useRef(null);
  const [liveTick, setLiveTick] = useState(0);
  const [batchTicks, setBatchTicks] = useState([]);

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'status') {
      setFeedStatus(prev => ({ ...prev, [msg.feed]: msg.level }));
      return;
    }
    if (msg.type === 'feedHealth' && Array.isArray(msg.feeds)) {
      setFeedStatus(prev => {
        const next = { ...prev };
        for (const f of msg.feeds) {
          if (!f.feed) continue;
          next[f.feed] = {
            level: f.level || 'connecting',
            latencyMs: f.latencyMs ?? null,
            lastTickAt: f.lastTickAt ?? null,
            reconnects: f.reconnects ?? 0,
            lastError: f.lastError ?? null,
          };
        }
        return next;
      });
      return;
    }
    if (msg.type === 'snapshot') {
      const snap = msg.data;
      ['stocks', 'forex', 'crypto'].forEach(cat => {
        if (!snap?.[cat]) return;
        // Strip C: (forex) and X: (crypto) prefixes from keys so they match
        // the REST batch data keys (which are already stripped by normalizePolygon)
        const prefix = cat === 'forex' ? 'C:' : cat === 'crypto' ? 'X:' : '';
        Object.entries(snap[cat]).forEach(([sym, info]) => {
          const key = prefix && sym.startsWith(prefix) ? sym.slice(prefix.length) : sym;
          liveOverlayRef.current[key] = { ...info, symbol: key, _cat: cat };
        });
      });
      setLiveTick(n => n + 1);
      return;
    }
    if (msg.type === 'tick' || msg.type === 'quote') {
      tickBufferRef.current.push(msg);
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          const ticks = tickBufferRef.current.splice(0);
          if (ticks.length === 0) return;
          const normalizedTicks = [];
          ticks.forEach(t => {
            if (t.symbol && t.data) {
              // Strip C: / X: prefixes for consistent keying with REST data
              let sym = t.symbol;
              if (t.category === 'forex' && sym.startsWith('C:')) sym = sym.slice(2);
              if (t.category === 'crypto' && sym.startsWith('X:')) sym = sym.slice(2);
              liveOverlayRef.current[sym] = { ...liveOverlayRef.current[sym], ...t.data, symbol: sym, _cat: t.category };
              normalizedTicks.push({ category: t.category, symbol: sym, data: t.data });
            }
          });
          setLiveTick(n => n + 1);
          if (normalizedTicks.length > 0) setBatchTicks(normalizedTicks);
        }, 250);
      }
    }
  }, []);

  // Merge REST snapshot with WS live overlay
  const mergedData = useMemo(() => {
    if (!restData) return restData;
    const overlay = liveOverlayRef.current;
    if (Object.keys(overlay).length === 0) return restData;
    const merged = { ...restData };
    ['stocks', 'forex', 'crypto'].forEach(cat => {
      if (!restData[cat]) return;
      const updates = {};
      Object.entries(overlay).forEach(([sym, info]) => {
        if (info._cat === cat && restData[cat][sym]) {
          updates[sym] = { ...restData[cat][sym], ...info };
        }
      });
      if (Object.keys(updates).length > 0) {
        merged[cat] = { ...restData[cat], ...updates };
      }
    });
    merged.indices = merged.stocks || {};
    return merged;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restData, liveTick]);

  return {
    feedStatus,
    batchTicks,
    mergedData,
    handleWsMessage,
  };
}
