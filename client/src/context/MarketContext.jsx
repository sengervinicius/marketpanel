/**
 * MarketContext.jsx
 * Formal client state model mirroring marketState.
 * Provides a reducer for snapshot/tick actions plus memoised per-panel selectors.
 *
 * Architecture:
 *   - MarketProvider wraps the app; it accepts `restData` (from useMarketData REST poll)
 *     and `liveOverlay` (WS ticks) and merges them into a single coherent state.
 *   - Per-panel hooks (useStocksData, useForexData, etc.) provide memoised, pre-derived
 *     views of the data so panels don't do their own normalisation.
 *   - The reducer pattern means state transitions are explicit and testable.
 */

import { createContext, useContext, useReducer, useEffect, useMemo } from 'react';

// ─── Reducer ──────────────────────────────────────────────────────────────────
const initialState = {
  stocks: {},
  forex:  {},
  crypto: {},
  indices:{},
  lastUpdated: null,
  lastSnapshotAt: null,
};

function marketReducer(state, action) {
  switch (action.type) {
    case 'SNAPSHOT': {
      // Full REST snapshot: replace all categories
      const { stocks, forex, crypto, indices, lastUpdated } = action.payload;
      return {
        ...state,
        stocks:  stocks  || state.stocks,
        forex:   forex   || state.forex,
        crypto:  crypto  || state.crypto,
        indices: indices || stocks || state.indices,
        lastUpdated:    lastUpdated || state.lastUpdated,
        lastSnapshotAt: Date.now(),
      };
    }
    case 'TICK_UPDATE': {
      // Live WS tick: merge single symbol into correct category
      const { category, symbol, data } = action.payload;
      if (!category || !symbol || !data) return state;
      return {
        ...state,
        [category]: {
          ...state[category],
          [symbol]: { ...(state[category]?.[symbol] || {}), ...data },
        },
        // Keep indices in sync with stocks
        indices: category === 'stocks'
          ? { ...state.indices, [symbol]: { ...(state.indices?.[symbol] || {}), ...data } }
          : state.indices,
      };
    }
    case 'BATCH_TICK': {
      // Batch of WS ticks flushed at once (from throttle)
      const { ticks } = action.payload; // [{ category, symbol, data }]
      if (!ticks || ticks.length === 0) return state;
      const next = {
        stocks:  { ...state.stocks },
        forex:   { ...state.forex },
        crypto:  { ...state.crypto },
        indices: { ...state.indices },
      };
      ticks.forEach(({ category, symbol, data }) => {
        if (!category || !symbol || !data) return;
        next[category][symbol] = { ...(next[category][symbol] || {}), ...data };
        if (category === 'stocks') {
          next.indices[symbol] = { ...(next.indices[symbol] || {}), ...data };
        }
      });
      return { ...state, ...next };
    }
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
const MarketContext = createContext(null);

export function MarketProvider({ restData, children }) {
  const [state, dispatch] = useReducer(marketReducer, initialState);

  // Sync REST data into reducer whenever useMarketData refreshes
  useEffect(() => {
    if (!restData) return;
    dispatch({ type: 'SNAPSHOT', payload: restData });
  }, [restData]);

  return (
    <MarketContext.Provider value={{ state, dispatch }}>
      {children}
    </MarketContext.Provider>
  );
}

function useMarketContext() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarketContext must be inside MarketProvider');
  return ctx;
}

// ─── Per-panel selectors ──────────────────────────────────────────────────────

/** Returns the full stocks map { [symbol]: { price, changePct, change, ... } } */
export function useStocksData() {
  const { state } = useMarketContext();
  return useMemo(() => state.stocks, [state.stocks]);
}

/** Returns the full forex map */
export function useForexData() {
  const { state } = useMarketContext();
  return useMemo(() => state.forex, [state.forex]);
}

/** Returns the full crypto map */
export function useCryptoData() {
  const { state } = useMarketContext();
  return useMemo(() => state.crypto, [state.crypto]);
}

/** Returns the indices map (mirrors stocks for ETF-proxy panels) */
export function useIndicesData() {
  const { state } = useMarketContext();
  return useMemo(() => state.indices, [state.indices]);
}

/** Returns an array of { symbol, price, changePct } sorted by |changePct| desc (top movers) */
export function useTopMovers(n = 5) {
  const { state } = useMarketContext();
  return useMemo(() => {
    return Object.values(state.stocks)
      .filter(s => s.price != null && s.changePct != null)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, n);
  }, [state.stocks, n]);
}

/** Returns the dispatch function for WS tick injection */
export function useMarketDispatch() {
  const { dispatch } = useMarketContext();
  return dispatch;
}
