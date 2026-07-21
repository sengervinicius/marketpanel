/**
 * PriceRow.jsx
 * Shared price row used across data panels (StockPanel, ForexPanel, CryptoPanel, WatchlistPanel).
 * Renders: symbol, name, price, change% in a grid layout.
 * Uses design tokens. Supports drag, click, double-click, touch-hold, right-click.
 *
 * Phase 8: Added `ticker` prop for PriceContext fallback. When `ticker` is provided
 * and `price` is null, PriceRow automatically uses useMergedTickerQuote to fetch
 * live prices via PriceContext, fixing the "--" bug for dropped tickers.
 *
 * Fix 4: Replaced dashes with shimmer loading states. Shows animated shimmer
 * placeholder when price is null (loading), falls back to dash after 10 seconds.
 *
 * Phase 2: Added `sparklineData` prop for optional inline sparklines (array of numbers).
 */
import { memo, useState, useEffect } from 'react';
import useMergedTickerQuote from './useMergedTickerQuote';
// H1.2: row sparklines use the v2 component (own column, damped scaling).
import Sparkline from './Sparkline';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useTickerClicks } from '../../hooks/useTickerClicks';
import { fmtVol } from '../../utils/format';
import './Shimmer.css';

const fmt2 = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt4 = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

function PriceRow({
  symbol,
  displaySymbol,
  name,
  price: priceProp,
  changePct: changePctProp,
  // Phase 8: optional ticker for PriceContext fallback
  ticker,
  // Phase 2: optional sparkline data (array of numbers)
  sparklineData = null,
  // wave-nov item 1 — optional VOL cell (compact 48.2M). Callers that pass
  // `volume` must also pass a grid template with a COL_VOL column (see
  // panelColumns.js COLS_MOVERS_SPARK); undefined keeps the legacy layout.
  volume,
  symbolColor = 'var(--text-primary)',
  // CIO-note (2026-04-20): default grid matches utils/panelColumns.js
  // COLS_STANDARD. A 2-digit CHG% (e.g. +15.33%) no longer collides
  // with the price column at the default. Individual panels still pass
  // their own `columns` via the shared constants in panelColumns.js.
  columns = '60px 1fr 80px 76px',
  decimals = 2,
  // Interaction handlers
  onClick,
  onDoubleClick,
  onContextMenu,
  onTouchHold,
  // Drag support
  draggable = false,
  dragData,
  // Touch ref for hold detection
  touchRef,
  // Phase 8: flash animation for newly dropped tickers
  flash,
  // Extra content (e.g., remove button)
  trailing,
  // Data attributes for context menus
  dataAttrs,
}) {
  // #247 P2.5 — HTML5 drag-and-drop doesn't fire on iOS/Android touch
  // devices; worse, a `draggable` element interferes with scroll. Disable
  // drag on mobile and let callers (e.g. long-press context menus) take
  // over via `onTouchHold`.
  const isMobile = useIsMobile();
  const dragEnabled = draggable && !isMobile;

  // Fix 4: Track whether data has timed out (after 10s, show dash instead of shimmer)
  const [showShimmer, setShowShimmer] = useState(true);

  // Sprint 3: Standardized timeout — 8s shimmer then show dash
  useEffect(() => {
    const timer = setTimeout(() => setShowShimmer(false), 8000);
    return () => clearTimeout(timer);
  }, []);

  // Phase 8: merge snapshot price with PriceContext fallback
  const snapshotQuote = priceProp != null ? { price: priceProp, changePct: changePctProp } : null;
  const merged = useMergedTickerQuote(ticker || null, snapshotQuote);
  const price = merged.price;
  const changePct = merged.changePct;

  const pos = (changePct ?? 0) >= 0;
  const fmtFn = decimals >= 4 ? fmt4 : fmt2;

  // Fix 4: Helper to render price with shimmer or formatted value
  const renderPrice = (val) => {
    if (val == null) {
      return showShimmer ? <span className="price-shimmer" /> : '—';
    }
    return fmtFn(val);
  };

  // Fix 4: Helper to render change% with shimmer or formatted value
  const renderChangePct = (val) => {
    if (val == null) {
      return showShimmer ? <span className="price-shimmer price-shimmer--narrow" /> : '—';
    }
    return fmtPct(val);
  };

  const handleTouchStart = (e) => {
    if (!onTouchHold || !touchRef) return;
    e.stopPropagation();
    clearTimeout(touchRef.current);
    touchRef.current = setTimeout(() => onTouchHold(), 500);
  };
  const handleTouchEnd = () => { if (touchRef) clearTimeout(touchRef.current); };
  const handleTouchMove = () => { if (touchRef) clearTimeout(touchRef.current); };

  const handleDragStart = (e) => {
    if (!dragEnabled || !dragData) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify(dragData));
  };

  // wave-nov item 5 — shared click contract (useTickerClicks): single
  // click fires the caller's onClick after a 250ms delay; a double-click
  // cancels it and fires onDoubleClick (or opens the detail window when
  // the caller gave none). Previously the un-delayed onClick opened the
  // in-app overlay on the FIRST click of a double-click, flashing it under
  // (or swallowing) the detail window on every PriceRow panel.
  const rowClicks = useTickerClicks(ticker || symbol, {
    onSingle: onClick ? (sym, e) => onClick(e) : undefined,
    onDouble: onDoubleClick ? (sym, e) => onDoubleClick(e) : undefined,
  });
  const handleClick = onClick ? rowClicks.onClick : undefined;
  const handleDoubleClick = (onClick || onDoubleClick) ? rowClicks.onDoubleClick : undefined;

  return (
    <div
      {...(dataAttrs || {})}
      className={flash ? 'price-row-flash' : undefined}
      draggable={dragEnabled || undefined}
      onDragStart={dragEnabled ? handleDragStart : undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onContextMenu={onContextMenu}
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        padding: 'var(--row-pad, 3px) 8px',  // H1.3 shared density token
        borderBottom: '1px solid var(--border-subtle)',
        alignItems: 'center',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {/* Polish W2 item 3 — every text cell clips: grid children default to
          min-width:auto, so long symbols (^STOXX50E) / names (Oncoclinicas do
          Brasil…) used to paint over the neighbouring cell. min-width:0 +
          overflow ellipsis on all four cells guarantees truncation instead. */}
      <span style={{
        color: symbolColor,
        fontWeight: 700,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingRight: 4,
      }} title={displaySymbol || symbol}>
        {displaySymbol || symbol}
      </span>
      <span style={{
        color: 'var(--text-muted)',
        fontSize: '9px',
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingRight: 4,
      }} title={name}>
        {name}
      </span>
      <span style={{
        color: 'var(--text-primary)',
        textAlign: 'right',
        paddingRight: 4,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}>
        {renderPrice(price)}
      </span>
      <span style={{
        color: pos ? 'var(--price-up)' : 'var(--price-down)',
        textAlign: 'right',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        minWidth: 0,
        whiteSpace: 'nowrap',
      }}>
        {renderChangePct(changePct)}
      </span>
      {volume !== undefined && (
        <span style={{
          color: 'var(--text-muted)',
          textAlign: 'right',
          fontSize: '10px',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          paddingRight: 4,
        }} title={volume != null ? `Volume ${Number(volume).toLocaleString('en-US')}` : undefined}>
          {volume != null ? fmtVol(volume) : '—'}
        </span>
      )}
      {/* H1.2: sparkline lives in its own narrow column (COL_SPARK),
          not inside the CHG% cell. Panels opt in via *_SPARK templates. */}
      {sparklineData && sparklineData.length >= 2 && (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <Sparkline data={sparklineData} width={44} height={14} />
        </span>
      )}
      {trailing}
    </div>
  );
}

export { PriceRow };
export default memo(PriceRow);
