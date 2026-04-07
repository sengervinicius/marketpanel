/**
 * WatchlistContext.jsx
 * Manages a user-defined watchlist stored in localStorage.
 * Panels and right-click menus can read/write the watchlist without prop drilling.
 */

import { createContext, useContext, useState, useCallback } from 'react';

const WatchlistContext = createContext(null);
const LS_KEY = 'senger_watchlist_v1';
// Maximum watchlist size and duplicate protection (case-insensitive)
const MAX_WATCHLIST_SIZE = 50;

const SEED_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'GLD', 'BTCUSD', 'EWZ'];

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : SEED_WATCHLIST;
  } catch {
    return SEED_WATCHLIST;
  }
}

export function WatchlistProvider({ children }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);

  const save = useCallback((next) => {
    // Validate: must be an array and capped at MAX_WATCHLIST_SIZE
    if (!Array.isArray(next)) return;
    const validated = next.slice(0, MAX_WATCHLIST_SIZE);
    setWatchlist(validated);
    localStorage.setItem(LS_KEY, JSON.stringify(validated));
  }, []);

  const addTicker = useCallback((symbol) => {
    setWatchlist(prev => {
      const upper = symbol.toUpperCase();
      // Duplicate protection: case-insensitive check
      if (prev.some(s => s.toUpperCase() === upper)) return prev;
      // Enforce max size
      if (prev.length >= MAX_WATCHLIST_SIZE) return prev;
      const next = [...prev, upper];
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeTicker = useCallback((symbol) => {
    setWatchlist(prev => {
      const next = prev.filter(s => s !== symbol);
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isWatching = useCallback((symbol) => watchlist.includes(symbol?.toUpperCase()), [watchlist]);

  const toggle = useCallback((symbol) => {
    isWatching(symbol) ? removeTicker(symbol) : addTicker(symbol);
  }, [isWatching, addTicker, removeTicker]);

  return (
    <WatchlistContext.Provider value={{ watchlist, addTicker, removeTicker, isWatching, toggle, save }}>
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error('useWatchlist must be used inside WatchlistProvider');
  return ctx;
}
