/**
 * OptionsFlowPanel.jsx — SMART MONEY unified feed
 *
 * CIO-note (2026-04-20): redesigned from card-based FeedItem stack
 * (one chunky card per signal) to Bloomberg-style tabular rows. One
 * row per signal. Columns: ticker, type badge, strike/detail, size,
 * signal arrow, time. Sticky pulse bar + filter tabs on top. This
 * matches the density of StockPanel/WatchlistPanel and lets a CIO
 * scan more signals per unit of screen real-estate.
 *
 * Answers: "What is smart money doing RIGHT NOW that I should know about?"
 *
 * Unified feed combining:
 * - Unusual options flow (sweeps, blocks, golden sweeps)
 * - Dark pool institutional block trades
 * - Congressional stock trades
 * - Market sentiment pulse (compact call/put ratio)
 *
 * Uses combined /api/unusual-whales/panel-data endpoint.
 * Auto-refreshes every 2 minutes.
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './OptionsFlowPanel.css';

/* ── Formatting helpers ────────────────────────────────────── */

const fmtMoney = (value) => {
  if (!value && value !== 0) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000)    return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000)        return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
};

const fmtStrike = (strike) => {
  if (!strike || strike === 0) return '';
  return `$${parseFloat(strike).toFixed(0)}`;
};

const fmtExpiry = (exp) => {
  if (!exp) return '';
  try {
    const d = new Date(exp);
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  } catch { return ''; }
};

