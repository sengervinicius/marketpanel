/**
 * FuturesPanel — Regional futures/index box for the terminal home.
 *
 * #226 (2026-04-23): the CIO asked for a one-screen read on where each
 * major region is trading right now — US, London, Frankfurt, Hong Kong,
 * Tokyo, São Paulo. Where a liquid futures contract is publicly available
 * (ES/NQ/YM on CME, NIY on CME for Nikkei), we surface that; elsewhere we
 * use the cash index as the live proxy, which matches what every trading
 * desk is actually watching during the local session. Kind is labeled
 * explicitly so the user can't confuse a cash index for a futures print.
 *
 * Data: GET /api/futures (see server/routes/market/futures.js).
 *
 * Layout mirrors the other dense panels (DICurvePanel, WatchlistPanel):
 * canonical panel header, Bloomberg-style tabular matrix, source strip.
 */

import { useState, useEffect, memo, useCallback } from 'react';
import { apiFetch } from '../../utils/api';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import DesktopOnlyPlaceholder from '../common/DesktopOnlyPlaceholder';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';
import './FuturesPanel.css';

// The server-side spec is the source of truth; we just render what it sends.

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  // Large indices (DAX ~17k, HSI ~17k, Nikkei ~37k) read better without
  // decimal noise, but we keep two decimals for futures prints (ES, NQ).
  return v >= 1000 ? v.toFixed(0) : v.toFixed(2);
}
function fmtChange(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

// marketState tokens from Yahoo: PRE, REGULAR, POST, POSTPOST, PREPRE, CLOSED
function stateClass(s) {
  if (!s) return '';
  const k = String(s).toLowerCase();
  if (k === 'regular')   return 'fut-state-regular';
  if (k === 'pre')       return 'fut-state-pre';
  if (k === 'prepre')    return 'fut-state-prepre';
  if (k === 'post')      return 'fut-state-post';
  if (k === 'postpost')  return 'fut-state-postpost';
  return 'fut-state-closed';
}
function stateTitle(s, tz) {
  if (!s) return 'Session state unknown';
  const label = String(s).toUpperCase();
  return tz ? `${label} session (${tz})` : `${label} session`;
}

function FuturesPanelInner() {
  const openDetail = useOpenDetail();
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [updatedAt, setUpdated] = useState('');
  const [source, setSource]     = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch('/api/futures');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setItems(Array.isArray(json.items) ? json.items : []);
      setSource(json.source || 'Yahoo Finance');
      setUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[Futures] load error:', e.message);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // 60s poll — faster than snapshot cadence since futures move through
    // the overnight session and the CIO wants fresh prints.
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  // Mark only the first row of each region with the region label so the
  // column reads like a grouped table (Bloomberg convention).
  const seenRegions = new Set();

  // #283 — accept ticker drops from the global header search dropdown.
  // The Futures box only renders a server-controlled regional matrix
  // today; the user-meaningful behaviour for "I dropped a ticker on
  // Futures" is "open this ticker's detail view". Mirrors the
  // row-click behaviour already wired below. PanelShell-style wiring
  // would require a custom-tickers list which is out of scope here.
  const handleDropTicker = useCallback((ticker) => {
    if (ticker) openDetail(ticker, 'Futures');
  }, [openDetail]);
  const handleDrop = useCallback(makePanelDropHandler(handleDropTicker), [handleDropTicker]);

  return (
    <div
      className="fut-container"
      onDragOver={handlePanelDragOver}
      onDrop={handleDrop}
    >

      {/* Canonical panel header */}
      <div className="fut-header">
        <span className="fut-header-title">FUTURES</span>
        <span className="fut-header-status">
          {loading ? 'LOADING…' : error ? 'ERR' : updatedAt}
        </span>
      </div>

      {/* Matrix header */}
      <div className="fut-matrix-head">
        <span className="fut-col-region">REGION</span>
        <span className="fut-col-name">CONTRACT</span>
        <span className="fut-col-kind">TYPE</span>
        <span className="fut-col-state" style={{ background: 'transparent' }} />
        <span className="fut-col-price">LAST</span>
        <span className="fut-col-change">Δ</span>
        <span className="fut-col-chgpct">Δ%</span>
      </div>

      {/* Body */}
      {loading && items.length === 0 ? (
        <div className="fut-state">…</div>
      ) : error && items.length === 0 ? (
        <div className="fut-state">
          <span>NO DATA</span>
          <button className="fut-retry-btn" onClick={load}>RETRY</button>
        </div>
      ) : (
        <div className="fut-matrix">
          {items.map((it) => {
            const showRegion = !seenRegions.has(it.region);
            seenRegions.add(it.region);
            const chg    = it.change;
            const chgPct = it.changePct;
            const chgCls  = chg    == null ? '' : chg    >= 0 ? 'fut-change-pos' : 'fut-change-neg';
            const pctCls  = chgPct == null ? '' : chgPct >= 0 ? 'fut-chgpct-pos' : 'fut-chgpct-neg';
            const unavail = it.unavailable || it.price == null;

            return (
              <div
                key={it.symbol}
                className="fut-matrix-row"
                title={unavail
                  ? `${it.name} · data unavailable`
                  : `${it.name} · ${it.exchange || ''} · ${stateTitle(it.marketState, it.tz)}`}
                onClick={() => openDetail(it.symbol, 'Futures')}
              >
                <span className={`fut-col-region ${showRegion ? '' : 'fut-col-region-blank'}`}>
                  {it.regionLabel}
                </span>
                <span className="fut-col-name">{it.name}</span>
                <span className={`fut-col-kind ${it.kind === 'futures' ? 'fut-col-kind-futures' : ''}`}>
                  {it.kind === 'futures' ? 'FUT' : 'IDX'}
                </span>
                <span className={`fut-col-state ${stateClass(it.marketState)}`} />
                <span className="fut-col-price">{fmtPrice(it.price)}</span>
                <span className={`fut-col-change ${chgCls}`}>{fmtChange(chg)}</span>
                <span className={`fut-col-chgpct ${pctCls}`}>{fmtPct(chgPct)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="fut-source">
        <span className="fut-source-text">
          {source || 'Yahoo Finance'} · FUT = futures · IDX = cash index · GREEN dot = live session
        </span>
      </div>
    </div>
  );
}

/* Mobile wrapper — the dense 7-column matrix is desktop-shaped; on mobile
 * we swap in the branded "open on desktop" placeholder consistent with
 * DICurvePanel / OptionsFlowPanel. */
function FuturesPanel() {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <DesktopOnlyPlaceholder
        title="Futures"
        subtitle="US · London · Frankfurt · Hong Kong · Tokyo · São Paulo"
        features={[
          'ES / NQ / YM E-mini futures for US equity risk overnight',
          'Nikkei 225 CME futures (NIY) for Asia overnight',
          'FTSE, DAX, HSI, Bovespa cash indices as live local proxies',
          'Session-state dots: green = live, amber = pre/post',
        ]}
      />
    );
  }
  return <FuturesPanelInner />;
}

export { FuturesPanel };
export default memo(FuturesPanel);
