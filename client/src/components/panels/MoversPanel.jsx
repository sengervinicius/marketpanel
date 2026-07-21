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
import { COLS_STANDARD_SPARK } from '../../utils/panelColumns';
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

function fmtVolume(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return String(v);
}

function MoversPanel({ onTickerClick }) {
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

  return (
    <div className="mv-panel">
      <PanelChrome
        title="MOVERS"
        subtitle={exchange === 'US'
          // Data-quality: server pre-filters the ranking universe; the
          // tooltip documents it without cluttering the chrome.
          ? <span title={"Filtered universe: \u2265$5 \u00b7 \u2265$50M traded ($100M actives)"}>POLYGON &middot; US EQUITIES</span>
          : <span title={"Curated B3 universe \u00b7 price \u2265 R$1"}>YAHOO &middot; B3</span>}
        badge={<span className="panel-chrome-badge" style={{ color: badge.color, background: badge.bg }}>{badge.text}</span>}
        timestamp={loading ? 'LOADING…' : error ? 'ERR' : updatedAt}
        actions={
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
        }
      />

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
            <span>{note || error || 'NO DATA'}</span>
            <button className="mv-retry-btn" onClick={() => { setLoading(true); load(); }}>RETRY</button>
          </div>
        ) : (
          rows.map((r, i) => {
            const spark = sparklines[exchange === 'BR' ? `${r.symbol}.SA` : r.symbol];
            return (
              <PriceRow
                key={r.symbol}
                symbol={r.symbol}
                name={r.name || (tab === 'actives' && r.volume != null ? `VOL ${fmtVolume(r.volume)}` : `#${i + 1}`)}
                price={r.price}
                changePct={r.changePct}
                decimals={2}
                columns={COLS_STANDARD_SPARK}
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
