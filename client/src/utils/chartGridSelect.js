/**
 * chartGridSelect.js — pure grid-update logic for "user clicked a ticker
 * somewhere else in the terminal" (watchlist rows, panel rows, news briefing
 * chips, movers, sector screens, the 'chart:set-ticker' event, …).
 *
 * Selecting a ticker must NEVER grow the chart grid:
 *   - already charted → that tile becomes the primary tile (caller highlights
 *     it); the grid itself is unchanged.
 *   - not charted     → it replaces the current primary tile in place (same
 *     slot, same size). The grid length never changes.
 *
 * "Primary" = the first tile by default (index 0), promoted to whichever tile
 * the user last selected via a ticker click. Explicit adds remain the + ADD
 * affordances and drag-drop, which go through addTicker, not this helper.
 *
 * @param {string[]} tickers    current grid (already-normalized symbols)
 * @param {number}   primaryIdx index of the current primary tile
 * @param {string}   sym        normalized symbol the user selected
 * @returns {{ tickers: string[], primaryIdx: number, changed: boolean }}
 *   changed=true only when a tile's symbol was replaced (grid array is a new
 *   array in that case; otherwise the original reference is returned).
 */
export function selectTickerInGrid(tickers, primaryIdx, sym) {
  if (!sym || !Array.isArray(tickers) || tickers.length === 0) {
    return { tickers, primaryIdx: 0, changed: false };
  }
  const existing = tickers.indexOf(sym);
  if (existing !== -1) {
    // Already charted: just promote it to primary. Never a second tile.
    return { tickers, primaryIdx: existing, changed: false };
  }
  // Not charted: replace the primary tile in place. Clamp in case tiles were
  // removed since the primary was last set.
  const idx = Math.min(Math.max(primaryIdx || 0, 0), tickers.length - 1);
  const next = tickers.slice();
  next[idx] = sym;
  return { tickers: next, primaryIdx: idx, changed: true };
}

export default selectTickerInGrid;
