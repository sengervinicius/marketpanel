import { useState, useCallback, useRef, useMemo } from 'react';

/**
 * Utility: Check if US markets (NYSE/NASDAQ) are currently open.
 * NYSE hours: 9:30 AM - 4:00 PM ET, Monday-Friday
 */
function isMarketOpen() {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay(); // 0=Sun, 6=Sat
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Mon-Fri (1-5), 9:30 AM - 4:00 PM ET
  const isWeekday = day >= 1 && day <= 5;
  const isMarketHours = timeInMinutes >= 570 && timeInMinutes < 960; // 9:30=570, 16:00=960

  return isWeekday && isMarketHours;
}

/**
 * Determine the status level for a feed based on current time and data recency.
 * - If market closed: 'closed'
 * - If non-US feed (forex/crypto): 'delayed' for real-time feeds
 * - Otherwise: current status level
 */
function determineFeedStatus(feed, currentLevel) {
  // If current level is explicitly set by backend, respect it (unless overridden by market state)
  // For stocks, check market hours
  if (feed === 'stocks') {
    if (!isMarketOpen()) {
      return 'closed';
    }
  }
  // Forex and crypto are 24/5 or 24/7, but may have 15min delays outside US hours
  if ((feed === 'forex' || feed === 'crypto') && currentLevel === 'live') {
    // Could add 15-min delay detection here if needed
  }
  return currentLevel;
}

/**
 * useWebSocketTicks — manages live WebSocket overlay + tick buffering.
 *
 * Extracted from App.jsx. Handles:
 * - Feed status tracking (stocks, forex, crypto connection state)
 * - Snapshot ingestion (full market state on WS connect)
 * - Tick buffering with 250ms throttle
 * - Merging live overlay onto REST data
 * - Auto-transition to 'live' when data is received
 */
export function useWebSocketTicks(restData) {
  const [feedStatus, setFeedStatus] = useState({ stocks: 'connecting', forex: 'connecting', crypto: 'connecting' });
  const liveOverlayRef = useRef({});
  const tickBufferRef = useRef([]);
  const throttleTimerRef = useRef(null);
  const [liveTick, setLiveTick] = useState(0);
  const [batchTicks, setBatchTicks] = useState([]);

  // Track which feeds have received data to auto-mark as 'live'
  const feedDataReceivedRef = useRef({ stocks: false, forex: false, crypto: false });

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'status') {
      setFeedStatus(prev => {
        const newLevel = msg.level;
        const finalLevel = determineFeedStatus(msg.feed, newLevel);
        return { ...prev, [msg.feed]: finalLevel };
      });
      return;
    }
    if (msg.type === 'feedHealth' && Array.isArray(msg.feeds)) {
      setFeedStatus(prev => {
        const next = { ...prev };
        for (const f of msg.feeds) {
          if (!f.feed) continue;
          const newLevel = f.level || 'connecting';
          const finalLevel = determineFeedStatus(f.feed, newLevel);
          next[f.feed] = {
            level: finalLevel,
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
      // Mark feeds as live when we receive snapshot data
      ['stocks', 'forex', 'crypto'].forEach(cat => {
        if (!snap?.[cat]) return;
        feedDataReceivedRef.current[cat] = true;
        // Strip C: (forex) and X: (crypto) prefixes from keys so they match
        // the REST batch data keys (which are already stripped by normalizePolygon)
        const prefix = cat === 'forex' ? 'C:' : cat === 'crypto' ? 'X:' : '';
        Object.entries(snap[cat]).forEach(([sym, info]) => {
          const key = prefix && sym.startsWith(prefix) ? sym.slice(prefix.length) : sym;
          liveOverlayRef.current[key] = { ...info, symbol: key, _cat: cat };
        });
      });
      // Auto-transition feeds to 'live' if they've received data and aren't explicitly error/degraded
      setFeedStatus(prev => {
        const next = { ...prev };
        ['stocks', 'forex', 'crypto'].forEach(cat => {
          if (!feedDataReceivedRef.current[cat]) return;
          const current = next[cat];
          const currentLevel = typeof current === 'string' ? current : current?.level || 'connecting';
          // Only auto-upgrade 'connecting' to 'live'; don't override explicit error/degraded from backend
          if (currentLevel === 'connecting') {
            next[cat] = determineFeedStatus(cat, 'live');
          }
        });
        return next;
      });
      setLiveTick(n => n + 1);
      return;
    }
    // Handle batched ticks (new format: single message with array of ticks)
    if (msg.type === 'tick_batch' && Array.isArray(msg.ticks)) {
      msg.ticks.forEach(t => {
        if (t.category) feedDataReceivedRef.current[t.category] = true;
        tickBufferRef.current.push({ type: 'tick', ...t });
      });
      // Fall through to the throttle flush logic below
      if (!throttleTimerRef.current) {
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          const ticks = tickBufferRef.current.splice(0);
          if (ticks.length === 0) return;
          const normalizedTicks = [];
          ticks.forEach(t => {
            if (t.symbol && t.data) {
              let sym = t.symbol;
              if (t.category === 'forex' && sym.startsWith('C:')) sym = sym.slice(2);
              if (t.category === 'crypto' && sym.startsWith('X:')) sym = sym.slice(2);
              liveOverlayRef.current[sym] = { ...liveOverlayRef.current[sym], ...t.data, symbol: sym, _cat: t.category };
              normalizedTicks.push({ category: t.category, symbol: sym, data: t.data });
            }
          });
          setFeedStatus(prev => {
            const next = { ...prev };
            ['stocks', 'forex', 'crypto'].forEach(cat => {
              if (!feedDataReceivedRef.current[cat]) return;
              const current = next[cat];
              const currentLevel = typeof current === 'string' ? current : current?.level || 'connecting';
              if (currentLevel === 'connecting') {
                next[cat] = determineFeedStatus(cat, 'live');
              }
            });
            return next;
          });
          setLiveTick(n => n + 1);
          if (normalizedTicks.length > 0) setBatchTicks(normalizedTicks);
        }, 250);
      }
      return;
    }
    if (msg.type === 'tick' || msg.type === 'quote') {
      // Mark feed as live when we receive tick/quote data (legacy per-tick format)
      if (msg.category) {
        feedDataReceivedRef.current[msg.category] = true;
      }
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
          // Auto-mark feeds as live if they've received data
          setFeedStatus(prev => {
            const next = { ...prev };
            ['stocks', 'forex', 'crypto'].forEach(cat => {
              if (!feedDataReceivedRef.current[cat]) return;
              const current = next[cat];
              const currentLevel = typeof current === 'string' ? current : current?.level || 'connecting';
              if (currentLevel === 'connecting') {
                next[cat] = determineFeedStatus(cat, 'live');
              }
            });
            return next;
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
