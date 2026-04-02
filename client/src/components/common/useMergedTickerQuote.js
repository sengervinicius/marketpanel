/**
 * useMergedTickerQuote.js — shared hook that merges snapshot data with PriceContext
 *
 * Phase 8: Centralizes the "snapshot-first, PriceContext-fallback" pattern that
 * CustomSubsectionBlock's TickerRow already implements.
 *
 * Usage:
 *   const { price, change, changePct, volume } = useMergedTickerQuote(symbol, snapshotQuote);
 *
 * - snapshotQuote: the object from marketData (e.g. data[symbol]) or null/undefined
 * - If snapshotQuote has a price, returns it directly (no extra fetch).
 * - If snapshotQuote is missing or has null price, registers the symbol with
 *   PriceContext which fetches via /api/snapshot/ticker/:symbol on a 6s cycle.
 * - Symbol normalization (C:, X:, .SA) is handled by PriceContext's batchKey().
 */
import { useTickerPrice } from '../../context/PriceContext';

export default function useMergedTickerQuote(symbol, snapshotQuote) {
  // Only activate PriceContext polling if the snapshot doesn't have a price.
  // Passing null to useTickerPrice is safe — it returns null and skips registration.
  const hasSnapshot = snapshotQuote && snapshotQuote.price != null;
  const priceCtx = useTickerPrice(hasSnapshot ? null : symbol);

  return {
    price:     snapshotQuote?.price     ?? priceCtx?.price     ?? null,
    change:    snapshotQuote?.change    ?? priceCtx?.change    ?? null,
    changePct: snapshotQuote?.changePct ?? priceCtx?.changePct ?? null,
    volume:    snapshotQuote?.volume    ?? priceCtx?.volume    ?? null,
  };
}
