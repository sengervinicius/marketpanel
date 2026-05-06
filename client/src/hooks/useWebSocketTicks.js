import { useState, useCallback, useRef, useMemo, useEffect } from 'react';

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
  // #288 / FIX-001 — readyState mirror. App.jsx pushes WebSocket
  // readyState into this state via setWsState; the effect below derives
  // feedStatus from it. Previously the footer FEED bar stayed on
  // "CONNECTING" forever because feedStatus only flipped to 'live' when
  // the server pushed `snapshot` / `tick` / `tick_batch` — and those
  // messages are sparse in normal operation. Treating WS readyState ===
  // OPEN as evidence of liveness produces a footer that truthfully
  // reflects the connection state without trampling explicit
  // backend-reported error/degraded levels.
  const [wsReadyState, setWsState] = useState(null);
  useEffect(() => {
    if (wsReadyState == null) return;
    setFeedStatus(prev => {
      let dirty = false;
      const next = { ...prev };
      ['stocks', 'forex', 'crypto'].forEach(cat => {
        const current = next[cat];
        const currentLevel = typeof current === 'string' ? current : current?.level || 'connecting';
        if (wsReadyState === 1 /* WebSocket.OPEN */) {
          if (currentLevel === 'connecting') {
            // determineFeedStatus downgrades stocks to 'closed' outside
            // US market hours; forex/crypto stay 'live'.
            const promoted = determineFeedStatus(cat, 'live');
            if (promoted !== currentLevel) { next[cat] = promoted; dirty = true; }
          }
        } else if (wsReadyState === 3 /* WebSocket.CLOSED */) {
          // Only revert auto-promoted statuses. Never override an
          // explicit backend-reported 'error' / 'degraded'.
          if (currentLevel === 'live' || currentLevel === 'closed') {
            next[cat] = 'connecting';
            dirty = true;
          }
        }
      });
      return dirty ? next : prev;
    });
  }, [wsReadyState]);

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
        const now = Date.now();
        Object.entries(snap[cat]).forEach(([sym, info]) => {
          const key = prefix && sym.startsWith(prefix) ? sym.slice(prefix.length) : sym;
          // #289 INCIDENT — stamp every overlay write with the wall-clock
          // time so the merge below can drop stale entries. Without this,
          // a Polygon WS disconnect leaves stale prices glued forever
          // (BTC stuck 2h behind reported by user).
          liveOverlayRef.current[key] = { ...info, symbol: key, _cat: cat, _overlayAt: now };
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
              // #289 INCIDENT — _overlayAt stamp; see snapshot handler comment.
              liveOverlayRef.current[sym] = { ...liveOverlayRef.current[sym], ...t.data, symbol: sym, _cat: t.category, _overlayAt: Date.now() };
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
              // #289 INCIDENT — stamp _overlayAt; see snapshot handler.
              liveOverlayRef.current[sym] = { ...liveOverlayRef.current[sym], ...t.data, symbol: sym, _cat: t.category, _overlayAt: Date.now() };
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

  // Merge REST snapshot with WS live overlay.
  //
  // #289 INCIDENT — stale-overlay protection. Before this change, an
  // overlay entry written when the WS was healthy would stay glued on
  // top of REST data forever — even if the Polygon feed for that
  // category dropped. User reported: "BTC prices are now stuck at
  // 9.15am, like 2 hours behind". With per-category staleness windows
  // we now drop overlay entries whose _overlayAt is older than the
  // window and let REST take over. The windows are deliberately tight
  // for ticks-heavy feeds (crypto / forex run 24x7 and should refresh
  // every few seconds; stocks idle longer between trades).
  const OVERLAY_STALE_MS = {
    crypto: 60 * 1000,    // 1 min — crypto trades 24/7, anything older is suspect
    forex:  60 * 1000,    // 1 min — same
    stocks: 5 * 60 * 1000, // 5 min — stocks have natural gaps between trades
  };
  const mergedData = useMemo(() => {
    if (!restData) return restData;
    const overlay = liveOverlayRef.current;
    if (Object.keys(overlay).length === 0) return restData;
    const merged = { ...restData };
    const now = Date.now();
    ['stocks', 'forex', 'crypto'].forEach(cat => {
      if (!restData[cat]) return;
      const window = OVERLAY_STALE_MS[cat] || 60 * 1000;
      const updates = {};
      Object.entries(overlay).forEach(([sym, info]) => {
        if (info._cat !== cat || !restData[cat][sym]) return;
        // #289 — drop stale entries so REST data takes precedence.
        // Entries without _overlayAt are pre-#289 writes; treat as fresh
        // for one render then they'll get re-stamped on next tick.
        if (info._overlayAt && (now - info._overlayAt > window)) return;
        updates[sym] = { ...restData[cat][sym], ...info };
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
    // #288 / FIX-001 — caller pushes WS readyState here on every change.
    setWsState,
  };
}
