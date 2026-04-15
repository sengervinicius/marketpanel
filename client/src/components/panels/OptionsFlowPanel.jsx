/**
 * OptionsFlowPanel.jsx — Options - Market Intel panel
 *
 * Answers: "Where is smart money positioning right now?"
 *
 * Three sections:
 * 1. CALL/PUT TIDE — overall market options sentiment bar
 * 2. UNUSUAL FLOW — large/unusual options trades (sweeps, blocks, golden sweeps)
 * 3. CONGRESS — politician stock trades (buy/sell with amounts)
 *
 * Uses combined /api/unusual-whales/panel-data endpoint for single fetch.
 * Auto-refreshes every 2 minutes.
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './OptionsFlowPanel.css';

const formatPremium = (value) => {
  if (!value && value !== 0) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === 0) return '—';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
};

const formatStrike = (strike) => {
  if (!strike || strike === 0) return '';
  return `$${parseFloat(strike).toFixed(0)}`;
};

const formatExpiry = (exp) => {
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
    if (diffM < 60) return `${diffM}m`;
    const diffH = Math.round(diffM / 60);
    if (diffH < 24) return `${diffH}h`;
    return `${Math.round(diffH / 24)}d`;
  } catch { return ''; }
};

function OptionsFlowPanel() {
  const [tide, setTide] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [congress, setCongress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab] = useState('flow');

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/unusual-whales/panel-data');
      if (!res?.ok) throw new Error('fetch failed');
      const data = await res.json();

      if (data.tide) setTide(data.tide);
      if (data.alerts?.data) setAlerts(data.alerts.data);
      if (data.congress?.data) setCongress(data.congress.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.warn('[OptionsFlowPanel] Fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // Tide computation — handle multiple field patterns
  const callVol = tide?.callVolume || 0;
  const putVol = tide?.putVolume || 0;
  const totalVol = callVol + putVol;
  const callPct = tide?.ratio
    ? Math.round(tide.ratio * 100)
    : totalVol > 0
      ? Math.round((callVol / totalVol) * 100)
      : null;
  const putPct = callPct != null ? 100 - callPct : null;

  const sentiment = tide?.sentiment?.toUpperCase() ||
    (callPct > 55 ? 'BULLISH' : callPct < 45 ? 'BEARISH' : 'NEUTRAL');
  const sentColor = sentiment === 'BULLISH' ? 'var(--price-up)'
    : sentiment === 'BEARISH' ? 'var(--price-down)'
    : 'var(--text-muted)';

  const ts = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="ofp">
      {/* Header */}
      <div className="ofp-hdr">
        <div className="ofp-hdr-left">
          <span className="ofp-hdr-title">OPTIONS</span>
          <span className="ofp-hdr-subtitle">Market Intel</span>
        </div>
        <div className="ofp-hdr-right">
          <span className="ofp-hdr-ts">{loading ? 'SYNCING...' : ts}</span>
          <button className="ofp-hdr-btn" onClick={fetchData} title="Refresh">↻</button>
        </div>
      </div>

      {/* Tide bar */}
      <div className="ofp-tide">
        <div className="ofp-tide-bar-wrap">
          <span className="ofp-tide-lbl ofp-tide-lbl--call">
            CALLS {callPct ?? '—'}%
          </span>
          <div className="ofp-tide-bar">
            <div className="ofp-tide-calls" style={{ width: `${callPct ?? 50}%` }} />
          </div>
          <span className="ofp-tide-lbl ofp-tide-lbl--put">
            PUTS {putPct ?? '—'}%
          </span>
        </div>
        <span className="ofp-tide-sentiment" style={{ color: sentColor }}>
          {sentiment}
        </span>
      </div>

      {/* Tabs */}
      <div className="ofp-tabs">
        <button
          className={`ofp-tab ${activeTab === 'flow' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          UNUSUAL FLOW{alerts.length > 0 ? ` (${alerts.length})` : ''}
        </button>
        <button
          className={`ofp-tab ${activeTab === 'congress' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('congress')}
        >
          CONGRESS{congress.length > 0 ? ` (${congress.length})` : ''}
        </button>
      </div>

      {/* Content */}
      <div className="ofp-body">
        {activeTab === 'flow' ? (
          <FlowTab alerts={alerts} loading={loading} />
        ) : (
          <CongressTab trades={congress} loading={loading} />
        )}
      </div>

      {/* Footer */}
      <div className="ofp-footer">
        <span className="ofp-footer-src">via Unusual Whales</span>
      </div>
    </div>
  );
}

