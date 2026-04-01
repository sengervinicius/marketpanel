/**
 * ETFPanel.jsx
 * Mobile ETF panel with categorized ETF browsing
 * Categories: Bond ETFs, Sector ETFs, International, Thematic
 */

import { memo, useState } from 'react';
import { useStocksData } from '../../context/MarketContext';
import { useWatchlist } from '../../context/PortfolioContext';
import { ETF_CATEGORIES } from '../../utils/constants';

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

function ETFPanel({ onOpenDetail }) {
  const stocksData = useStocksData();
  const { addTicker } = useWatchlist();
  const [expanded, setExpanded] = useState(() => {
    const keys = Object.keys(ETF_CATEGORIES);
    return keys.reduce((acc, k) => ({ ...acc, [k]: k === 'Sector ETFs' }), {});
  });

  const toggleCategory = (cat) => {
    setExpanded(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const containerStyle = {
    backgroundColor: '#0a0a0a',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    WebkitOverflowScrolling: 'touch',
  };

  const headerStyle = {
    padding: '10px 14px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
  };

  const titleStyle = {
    color: '#ff6600',
    fontSize: '11px',
    letterSpacing: '0.2em',
    fontWeight: 'bold',
  };

  const contentStyle = {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  };

  const categoryHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #1e1e1e',
    cursor: 'pointer',
    backgroundColor: '#0d0d0d',
    minHeight: '44px',
  };

  const categoryTitleStyle = {
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    color: '#ccc',
  };

  const expandIconStyle = {
    fontSize: '12px',
    color: '#666',
    transition: 'transform 0.2s',
  };

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid #141414',
    minHeight: '44px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.15)',
  };

  const symbolStyle = {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#ff6600',
    minWidth: '50px',
  };

  const nameStyle = {
    fontSize: '9px',
    color: '#666',
    marginLeft: '8px',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const dataContainerStyle = {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-end',
    flexShrink: 0,
  };

  const priceStyle = {
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '50px',
    textAlign: 'right',
  };

  const changeStyle = (changePct) => ({
    fontSize: '10px',
    color: changePct >= 0 ? '#00cc66' : '#ff4444',
    minWidth: '45px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  });

  const addButtonStyle = {
    background: 'none',
    border: '1px solid #2a2a2a',
    color: '#666',
    fontSize: '8px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    borderRadius: '2px',
    flexShrink: 0,
    minWidth: '40px',
    minHeight: '32px',
    letterSpacing: '0.1em',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleStyle}>ETF CATEGORIES</div>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {Object.entries(ETF_CATEGORIES).map(([category, etfs]) => (
          <div key={category}>
            {/* Category header */}
            <div
              style={categoryHeaderStyle}
              onClick={() => toggleCategory(category)}
            >
              <span style={categoryTitleStyle}>{category.toUpperCase()}</span>
              <span style={{
                ...expandIconStyle,
                transform: expanded[category] ? 'rotate(180deg)' : 'rotate(0deg)',
              }}>
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
                  style={rowStyle}
                  onClick={() => onOpenDetail?.(etf.symbol)}
                >
                  {/* Symbol and name */}
                  <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <span style={symbolStyle}>{etf.symbol}</span>
                    <span style={nameStyle}>{etf.label}</span>
                  </div>

                  {/* Price and change */}
                  <div style={dataContainerStyle}>
                    <div style={priceStyle}>
                      {fmtPrice(price, 2)}
                    </div>
                    <div style={changeStyle(changePct)}>
                      {fmtPct(changePct)}
                    </div>
                  </div>

                  {/* Add to watchlist button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addTicker(etf.symbol);
                    }}
                    style={addButtonStyle}
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
