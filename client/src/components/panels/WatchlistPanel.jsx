/**
 * WatchlistPanel.jsx
 * User-defined watchlist stored in localStorage.
 * Tickers are fetched on-demand via /api/snapshot/stocks?tickers= (ad-hoc endpoint).
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { normalizeSymbol } from '../../utils/format';
import { apiFetch } from '../../utils/api';
import EmptyState from '../common/EmptyState';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';

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

function WatchlistPanel({ onTickerClick, onOpenDetail }) {
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
      const res  = await apiFetch(`/api/snapshot/stocks?tickers=${watchlist.join(',')}`);
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
    <PanelShell>
      {/* Header */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-strong)', background: 'var(--bg-elevated)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--section-watchlist)', fontSize: 'var(--font-base)', fontWeight: 700, letterSpacing: '1px', flex: 1 }}>\u2605 WATCHLIST</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>{watchlist.length} symbols</span>
        <button
          onClick={() => setShowAdd(s => !s)}
          style={{ background: showAdd ? '#1a0d00' : 'none', border: '1px solid var(--border-strong)', color: 'var(--section-watchlist)', fontSize: 9, padding: '1px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}
        >+ ADD</button>
      </div>

      {/* Add ticker input */}
      {showAdd && (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--border-default)', flexShrink: 0, background: 'var(--bg-surface)' }}>
          <input
            ref={inputRef}
            value={addInput}
            onChange={e => setAddInput(e.target.value.toUpperCase())}
            placeholder="e.g. AAPL or VALE3.SA"
            style={{
              flex: 1, background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)',
              fontFamily: 'inherit', fontSize: 'var(--font-base)', padding: '3px 6px', outline: 'none', borderRadius: 'var(--radius-sm)',
            }}
          />
          <button type="submit" style={{ background: '#1a0d00', border: '1px solid var(--section-watchlist)', color: 'var(--section-watchlist)', fontSize: 9, padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}>ADD</button>
          <button type="button" onClick={() => { setShowAdd(false); setAddInput(''); }} style={{ background: 'none', border: '1px solid var(--text-faint)', color: 'var(--text-muted)', fontSize: 9, padding: '2px 6px', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)' }}>\u2715</button>
        </form>
      )}

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        {['TICKER', 'SOURCE', 'LAST', 'CHG%', ''].map((h, i) => (
          <span key={i} style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)', fontWeight: 700, letterSpacing: '1px', textAlign: i >= 2 ? 'right' : 'left', paddingRight: i >= 2 ? 4 : 0 }}>{h}</span>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {watchlist.length === 0 ? (
          <EmptyState
            icon="\u2606"
            title="No watchlist items"
            message="Search for a ticker and add it to your watchlist to track it here."
          />
        ) : loading && Object.keys(quotes).length === 0 ? (
          <div style={{ padding: 'var(--sp-5)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-base)' }}>LOADING...</div>
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
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLS,
                  padding: '3px 8px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  alignItems: 'center',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <span style={{ color: 'var(--section-watchlist)', fontSize: 'var(--font-base)', fontWeight: 700 }}>{sym}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: 9 }}></span>
                <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-base)', textAlign: 'right', paddingRight: 4, fontVariantNumeric: 'tabular-nums' }}>{fmt(q.price)}</span>
                <span style={{ color: pos ? 'var(--price-up)' : 'var(--price-down)', fontSize: 'var(--font-base)', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(q.changePct)}</span>
                <button
                  onClick={e => { e.stopPropagation(); removeTicker(sym); }}
                  title="Remove from watchlist"
                  style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: 'var(--font-base)', padding: 0, textAlign: 'center', transition: 'color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--price-down)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
                >\u2715</button>
              </div>
            );
          })
        )}
        {error && (
          <div style={{ padding: '4px 8px', color: '#aa3333', fontSize: 9, borderTop: '1px solid var(--border-default)' }}>
            \u26A0 {error}
          </div>
        )}
      </div>
    </PanelShell>
  );
}

export default memo(WatchlistPanel);
