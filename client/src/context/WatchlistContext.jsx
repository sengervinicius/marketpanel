/**
 * WatchlistContext.jsx
 *
 * SINGLE SOURCE OF TRUTH ADAPTER.
 *
 * Historically there were TWO independent asset lists:
 *   1. settings.watchlist  — a flat array of symbols (localStorage particle_watchlist_v1)
 *   2. portfolio positions — /api/portfolio, which is what the desktop "Watchlist"
 *      panel actually renders (usePortfolio -> positions)
 *
 * Nothing on desktop wrote (1) any more, so the two drifted badly: the mobile app
 * showed 11 legacy symbols while the desktop showed 24 real ones, with only 5 in
 * common. Desktop's News / Calendar / ETF panels also read (1), so they were being
 * scoped to the wrong list too.
 *
 * This provider is now a thin adapter over the portfolio store, so there is exactly
 * ONE list. Every existing consumer of useWatchlist() keeps the same API and
 * automatically sees the canonical list; every write goes to /api/portfolio and
 * therefore syncs across desktop and mobile in both directions.
 *
 * Positions carry no quantities in practice — they are just the user's asset list.
 */

import { createContext, useContext, useCallback, useMemo, useEffect } from 'react';
import { usePortfolio } from './PortfolioContext';
import { canonicalKey } from '../utils/tickerNormalize';
import { swallow } from '../utils/swallow';

const WatchlistContext = createContext(null);
const MAX_WATCHLIST_SIZE = 50;

export function WatchlistProvider({ children }) {
  // The canonical store. PortfolioProvider must be an ancestor.
  const portfolio = usePortfolio?.() || null;
  const positions = portfolio?.positions || [];

  // Raw symbols exactly as stored (C:USDBRL, X:BTCUSD, ^N225, GC=F, PETR4.SA…).
  // Consumers get the stored form so that quote/chart lookups keep working; use
  // toDisplay() at render time for a human label.
  const watchlist = useMemo(
    () => positions.map(p => p?.symbol).filter(Boolean).slice(0, MAX_WATCHLIST_SIZE),
    [positions]
  );

  // Identity is compared on the canonical key so "BTCUSD" matches "X:BTCUSD"
  // and "PETR4" matches "PETR4.SA" — this is what previously let the same asset
  // exist twice under two spellings.
  const findPosition = useCallback((symbol) => {
    const key = canonicalKey(symbol);
    if (!key) return null;
    return positions.find(p => canonicalKey(p?.symbol) === key) || null;
  }, [positions]);

  const isWatching = useCallback((symbol) => !!findPosition(symbol), [findPosition]);

  const addTicker = useCallback((symbol) => {
    if (!symbol) return;
    if (findPosition(symbol)) return;              // already present under any spelling
    if (watchlist.length >= MAX_WATCHLIST_SIZE) return;
    portfolio?.addTicker?.(symbol);                 // persists + syncs to server
  }, [findPosition, watchlist.length, portfolio]);

  const removeTicker = useCallback((symbol) => {
    const pos = findPosition(symbol);
    if (pos?.id != null) portfolio?.removePosition?.(pos.id);
  }, [findPosition, portfolio]);

  const toggle = useCallback((symbol) => {
    isWatching(symbol) ? removeTicker(symbol) : addTicker(symbol);
  }, [isWatching, addTicker, removeTicker]);

  // Portfolio persists itself (debounced local + server sync), so save() is a no-op
  // kept for API compatibility with the previous provider.
  const save = useCallback(() => {}, []);

  // The AI chat's [action:watchlist_add:XXX] button dispatches this event.
  useEffect(() => {
    const handler = (e) => {
      const list = e?.detail?.watchlist;
      if (Array.isArray(list)) {
        list.forEach(sym => { try { addTicker(sym); } catch (err) { swallow(err, 'watchlist.event_add'); } });
      }
      const one = e?.detail?.symbol;
      if (typeof one === 'string') {
        try { addTicker(one); } catch (err) { swallow(err, 'watchlist.event_add_one'); }
      }
    };
    window.addEventListener('particle:watchlist-changed', handler);
    return () => window.removeEventListener('particle:watchlist-changed', handler);
  }, [addTicker]);

  const value = useMemo(
    () => ({ watchlist, addTicker, removeTicker, isWatching, toggle, save }),
    [watchlist, addTicker, removeTicker, isWatching, toggle, save]
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export const useWatchlist = () => {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used inside WatchlistProvider');
  return ctx;
};
