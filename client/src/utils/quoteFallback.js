/**
 * quoteFallback.js — pure fallback-decision logic for panel price rows.
 *
 * Futures "—" bug follow-up: panels (CommoditiesPanel / StockPanel /
 * ForexPanel / GlobalIndicesPanel CUSTOM bucket) render rows for whatever
 * symbols the user saved, but their `data` prop only covers the server's
 * /snapshot/* + WebSocket universe. Any symbol outside that universe must
 * fall back to PriceContext extras (useTickerPrice → batched
 * /api/snapshot/tickers, which supports =F futures via Yahoo).
 *
 * The merge decision used to live inline in useMergedTickerQuote; it is
 * extracted here so it is unit-testable and reusable outside React.
 */

/** True when a snapshot entry actually carries a usable price. */
export function hasUsableQuote(entry) {
  return entry != null && typeof entry.price === 'number' && !Number.isNaN(entry.price);
}

/**
 * needsFallback(snapshotEntry) — should this row consult PriceContext
 * extras? Yes whenever the batch/snapshot entry is missing or price-less
 * (e.g. `{}` from `data[symbol] || {}`, or an entry with price: null).
 */
export function needsFallback(snapshotEntry) {
  return !hasUsableQuote(snapshotEntry);
}

/**
 * mergeQuote(snapshotQuote, ctxQuote) — field-level merge, snapshot-first.
 *
 * - snapshot (REST batch + WS overlay) wins per field when present;
 * - PriceContext extras fill any missing field;
 * - always returns an object with all four fields (null when unknown),
 *   so consumers never branch on undefined.
 */
export function mergeQuote(snapshotQuote, ctxQuote) {
  return {
    price:     snapshotQuote?.price     ?? ctxQuote?.price     ?? null,
    change:    snapshotQuote?.change    ?? ctxQuote?.change    ?? null,
    changePct: snapshotQuote?.changePct ?? ctxQuote?.changePct ?? null,
    volume:    snapshotQuote?.volume    ?? ctxQuote?.volume    ?? null,
  };
}
