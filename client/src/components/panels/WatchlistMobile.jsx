/**
 * WatchlistMobile.jsx — Mobile Wave 1 Watchlist tab.
 *
 * The *real* watchlist (not the holdings view mobile previously showed),
 * per the approved mockup (particle-mobile-mockups.html · Watchlist).
 * Names via /api/snapshot/tickers, live price via PriceContext, tap →
 * detail bottom-sheet, trailing ✕ removes the name. Segmented
 * Trader/Fundamental/P&L switch changes the sort emphasis.
 */

import { useState, useEffect, useMemo } from 'react';
import { useWatchlist } from '../../context/WatchlistContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import './MobileWave1.css';

const VIEWS = [
  { id: 'trader',      label: 'Trader' },
  { id: 'fundamental', label: 'Fundamental' },
  { id: 'pnl',         label: 'P&L' },
];

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const dp = Math.abs(v) < 10 ? 4 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: dp });
}

function Row({ symbol, name, onRemove }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  const pct = q?.changePct;
  const cls = pct == null ? 'flat' : pct >= 0 ? 'u' : 'd';
  return (
    <div className="mw-row tap" onClick={() => openDetail(symbol)}>
      <div className="mw-row-l">
        <span className="mw-tk">{symbol}</span>
        {name ? <span className="mw-nm">{name}</span> : null}
      </div>
      <div className="mw-row-r">
        <span className="mw-price">{fmtPrice(q?.price)}</span>
        <span className={`mw-chg ${cls}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '·'}</span>
        <button
          className="mw-rowbtn"
          aria-label={`Remove ${symbol}`}
          onClick={(e) => { e.stopPropagation(); onRemove(symbol); }}
        >×</button>
      </div>
    </div>
  );
}

function WatchlistMobile() {
  const { watchlist, removeTicker } = useWatchlist();
  const [view, setView] = useState('trader');
  const [meta, setMeta] = useState({}); // sym → { name, changePct }

  const symbolsKey = useMemo(() => (watchlist || []).slice(0, 50).join(','), [watchlist]);

  useEffect(() => {
    if (!symbolsKey) return undefined;
    let alive = true;
    const load = () => {
      apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbolsKey)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (!alive || !j?.results) return;
          const map = {};
          for (const [sym, entry] of Object.entries(j.results)) {
            const t = entry?.ticker;
            if (!t) continue;
            map[sym] = { name: t.name || null, changePct: t.todaysChangePerc ?? null };
          }
          setMeta(map);
        })
        .catch(e => swallow(e, 'panel.watchlistMobile.snapshot'));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbolsKey]);

  const ordered = useMemo(() => {
    const list = [...(watchlist || [])];
    // Trader view leads with the biggest movers; other views keep list order.
    if (view === 'trader') {
      list.sort((a, b) => (meta[b]?.changePct ?? -Infinity) - (meta[a]?.changePct ?? -Infinity));
    }
    return list;
  }, [watchlist, meta, view]);

  return (
    <div className="mw-scroll">
      <div className="mw-seg">
        {VIEWS.map(v => (
          <button key={v.id} data-on={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </div>

      {ordered.length === 0 ? (
        <div className="mw-card"><div className="mw-empty">Your watchlist is empty — add names from Search.</div></div>
      ) : (
        <div className="mw-card mw-card--list">
          {ordered.map(sym => (
            <Row key={sym} symbol={sym} name={meta[sym]?.name} onRemove={removeTicker} />
          ))}
        </div>
      )}
    </div>
  );
}

export default WatchlistMobile;
