/**
 * PortfolioContext.jsx — Portfolio state management with localStorage persistence
 *
 * Phase 4A: Frontend-first portfolio system.
 *
 * Schema (portfolioStateV1):
 *   { version: 1, migrated: boolean, portfolios: [...], positions: [...] }
 *
 * Each portfolio:   { id, name, subportfolios: [{ id, name }] }
 * Each position:    { id, symbol, portfolioId, subportfolioId, investedAmount,
 *                     quantity, entryPrice, currency, note, createdAt }
 *
 * Migration: Converts legacy senger_watchlist_v1 → portfolio positions on first load.
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const PortfolioContext = createContext(null);
const LS_KEY = 'senger_portfolio_v1';
const LEGACY_WL_KEY = 'senger_watchlist_v1';
const MAX_POSITIONS = 200;

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
      { id: mainId, name: 'Main', subportfolios: [{ id: coreId, name: 'Core' }] },
    ],
    positions: [],
  };
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

    console.log(`[Portfolio] Migrated ${newPositions.length} symbols from legacy watchlist`);
    return {
      ...state,
      migrated: true,
      positions: [...state.positions, ...newPositions],
    };
  } catch (err) {
    console.warn('[Portfolio] Migration failed — legacy watchlist preserved:', err);
    // Do NOT destroy legacy data; just mark as not-migrated so we can retry
    return state;
  }
}

// ── Load from localStorage ──
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1) {
        // Run migration if not yet done
        const migrated = migrateFromWatchlist(parsed);
        if (migrated !== parsed) persist(migrated);
        return migrated;
      }
    }
  } catch (err) {
    console.warn('[Portfolio] Failed to load state, resetting:', err);
  }
  // First time or corrupted — create fresh + migrate
  const fresh = defaultState();
  const migrated = migrateFromWatchlist(fresh);
  persist(migrated);
  return migrated;
}

function persist(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[Portfolio] Persist failed:', err);
  }
}

// ── Provider ──
export function PortfolioProvider({ children }) {
  const [state, setState] = useState(loadState);

  const update = useCallback((fn) => {
    setState(prev => {
      const next = fn(prev);
      persist(next);
      return next;
    });
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

  // ── Backward-compat with WatchlistContext consumers ──
  // These let existing code (search panels, right-click menus) still call addTicker/removeTicker
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
      persist(next);
      return next;
    });
  }, []);

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
    // Legacy watchlist compat
    watchlist,
    addTicker,
    removeTicker,
    isWatching,
    toggle,
    save: () => {},  // no-op, we auto-persist
  }), [state, watchlist, addPortfolio, renamePortfolio, addSubportfolio, renameSubportfolio,
       addPosition, updatePosition, removePosition, addTicker, removeTicker, isWatching, toggle]);

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
