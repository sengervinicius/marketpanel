/**
 * WatchlistPanelMobile.jsx
 * Mobile-first watchlist with search + undo toast.
 *
 * #224 — sort chips removed (users wanted a cleaner list; sort defaults
 * to insertion order, and the search box is plenty). Row taps go through
 * `createTapHandlers` so a vertical scroll gesture is no longer
 * misinterpreted as a tap — the old onClick + onTouchEnd(preventDefault
 * + openDetail) combo fired openDetail for any scroll flick.
 *
 * Uses shared mobile CSS primitives (.m-search, .m-row, .m-toast, etc.)
 */

import { memo, useState, useMemo, useRef } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import { createTapHandlers } from '../../utils/tapHandlers';
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
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);
  const [whySymbol, setWhySymbol] = useState(null);
  const [whySummary, setWhySummary] = useState(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyError, setWhyError] = useState(null);

  // #224 — cache tap handlers per symbol so their internal state (touch
  // start position, moved flag, long-press timer) survives re-renders.
  // Rebuilding handlers every render would reset state mid-gesture.
  const rowHandlersRef = useRef(new Map());

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

  const getRowHandlers = (sym) => {
    let h = rowHandlersRef.current.get(sym);
    if (!h) {
      h = createTapHandlers({
        onTap: () => openDetail(sym),
        onLongPress: () => handleWhyPress(sym),
      });
      rowHandlersRef.current.set(sym, h);
    }
    return h;
  };

  // Filter by search query
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return watchlist;
    const q = searchQuery.toUpperCase();
    return watchlist.filter(sym => sym.toUpperCase().includes(q));
  }, [watchlist, searchQuery]);

  // #224 — sort chips removed. List renders in insertion order
  // (watchlist context preserves add-order), which is what users
  // expect by default. Search box covers the "find by name" case.

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

      {/* Search (only when not empty) */}
      {watchlist.length > 0 && (
        <div className="wpm-search-container">
          <input
            type="text"
            className="m-search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* List or Empty State */}
      {watchlist.length === 0 ? (
        <div className="m-empty">
          <div className="m-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
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
          {filtered.length === 0 ? (
            <div className="wpm-list-empty-msg">
              No results for "{searchQuery}"
            </div>
          ) : (
            filtered.map((sym) => {
              const d = getData(sym);
              const pct = d?.changePct;
              const handlers = getRowHandlers(sym);
              return (
                <div
                  key={sym}
                  className="m-row wpm-row"
                  {...handlers}
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
                      rowHandlersRef.current.delete(sym);
                      undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
                    }}
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
              ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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
