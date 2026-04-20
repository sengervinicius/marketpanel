/**
 * panelColumns.js
 * Shared column templates for price-row panels (Stock, Brazil, Forex,
 * Commodities, Watchlist, GlobalIndices, Crypto, Index, Alerts, Portfolio).
 *
 * CIO-note (2026-04-20):
 *   Multiple panels were widening/shrinking their own COLS strings with
 *   CHG% columns as narrow as 52px, causing collisions the moment a
 *   2-digit % value arrived (e.g. ONCO3 +15.33% crushing the 1.58 price
 *   in the Brazil panel). This module centralises the grid templates so
 *   we never re-litigate "how wide is a CHG% column" panel by panel.
 *
 *   Width budget — derived from worst realistic values in a 11px
 *   monospace at tabular-nums:
 *     symbol:  up to 6 chars (B3 tickers like PETR4B)       → 60px
 *     price:   up to 10 chars (123,456.78)                  → 80px
 *     chg%:    up to 8 chars (+888.88%) with optional arrow → 76px
 *     pad/gap: 4px each side on every cell                  → baked in
 *
 *   For the FX panel we widen symbol to 72px because EUR/USD-style
 *   labels often live in the symbol column.
 *
 *   For PortfolioPanel we keep a bespoke template because it carries
 *   quantity/cost/pnl/weight columns, but we still lift the CHG% column
 *   to the common floor.
 */

// ── Common column-width primitives ────────────────────────────────────
export const COL_SYMBOL       = '60px';
export const COL_SYMBOL_FX    = '72px';   // "EUR/USD" needs more room
export const COL_SYMBOL_TIGHT = '44px';   // commodity symbols like GLD / BZ=F
export const COL_NAME_FLEX    = '1fr';
export const COL_PRICE        = '80px';
export const COL_CHG_PCT      = '76px';   // minimum safe width — do NOT shrink
export const COL_REMOVE_BTN   = '24px';

// ── Canonical 4-column layouts ───────────────────────────────────────
// symbol | name | price | chg%
export const COLS_STANDARD = `${COL_SYMBOL} ${COL_NAME_FLEX} ${COL_PRICE} ${COL_CHG_PCT}`;

// Forex variant — slightly wider symbol for pair labels
export const COLS_FOREX    = `${COL_SYMBOL_FX} ${COL_NAME_FLEX} ${COL_PRICE} ${COL_CHG_PCT}`;

// Commodities / indexes with short symbols (GLD, SLV, SPY)
export const COLS_TIGHT    = `${COL_SYMBOL_TIGHT} ${COL_NAME_FLEX} ${COL_PRICE} ${COL_CHG_PCT}`;

// Watchlist: symbol | name | price | chg% | remove-btn
export const COLS_WATCHLIST = `${COL_SYMBOL_FX} ${COL_NAME_FLEX} ${COL_PRICE} ${COL_CHG_PCT} ${COL_REMOVE_BTN}`;
