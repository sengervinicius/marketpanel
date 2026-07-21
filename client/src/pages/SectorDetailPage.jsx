/**
 * SectorDetailPage.jsx — FEAT-2: market map drill-down window.
 * Route: /sector/:etf  (opened via window.open from the MARKET MAP panel;
 * also reachable as /?sector=XLK — see the query bridge in main.jsx).
 *
 * Lists ALL configured constituents of the SPDR sector ETF with an
 * approximate day contribution = approx index weight × day move, sorted
 * by contribution. Double-click a row → that ticker's own detail window
 * (consistent with FEAT-1); single click does nothing.
 *
 * Auth applies: like InstrumentDetailPage, this route only mounts after
 * the auth check passes (see main.jsx AppShell).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import {
  getSectorConstituents, SECTOR_NAMES,
} from '../config/sectorConstituents';
import { openDetailWindow } from '../utils/detailWindow';
import { useTickerClicksFactory } from '../hooks/useTickerClicks';
import './SectorDetailPage.css';

const REFRESH_MS = 60_000;

const fmtNum = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
// Contribution in index percentage points (weight% × move% / 100).
const fmtContrib = (n) => (n == null || !Number.isFinite(n))
  ? '—'
  : (n >= 0 ? '+' : '') + n.toFixed(3);

export default function SectorDetailPage() {
  const { etf } = useParams();
  const tickerClicks = useTickerClicksFactory(); // wave-nov item 5
  const { user } = useAuth();
  const sym = String(etf || '').toUpperCase();
  const constituents = useMemo(() => getSectorConstituents(sym), [sym]);
  const sectorName = SECTOR_NAMES[sym] || null;

  const [quotes, setQuotes] = useState({});   // SYM → { price, changePct, name }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!constituents.length) { setLoading(false); return; }
    try {
      const symbols = [sym, ...constituents.map(c => c.symbol)];
      const res = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbols.join(','))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const map = {};
      for (const [s, entry] of Object.entries(json?.results || {})) {
        const t = entry?.ticker;
        if (!t) continue;
        map[s] = {
          price: t.min?.c ?? t.day?.c ?? null,
          changePct: Number.isFinite(t.todaysChangePerc) ? t.todaysChangePerc : null,
          name: t.name || null,
        };
      }
      setQuotes(map);
      setError(null);
    } catch (e) {
      setError(e.message || 'quote fetch failed');
    } finally {
      setLoading(false);
    }
  }, [sym, constituents]);

  useEffect(() => {
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    document.title = `${sym} — ${sectorName || 'Sector'} · Particle`;
  }, [sym, sectorName]);

  const rows = useMemo(() => constituents
    .map(({ symbol, weight }) => {
      const q = quotes[symbol] || {};
      const contrib = (weight != null && Number.isFinite(q.changePct))
        ? (weight / 100) * q.changePct
        : null;
      return { symbol, weight, contrib, ...q };
    })
    .sort((a, b) => (b.contrib ?? -Infinity) - (a.contrib ?? -Infinity)),
  [constituents, quotes]);

  const etfQuote = quotes[sym];
  const etfPct = etfQuote?.changePct ?? null;
  const etfPos = (etfPct ?? 0) >= 0;

  if (!constituents.length) {
    return (
      <div className="secp-page">
        <div className="secp-empty">Unknown sector "{sym}". Try XLK, XLF, XLV, XLE, XLI, XLY, XLP, XLU, XLB, XLRE or XLC.</div>
      </div>
    );
  }

  return (
    <div className="secp-page">
      {/* Minimal pop-out chrome: logo + sector + close hint (mirrors InstrumentDetailPage) */}
      <div className="secp-chrome">
        <span className="secp-logo">PARTICLE</span>
        <span className="secp-chrome-label">SECTOR</span>
        <span className="secp-chrome-sym">{sym}</span>
        <div className="secp-chrome-spacer" />
        {user && <span className="secp-chrome-user">{user.username?.toUpperCase()}</span>}
        <button className="secp-close" title="Close this window" onClick={() => window.close()}>CLOSE</button>
      </div>

      {/* Sector header: name + ETF + day% */}
      <div className="secp-head">
        <span className="secp-head-name">{(sectorName || sym).toUpperCase()}</span>
        <span className="secp-head-etf">{sym}</span>
        <span className={`secp-head-chg ${etfPos ? 'secp-up' : 'secp-dn'}`}>{fmtPct(etfPct)}</span>
        {error && <span className="secp-head-err" title={error}>STALE</span>}
      </div>

      <div className="secp-table" role="table" aria-label={`${sectorName || sym} constituents`}>
        <div className="secp-thead" role="row">
          <span>TICKER</span>
          <span>NAME</span>
          <span className="secp-num">LAST</span>
          <span className="secp-num">1D%</span>
          <span className="secp-num" title="approx index weight × day move (index pct-points); weights are rough public approximations of the top-10 holdings">CONTRIB (approx)</span>
        </div>
        {rows.map((r) => {
          const pos = (r.changePct ?? 0) >= 0;
          const cpos = (r.contrib ?? 0) >= 0;
          return (
            <div
              key={r.symbol}
              className="secp-row"
              role="row"
              title={`${r.symbol} · click → detail here, double-click → new window${r.weight != null ? ` · ~${r.weight.toFixed(1)}% of ${sym}` : ''}`}
              /* wave-nov item 5 — this page IS a pop-out window (no in-app
                 overlay available), so "single click → detail" navigates
                 THIS window to #/detail/:sym (browser Back returns to the
                 sector list); double-click still spawns a fresh window. */
              style={{ cursor: 'pointer' }}
              {...tickerClicks(r.symbol, {
                onSingle: (t) => { window.location.hash = `#/detail/${encodeURIComponent(t)}`; },
                onDouble: (t) => openDetailWindow(t),
              })}
            >
              <span className="secp-sym">{r.symbol}</span>
              <span className="secp-name">{loading && !r.name ? '…' : (r.name || '—')}</span>
              <span className="secp-num">{fmtNum(r.price)}</span>
              <span className={`secp-num ${pos ? 'secp-up' : 'secp-dn'}`}>{fmtPct(r.changePct)}</span>
              <span className={`secp-num ${cpos ? 'secp-up' : 'secp-dn'}`}>{fmtContrib(r.contrib)}</span>
            </div>
          );
        })}
      </div>

      <div className="secp-foot">
        CONTRIB ≈ approx. index weight × 1D move (pct-points) · top-10 SPDR holdings, weights hardcoded approximations · dbl-click row → instrument window
      </div>
    </div>
  );
}