const timeAgo = (ts) => {
  if (!ts) return '';
  try {
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffM = Math.round(diffMs / 60000);
    if (diffM < 1) return 'now';
    if (diffM < 60) return `${diffM}m`;
    const diffH = Math.round(diffM / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d`;
  } catch { return ''; }
};

const fmtShares = (n) => {
  if (!n) return '';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M sh`;
  if (num >= 1_000)     return `${(num / 1_000).toFixed(0)}K sh`;
  return `${num.toLocaleString()} sh`;
};

/* ── Build unified feed items ──────────────────────────────── */

function buildFeedItems(alerts, darkPool, congress) {
  const items = [];

  // Options flow items
  for (const a of alerts) {
    const ticker = a.symbol || a.ticker;
    if (!ticker || ticker === 'N/A') continue;

    const rawSent = (a.sentiment || a.type || '').toLowerCase();
    const isCall = rawSent.includes('call') || rawSent.includes('bull');
    const isPut  = rawSent.includes('put')  || rawSent.includes('bear');
    const signal = isCall ? 'bullish' : isPut ? 'bearish' : 'neutral';

    const isSweep    = a.isSweep    || (a.type || '').toLowerCase().includes('sweep');
    const isFloor    = a.isFloor    || (a.type || '').toLowerCase().includes('floor');
    const isMultiLeg = a.isMultiLeg || (a.type || '').toLowerCase().includes('multi');
    const isGolden   = isSweep && isFloor;
    const typeLabel = isGolden ? 'GOLDEN' : isSweep ? 'SWEEP' : isFloor ? 'FLOOR' : isMultiLeg ? 'MULTI' : 'BLOCK';

    // Tabular detail: "C $190 3/15" or "P $45 4/21"
    const side = isCall ? 'C' : isPut ? 'P' : '';
    const strike = a.strike ? fmtStrike(a.strike) : '';
    const exp = fmtExpiry(a.expiry || a.expiration);
    const detail = [side, strike, exp].filter(Boolean).join(' ');

    items.push({
      type: 'options',
      ticker,
      signal,
      typeLabel,
      isGolden,
      detail,
      size: fmtMoney(a.premium),
      sortValue: a.premium || 0,
      time: a.timestamp || a.date,
      sortWeight: isGolden ? 3 : isSweep ? 2 : 1,
    });
  }

  // Dark pool items
  for (const dp of darkPool) {
    const ticker = dp.symbol || dp.ticker;
    if (!ticker) continue;

    const size     = dp.size || dp.volume || 0;
    const price    = dp.price || dp.averagePrice || 0;
    const notional = size && price ? size * price : dp.notional || 0;

    const detail = price
      ? `@ $${parseFloat(price).toFixed(2)} · ${fmtShares(size)}`
      : fmtShares(size);

    items.push({
      type: 'darkpool',
      ticker,
      signal: 'neutral',
      typeLabel: 'DRK PL',
      detail,
      size: fmtMoney(notional || 0),
      sortValue: notional || size || 0,
      time: dp.timestamp || dp.date || dp.executed_at,
      sortWeight: 1.5,
    });
  }

  // Congress items
  for (const t of congress) {
    const ticker = t.ticker;
    if (!ticker || ticker === 'N/A') continue;

    const rawTxn = (t.transactionType || t.action || '').toLowerCase();
    const isBuy  = rawTxn.includes('buy') || rawTxn.includes('purchase');
    const isSell = rawTxn.includes('sell') || rawTxn.includes('sale') || rawTxn.includes('sold');
    const signal = isBuy ? 'bullish' : isSell ? 'bearish' : 'neutral';

    const member = t.representative || 'Unknown';
    const party  = t.party ? t.party.charAt(0) : '';
    const action = isBuy ? 'BUY' : isSell ? 'SELL' : 'TXN';
    const memberShort = member.length > 18 ? member.slice(0, 17) + '…' : member;

    items.push({
      type: 'congress',
      ticker,
      signal,
      typeLabel: `${action}`,
      detail: party ? `${memberShort} (${party})` : memberShort,
      size: t.amountRange || fmtMoney(t.amount),
      sortValue: 0,
      time: t.transactionDate || t.date || t.filedDate,
      sortWeight: 1,
    });
  }

  // Sort: golden sweeps first, then by premium/notional, then recency
  items.sort((a, b) => {
    if (a.sortWeight !== b.sortWeight) return b.sortWeight - a.sortWeight;
    if (a.sortValue  !== b.sortValue)  return b.sortValue  - a.sortValue;
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return tb - ta;
  });

  return items;
}

/* ── Filter tabs ───────────────────────────────────────────── */

const TABS = [
  { key: 'all',      label: 'ALL' },
  { key: 'options',  label: 'OPTIONS' },
  { key: 'darkpool', label: 'DARK POOL' },
  { key: 'congress', label: 'CONGRESS' },
];

/* ── Pulse bar (compact sentiment) ─────────────────────────── */

const PulseBar = memo(function PulseBar({ tide }) {
  const callVol = tide?.callVolume || 0;
  const putVol  = tide?.putVolume  || 0;
  const total   = callVol + putVol;
  const callPct = tide?.ratio
    ? Math.round(tide.ratio * 100)
    : total > 0 ? Math.round((callVol / total) * 100) : 50;

  const sentiment = tide?.sentiment?.toUpperCase() ||
    (callPct > 55 ? 'BULLISH' : callPct < 45 ? 'BEARISH' : 'NEUTRAL');
  const sentCls = sentiment === 'BULLISH' ? 'sm-pulse--bull'
    : sentiment === 'BEARISH' ? 'sm-pulse--bear' : 'sm-pulse--neut';

  return (
    <div className="sm-pulse">
      <span className="sm-pulse-label sm-pulse-label--call">C {callPct}%</span>
      <div className="sm-pulse-bar">
        <div className="sm-pulse-fill" style={{ width: `${callPct}%` }} />
      </div>
      <span className="sm-pulse-label sm-pulse-label--put">P {100 - callPct}%</span>
      <span className={`sm-pulse-tag ${sentCls}`}>{sentiment}</span>
    </div>
  );
});

/* ── Tabular row ───────────────────────────────────────────── */

const FlowRow = memo(function FlowRow({ item }) {
  const signalCls = item.signal === 'bullish' ? 'sm-row--bull'
    : item.signal === 'bearish' ? 'sm-row--bear' : '';

  const typeCls = `sm-type sm-type--${item.type}${item.isGolden ? ' sm-type--golden' : ''}`;
  const sigGlyph = item.signal === 'bullish' ? '▲'
    : item.signal === 'bearish' ? '▼' : '·';
  const sigCls = item.signal === 'bullish' ? 'sm-sig--bull'
    : item.signal === 'bearish' ? 'sm-sig--bear' : 'sm-sig--neut';

  return (
    <div className={`sm-row ${signalCls}`}>
      <span className="sm-col-ticker">{item.ticker}</span>
      <span className={typeCls}>{item.typeLabel}</span>
      <span className="sm-col-detail" title={item.detail}>{item.detail || '—'}</span>
      <span className="sm-col-size">{item.size}</span>
      <span className={`sm-col-signal ${sigCls}`}>{sigGlyph}</span>
      <span className="sm-col-time">{timeAgo(item.time)}</span>
    </div>
  );
});

/* ── Main panel ────────────────────────────────────────────── */

function OptionsFlowPanel() {
  const [tide, setTide]         = useState(null);
  const [alerts, setAlerts]     = useState([]);
  const [darkPool, setDarkPool] = useState([]);
  const [congress, setCongress] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab]   = useState('all');

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/unusual-whales/panel-data');
      if (!res?.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (data.tide) setTide(data.tide);
      if (data.alerts?.data)   setAlerts(data.alerts.data);
      if (data.darkPool?.data) setDarkPool(data.darkPool.data);
      if (data.congress?.data) setCongress(data.congress.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.warn('[SmartMoney] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const allItems = useMemo(
    () => buildFeedItems(alerts, darkPool, congress),
    [alerts, darkPool, congress]
  );

  const filtered = useMemo(() => {
    if (activeTab === 'all') return allItems;
    return allItems.filter(i => i.type === activeTab);
  }, [allItems, activeTab]);

  const counts = useMemo(() => ({
    all: allItems.length,
    options: allItems.filter(i => i.type === 'options').length,
    darkpool: allItems.filter(i => i.type === 'darkpool').length,
    congress: allItems.filter(i => i.type === 'congress').length,
  }), [allItems]);

  const ts = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="sm-panel">
      {/* Header */}
      <div className="sm-hdr">
        <span className="sm-hdr-title">OPTIONS / FLOW</span>
        <span className="sm-hdr-sub">FLOW · DARK POOL · CONGRESS</span>
        <div className="sm-hdr-right">
          <span className="sm-hdr-ts">{loading ? 'SYNCING' : ts}</span>
          <button className="sm-hdr-btn" onClick={fetchData} title="Refresh">↻</button>
        </div>
      </div>

      {/* Pulse bar */}
      <PulseBar tide={tide} />

      {/* Filter tabs */}
      <div className="sm-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`sm-tab ${activeTab === t.key ? 'sm-tab--active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="sm-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      {/* Column headers — Bloomberg-style */}
      <div className="sm-row sm-row-hdr">
        <span className="sm-col-ticker">TKR</span>
        <span className="sm-col-type">TYPE</span>
        <span className="sm-col-detail">DETAIL</span>
        <span className="sm-col-size">SIZE</span>
        <span className="sm-col-signal">SIG</span>
        <span className="sm-col-time">TIME</span>
      </div>

      {/* Tabular feed */}
      <div className="sm-feed">
        {loading && filtered.length === 0 ? (
          <div className="sm-empty">Loading smart money data…</div>
        ) : filtered.length === 0 ? (
          <div className="sm-empty">No {activeTab === 'all' ? '' : activeTab + ' '}signals detected</div>
        ) : (
          filtered.slice(0, 60).map((item, i) => (
            <FlowRow key={`${item.type}-${item.ticker}-${i}`} item={item} />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="sm-footer">
        <span className="sm-footer-src">via Unusual Whales</span>
        <span className="sm-footer-count">{counts.all} signals</span>
      </div>
    </div>
  );
}

export default memo(OptionsFlowPanel);
