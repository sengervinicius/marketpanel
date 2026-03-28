/**
 * WatchlistContext.jsx
 * Manages a user-defined watchlist stored in localStorage.
 * Panels and right-click menus can read/write the watchlist without prop drilling.
 */

import { createContext, useContext, useState, useCallback } from 'react';

const WatchlistContext = createContext(null);
const LS_KEY = 'senger_watchlist_v1';

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function WatchlistProvider({ children }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);

  const save = useCallback((next) => {
    setWatchlist(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }, []);

  const addTicker = useCallback((symbol) => {
    setWatchlist(prev => {
      if (prev.includes(symbol)) return prev;
      if (prev.length >= 50) return prev;
      const next = [...prev, symbol.toUpperCase()];
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
