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
import { displayToApi } from '../../utils/format';
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

function Row({ symbol, display, name, onRemove }) {
  const q = useTickerPrice(symbol); // symbol is the API form (e.g. C:EURUSD)
  const openDetail = useOpenDetail();
  const label = display || symbol;
  const pct = q?.changePct;
  const cls = pct == null ? 'flat' : pct >= 0 ? 'u' : 'd';
  return (
    <div className="mw-row tap" onClick={() => openDetail(symbol)}>
      <div className="mw-row-l">
        <span className="mw-tk">{label}</span>
        {name ? <span className="mw-nm">{name}</span> : null}
      </div>
      <div className="mw-row-r">
        <span className="mw-price">{fmtPrice(q?.price)}</span>
        <span className={`mw-chg ${cls}`}>{pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '·'}</span>
        <button
          className="mw-rowbtn"
          aria-label={`Remove ${label}`}
          onClick={(e) => { e.stopPropagation(); onRemove(display || symbol); }}
        >×</button>
      </div>
    </div>
  );
}

function WatchlistMobile() {
  const { watchlist, removeTicker } = useWatchlist();
  const [view, setView] = useState('trader');
  const [meta, setMeta] = useState({}); // sym → { name, changePct }

  const pairs = useMemo(
    () => (watchlist || []).slice(0, 50).map(orig => ({ orig, api: displayToApi(orig) })),
    [watchlist],
  );
  const symbolsKey = useMemo(() => pairs.map(p => p.api).join(','), [pairs]);

  useEffect(() => {
    if (!symbolsKey) return undefined;
    let alive = true;
    const load = () => {
      apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbolsKey)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          if (!alive || !j?.results) return;
          const map = {};
          for (const { orig, api } of pairs) {
            const t = j.results[api]?.ticker || j.results[orig]?.ticker;
            if (t) map[orig] = { name: t.name || null, changePct: t.todaysChangePerc ?? null };
          }
          setMeta(map);
        })
        .catch(e => swallow(e, 'panel.watchlistMobile.snapshot'));
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbolsKey, pairs]);

  const ordered = useMemo(() => {
    const list = [...pairs];
    // Trader view leads with the biggest movers; other views keep list order.
    if (view === 'trader') {
      list.sort((a, b) => (meta[b.orig]?.changePct ?? -Infinity) - (meta[a.orig]?.changePct ?? -Infinity));
    }
    return list;
  }, [pairs, meta, view]);

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
          {ordered.map(({ orig, api }) => (
            <Row key={orig} symbol={api} display={orig} name={meta[orig]?.name} onRemove={removeTicker} />
          ))}
        </div>
      )}
    </div>
  );
}

export default WatchlistMobile;
