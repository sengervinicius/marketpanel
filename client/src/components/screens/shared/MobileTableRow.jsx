/**
 * MobileTableRow.jsx — Phase 7: Mobile table row with expansion
 *
 * Features:
 * - Compact row showing: TICKER, PRICE, 1D% by default
 * - Tap to expand: shows MKT CAP, P/E, REVENUE + optional mini chart
 * - Smooth CSS expand/collapse animation
 * - 44px+ minimum row height for touch
 * - Tap ticker to open InstrumentDetail
 */

import { useState, useRef } from 'react';
import './MobileTableRow.css';

export function MobileTableRow({
  ticker,
  price,
  change1d,
  mktCap,
  pe,
  revenue,
  miniChart = null,
  onTickerClick = null,
  onExpand = null,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const expandableRef = useRef(null);

  const handleRowClick = (e) => {
    e.preventDefault();
    setIsExpanded(!isExpanded);
    if (onExpand) onExpand(!isExpanded);
  };

  const handleTickerClick = (e) => {
    e.stopPropagation();
    if (onTickerClick) onTickerClick(ticker);
  };

  const isPositive = change1d >= 0;

  return (
    <div className="mobile-table-row">
      {/* Compact row (always visible) */}
      <div
        className="mobile-table-row-compact"
        onClick={handleRowClick}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleRowClick(e);
        }}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
      >
        <div className="mobile-row-col mobile-row-ticker">
          <button
            className="mobile-ticker-btn"
            onClick={handleTickerClick}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleTickerClick(e);
            }}
          >
            {ticker}
          </button>
        </div>

        <div className="mobile-row-col mobile-row-price">
          ${price?.toFixed(2) ?? '—'}
        </div>

        <div className={`mobile-row-col mobile-row-change ${isPositive ? 'mobile-row-change--up' : 'mobile-row-change--down'}`}>
          {isPositive ? '+' : ''}{change1d?.toFixed(2) ?? '—'}%
        </div>

        <div className="mobile-row-expand-icon">
          {isExpanded ? '▼' : '▶'}
        </div>
      </div>

      {/* Expandable row (animated) */}
      <div
        className={`mobile-table-row-expandable ${isExpanded ? 'mobile-table-row-expandable--open' : ''}`}
        ref={expandableRef}
        style={{
          maxHeight: isExpanded ? (expandableRef.current?.scrollHeight ?? 'auto') : '0',
        }}
      >
        <div className="mobile-table-row-expanded">
          {/* Additional metrics grid */}
          <div className="mobile-expanded-metrics">
            {mktCap != null && (
              <div className="mobile-metric">
                <div className="mobile-metric-label">MKT CAP</div>
                <div className="mobile-metric-value">{mktCap}</div>
              </div>
            )}

            {pe != null && (
              <div className="mobile-metric">
                <div className="mobile-metric-label">P/E</div>
                <div className="mobile-metric-value">{pe}</div>
              </div>
            )}

            {revenue != null && (
              <div className="mobile-metric">
                <div className="mobile-metric-label">REVENUE</div>
                <div className="mobile-metric-value">{revenue}</div>
              </div>
            )}
          </div>

          {/* Optional mini chart */}
          {miniChart && (
            <div className="mobile-expanded-chart">
              {miniChart}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MobileTableRow;
