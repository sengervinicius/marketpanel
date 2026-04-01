/**
 * WatchlistPanelMobile.jsx
 * Premium mobile-first watchlist redesign
 * Clean header, smooth search/filter, 60px rows, undo toast positioned above tab bar
 */

import { memo, useState, useMemo, useRef, useEffect } from 'react';
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
  const { watchlist, removeTicker, addTicker } = useWatchlist();
  const stocks = useStocksData();
  const forex = useForexData();
  const crypto = useCryptoData();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('added');
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);

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
    if (sortBy === 'name') {
      arr.sort((a, b) => a.localeCompare(b));
    } else if (sortBy === 'change') {
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
    // 'added' is default (no sort)
    return arr;
  }, [filtered, sortBy, getData]);

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#060606',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  };

  // Header: "Watchlist" title, count badge, orange "+" button
  const headerStyle = {
    padding: '16px 16px',
    borderBottom: '1px solid #111',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const titleStyle = {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: '-0.3px',
  };

  const headerRightStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  };

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 102, 0, 0.12)',
    color: '#ff6600',
    fontSize: 12,
    fontWeight: '600',
    borderRadius: '50%',
    width: 24,
    height: 24,
  };

  const addButtonStyle = {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '2px solid #ff6600',
    background: 'none',
    color: '#ff6600',
    fontSize: 20,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.1)',
  };

  // Search input: pill-shaped, subtle, icon inside
  const searchContainerStyle = {
    padding: '8px 16px',
    flexShrink: 0,
  };

  const searchInputStyle = {
    width: '100%',
    padding: '10px 14px 10px 36px',
    backgroundColor: '#0f0f0f',
    border: '1px solid #1a1a1a',
    borderRadius: '20px',
    color: '#ccc',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22%23666%22 stroke-width=%221.5%22 stroke-linecap=%22round%22%3E%3Ccircle cx=%227%22 cy=%227%22 r=%225%22/%3E%3Cline x1=%2211%22 y1=%2211%22 x2=%2215%22 y2=%2215%22/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: '10px center',
    backgroundSize: '16px',
  };

  // Sort chips: horizontal row, pill buttons, orange when active
  const sortContainerStyle = {
    display: 'flex',
    gap: '8px',
    padding: '12px 16px',
    flexShrink: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollBehavior: 'smooth',
  };

  const sortChipStyle = (isActive) => ({
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: isActive ? '600' : '500',
    backgroundColor: isActive ? 'rgba(255, 102, 0, 0.15)' : 'transparent',
    border: `1px solid ${isActive ? '#ff6600' : '#1a1a1a'}`,
    color: isActive ? '#ff6600' : '#666',
    cursor: 'pointer',
    fontFamily: 'inherit',
    borderRadius: '20px',
    flexShrink: 0,
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.08)',
  });

  // List: 60px min-height rows
  const listStyle = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    WebkitOverflowScrolling: 'touch',
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    borderBottom: '1px solid #111',
    cursor: 'pointer',
    minHeight: 60,
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s ease',
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.08)',
  };

  const symbolNameStyle = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };

  const symbolStyle = {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: '-0.2px',
    marginBottom: 4,
  };

  const nameStyle = {
    color: '#999',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const priceChangeStyle = {
    textAlign: 'right',
    marginRight: 12,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };

  const priceStyle = {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
    marginBottom: 4,
  };

  const changeStyle = (changePct) => ({
    color: changePct == null ? '#666' : changePct >= 0 ? '#00cc44' : '#ff3b30',
    fontSize: 11,
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
  });

  const removeButtonStyle = {
    width: 36,
    height: 36,
    background: 'none',
    border: 'none',
    color: '#333',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s ease',
    WebkitTapHighlightColor: 'transparent',
  };

  // Empty state: large star icon, friendly message, orange button
  const emptyStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: '20px',
  };

  const emptyIconStyle = {
    fontSize: 48,
    color: '#1a1a1a',
  };

  const emptyTextStyle = {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 1.5,
  };

  const emptyButtonStyle = {
    background: '#ff6600',
    border: 'none',
    color: '#000',
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    borderRadius: '8px',
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'transparent',
  };

  // Undo toast: bottom: 70px (above tab bar)
  const undoToastStyle = {
    position: 'fixed',
    bottom: '70px',
    left: '16px',
    right: '16px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #222',
    borderRadius: '8px',
    padding: '12px 16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    fontSize: 13,
    color: '#ccc',
    fontFamily: 'inherit',
    zIndex: 1000,
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    animation: 'slideUp 0.3s ease',
  };

  const undoButtonStyle = {
    background: 'none',
    border: 'none',
    color: '#ff6600',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
    minWidth: 'auto',
    minHeight: 'auto',
    WebkitTapHighlightColor: 'transparent',
  };

  const noResultsStyle = {
    padding: '32px 16px',
    textAlign: 'center',
    color: '#666',
    fontSize: 13,
  };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div style={headerStyle}>
        <span style={titleStyle}>Watchlist</span>
        <div style={headerRightStyle}>
          {watchlist.length > 0 && (
            <div style={badgeStyle}>{watchlist.length}</div>
          )}
          <button onClick={onManage} style={addButtonStyle} title="Add instruments">
            +
          </button>
        </div>
      </div>

      {/* Search and Sort (only when not empty) */}
      {watchlist.length > 0 && (
        <>
          {/* Search input: pill-shaped */}
          <div style={searchContainerStyle}>
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={searchInputStyle}
            />
          </div>

          {/* Sort chips */}
          <div style={sortContainerStyle}>
            {['Added', 'Name', 'Change', 'Price'].map((label) => {
              const sortKey = label.toLowerCase();
              const isActive = sortBy === sortKey;
              return (
                <button
                  key={label}
                  onClick={() => setSortBy(sortKey)}
                  style={sortChipStyle(isActive)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* List or Empty State */}
      {watchlist.length === 0 ? (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>★</div>
          <div style={emptyTextStyle}>
            Your watchlist is empty.
            <br />
            Add instruments to track prices.
          </div>
          <button onClick={onManage} style={emptyButtonStyle}>
            Add Instruments
          </button>
        </div>
      ) : (
        <div style={listStyle}>
          {sorted.length === 0 ? (
            <div style={noResultsStyle}>
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
                  {/* Symbol + name (left) */}
                  <div style={symbolNameStyle}>
                    <div style={symbolStyle}>{sym}</div>
                    {d?.name && <div style={nameStyle}>{d.name}</div>}
                  </div>

                  {/* Price + change (right) */}
                  <div style={priceChangeStyle}>
                    <div style={priceStyle}>
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div style={changeStyle(pct)}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Remove button (far right) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                      setUndoItem(sym);
                      removeTicker(sym);
                      undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
                    }}
                    style={removeButtonStyle}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Undo Toast (above tab bar at bottom: 70px) */}
      {undoItem && (
        <div style={undoToastStyle}>
          <span>{undoItem} removed</span>
          <button
            onClick={() => {
              addTicker(undoItem);
              setUndoItem(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
            style={undoButtonStyle}
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(WatchlistPanelMobile);
