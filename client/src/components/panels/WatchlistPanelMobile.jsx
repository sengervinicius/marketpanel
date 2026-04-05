/**
 * WatchlistPanelMobile.jsx
 * Mobile-first watchlist with search, sort chips, undo toast
 * Uses shared mobile CSS primitives (.m-search, .m-chip, .m-row, .m-toast, etc.)
 */

import { memo, useState, useMemo, useRef, useEffect } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import './WatchlistPanelMobile.css';

function fmtPrice(v, dec = 2) {
  if (v == null) return '--';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtPct(v) {
  if (v == null) return '--';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function WatchlistPanelMobile({ onManage }) {
  const { watchlist, removeTicker, addTicker } = useWatchlist();
  const stocks = useStocksData();
  const forex = useForexData();
  const crypto = useCryptoData();
  const openDetail = useOpenDetail();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('added');
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);
  const pressTimerRef = useRef(null);
  const [whySymbol, setWhySymbol] = useState(null);
  const [whySummary, setWhySummary] = useState(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyError, setWhyError] = useState(null);

  const getData = (sym) => stocks[sym] || forex[sym] || crypto[sym] || null;

  const handleWhyPress = async (symbol) => {
    setWhySymbol(symbol);
    setWhyLoading(true);
    setWhyError(null);
    setWhySummary(null);

    try {
      const query = `Why is ${symbol} moving today? What are the latest catalysts and news driving ${symbol} price action?`;
      const res = await apiFetch('/api/search/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) {
        setWhyError(json.error || 'Failed to fetch analysis');
        return;
      }
      setWhySummary(json.summary || '');
    } catch (err) {
      setWhyError(err.message || 'Error fetching analysis');
    } finally {
      setWhyLoading(false);
    }
  };

  const handleRowTouchStart = (symbol, e) => {
    pressTimerRef.current = setTimeout(() => {
      handleWhyPress(symbol);
    }, 600);
  };

  const handleRowTouchEnd = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
    }
  };

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
    <div className="flex-col wpm-container">
      {/* Header */}
      <div className="flex-row wpm-header">
        <span className="wpm-header-title">
          Watchlist
        </span>
        <div className="flex-row wpm-header-actions">
          {watchlist.length > 0 && (
            <div className="wpm-badge">{watchlist.length}</div>
          )}
          <button className="btn flex-row wpm-manage-btn" onClick={onManage} title="Add instruments">+</button>
        </div>
      </div>

      {/* Search and Sort (only when not empty) */}
      {watchlist.length > 0 && (
        <>
          <div className="wpm-search-container">
            <input
              type="text"
              className="m-search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort chips */}
          <div className="flex-row wpm-sort-chips">
            {['Added', 'Name', 'Change', 'Price'].map((label) => {
              const sortKey = label.toLowerCase();
              const isActive = sortBy === sortKey;
              return (
                <button className="btn m-chip"
                  key={label}
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
        <div className="wpm-list-container">
          {sorted.length === 0 ? (
            <div className="wpm-list-empty-msg">
              No results for "{searchQuery}"
            </div>
          ) : (
            sorted.map((sym) => {
              const d = getData(sym);
              const pct = d?.changePct;
              return (
                <div
                  key={sym}
                  className="m-row wpm-row"
                  onClick={() => openDetail(sym)}
                  onTouchStart={(e) => handleRowTouchStart(sym, e)}
                  onTouchEnd={handleRowTouchEnd}
                  onTouchMove={handleRowTouchEnd}
                >
                  {/* Symbol + name */}
                  <div className="flex-col wpm-row-info">
                    <div className="wpm-row-symbol">
                      {sym}
                    </div>
                    {d?.name && (
                      <div className="wpm-row-name">
                        {d.name}
                      </div>
                    )}
                  </div>

                  {/* Price + change */}
                  <div className="flex-col wpm-row-data">
                    <div className="wpm-row-price">
                      {d?.price ? fmtPrice(d.price) : '--'}
                    </div>
                    <div className={`wpm-row-change ${pct == null ? 'wpm-row-change-neutral' : pct >= 0 ? 'wpm-row-change-positive' : 'wpm-row-change-negative'}`}>
                      {fmtPct(pct)}
                    </div>
                  </div>

                  {/* Remove button */}
                  <button className="btn wpm-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
                      setUndoItem(sym);
                      removeTicker(sym);
                      undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
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
        <div className="m-toast wpm-toast">
          <span className="wpm-toast-text">{undoItem} removed</span>
          <button className="btn wpm-toast-btn"
            onClick={() => {
              addTicker(undoItem);
              setUndoItem(null);
              if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
            }}
          >
            UNDO
          </button>
        </div>
      )}

      {/* Why Sheet Overlay */}
      {whySymbol && (
        <>
          <div className="wp-why-sheet-backdrop"
            onClick={() => {
              setWhySymbol(null);
              setWhySummary(null);
              setWhyError(null);
            }}
          />
          <div className="wp-why-sheet">
            <div className="wp-why-sheet-header">
              <span className="wp-why-sheet-title">Why is {whySymbol} moving?</span>
              <button className="btn wp-why-sheet-close"
                onClick={() => {
                  setWhySymbol(null);
                  setWhySummary(null);
                  setWhyError(null);
                }}
              >✕</button>
            </div>
            <div className="wp-why-sheet-content">
              {whyLoading && (
                <div className="wp-why-sheet-loading">
                  <span>Loading analysis...</span>
                </div>
              )}
              {whyError && (
                <div className="wp-why-sheet-error">
                  <span>{whyError}</span>
                  <button className="btn wp-why-sheet-retry"
                    onClick={() => handleWhyPress(whySymbol)}
                  >Retry</button>
                </div>
              )}
              {whySummary && (
                <div className="wp-why-sheet-text">
                  {whySummary}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(WatchlistPanelMobile);
