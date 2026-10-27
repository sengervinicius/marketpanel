/**
 * OddsPanel.jsx — #292 F3: "MARKETS THAT MATTER".
 *
 * Replaces the odds half of Movers & Predictions. Finance / policy /
 * geopolitics markets only (the aggregator's FOR YOU feed, sports hard-
 * excluded), each with the current probability, the 24h move in points
 * and a 7-day probability chart from the Polymarket CLOB. Sorted by what
 * moved, so the rows at the top are the ones worth reading.
 *
 * Data:  GET /api/predictions/for-you?limit=24
 *        GET /api/predictions/history/:id?interval=1w   (per visible row)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import PanelChrome from '../common/PanelChrome';
import PanelState from '../common/PanelState';
import { PanelTabRow } from './_shared/PanelTabRow';
import Sparkline from '../common/Sparkline';
import './OddsPanel.css';

const REFRESH_MS = 120_000;
const TABS = [
  { id: 'all',      label: 'ALL' },
  { id: 'fed',      label: 'FED' },
  { id: 'politics', label: 'POLITICS' },
  { id: 'geo',      label: 'GEO' },
  { id: 'crypto',   label: 'CRYPTO' },
  { id: 'brazil',   label: 'BRAZIL' },
];
const TAB_CATS = {
  fed:      ['fed-rates', 'inflation', 'economy'],
  politics: ['politics'],
  geo:      ['geopolitics'],
  crypto:   ['crypto'],
};
const BRAZIL_RE = /\b(brazil|brasil|lula|bolsonaro|tarc[ií]sio|ibovespa|selic|real\b|petrobras|b3\b)/i;

const fmtPct = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const fmtPts = (d) => (d == null ? '' : `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d * 100))}pt`);

export default function OddsPanel({ embedded = false }) {
  const [markets, setMarkets] = useState([]);
  const [hist, setHist] = useState({});
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asOf, setAsOf] = useState(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = async () => {
    try {
      const r = await apiFetch('/api/predictions/for-you?limit=24');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!mounted.current) return;
      const list = Array.isArray(j.markets) ? j.markets : [];
      setMarkets(list);
      setAsOf(j.lastRefresh || Date.now());
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e.message || 'failed');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  useEffect(() => { load(); const id = setInterval(load, REFRESH_MS); return () => clearInterval(id); }, []);

  const rows = useMemo(() => {
    let list = markets.filter(m => m.category !== 'sports');
    if (tab === 'brazil') list = list.filter(m => BRAZIL_RE.test(m.title || ''));
    else if (TAB_CATS[tab]) list = list.filter(m => TAB_CATS[tab].includes(m.category));
    // What moved first; ties by liquidity.
    return list
      .map(m => ({ ...m, move: m.change1d != null ? Math.abs(m.change1d) : 0 }))
      .sort((a, b) => b.move - a.move || (b.volume24h || 0) - (a.volume24h || 0))
      .slice(0, 8);
  }, [markets, tab]);

  // History for the visible rows (cached server-side for 5 min).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const m of rows) {
        if (cancelled || hist[m.id] !== undefined) continue;
        try {
          const r = await apiFetch(`/api/predictions/history/${encodeURIComponent(m.id)}?interval=1w`);
          const j = r.ok ? await r.json() : null;
          if (cancelled) return;
          setHist(prev => ({ ...prev, [m.id]: Array.isArray(j?.points) ? j.points.map(p => p.p) : [] }));
        } catch (e) { swallow(e, 'OddsPanel.history'); if (!cancelled) setHist(prev => ({ ...prev, [m.id]: [] })); }
        await new Promise(res => setTimeout(res, 80));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const body = loading && markets.length === 0
    ? <PanelState kind="loading" compact />
    : error && markets.length === 0
      ? <PanelState kind="error" title="ODDS UNAVAILABLE" detail={error} onRetry={() => { setLoading(true); load(); }} compact />
      : rows.length === 0
        ? <PanelState kind="empty" title="NO MARKETS IN THIS VIEW" compact />
        : (
          <div className="odds-list">
            {rows.map((m) => {
              const series = hist[m.id];
              const d = m.change1d;
              const dir = d == null ? 0 : d > 0.005 ? 1 : d < -0.005 ? -1 : 0;
              return (
                <a key={m.id} className="odds-row" href={m.url || '#'} target="_blank" rel="noreferrer" title={`${m.title}\n${m.source} · 24h vol $${Math.round(m.volume24h || 0).toLocaleString()}`}>
                  <span className="odds-title">{m.title}</span>
                  <span className="odds-spark">
                    {series && series.length >= 2
                      ? <Sparkline data={series} width={56} height={16} baseline="first" />
                      : <span className="odds-spark-empty">{series ? '' : '…'}</span>}
                  </span>
                  <span className="odds-prob">{fmtPct(m.probability)}</span>
                  <span className={`odds-move${dir > 0 ? ' odds-move--up' : dir < 0 ? ' odds-move--down' : ''}`}>{fmtPts(d)}</span>
                </a>
              );
            })}
          </div>
        );

  return (
    <div className="odds-panel">
      {!embedded && (
        <PanelChrome
          title="MARKETS THAT MATTER"
          subtitle="POLYMARKET · KALSHI · 7D ODDS"
          updatedAt={asOf}
          source="polymarket"
        />
      )}
      <PanelTabRow value={tab} onChange={setTab} items={TABS} />
      {body}
    </div>
  );
}
