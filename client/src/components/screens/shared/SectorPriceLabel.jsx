/**
 * SectorPriceLabel.jsx — Sprint 5 Phase 5
 * Live price display for sector charts.
 *
 * Subscribes to PriceContext independently, allowing price updates
 * without re-rendering the chart. This separation ensures:
 * - Chart data doesn't change on price updates
 * - Price updates are smooth and don't cause layout shifts
 * - Each label is a tiny, pure subscription component
 */
import { memo } from 'react';
import { useTickerPrice } from '../../../context/PriceContext';

function SectorPriceLabel({ ticker, accentColor }) {
  // Subscribe to live price independently
  // This component will re-render on price changes, but parent chart won't
  const priceData = useTickerPrice(ticker);
  const price = priceData?.price;
  const changePct = priceData?.changePct;
  const isUp = changePct != null ? changePct >= 0 : true;

  // Display formatting
  const displayPrice = price != null ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const displayChange = changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
        ${displayPrice}
      </span>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums',
          color: isUp ? 'var(--price-up, #4caf50)' : 'var(--price-down, #f44336)',
          fontWeight: 600,
        }}
      >
        {displayChange}
      </span>
    </div>
  );
}

export default memo(SectorPriceLabel);
