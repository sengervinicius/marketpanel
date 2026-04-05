/**
 * WatchlistPanel.jsx
 * User-defined watchlist stored in localStorage.
 * Tickers are fetched on-demand via /api/snapshot/stocks?tickers= (ad-hoc endpoint).
 * Fix 4: Shows shimmer placeholder while loading quotes instead of dashes.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { normalizeSymbol } from '../../utils/format';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import '../common/Shimmer.css';
import './WatchlistPanel.css';

const fmt    = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const COLS   = '72px 1fr 72px 64px 24px';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

function normalizePolygonQuote(t) {
  const price = (t.min?.c > 0 ? t.min.c : null) ?? (t.day?.c > 0 ? t.day.c : null) ?? t.lastTrade?.p ?? t.prevDay?.c ?? null;
  return { symbol: t.ticker, price, changePct: t.todaysChangePerc ?? null, change: t.todaysChange ?? null };
}

function WatchlistPanel({ onTickerClick }) {
  const openDetail = useOpenDetail();
  const { watchlist, removeTicker } = useWatchlist();
  const [quotes, setQuotes]         = useState({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [addInput, setAddInput]     = useState('');
  const [showAdd, setShowAdd]       = useState(false);
  const { addTicker }               = useWatchlist();
  const ptRef                       = useRef(null);
  const inputRef                    = useRef(null);
  const [whySymbol, setWhySymbol]   = useState(null);
  const [whySummary, setWhySummary] = useState(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyError, setWhyError]     = useState(null);
  // Fix 4: Track per-symbol shimmer timeout state
  const [shimmerTimeouts, setShimmerTimeouts] = useState({});

  // Fetch live quotes for all watchlist symbols
  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) { setQuotes({}); return; }
    setLoading(true);
    setError(null);
    try {
      const res  = await apiFetch(`/api/snapshot/stocks?tickers=${watchlist.join(',')}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Error fetching quotes'); return; }
      const map = {};
      (json.tickers || []).forEach(t => { map[t.ticker] = normalizePolygonQuote(t); });
      setQuotes(map);
      // Fix 4: Clear shimmer timeouts for symbols that now have data
      setShimmerTimeouts(prev => {
        const updated = { ...prev };
        Object.keys(map).forEach(sym => delete updated[sym]);
        return updated;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [watchlist]);

  // Fix 4: Initialize 10-second shimmer timeout for new symbols without data
  useEffect(() => {
    const newTimeouts = {};
    watchlist.forEach(sym => {
      if (!quotes[sym] && !shimmerTimeouts[sym]) {
        newTimeouts[sym] = setTimeout(() => {
          setShimmerTimeouts(prev => {
            const updated = { ...prev };
            updated[sym] = true; // Mark as expired (show dash)
            return updated;
          });
        }, 10000);
      }
    });
    if (Object.keys(newTimeouts).length > 0) {
      setShimmerTimeouts(prev => ({ ...prev, ...newTimeouts }));
    }
    return () => {
      Object.values(newTimeouts).forEach(timer => clearTimeout(timer));
    };
  }, [watchlist, quotes, shimmerTimeouts]);

  // Re-fetch when watchlist changes, and poll every 10s
  useEffect(() => {
    fetchQuotes();
    const id = setInterval(fetchQuotes, 10_000);
    return () => clearInterval(id);
  }, [fetchQuotes]);

  // Focus input when add box opens
  useEffect(() => {
    if (showAdd) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showAdd]);

  const handleAdd = (e) => {
    e.preventDefault();
    const sym = addInput.trim().toUpperCase();
    if (sym) { addTicker(sym); setAddInput(''); setShowAdd(false); }
  };

  const handleWhyClick = async (symbol) => {
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

  return (
    <PanelShell>
      {/* Header */}
      <div className="flex-row wp-header">
        <span className="wp-header-title">★ WATCHLIST</span>
        <span className="wp-header-count">{watchlist.length} symbols</span>
        <button className={`btn wp-add-btn ${showAdd ? 'wp-add-btn-active' : ''}`}
          onClick={() => setShowAdd(s => !s)}
        >+ ADD</button>
      </div>

      {/* Add ticker input */}
      {showAdd && (
        <form onSubmit={handleAdd} className="flex-row wp-add-form">
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL or VALE3.SA"
            className="wp-add-input"
          />
          <button className="btn wp-add-submit-btn" type="submit">ADD</button>
          <button className="btn wp-add-cancel-btn" type="button" onClick={() => { setShowAdd(false); setAddInput(''); }}>✕</button>
        </form>
      )}

      {/* Column headers */}
      <div className="wp-col-header">
        {['TICKER', 'SOURCE', 'LAST', 'CHG%', ''].map((h, i) => (
          <span key={i} className={`wp-col-header-cell ${i >= 2 ? 'wp-col-header-right' : ''}`}>{h}</span>
        ))}
      </div>

      <div className="wp-rows-container">
        {watchlist.length === 0 ? (
          <EmptyState
            icon="☆"
            title="No watchlist items"
            message="Search for a ticker and add it to your watchlist to track it here."
          />
        ) : loading && Object.keys(quotes).length === 0 ? (
          <div style={{ padding: 'var(--sp-5)', textAlign: 'center', color: 'var(--text-muted)' }}>LOADING...</div>
        ) : (
          watchlist.map(sym => {
            const q = quotes[sym] || {};
            const pos = (q.changePct ?? 0) >= 0;
            // Determine asset type for right-click menu
            let assetType = 'EQUITY';
            if (/^[A-Z]{6}$/.test(sym)) assetType = sym.endsWith('USD') ? (sym.slice(0, 3) === 'BTC' || sym.slice(0, 3) === 'ETH' ? 'CRYPTO' : 'FX') : 'FX';
            if (sym.endsWith('.SA')) assetType = 'BR';

            // Fix 4: Show shimmer for price/change when data is missing and within 10s window
            const hasData = quotes[sym];
            const showShimmer = !hasData && !shimmerTimeouts[sym];
            const priceDisplay = showShimmer ? <span className="price-shimmer" /> : fmt(q.price);
            const changeDisplay = showShimmer ? <span className="price-shimmer price-shimmer--narrow" /> : fmtPct(q.changePct);

            return (
              <div
                key={sym}
                data-ticker={sym}
                data-ticker-label={sym}
                data-ticker-type={assetType}
                onClick={() => onTickerClick?.(sym)}
                onDoubleClick={() => openDetail(sym)}
                onContextMenu={e => showInfo(e, sym, sym, assetType)}
                onTouchStart={e => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => openDetail(sym), 500); }}
                onTouchEnd={() => clearTimeout(ptRef.current)}
                onTouchMove={() => clearTimeout(ptRef.current)}
                className="wp-row"
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span className="wp-row-symbol">{sym}</span>
                <span className="wp-row-source"></span>
                <span className="wp-row-price">{priceDisplay}</span>
                <span className={`wp-row-change ${pos ? 'wp-row-change-positive' : 'wp-row-change-negative'}`}>{changeDisplay}</span>
                <div className="wp-row-actions">
                  <button className="btn wp-why-btn"
                    onClick={e => { e.stopPropagation(); handleWhyClick(sym); }}
                    title="Why is this moving?"
                  >?</button>
                  <button className="btn wp-remove-btn"
                    onClick={e => { e.stopPropagation(); removeTicker(sym); }}
                    title="Remove from watchlist"
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--price-down)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                  >✕</button>
                </div>
              </div>
            );
          })
        )}
        {error && (
          <div className="wp-error-msg">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Why Popover */}
      {whySymbol && (
        <div className="wp-why-popover">
          <div className="wp-why-header">
            <span className="wp-why-title">Why is {whySymbol} moving?</span>
            <button className="btn wp-why-close"
              onClick={() => { setWhySymbol(null); setWhySummary(null); setWhyError(null); }}
            >✕</button>
          </div>
          <div className="wp-why-content">
            {whyLoading && (
              <div className="wp-why-loading">
                <span>Loading analysis...</span>
              </div>
            )}
            {whyError && (
              <div className="wp-why-error">
                <span>{whyError}</span>
                <button className="btn wp-why-retry"
                  onClick={() => handleWhyClick(whySymbol)}
                >Retry</button>
              </div>
            )}
            {whySummary && (
              <div className="wp-why-text">
                {whySummary}
              </div>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

export default memo(WatchlistPanel);