/** Unusual options flow tab */
function FlowTab({ alerts, loading }) {
  if (alerts.length === 0) {
    return (
      <div className="ofp-empty">
        {loading ? 'Loading flow data...' : 'No unusual flow detected'}
      </div>
    );
  }

  return (
    <>
      <div className="ofp-row ofp-row--hdr ofp-row--flow">
        <span className="ofp-col-tick">TICKER</span>
        <span className="ofp-col-cptype">C/P</span>
        <span className="ofp-col-strike">STRIKE</span>
        <span className="ofp-col-prem">PREMIUM</span>
        <span className="ofp-col-time">AGO</span>
      </div>
      {alerts.slice(0, 20).map((a, i) => {
        const ticker = a.symbol || a.ticker || '—';
        // Determine call/put from sentiment, type, or description
        const rawSent = (a.sentiment || a.type || '').toLowerCase();
        const isCall = rawSent.includes('call') || rawSent.includes('bull');
        const isPut = rawSent.includes('put') || rawSent.includes('bear');
        const cpLabel = isCall ? 'C' : isPut ? 'P' : '—';
        const cpColor = isCall ? 'var(--price-up)' : isPut ? 'var(--price-down)' : 'var(--text-muted)';

        // Type badge (sweep, block, golden)
        const typeRaw = (a.type || '').toLowerCase();
        const isSweep = typeRaw.includes('sweep');
        const isBlock = typeRaw.includes('block');
        const isGolden = typeRaw.includes('golden');
        const typeBadge = isGolden ? '★' : isSweep ? 'SW' : isBlock ? 'BK' : '';

        return (
          <div key={i} className="ofp-row ofp-row--flow">
            <span className="ofp-col-tick">
              <span className="ofp-ticker">{ticker}</span>
              {typeBadge && <span className="ofp-type-badge" data-type={isGolden ? 'golden' : isSweep ? 'sweep' : 'block'}>{typeBadge}</span>}
            </span>
            <span className="ofp-col-cptype" style={{ color: cpColor, fontWeight: 700 }}>
              {cpLabel}
            </span>
            <span className="ofp-col-strike">{formatStrike(a.strike)}</span>
            <span className="ofp-col-prem">{formatPremium(a.premium)}</span>
            <span className="ofp-col-time">{timeAgo(a.timestamp)}</span>
          </div>
        );
      })}
    </>
  );
}

/** Congress trades tab */
function CongressTab({ trades, loading }) {
  if (trades.length === 0) {
    return (
      <div className="ofp-empty">
        {loading ? 'Loading congress data...' : 'No recent congress trades'}
      </div>
    );
  }

  return (
    <>
      <div className="ofp-row ofp-row--hdr ofp-row--congress">
        <span className="ofp-col-tick">TICKER</span>
        <span className="ofp-col-action">B/S</span>
        <span className="ofp-col-prem">AMOUNT</span>
        <span className="ofp-col-member">MEMBER</span>
      </div>
      {trades.slice(0, 20).map((t, i) => {
        const ticker = t.ticker || '—';
        const rawTxn = (t.transactionType || t.action || '').toLowerCase();
        const isBuy = rawTxn.includes('buy') || rawTxn.includes('purchase');
        const isSell = rawTxn.includes('sell') || rawTxn.includes('sale') || rawTxn.includes('sold');
        const actionLabel = isBuy ? 'BUY' : isSell ? 'SELL' : (t.transactionType || '—').toUpperCase().slice(0, 4);
        const actionColor = isBuy ? 'var(--price-up)' : isSell ? 'var(--price-down)' : 'var(--text-muted)';

        // Amount: prefer amountRange if available (e.g., "$1K-$15K")
        const amountDisplay = t.amountRange || formatPremium(t.amount);

        // Member: show last name, truncated
        const member = t.representative || '—';
        const memberShort = member.includes(' ') ? member.split(' ').pop()?.slice(0, 10) : member.slice(0, 10);
        const party = t.party ? ` (${t.party.charAt(0)})` : '';

        return (
          <div key={i} className="ofp-row ofp-row--congress">
            <span className="ofp-col-tick ofp-ticker">{ticker}</span>
            <span className="ofp-col-action" style={{ color: actionColor, fontWeight: 700 }}>
              {actionLabel}
            </span>
            <span className="ofp-col-prem">{amountDisplay}</span>
            <span className="ofp-col-member">{memberShort}{party}</span>
          </div>
        );
      })}
    </>
  );
}

export default memo(OptionsFlowPanel);
