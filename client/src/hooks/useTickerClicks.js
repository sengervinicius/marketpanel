/**
 * useTickerClicks.js — wave-nov item 5: shared ticker-row click contract.
 *
 * Extracted from WatchlistPanel (FEAT-1b) — the one row in the app that
 * already behaved correctly:
 *
 *   single click  → the panel's in-app action (usually the overlay
 *                   detail), fired after SINGLE_CLICK_DELAY_MS
 *   double click  → cancels the pending single click and opens the
 *                   standalone #/detail/:symbol WINDOW (default), or a
 *                   caller-supplied onDouble
 *
 * Why the delay: a double-click is physically two clicks, so without it
 * the overlay opened (and re-rendered the row tree) before the dblclick
 * event fired — on most panels that either flashed the overlay under the
 * new window or swallowed the dblclick entirely, which is why "only the
 * watchlist opens the new window" was reported.
 *
 * NOTE: handlers do NOT call stopPropagation — nested rows/chips that
 * need it (news chips, market-map mover line) wrap the handlers.
 */
import { useCallback, useEffect, useRef } from 'react';
import { openDetailWindow } from '../utils/detailWindow';

export const SINGLE_CLICK_DELAY_MS = 250;

/**
 * Factory variant for components that render many rows inline. One shared
 * pending-click timer per component is enough — only one row is clicked
 * at a time, and a click on row B correctly supersedes a pending click
 * on row A.
 *
 *   const tickerClicks = useTickerClicksFactory();
 *   <div {...tickerClicks(sym, { onSingle: openDetail })} />
 */
export function useTickerClicksFactory() {
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  // Handlers forward (symbol, event) so wrappers can keep using the
  // original React event (modifier keys, stopPropagation, …).
  return useCallback((symbol, { onSingle, onDouble } = {}) => ({
    onClick: onSingle
      ? (e) => {
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => onSingle(symbol, e), SINGLE_CLICK_DELAY_MS);
        }
      : undefined,
    onDoubleClick: (e) => {
      clearTimeout(timerRef.current);
      if (onDouble) onDouble(symbol, e);
      else openDetailWindow(symbol);
    },
  }), []);
}

/**
 * Per-row hook (for row components):
 *   const { onClick, onDoubleClick } = useTickerClicks(sym, { onSingle: openDetail });
 */
export function useTickerClicks(symbol, opts = {}) {
  const make = useTickerClicksFactory();
  return make(symbol, opts);
}

export default useTickerClicks;
