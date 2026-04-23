/**
 * ETFPanel.jsx
 * Mobile ETF panel with categorized ETF browsing
 * Categories: Bond ETFs, Sector ETFs, International, Thematic
 */

import { memo, useState } from 'react';
import { useStocksData } from '../../context/MarketContext';
import { useWatchlist } from '../../context/PortfolioContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { ETF_CATEGORIES } from '../../utils/constants';
import { tapStart, tapMove, tapEnd } from '../../utils/tapHandlers';
import './ETFPanel.css';

function fmtPrice(v, dec = 2) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(v) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtVol(n) {
  if (!n) return '--';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

function ETFPanel() {
  const openDetail = useOpenDetail();
  const stocksData = useStocksData();
  const { addTicker } = useWatchlist();
  const [expanded, setExpanded] = useState(() => {
    const keys = Object.keys(ETF_CATEGORIES);
    return keys.reduce((acc, k) => ({ ...acc, [k]: k === 'Sector ETFs' }), {});
  });

  const toggleCategory = (cat) => {
    setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <div className="ep-container">
      {/* Header */}
      <div className="ep-header">
        <div className="ep-header-title">ETF CATEGORIES</div>
      </div>

      {/* Content */}
      <div className="ep-content">
        {Object.entries(ETF_CATEGORIES).map(([category, etfs]) => (
          <div key={category}>
            {/* Category header */}
            <div
              className="ep-category-header"
              onClick={() => toggleCategory(category)}
            >
              <span className="ep-category-title">{category.toUpperCase()}</span>
              <span className={`ep-expand-icon ${expanded[category] ? 'ep-expand-icon-rotated' : ''}`}>
                ▼
              </span>
            </div>

            {/* ETFs in category */}
            {expanded[category] && etfs.map((etf) => {
              const data = stocksData[etf.symbol];
              const price = data?.price ?? null;
              const changePct = data?.changePct ?? null;
              const volume = data?.volume ?? null;

              return (
                <div
                  key={etf.symbol}
                  className="ep-row"
                  onClick={() => openDetail(etf.symbol)}
                  onTouchStart={tapStart}
                  onTouchMove={tapMove}
                  onTouchEnd={(e) => tapEnd(e, () => openDetail(etf.symbol))}
                >
                  {/* Symbol and name */}
                  <div className="ep-row-left">
                    <span className="ep-row-symbol">{etf.symbol}</span>
                    <span className="ep-row-name">{etf.label}</span>
                  </div>

                  {/* Price and change */}
                  <div className="ep-row-data">
                    <div className="ep-row-price">
                      {fmtPrice(price, 2)}
                    </div>
                    <div className={`ep-row-change ${changePct >= 0 ? 'ep-row-change-positive' : 'ep-row-change-negative'}`}>
                      {fmtPct(changePct)}
                    </div>
                  </div>

                  {/* Add to watchlist button */}
                  <button className="btn ep-add-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      addTicker(etf.symbol);
                    }}
                    title="Add to watchlist"
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ETFPanel);
