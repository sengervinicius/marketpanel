/**
 * MoversPanel.jsx — H2 Wave 1: top movers home panel.
 *
 * Tabs: GAINERS / LOSERS / ACTIVES, with a US / BR exchange toggle.
 * Data: GET /api/market/movers?tab=…&exchange=… (see routes/market/movers.js)
 *   US — Polygon snapshot movers (gainers/losers native, actives by volume)
 *   BR — the /snapshot/brazil universe ranked by chg% (or volume) via Yahoo
 *
 * Conventions follow FuturesPanel (apiFetch + refresh interval + FeedStatus)
 * and the shared PriceRow/panelColumns row patterns with Sparkline v2.
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useFeedStatus } from '../../context/FeedStatusContext';
import PanelChrome from '../common/PanelChrome';
import { PriceRow } from '../common/PriceRow';
import { PanelTabRow } from './_shared';
import { useSparklineData } from '../../hooks/useSparklineData';
import { COLS_MOVERS_SPARK } from '../../utils/panelColumns';
import { isUsMarketOpen, isB3MarketOpen } from '../../utils/marketHours';
import './MoversPanel.css';
import { openDetailWindow } from '../../utils/detailWindow';

const TABS = [
  { id: 'gainers', label: 'GAINERS' },
  { id: 'losers',  label: 'LOSERS' },
  { id: 'actives', label: 'ACTIVES' },
];
const EXCHANGES = ['US', 'BR'];
const REFRESH_MS = 60_000;
const LIMIT = 20;

function MoversPanel({ onTickerClick, embedded = false }) {
  const openDetail = useOpenDetail();
  const { getBadge } = useFeedStatus();
  const [tab, setTab]           = useState('gainers');
  // Polish W2 item 4a — the default exchange follows the OPEN market:
  // B3 trading while the US is closed → start on BR. Evaluated once on
  // mount; every later change is a manual override the panel respects.
  const [exchange, setExchange] = useState(() =>
    (isB3MarketOpen() && !isUsMarketOpen()) ? 'BR' : 'US');
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [note, setNote]         = useState(null);
  const [sessionLabel, setSessionLabel] = useState(null);
  const [updatedAt, setUpdated] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch(`/api/market/movers?tab=${tab}&exchange=${exchange}&limit=${LIMIT}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (json.error && !(json.data || []).length) throw new Error(json.error);
      setRows(Array.isArray(json.data) ? json.data : []);
      setNote(json.note || null);
      // 4b — server tags stale-session data (evening/weekend fallback).
      setSessionLabel(json.session === 'last' ? (json.sessionLabel || 'LAST SESSION') : null);
      setUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.warn('[Movers] load error:', e.message);
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab, exchange]);

  useEffect(() => {
    setLoading(true);
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [load]);

  // Sparkline v2 where data allows — /api/history resolves plain US
  // symbols and .SA-suffixed B3 symbols.
  const sparkTickers = useMemo(
    () => rows.map(r => (exchange === 'BR' ? `${r.symbol}.SA` : r.symbol)),
    [rows, exchange],
  );
  const sparklines = useSparklineData(sparkTickers);

  const badge = getBadge('stocks');

  const exchToggle = (
    <div className="mv-exch-toggle">
      {EXCHANGES.map(ex => (
        <button
          key={ex}
          type="button"
          className={`mv-exch-btn${exchange === ex ? ' mv-exch-btn--active' : ''}`}
          onClick={() => setExchange(ex)}
        >{ex}</button>
      ))}
    </div>
  );

  return (
    <div className="mv-panel">
      {embedded ? (
        <div className="mpp-subhead">
          <span className="mpp-subhead-label">MOVERS</span>
          <span className="mpp-subhead-meta">
            <span className="mpp-subhead-src">{exchange === 'US' ? 'POLYGON \u00b7 US' : 'YAHOO \u00b7 B3'}</span>
            {exchToggle}
          </span>
        </div>
      ) : (
        <PanelChrome
          title="MOVERS"
          subtitle={exchange === 'US'
            ? <span title={"Filtered universe: \u2265$5 \u00b7 \u2265$50M traded ($100M actives)"}>POLYGON &middot; US EQUITIES</span>
            : <span title={"Curated B3 universe \u00b7 price \u2265 R$1"}>YAHOO &middot; B3</span>}
          badge={<span className="panel-chrome-badge" style={{ color: badge.color, background: badge.bg }}>{badge.text}</span>}
          timestamp={loading ? 'LOADING\u2026' : error ? 'ERR' : updatedAt}
          actions={exchToggle}
        />
      )}

      <PanelTabRow value={tab} onChange={setTab} items={TABS} equal />

      {sessionLabel && rows.length > 0 && (
        <div className="mv-session-strip">
          <span className="mv-session-chip">{sessionLabel}</span>
        </div>
      )}

      <div className="mv-body">
        {loading && rows.length === 0 ? (
          <div className="mv-state">…</div>
        ) : rows.length === 0 ? (
          <div className="mv-state">
            <span>{note || (error ? 'Couldn’t load movers — tap retry.' : 'NO DATA')}</span>
            <button className="mv-retry-btn" onClick={() => { setLoading(true); load(); }}>RETRY</button>
          </div>
        ) : (
          rows.map((r, i) => {
            const spark = sparklines[exchange === 'BR' ? `${r.symbol}.SA` : r.symbol];
            return (
              <PriceRow
                key={r.symbol}
                symbol={r.symbol}
                /* wave-nov item 1 — real company name in the subtext (same
                   pattern as the other panels), rank preserved as a prefix.
                   Server now merges names for US movers (Polygon lacks them). */
                name={r.name ? `#${i + 1} · ${r.name}` : `#${i + 1}`}
                price={r.price}
                changePct={r.changePct}
                decimals={2}
                columns={COLS_MOVERS_SPARK}
                volume={r.volume ?? null}
                sparklineData={spark}
                onClick={() => onTickerClick?.(r.symbol)}
                onDoubleClick={() => openDetailWindow(exchange === 'BR' ? `${r.symbol}.SA` : r.symbol, 'Movers')}
                draggable
                dragData={{ symbol: exchange === 'BR' ? `${r.symbol}.SA` : r.symbol }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export { MoversPanel };
export default memo(MoversPanel);
