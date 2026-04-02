/**
 * useMergedPrice.js — unified price hook for all panels
 *
 * Phase 10: Single source-of-truth price accessor.
 *
 * Usage:
 *   const { price, changePct, change, volume } = useMergedPrice(symbol, batchMap);
 *
 * Behaviour:
 *   1. If batchMap[symbol] has a non-null price, returns it (fast path, no extra fetch).
 *   2. Otherwise, registers the symbol with PriceContext which fetches
 *      via /api/snapshot/ticker/:symbol on a 6s cycle.
 *   3. Always returns { price, changePct, change, volume } — all nullable.
 *
 * This is the map-based convenience wrapper. For pre-looked-up quotes,
 * useMergedTickerQuote (Phase 8) still works and PriceRow uses it internally.
 */
import { useTickerPrice } from '../context/PriceContext';

export default function useMergedPrice(symbol, batchMap) {
  const entry = batchMap?.[symbol] ?? null;
  const hasSnapshot = entry && entry.price != null;

  // Only activate PriceContext polling if the batch doesn't have this symbol.
  // Passing null to useTickerPrice is safe — it returns null and skips registration.
  const priceCtx = useTickerPrice(hasSnapshot ? null : symbol);

  return {
    price:     entry?.price     ?? priceCtx?.price     ?? null,
    change:    entry?.change    ?? priceCtx?.change    ?? null,
    changePct: entry?.changePct ?? priceCtx?.changePct ?? null,
    volume:    entry?.volume    ?? priceCtx?.volume    ?? null,
  };
}
