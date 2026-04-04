/**
 * PortfolioContext.jsx — Portfolio state with server persistence + localStorage fallback
 *
 * Phase 4A: Frontend-first portfolio system (localStorage).
 * Phase 4B: Server-backed persistence with sync.
 * Phase 4C: Benchmark support, sync status UX (synced/syncing/failed).
 *
 * Initialization precedence:
 *   1. If server has data → use it as source of truth.
 *   2. Else if local portfolioStateV1 exists → use it, sync once to server.
 *   3. Else if legacy watchlist exists → migrate → sync to server.
 *   4. Else → create empty default tree (Main/Core).
 *
 * Ongoing updates:
 *   - Every mutation updates React state immediately (optimistic).
 *   - A debounced sync (1000ms) writes the full state to POST /api/portfolio/sync.
 *   - On failure: local state is kept, warning logged, syncStatus set to 'error'.
 *
 * Conflict model: last-write-wins per user.
 */

import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { apiFetch } from '../utils/api';

const PortfolioContext = createContext(null);
const LS_KEY = 'senger_portfolio_v1';
const LEGACY_WL_KEY = 'senger_watchlist_v1';
const MAX_POSITIONS = 200;
const SYNC_DEBOUNCE_MS = 1000;

// ── ID generation ──
let _idCounter = Date.now();
function uid() { return 'p' + (++_idCounter).toString(36); }

// ── Default schema ──
function defaultState() {
  const mainId = uid();
  const coreId = uid();
  return {
    version: 1,
    migrated: false,
    portfolios: [
      { id: mainId, name: 'Main', benchmark: null, subportfolios: [{ id: coreId, name: 'Core', benchmark: null }] },
    ],
    positions: [],
  };
}

// ── Schema migration: add benchmark fields if missing ──
function ensureBenchmarkFields(state) {
  let changed = false;
  const portfolios = state.portfolios.map(p => {
    let pChanged = false;
    if (p.benchmark === undefined) { pChanged = true; }
    const subs = p.subportfolios.map(sp => {
      if (sp.benchmark === undefined) { pChanged = true; return { ...sp, benchmark: null }; }
      return sp;
    });
    if (pChanged) { changed = true; return { ...p, benchmark: p.benchmark ?? null, subportfolios: subs }; }
    return p;
  });
  return changed ? { ...state, portfolios } : state;
}

// ── Migration from legacy watchlist ──
function migrateFromWatchlist(state) {
  if (state.migrated) return state;

  try {
    const raw = localStorage.getItem(LEGACY_WL_KEY);
    if (!raw) return { ...state, migrated: true };

    const symbols = JSON.parse(raw);
    if (!Array.isArray(symbols) || symbols.length === 0) return { ...state, migrated: true };

    const portfolio = state.portfolios[0];
    if (!portfolio) return { ...state, migrated: true };
    const subportfolio = portfolio.subportfolios[0];
    if (!subportfolio) return { ...state, migrated: true };

    // Avoid duplicating already-existing symbols
    const existingSymbols = new Set(state.positions.map(p => p.symbol.toUpperCase()));

    const newPositions = symbols
      .filter(s => typeof s === 'string' && s.trim())
      .map(s => s.toUpperCase())
      .filter(s => !existingSymbols.has(s))
      .map(symbol => ({
        id: uid(),
        symbol,
        portfolioId: portfolio.id,
        subportfolioId: subportfolio.id,
        investedAmount: null,
        quantity: null,
        entryPrice: null,
        currency: 'USD',
        note: '',
        createdAt: new Date().toISOString(),
      }));

    return {
      ...state,
      migrated: true,
      positions: [...state.positions, ...newPositions],
    };
  } catch (err) {
    console.warn('[Portfolio] Migration failed — legacy watchlist preserved:', err);
    return state;
  }
}

// ── localStorage helpers ──
function loadLocalState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        let state = migrateFromWatchlist(parsed);
        state = ensureBenchmarkFields(state);
        if (state !== parsed) persistLocal(state);
        return state;
      }
    }
  } catch (err) {
    console.warn('[Portfolio] Failed to load local state:', err);
  }
  // First time or corrupted — create fresh + migrate
  const fresh = defaultState();
  const migrated = migrateFromWatchlist(fresh);
  persistLocal(migrated);
  return migrated;
}

function persistLocal(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[Portfolio] Local persist failed:', err);
  }
}

// ── Server API helpers ──
async function fetchServerPortfolio() {
  try {
    const res = await apiFetch('/api/portfolio');
    if (!res.ok) {
      console.warn('[Portfolio] Server fetch failed:', res.status);
      return null;
    }
    const json = await res.json();
    return json.data || null;
  } catch (err) {
    console.warn('[Portfolio] Server fetch error:', err.message);
    return null;
  }
}

