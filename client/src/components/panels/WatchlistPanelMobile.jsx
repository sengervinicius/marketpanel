/**
 * WatchlistPanelMobile.jsx
 * Enhanced mobile watchlist view with search and management features
 */

import { memo, useState, useMemo } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';

function fmtPrice(v, dec = 2) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(v) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function WatchlistPanelMobile({ onOpenDetail, onManage }) {
  const { watchlist, removeTicker } = useWatchlist();
  const stocks = useStocksData();
  const forex = useForexData();
  const crypto = useCryptoData();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('added'); // 'added', 'change', 'price'

  const getData = (sym) => stocks[sym] || forex[sym] || crypto[sym] || null;

  // Filter by search query
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return watchlist;
    const q = searchQuery.toUpperCase();
    return watchlist.filter(sym => sym.toUpperCase().includes(q));
  }, [watchlist, searchQuery]);

  // Sort based on selected criterion
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'change') {
      arr.sort((a, b) => {
        const dataA = getData(a);
        const dataB = getData(b);
        const pctA = dataA?.changePct ?? 0;
        const pctB = dataB?.changePct ?? 0;
        return pctB - pctA;
      });
    } else if (sortBy === 'price') {
      arr.sort((a, b) => {
        const dataA = getData(a);
        const dataB = getData(b);
        const priceA = dataA?.price ?? 0;
        const priceB = dataB?.price ?? 0;
        return priceB - priceA;
      });
    }
    return arr;
  }, [filtered, sortBy]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0a0a0a',
    fontFamily: '"Courier New", monospace',
  };

  const headerStyle = {
    padding: '10px 14px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const titleStyle = {
    color: '#ff6600',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: '0.2em',
  };

  const manageButtonStyle = {
    background: 'none',
    border: '1px solid #2a2a2a',
    color: '#888',
    padding: '4px 12px',
    fontSize: 9,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '0.1em',
    borderRadius: 2,
    minHeight: '32px',
  };

  const searchStyle = {
    padding: '8px 12px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
  };

  const searchInputStyle = {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#0d0d0d',
    border: '1px solid #1e1e1e',
    borderRadius: '3px',
    color: '#ccc',
    fontSize: '12px',
    fontFamily: 'monospace',
    outline: 'none',
    boxSizing: 'border-box',
    minHeight: '36px',
  };

  const filterBarStyle = {
    display: 'flex',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: '1px solid #1e1e1e',
    flexShrink: 0,
    overflowX: 'auto',
  };

  const filterButtonStyle = (isActive) => ({
    padding: '4px 8px',
    fontSize: '8px',
    backgroundColor: isActive ? '#1a0900' : 'transparent',
    border: `1px solid ${isActive ? '#ff6600' : '#2a2a2a'}`,
    color: isActive ? '#ff6600' : '#444',
    cursor: 'pointer',
    fontFamily: 'inherit',
    borderRadius: '2px',
    fontWeight: isActive ? 'bold' : 'normal',
    letterSpacing: '0.05em',
    flexShrink: 0,
  });

  const emptyStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  };

  const listStyle = {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #141414',
    cursor: 'pointer',
    minHeight: 56,
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.15)',
  };

  const symbolNameStyle = {
    flex: 1,
    minWidth: 0,
  };

  const symbolStyle = {
    color: '#e0e0e0',
    fontSize: 13,
    fontWeight: 'bold',
  };

  const nameStyle = {
    color: '#444',
    fontSize: 9,
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const priceChangeStyle = {
    textAlign: 'right',
    marginRight: 12,
  };

  const priceStyle = {
    color: '#e0e0e0',
    fontSize: 14,
    fontVariantNumeric: 'tabular-nums',
  };

  const changeStyle = (changePct) => ({
    color: changePct == null ? '#555' : changePct >= 0 ? '#00cc44' : '#cc2200',
    fontSize: 10,
    marginTop: 2,
  });

  const removeButtonStyle = {
    background: 'none',
    border: '1px solid #1a1a1a',
    color: '#444',
    cursor: 'pointer',
    fontSize: 10,
    lineHeight: 1,
    padding: '6px 10px',
    flexShrink: 0,
    borderRadius: 3,
    minWidth: '36px',
    minHeight: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'rgba(255, 0, 0, 0.15)',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={titleStyle}>WATCHLIST</span>
        <button onClick={onManage} style={manageButtonStyle}>
          + ADD
        </button>
      </div>

      {/* Search bar (visible when watchlist not empty) */}
      {watchlist.length > 0 && (
        <div style={searchStyle}>
          <input
            type="text"
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={searchInputStyle}
          />
        </div>
      )}

      {/* Sort filter tabs (visible when watchlist not empty) */}
      {watchlist.length > 0 && (
        <div style={filterBarStyle}>
          <button
            onClick={() => setSortBy('added')}
            style={filterButtonStyle(sortBy === 'added')}
          >
            ADDED
          </button>
          <button
            onClick={() => setSortBy('change')}
            style={filterButtonStyle(sortBy === 'change')}
          >
            CHANGE
          </button>
          <button
            onClick={() => setSortBy('price')}
            style={filterButtonStyle(sortBy === 'price')}
          >
            PRICE
          </button>
        </div>
      )}

      {/* Empty state */}
      {watchlist.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ color: '#2a2a2a', fontSize: 24 }}>☆</div>
          <div style={{ color: '#444', fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>
            Your watchlist is empty.
            <br />
            Use FIND to add instruments.
          </div>
          <button
            onClick={onManage}
            style={{
              background: '#1a0900',
              border: '1px solid #ff6600',
              color: '#ff6600',
              padding: '8px 20px',
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.15em',
              borderRadius: 3,
              marginTop: 8,
              minHeight: '44px',
            }}
          >
            GO TO SEARCH
          </button>
        </div>
      )}

      {/* List */}
      {watchlist.length > 0 && (
        <div style={listStyle}>
          {sorted.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: '#444',
              fontSize: 11,
            }}>
              No results for "{searchQuery}"
            </div>
          ) : (
            sorted.map((sym) => {
              const d = getData(sym);
              const pct = d?.changePct;
              return (
                <div
                  key={sym}
                  onClick={() => onOpenDetail?.(sym)}
                  style={rowStyle}
                >
                  {/* Symbol + name */}
                  <div style={symbolNameStyle}>
                    <div style={symbolStyle}>{sym}</div>
                    {d?.name && <div style={nameStyle}>{d.name}</div>}
                  </div>

                  {/* Price + change */}
                  <div style={priceChangeStyle}>
                    <div style={priceStyle}>
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div style={changeStyle(pct)}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTicker(sym);
                    }}
                    style={removeButtonStyle}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WatchlistPanelMobile);
