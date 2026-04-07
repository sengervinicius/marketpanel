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
 */
import { memo, useState, useEffect } from 'react';
import useMergedTickerQuote from './useMergedTickerQuote';
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
  symbolColor = 'var(--text-primary)',
  columns = '60px 1fr 68px 60px',
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
    if (!draggable || !dragData) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-ticker', JSON.stringify(dragData));
  };

  return (
    <div
      {...(dataAttrs || {})}
      className={flash ? 'price-row-flash' : undefined}
      draggable={draggable || undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onContextMenu={onContextMenu}
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        padding: '3px 8px',
        borderBottom: '1px solid var(--border-subtle)',
        alignItems: 'center',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <span style={{
        color: symbolColor,
        fontWeight: 700,
      }}>
        {displaySymbol || symbol}
      </span>
      <span style={{
        color: 'var(--text-muted)',
        fontSize: '9px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingRight: 4,
      }}>
        {name}
      </span>
      <span style={{
        color: 'var(--text-primary)',
        textAlign: 'right',
        paddingRight: 4,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {renderPrice(price)}
      </span>
      <span style={{
        color: pos ? 'var(--price-up)' : 'var(--price-down)',
        textAlign: 'right',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {renderChangePct(changePct)}
      </span>
      {trailing}
    </div>
  );
}

export { PriceRow };
export default memo(PriceRow);
