/**
 * WatchlistPanel.jsx
 * User-defined watchlist stored in localStorage.
 * Tickers are fetched on-demand via /api/snapshot/stocks?tickers= (ad-hoc endpoint).
 * Right-click on any row → TickerTooltip already handles tooltip;
 * the "Add to Watchlist" action lives in TickerTooltip's right-click menu.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { normalizeSymbol } from '../../utils/format';

const API = import.meta.env.VITE_API_URL || '';
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

export default function WatchlistPanel({ onTickerClick, onOpenDetail }) {
  const { watchlist, removeTicker } = useWatchlist();
  const [quotes, setQuotes]         = useState({});
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [addInput, setAddInput]     = useState('');
  const [showAdd, setShowAdd]       = useState(false);
  const { addTicker }               = useWatchlist();
  const ptRef                       = useRef(null);
  const inputRef                    = useRef(null);

  // Fetch live quotes for all watchlist symbols
  const fetchQuotes = useCallback(async () => {
    if (watchlist.length === 0) { setQuotes({}); return; }
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${API}/api/snapshot/stocks?tickers=${watchlist.join(',')}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Error fetching quotes'); return; }
      const map = {};
      (json.tickers || []).forEach(t => { map[t.ticker] = normalizePolygonQuote(t); });
      setQuotes(map);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [watchlist]);

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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid #2a2a2a', background: '#111', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#ff9900', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', flex: 1 }}>★ WATCHLIST</span>
        <span style={{ color: '#444', fontSize: '8px' }}>{watchlist.length} symbols</span>
        <button
          onClick={() => setShowAdd(s => !s)}
          style={{ background: showAdd ? '#1a0d00' : 'none', border: '1px solid #2a2a2a', color: '#ff9900', fontSize: 9, padding: '1px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}
        >+ ADD</button>
      </div>

      {/* Add ticker input */}
      {showAdd && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0, background: '#0d0d0d' }}>
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL or VALE3.SA"
            style={{
              flex: 1, background: '#0a0a0a', border: '1px solid #2a2a2a', color: '#e0e0e0',
              fontFamily: 'inherit', fontSize: 10, padding: '3px 6px', outline: 'none', borderRadius: 2,
            }}
          />
          <button type="submit" style={{ background: '#1a0d00', border: '1px solid #ff9900', color: '#ff9900', fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}>ADD</button>
          <button type="button" onClick={() => { setShowAdd(false); setAddInput(''); }} style={{ background: 'none', border: '1px solid #333', color: '#555', fontSize: 9, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 2 }}>✕</button>
        </form>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid #1a1a1a', flexShrink: 0 }}>
        {['TICKER', 'SOURCE', 'LAST', 'CHG%', ''].map((h, i) => (
          <span key={i} style={{ color: '#444', fontSize: '8px', fontWeight: 700, letterSpacing: '1px', textAlign: i >= 2 ? 'right' : 'left', paddingRight: i >= 2 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {watchlist.length === 0 ? (
          <div style={{ padding: '24px 12px', color: '#333', fontSize: 9, textAlign: 'center', lineHeight: 2 }}>
            Your watchlist is empty.<br />
            Click <span style={{ color: '#ff9900' }}>+ ADD</span> or right-click any ticker.
          </div>
        ) : loading && Object.keys(quotes).length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#444', fontSize: 10 }}>LOADING...</div>
        ) : (
          watchlist.map(sym => {
            const q = quotes[sym] || {};
            const pos = (q.changePct ?? 0) >= 0;
            // Determine asset type for right-click menu
            let assetType = 'EQUITY';
            if (/^[A-Z]{6}$/.test(sym)) assetType = sym.endsWith('USD') ? (sym.slice(0, 3) === 'BTC' || sym.slice(0, 3) === 'ETH' ? 'CRYPTO' : 'FX') : 'FX';
            if (sym.endsWith('.SA')) assetType = 'BR';

            return (
              <div
                key={sym}
                data-ticker={sym}
                data-ticker-label={sym}
                data-ticker-type={assetType}
                onClick={() => onTickerClick?.(sym)}
                onDoubleClick={() => onOpenDetail?.(sym)}
                onContextMenu={e => showInfo(e, sym, sym, assetType)}
                onTouchStart={e => { e.stopPropagation(); clearTimeout(ptRef.current); ptRef.current = setTimeout(() => onOpenDetail?.(sym), 500); }}
                onTouchEnd={() => clearTimeout(ptRef.current)}
                onTouchMove={() => clearTimeout(ptRef.current)}
                style={{ display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px', borderBottom: '1px solid #141414', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#141414'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ color: '#ff9900', fontSize: '10px', fontWeight: 700 }}>{sym}</span>
                <span style={{ color: '#333', fontSize: 9 }}></span>
                <span style={{ color: '#ccc', fontSize: '10px', textAlign: 'right', paddingRight: 4 }}>{fmt(q.price)}</span>
                <span style={{ color: pos ? '#4caf50' : '#f44336', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{fmtPct(q.changePct)}</span>
                <button
                  onClick={e => { e.stopPropagation(); removeTicker(sym); }}
                  title="Remove from watchlist"
                  style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 10, padding: 0, textAlign: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#f44336'}
                  onMouseLeave={e => e.currentTarget.style.color = '#333'}
                >✕</button>
              </div>
            );
          })
        )}
        {error && (
          <div style={{ padding: '4px 8px', color: '#aa3333', fontSize: 9, borderTop: '1px solid #1a1a1a' }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}
