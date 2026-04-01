/**
 * WatchlistPanelMobile.jsx
 * Mobile-first watchlist with search, sort chips, undo toast
 * Uses shared mobile CSS primitives (.m-search, .m-chip, .m-row, .m-toast, etc.)
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
        const pctA = getData(a)?.changePct ?? 0;
        const pctB = getData(b)?.changePct ?? 0;
        return pctB - pctA;
      });
    } else if (sortBy === 'price') {
      arr.sort((a, b) => {
        const priceA = getData(a)?.price ?? 0;
        const priceB = getData(b)?.price ?? 0;
        return priceB - priceA;
      });
    }
    return arr;
  }, [filtered, sortBy, getData]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-app)', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--sp-4)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px' }}>
          Watchlist
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {watchlist.length > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255, 102, 0, 0.12)',
              color: 'var(--accent)',
              fontSize: 12, fontWeight: 600,
              borderRadius: '50%', width: 24, height: 24,
            }}>{watchlist.length}</div>
          )}
          <button onClick={onManage} style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '2px solid var(--accent)',
            background: 'none', color: 'var(--accent)',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.1)',
          }} title="Add instruments">+</button>
        </div>
      </div>

      {/* Search and Sort (only when not empty) */}
      {watchlist.length > 0 && (
        <>
          <div style={{ padding: 'var(--sp-2) var(--sp-4)', flexShrink: 0 }}>
            <input
              type="text"
              className="m-search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort chips */}
          <div style={{
            display: 'flex', gap: 8,
            padding: 'var(--sp-3) var(--sp-4)',
            flexShrink: 0, overflowX: 'auto', overflowY: 'hidden',
            scrollBehavior: 'smooth',
          }}>
            {['Added', 'Name', 'Change', 'Price'].map((label) => {
              const sortKey = label.toLowerCase();
              const isActive = sortBy === sortKey;
              return (
                <button
                  key={label}
                  className="m-chip"
                  data-active={isActive}
                  onClick={() => setSortBy(sortKey)}
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
        <div className="m-empty">
          <div className="m-empty-icon">★</div>
          <div className="m-empty-text">
            Your watchlist is empty.
            <br />
            Add instruments to track prices.
          </div>
          <button className="m-btn-primary" onClick={onManage}>
            Add Instruments
          </button>
        </div>
      ) : (
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          {sorted.length === 0 ? (
            <div style={{
              padding: 'var(--sp-8) var(--sp-4)',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
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
                  className="m-row"
                  onClick={() => onOpenDetail?.(sym)}
                  style={{ padding: '0 var(--sp-4)', minHeight: 60 }}
                >
                  {/* Symbol + name */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px', marginBottom: 3 }}>
                      {sym}
                    </div>
                    {d?.name && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.name}
                      </div>
                    )}
                  </div>

                  {/* Price + change */}
                  <div style={{ textAlign: 'right', marginRight: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', marginBottom: 3 }}>
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div style={{
                      color: pct == null ? 'var(--text-muted)' : pct >= 0 ? 'var(--price-up)' : 'var(--price-down)',
                      fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                      setUndoItem(sym);
                      removeTicker(sym);
                      undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
                    }}
                    style={{
                      width: 40, height: 40,
                      background: 'none', border: 'none',
                      color: 'var(--text-faint)', cursor: 'pointer',
                      fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0,
                      borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'color 0.15s ease',
                      WebkitTapHighlightColor: 'transparent',
                    }}
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

      {/* Undo Toast */}
      {undoItem && (
        <div className="m-toast">
          <span>{undoItem} removed</span>
          <button
            onClick={() => {
              addTicker(undoItem);
              setUndoItem(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
            style={{
              background: 'none', border: 'none',
              color: 'var(--accent)', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, padding: 0,
              minWidth: 'auto', minHeight: 'auto',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            UNDO
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(WatchlistPanelMobile);
