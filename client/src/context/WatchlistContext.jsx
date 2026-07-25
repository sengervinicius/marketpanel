/**
 * WatchlistContext.jsx
 * Manages a user-defined watchlist with dual persistence:
 * - localStorage for instant load (offline-first)
 * - Server /api/settings for cross-session / cross-device sync
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch, beaconSettings } from '../utils/api';
import { swallow } from '../utils/swallow';

const WatchlistContext = createContext(null);
const LS_KEY = 'particle_watchlist_v1';
const MAX_WATCHLIST_SIZE = 50;
const SYNC_DEBOUNCE_MS = 1500;

// Migrate legacy key
try { const v = localStorage.getItem('senger_watchlist_v1'); if (v !== null) { localStorage.setItem('particle_watchlist_v1', v); localStorage.removeItem('senger_watchlist_v1'); } } catch (e) { swallow(e, 'context.watchlist.ls_migrate'); }

const SEED_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'GLD', 'BTCUSD', 'EWZ'];

function loadWatchlistRaw() {
  // Returns the user's explicitly-stored list, or null if nothing is stored.
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0 ? arr : null;
  } catch {
    return null;
  }
}
function loadWatchlist() {
  return loadWatchlistRaw() || SEED_WATCHLIST;
}

export function WatchlistProvider({ children }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const syncTimer = useRef(null);
  const pendingRef = useRef(null);
  const hasFetchedServer = useRef(false);
  // True only if the user had an explicitly-saved local list (not the seed).
  const hadStoredLocal = useRef(loadWatchlistRaw() !== null);

  // ── Persist to localStorage immediately ──────────────────────────────
  const persistLocal = useCallback((next) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch (e) { swallow(e, 'context.watchlist.ls_set'); }
  }, []);

  // ── Debounced persist to server ──────────────────────────────────────
  const persistServer = useCallback((next) => {
    pendingRef.current = next;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      pendingRef.current = null;
      try {
        await apiFetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify({ watchlist: next }),
        });
      } catch (err) {
        // Silent fail — localStorage is the primary store
        console.warn('[Watchlist] Server sync failed:', err.message);
      }
    }, SYNC_DEBOUNCE_MS);
  }, []);

  // Flush the last watchlist edit if the page is hidden/closed before the 1.5s
  // debounce fires, so the server (cross-device) copy isn't left stale.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && pendingRef.current) {
        if (syncTimer.current) clearTimeout(syncTimer.current);
        beaconSettings({ watchlist: pendingRef.current });
        pendingRef.current = null;
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  // ── On mount: fetch server watchlist and merge with local ────────────
  useEffect(() => {
    if (hasFetchedServer.current) return;
    hasFetchedServer.current = true;

    (async () => {
      try {
        const res = await apiFetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        const serverList = data?.settings?.watchlist;
        if (!Array.isArray(serverList) || serverList.length === 0) {
          // Server has no watchlist — push local to server
          persistServer(loadWatchlist());
          return;
        }

        // Server is the source of truth. Only merge in local symbols the user
        // genuinely added on THIS device (hadStoredLocal). If the local list is
        // just the seed default (fresh device / new install), take the server
        // list verbatim — otherwise the seed (GLD, SPY, ...) leaks into and
        // pollutes the user's real cross-device watchlist.
        let final;
        if (hadStoredLocal.current) {
          const localList = loadWatchlist();
          const merged = [...serverList];
          for (const sym of localList) {
            if (!merged.some(s => s.toUpperCase() === sym.toUpperCase())) merged.push(sym);
          }
          final = merged.slice(0, MAX_WATCHLIST_SIZE);
        } else {
          final = serverList.slice(0, MAX_WATCHLIST_SIZE);
        }

        setWatchlist(final);
        persistLocal(final);
        // If merged differs from server, push back
        if (final.length !== serverList.length || final.some((s, i) => s !== serverList[i])) {
          persistServer(final);
        }
      } catch {
        // Offline or not logged in — use localStorage only
      }
    })();
  }, [persistLocal, persistServer]);

  const addTicker = useCallback((symbol) => {
    setWatchlist(prev => {
      const upper = symbol.toUpperCase();
      if (prev.some(s => s.toUpperCase() === upper)) return prev;
      if (prev.length >= MAX_WATCHLIST_SIZE) return prev;
      const next = [...prev, upper];
      persistLocal(next);
      persistServer(next);
      return next;
    });
  }, [persistLocal, persistServer]);

  const removeTicker = useCallback((symbol) => {
    setWatchlist(prev => {
      const next = prev.filter(s => s !== symbol);
      persistLocal(next);
      persistServer(next);
      return next;
    });
  }, [persistLocal, persistServer]);

  const save = useCallback((next) => {
    if (!Array.isArray(next)) return;
    const validated = next.slice(0, MAX_WATCHLIST_SIZE);
    setWatchlist(validated);
    persistLocal(validated);
    persistServer(validated);
  }, [persistLocal, persistServer]);

  // Listen for external watchlist changes (e.g. from particle:action button in AI chat)
  useEffect(() => {
    const handler = (e) => {
      const { watchlist: newList } = e.detail || {};
      if (Array.isArray(newList)) {
        setWatchlist(newList.slice(0, MAX_WATCHLIST_SIZE));
      }
    };
    window.addEventListener('particle:watchlist-changed', handler);
    return () => window.removeEventListener('particle:watchlist-changed', handler);
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
