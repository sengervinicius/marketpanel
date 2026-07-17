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
import { mergeQuote } from '../../utils/quoteFallback';

export default function useMergedTickerQuote(symbol, snapshotQuote) {
  // Always register the symbol with PriceContext. PriceContext already checks
  // the batch first (lookupInBatch) and only starts extra fetches for tickers
  // not covered by the batch, so there's no duplicated work.
  //
  // Previously we passed null when the snapshot had a price, but this caused
  // dropped/custom tickers to show dashes when the snapshot object was empty
  // ({}) — the conditional skipped PriceContext registration on the first
  // render cycle, and subsequent re-renders never corrected it.
  const priceCtx = useTickerPrice(symbol);

  // Fallback decision + field-level merge live in utils/quoteFallback.js
  // (pure, unit-tested): snapshot wins per field, PriceContext extras fill
  // the gaps, all fields default to null.
  return mergeQuote(snapshotQuote, priceCtx);
}
