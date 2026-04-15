/**
 * OptionsFlowPanel.jsx — SMART MONEY unified feed
 *
 * Answers: "What is smart money doing RIGHT NOW that I should know about?"
 *
 * Unified feed combining:
 * - Unusual options flow (sweeps, blocks, golden sweeps) with narrative descriptions
 * - Dark pool institutional block trades
 * - Congressional stock trades
 * - Market sentiment pulse (compact call/put ratio)
 *
 * Each item tells a STORY: what happened, why it matters, and bullish/bearish signal.
 * Uses combined /api/unusual-whales/panel-data endpoint.
 * Auto-refreshes every 2 minutes.
 */

import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './OptionsFlowPanel.css';

/* ── Formatting helpers ────────────────────────────────────── */

const fmtMoney = (value) => {
  if (!value && value !== 0) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
};

const timeAgo = (ts) => {
  if (!ts) return '';
  try {
    const diffMs = Date.now() - new Date(ts).getTime();
    const diffM = Math.round(diffMs / 60000);
    if (diffM < 1) return 'now';
    if (diffM < 60) return `${diffM}m ago`;
    const diffH = Math.round(diffM / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d ago`;
  } catch { return ''; }
};

const fmtShares = (n) => {
  if (!n) return '';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M shares`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K shares`;
  return `${num.toLocaleString()} shares`;
};

/* ── Build unified feed items ──────────────────────────────── */

function buildFeedItems(alerts, darkPool, congress) {
  const items = [];

  // Options flow items
  for (const a of alerts) {
    const ticker = a.symbol || a.ticker;
    if (!ticker || ticker === 'N/A') continue;

    // API returns option_type/sentiment as "call" or "put", plus boolean flags
    const rawSent = (a.sentiment || a.type || '').toLowerCase();
    const isCall = rawSent.includes('call') || rawSent.includes('bull');
    const isPut = rawSent.includes('put') || rawSent.includes('bear');
    const signal = isCall ? 'bullish' : isPut ? 'bearish' : 'neutral';

    // Use boolean flags from API (isSweep, isFloor, isMultiLeg) or fallback to type string
    const isSweep = a.isSweep || (a.type || '').toLowerCase().includes('sweep');
    const isFloor = a.isFloor || (a.type || '').toLowerCase().includes('floor');
    const isMultiLeg = a.isMultiLeg || (a.type || '').toLowerCase().includes('multi');
    const isGolden = isSweep && isFloor; // golden sweep = sweep from the floor
    const typeLabel = isGolden ? 'GOLDEN SWEEP' : isSweep ? 'SWEEP' : isFloor ? 'FLOOR' : isMultiLeg ? 'MULTI-LEG' : 'BLOCK';

    // Build narrative
    const parts = [];
    parts.push(fmtMoney(a.premium));
    parts.push(isCall ? 'call' : isPut ? 'put' : 'options');
    parts.push(typeLabel.toLowerCase());
    if (a.strike) parts.push(`at ${fmtStrike(a.strike)} strike`);
    if (a.expiry || a.expiration) parts.push(`exp ${fmtExpiry(a.expiry || a.expiration)}`);
    if (a.side) parts.push(`(${a.side} side)`);
    const narrative = parts.join(' ');

    items.push({
      type: 'options',
      ticker,
      signal,
      typeLabel,
      isGolden,
      premium: a.premium || 0,
      narrative,
      time: a.timestamp || a.date,
      sortWeight: isGolden ? 3 : isSweep ? 2 : 1,
      sortValue: a.premium || 0,
    });
  }

  // Dark pool items
  for (const dp of darkPool) {
    const ticker = dp.symbol || dp.ticker;
    if (!ticker) continue;

    const size = dp.size || dp.volume || 0;
    const price = dp.price || dp.averagePrice || 0;
    const notional = size && price ? size * price : dp.notional || 0;

    const narrative = notional > 0
      ? `${fmtShares(size)} block at $${parseFloat(price).toFixed(2)} (${fmtMoney(notional)} notional)`
      : fmtShares(size) ? `${fmtShares(size)} dark pool print`
      : 'Institutional dark pool activity';

    items.push({
      type: 'darkpool',
      ticker,
      signal: 'neutral',
      typeLabel: 'DARK POOL',
      premium: notional || size || 0,
      narrative,
      time: dp.timestamp || dp.date || dp.executed_at,
      sortWeight: 1.5,
      sortValue: notional || size || 0,
    });
  }

  // Congress items
  for (const t of congress) {
    const ticker = t.ticker;
    if (!ticker || ticker === 'N/A') continue;

    const rawTxn = (t.transactionType || t.action || '').toLowerCase();
    const isBuy = rawTxn.includes('buy') || rawTxn.includes('purchase');
    const isSell = rawTxn.includes('sell') || rawTxn.includes('sale') || rawTxn.includes('sold');
    const signal = isBuy ? 'bullish' : isSell ? 'bearish' : 'neutral';

    const member = t.representative || 'Unknown';
    const party = t.party ? ` (${t.party.charAt(0)})` : '';
    const amount = t.amountRange || fmtMoney(t.amount);
    const action = isBuy ? 'bought' : isSell ? 'sold' : 'traded';

    const narrative = `${member}${party} ${action} ${amount !== '—' ? amount : ''}`.trim();

    items.push({
      type: 'congress',
      ticker,
      signal,
      typeLabel: 'CONGRESS',
      premium: 0,
      narrative,
      time: t.transactionDate || t.date || t.filedDate,
      sortWeight: 1,
      sortValue: 0,
    });
  }

  // Sort: golden sweeps first, then by premium/notional, then recency
  items.sort((a, b) => {
    if (a.sortWeight !== b.sortWeight) return b.sortWeight - a.sortWeight;
    if (a.sortValue !== b.sortValue) return b.sortValue - a.sortValue;
    // Recency
    const ta = a.time ? new Date(a.time).getTime() : 0;
    const tb = b.time ? new Date(b.time).getTime() : 0;
    return tb - ta;
  });

  return items;
}

/* ── Filter tabs ───────────────────────────────────────────── */

const TABS = [
  { key: 'all', label: 'ALL' },
  { key: 'options', label: 'OPTIONS' },
  { key: 'darkpool', label: 'DARK POOL' },
  { key: 'congress', label: 'CONGRESS' },
];

/* ── Pulse bar (compact sentiment) ─────────────────────────── */

const PulseBar = memo(({ tide }) => {
  const callVol = tide?.callVolume || 0;
  const putVol = tide?.putVolume || 0;
  const total = callVol + putVol;
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

/* ── Feed item card ────────────────────────────────────────── */

const FeedItem = memo(({ item }) => {
  const signalCls = item.signal === 'bullish' ? 'sm-item--bull'
    : item.signal === 'bearish' ? 'sm-item--bear' : '';

  const typeCls = `sm-type-badge sm-type--${item.type}`;
  const goldenCls = item.isGolden ? ' sm-type--golden' : '';

  return (
    <div className={`sm-item ${signalCls}`}>
      <div className="sm-item-top">
        <span className="sm-item-ticker">{item.ticker}</span>
        <span className={typeCls + goldenCls}>{item.typeLabel}</span>
        <span className="sm-item-time">{timeAgo(item.time)}</span>
      </div>
      <div className="sm-item-narrative">{item.narrative}</div>
      {item.signal !== 'neutral' && (
        <div className={`sm-item-signal sm-signal--${item.signal}`}>
          {item.signal === 'bullish' ? '▲' : '▼'} {item.signal.toUpperCase()}
        </div>
      )}
    </div>
  );
});

/* ── Main panel ────────────────────────────────────────────── */

function OptionsFlowPanel() {
  const [tide, setTide] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [darkPool, setDarkPool] = useState([]);
  const [congress, setCongress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab] = useState('all');

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/unusual-whales/panel-data');
      if (!res?.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (data.tide) setTide(data.tide);
      if (data.alerts?.data) setAlerts(data.alerts.data);
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

  // Build unified feed
  const allItems = useMemo(
    () => buildFeedItems(alerts, darkPool, congress),
    [alerts, darkPool, congress]
  );

  // Filter by active tab
  const filtered = useMemo(() => {
    if (activeTab === 'all') return allItems;
    return allItems.filter(i => i.type === activeTab);
  }, [allItems, activeTab]);

  // Count per type for tab badges
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
      {/* Header — matches EditablePanelHeader standard */}
      <div className="sm-hdr">
        <span className="sm-hdr-title">OPTIONS / FLOW</span>
        <span className="sm-hdr-sub">Flow · Dark Pool · Congress</span>
        <div className="sm-hdr-right">
          <span className="sm-hdr-ts">{loading ? 'SYNCING' : ts}</span>
          <button className="sm-hdr-btn" onClick={fetchData} title="Refresh">↻</button>
        </div>
      </div>

      {/* Compact pulse bar */}
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

      {/* Feed */}
      <div className="sm-feed">
        {loading && filtered.length === 0 ? (
          <div className="sm-empty">Loading smart money data...</div>
        ) : filtered.length === 0 ? (
          <div className="sm-empty">No {activeTab === 'all' ? '' : activeTab + ' '}signals detected</div>
        ) : (
          filtered.slice(0, 30).map((item, i) => <FeedItem key={`${item.type}-${item.ticker}-${i}`} item={item} />)
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
