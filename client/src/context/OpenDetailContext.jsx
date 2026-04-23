import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { extractSymbol } from '../utils/tickerNormalize';

const OpenDetailContext = createContext(null);

/**
 * #241 / P1.1: this used to reimplement its own string|object extractor.
 * It now delegates to the shared extractSymbol() in utils/tickerNormalize,
 * which is mirrored on the server in server/utils/tickerNormalize.js so
 * the contract is identical across the wire.
 */
const normalizeSymbol = extractSymbol;

export function OpenDetailProvider({ children, externalTicker, externalSetTicker }) {
  const [internalTicker, internalSetTicker] = useState(null);
  const [sectorContext, setSectorContext] = useState(null); // Track sector/screen context

  // Support both controlled (external state) and uncontrolled (internal state) modes
  const detailTicker = externalTicker !== undefined ? externalTicker : internalTicker;
  const setDetailTicker = externalSetTicker || internalSetTicker;

  // Ref-based pattern: survives HMR, stale closures, missing deps
  const setDetailTickerRef = useRef(setDetailTicker);
  setDetailTickerRef.current = setDetailTicker;

  const openDetail = useCallback((input, fromSector = null) => {
    const sym = normalizeSymbol(input);
    if (!sym) return; // silently no-op
    setSectorContext(fromSector); // Store sector context if provided
    setDetailTickerRef.current(sym);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailTickerRef.current(null);
    setSectorContext(null);
  }, []);

  return (
    <OpenDetailContext.Provider value={{ detailTicker, setDetailTicker, openDetail, closeDetail, sectorContext, setSectorContext }}>
      {children}
    </OpenDetailContext.Provider>
  );
}

/**
 * useOpenDetail — returns the openDetail(symbolOrObject) function.
 * This is the primary way components should open instrument detail.
 */
export function useOpenDetail() {
  const ctx = useContext(OpenDetailContext);
  if (!ctx) {
    // Fallback: return a no-op so components outside the provider don't crash.
    // This handles InstrumentDetailPage (pop-out) where we don't wrap with provider.
    return () => {};
  }
  return ctx.openDetail;
}

/**
 * useDetailTicker — returns [detailTicker, setDetailTicker, closeDetail].
 * Used by App.jsx and detail rendering logic.
 */
export function useDetailTicker() {
  const ctx = useContext(OpenDetailContext);
  if (!ctx) {
    return [null, () => {}, () => {}];
  }
  return [ctx.detailTicker, ctx.setDetailTicker, ctx.closeDetail];
}

/**
 * useSectorContext — returns the current sector/screen context when opening a detail view
 */
export function useSectorContext() {
  const ctx = useContext(OpenDetailContext);
  if (!ctx) {
    return null;
  }
  return ctx.sectorContext;
}

export default OpenDetailContext;