async function syncToServer(state) {
  try {
    const res = await apiFetch('/api/portfolio/sync', {
      method: 'POST',
      body: JSON.stringify({
        version: state.version || 1,
        portfolios: state.portfolios,
        positions: state.positions,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('[Portfolio] Server sync failed:', res.status, err.error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Portfolio] Server sync error:', err.message);
    return false;
  }
}

// ── Provider ──
// syncStatus: 'idle' | 'syncing' | 'synced' | 'error'
export function PortfolioProvider({ children }) {
  const { user, authReady } = useAuth();
  const [state, setState] = useState(loadLocalState); // Start with local immediately
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced | error
  const [serverLoaded, setServerLoaded] = useState(false);
  const syncTimerRef = useRef(null);
  const initialSyncDoneRef = useRef(false);
  const lastUserIdRef = useRef(null);

  // ── Debounced server sync ──
  const scheduleSyncToServer = useCallback((newState) => {
    if (!user) return; // Not logged in, skip server sync
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    setSyncStatus('syncing');
    syncTimerRef.current = setTimeout(async () => {
      const ok = await syncToServer(newState);
      setSyncStatus(ok ? 'synced' : 'error');
    }, SYNC_DEBOUNCE_MS);
  }, [user]);

  // ── Update helper: updates state, persists to localStorage, schedules server sync ──
  const update = useCallback((fn) => {
    setState(prev => {
      const next = fn(prev);
      persistLocal(next);
      scheduleSyncToServer(next);
      return next;
    });
  }, [scheduleSyncToServer]);

  // ── Server initialization: load from server when auth is ready ──
  useEffect(() => {
    if (!authReady) return;

    // User logged out — reset to local state
    if (!user) {
      initialSyncDoneRef.current = false;
      lastUserIdRef.current = null;
      setServerLoaded(false);
      setSyncStatus('idle');
      setState(loadLocalState());
      return;
    }

    // Same user already synced — skip
    if (lastUserIdRef.current === user.id && initialSyncDoneRef.current) return;

    // New user or first load — fetch from server
    lastUserIdRef.current = user.id;
    let cancelled = false;

    (async () => {
      const serverData = await fetchServerPortfolio();

      if (cancelled) return;

      if (serverData && Array.isArray(serverData.portfolios) && serverData.portfolios.length > 0) {
        // Case 1: Server has data → use it
        let normalized = {
          version: serverData.version || 1,
          migrated: true,
          portfolios: serverData.portfolios,
          positions: serverData.positions || [],
        };
        normalized = ensureBenchmarkFields(normalized);
        setState(normalized);
        persistLocal(normalized); // Mirror to local as fallback cache
        if (!cancelled) setSyncStatus('synced');
      } else {
        // Case 2 & 3: Server is empty → use local state (which may include migration result)
        const localState = loadLocalState();
        setState(localState);
        // Seed server with the local state
        setSyncStatus('syncing');
        const ok = await syncToServer(localState);
        if (!cancelled) setSyncStatus(ok ? 'synced' : 'error');
        // sync complete
      }

      if (!cancelled) {
        initialSyncDoneRef.current = true;
        setServerLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [authReady, user]);

  // ── Cleanup sync timer on unmount ──
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []);

  // ── Portfolio CRUD ──
  const addPortfolio = useCallback((name) => {
    const id = uid();
    const subId = uid();
    update(s => ({
      ...s,
      portfolios: [...s.portfolios, {
        id, name: name || 'Portfolio',
        subportfolios: [{ id: subId, name: 'Core' }],
      }],
    }));
    return id;
  }, [update]);

  const renamePortfolio = useCallback((id, name) => {
    update(s => ({
      ...s,
      portfolios: s.portfolios.map(p => p.id === id ? { ...p, name } : p),
    }));
  }, [update]);

  // ── Subportfolio CRUD ──
  const addSubportfolio = useCallback((portfolioId, name) => {
    const id = uid();
    update(s => ({
      ...s,
      portfolios: s.portfolios.map(p =>
        p.id === portfolioId
          ? { ...p, subportfolios: [...p.subportfolios, { id, name: name || 'Subportfolio' }] }
          : p
      ),
    }));
    return id;
  }, [update]);

  const renameSubportfolio = useCallback((portfolioId, subId, name) => {
    update(s => ({
      ...s,
      portfolios: s.portfolios.map(p =>
        p.id === portfolioId
          ? { ...p, subportfolios: p.subportfolios.map(sp => sp.id === subId ? { ...sp, name } : sp) }
          : p
      ),
    }));
  }, [update]);

  // ── Position CRUD ──
  const addPosition = useCallback((pos) => {
    update(s => {
      if (s.positions.length >= MAX_POSITIONS) return s;
      return {
        ...s,
        positions: [...s.positions, {
          id: uid(),
          symbol: (pos.symbol || '').toUpperCase(),
          portfolioId: pos.portfolioId,
          subportfolioId: pos.subportfolioId,
          investedAmount: pos.investedAmount ?? null,
          quantity: pos.quantity ?? null,
          entryPrice: pos.entryPrice ?? null,
          currency: pos.currency || 'USD',
          note: pos.note || '',
          createdAt: new Date().toISOString(),
        }],
      };
    });
  }, [update]);

  const updatePosition = useCallback((id, changes) => {
    update(s => ({
      ...s,
      positions: s.positions.map(p =>
        p.id === id ? { ...p, ...changes, symbol: changes.symbol ? changes.symbol.toUpperCase() : p.symbol } : p
      ),
    }));
  }, [update]);

  const removePosition = useCallback((id) => {
    update(s => ({
      ...s,
      positions: s.positions.filter(p => p.id !== id),
    }));
  }, [update]);

  // ── Benchmark ──
  const setBenchmark = useCallback((portfolioId, subportfolioId, benchmarkSymbol) => {
    update(s => ({
      ...s,
      portfolios: s.portfolios.map(p => {
        if (p.id !== portfolioId) return p;
        if (subportfolioId) {
          return {
            ...p,
            subportfolios: p.subportfolios.map(sp =>
              sp.id === subportfolioId ? { ...sp, benchmark: benchmarkSymbol || null } : sp
            ),
          };
        }
        return { ...p, benchmark: benchmarkSymbol || null };
      }),
    }));
  }, [update]);

  // ── Manual sync retry ──
  const retrySync = useCallback(() => {
    if (!user) return;
    setSyncStatus('syncing');
    syncToServer(state).then(ok => setSyncStatus(ok ? 'synced' : 'error'));
  }, [user, state]);

  // ── Backward-compat with WatchlistContext consumers ──
  const watchlist = useMemo(() => state.positions.map(p => p.symbol), [state.positions]);

  const addTicker = useCallback((symbol) => {
    const upper = (symbol || '').toUpperCase();
    if (!upper) return;
    setState(prev => {
      if (prev.positions.some(p => p.symbol === upper)) return prev;
      const portfolio = prev.portfolios[0];
      const sub = portfolio?.subportfolios[0];
      if (!portfolio || !sub) return prev;
      const next = {
        ...prev,
        positions: [...prev.positions, {
          id: uid(),
          symbol: upper,
          portfolioId: portfolio.id,
          subportfolioId: sub.id,
          investedAmount: null,
          quantity: null,
          entryPrice: null,
          currency: 'USD',
          note: '',
          createdAt: new Date().toISOString(),
        }],
      };
      persistLocal(next);
      scheduleSyncToServer(next);
      return next;
    });
  }, [scheduleSyncToServer]);

  const removeTicker = useCallback((symbol) => {
    update(s => ({
      ...s,
      positions: s.positions.filter(p => p.symbol !== symbol),
    }));
  }, [update]);

  const isWatching = useCallback((symbol) => {
    const upper = symbol?.toUpperCase();
    return state.positions.some(p => p.symbol === upper);
  }, [state.positions]);

  const toggle = useCallback((symbol) => {
    isWatching(symbol) ? removeTicker(symbol) : addTicker(symbol);
  }, [isWatching, addTicker, removeTicker]);

  const value = useMemo(() => ({
    // New portfolio API
    state,
    portfolios: state.portfolios,
    positions: state.positions,
    addPortfolio,
    renamePortfolio,
    addSubportfolio,
    renameSubportfolio,
    addPosition,
    updatePosition,
    removePosition,
    // Benchmark
    setBenchmark,
    // Sync status
    syncStatus,  // 'idle' | 'syncing' | 'synced' | 'error'
    syncError: syncStatus === 'error', // backward compat
    serverLoaded,
    retrySync,
    // Legacy watchlist compat
    watchlist,
    addTicker,
    removeTicker,
    isWatching,
    toggle,
    save: () => {},  // no-op, we auto-persist
  }), [state, watchlist, syncStatus, serverLoaded,
       addPortfolio, renamePortfolio, addSubportfolio, renameSubportfolio,
       addPosition, updatePosition, removePosition, setBenchmark, retrySync,
       addTicker, removeTicker, isWatching, toggle]);

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used inside PortfolioProvider');
  return ctx;
}

// Alias so existing code using useWatchlist() still works after provider swap
export const useWatchlist = usePortfolio;
