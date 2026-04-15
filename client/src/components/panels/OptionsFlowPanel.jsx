/**
 * OptionsFlowPanel.jsx — Market intelligence panel powered by Unusual Whales
 *
 * Three tabs of high-value data:
 * - FLOW: Unusual options activity (sweeps, blocks, large premium)
 * - CONGRESS: Congressional stock trades
 * - MARKET: Overall call/put tide sentiment
 *
 * Auto-refreshes every 2 minutes. Uses correct API endpoints.
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './OptionsFlowPanel.css';

const formatCurrency = (value) => {
  if (!value && value !== 0) return '—';
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : value;
  if (isNaN(num)) return '—';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
};

const formatDate = (ts) => {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return `${Math.round(diffMs / 60000)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
};

function OptionsFlowPanel() {
  const [marketTide, setMarketTide] = useState(null);
  const [flowAlerts, setFlowAlerts] = useState([]);
  const [congressTrades, setCongressTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab] = useState('flow'); // 'flow' | 'congress'
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      // Use correct endpoint paths matching server routes
      const [tideRes, alertsRes, tradesRes] = await Promise.all([
        apiFetch('/api/unusual-whales/tide').catch(() => null),
        apiFetch('/api/unusual-whales/alerts').catch(() => null),
        apiFetch('/api/unusual-whales/congress').catch(() => null),
      ]);

      const tideData = tideRes?.ok ? await tideRes.json() : null;
      const alertsData = alertsRes?.ok ? await alertsRes.json() : null;
      const tradesData = tradesRes?.ok ? await tradesRes.json() : null;

      if (tideData) setMarketTide(tideData);
      // Server wraps in { alerts: [...] } — unwrap
      if (alertsData) {
        const alerts = Array.isArray(alertsData) ? alertsData : (alertsData.alerts || []);
        setFlowAlerts(alerts);
      }
      // Server wraps in { trades: [...] } — unwrap
      if (tradesData) {
        const trades = Array.isArray(tradesData) ? tradesData : (tradesData.trades || []);
        setCongressTrades(trades);
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.warn('[OptionsFlowPanel] Fetch error:', err.message);
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // Tide uses `ratio` field from server (not `callRatio`)
  const callPct = marketTide?.ratio != null
    ? (marketTide.ratio * 100).toFixed(0)
    : marketTide?.callVolume && marketTide?.putVolume
      ? ((marketTide.callVolume / (marketTide.callVolume + marketTide.putVolume)) * 100).toFixed(0)
      : null;
  const putPct = callPct != null ? (100 - Number(callPct)) : null;

  const tideLabel = callPct == null ? '—'
    : Number(callPct) > 55 ? 'BULLISH'
    : Number(callPct) < 45 ? 'BEARISH'
    : 'NEUTRAL';

  const tideColor = tideLabel === 'BULLISH' ? 'var(--price-up)'
    : tideLabel === 'BEARISH' ? 'var(--price-down)'
    : 'var(--text-muted)';

  const ts = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  const totalAlerts = flowAlerts.length + congressTrades.length;

  return (
    <div className="ofp">
      {/* Header */}
      <div className="ofp-hdr">
        <div className="ofp-hdr-left">
          <span className="ofp-hdr-title">MARKET INTEL</span>
          {totalAlerts > 0 && (
            <span className="ofp-hdr-badge">{totalAlerts}</span>
          )}
        </div>
        <div className="ofp-hdr-right">
          <span className="ofp-hdr-ts">{loading ? 'SYNCING...' : error ? 'ERROR' : ts}</span>
          <button className="ofp-hdr-btn" onClick={fetchData} title="Refresh">↻</button>
        </div>
      </div>

      {/* Tide summary row */}
      <div className="ofp-tide">
        <div className="ofp-tide-bar-wrap">
          <span className="ofp-tide-lbl" style={{ color: 'var(--price-up)' }}>
            C {callPct ?? '—'}%
          </span>
          <div className="ofp-tide-bar">
            <div className="ofp-tide-calls" style={{ width: `${callPct ?? 50}%` }} />
          </div>
          <span className="ofp-tide-lbl" style={{ color: 'var(--price-down)' }}>
            P {putPct ?? '—'}%
          </span>
        </div>
        <span className="ofp-tide-sentiment" style={{ color: tideColor }}>
          {marketTide?.sentiment?.toUpperCase() || tideLabel}
        </span>
      </div>

      {/* Tab row */}
      <div className="ofp-tabs">
        <button
          className={`ofp-tab ${activeTab === 'flow' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          FLOW{flowAlerts.length > 0 ? ` (${flowAlerts.length})` : ''}
        </button>
        <button
          className={`ofp-tab ${activeTab === 'congress' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('congress')}
        >
          CONGRESS{congressTrades.length > 0 ? ` (${congressTrades.length})` : ''}
        </button>
      </div>

      {/* Content area */}
      <div className="ofp-body">
        {activeTab === 'flow' ? (
          flowAlerts.length === 0 ? (
            <div className="ofp-empty">
              {loading ? 'Loading flow data...' : error ? error : 'No unusual flow alerts'}
            </div>
          ) : (
            <>
              {/* Column header */}
              <div className="ofp-row ofp-row--hdr">
                <span className="ofp-col-tick">TICKER</span>
                <span className="ofp-col-type">TYPE</span>
                <span className="ofp-col-prem">PREMIUM</span>
                <span className="ofp-col-time">WHEN</span>
              </div>
              {flowAlerts.slice(0, 15).map((a, i) => {
                // Server returns `symbol` not `ticker`, and `type`
                const ticker = a.ticker || a.symbol || '—';
                const type = (a.type || 'ALERT').toUpperCase();
                const isSweep = type.includes('SWEEP');
                const isBlock = type.includes('BLOCK');
                const isGolden = type.includes('GOLDEN');
                const typeColor = isSweep ? 'var(--price-up)'
                  : isBlock ? '#f0a040'
                  : isGolden ? '#ffd700'
                  : 'var(--text-muted)';

                return (
                  <div key={i} className="ofp-row">
                    <span className="ofp-col-tick ofp-ticker">{ticker}</span>
                    <span className="ofp-col-type" style={{ color: typeColor }}>
                      {type.slice(0, 6)}
                    </span>
                    <span className="ofp-col-prem">{formatCurrency(a.premium || a.value)}</span>
                    <span className="ofp-col-time">{formatDate(a.timestamp)}</span>
                  </div>
                );
              })}
            </>
          )
        ) : (
          congressTrades.length === 0 ? (
            <div className="ofp-empty">
              {loading ? 'Loading congress data...' : error ? error : 'No recent congress trades'}
            </div>
          ) : (
            <>
              <div className="ofp-row ofp-row--hdr ofp-row--congress">
                <span className="ofp-col-tick">TICKER</span>
                <span className="ofp-col-action">ACTION</span>
                <span className="ofp-col-prem">AMOUNT</span>
                <span className="ofp-col-member">MEMBER</span>
              </div>
              {congressTrades.slice(0, 15).map((t, i) => {
                // Server returns `transactionType` not `action`, `representative` not `member`
                const rawAction = t.action || t.transactionType || 'TRADE';
                const action = rawAction.toUpperCase();
                const isBuy = action.includes('BUY') || action.includes('PURCHASE');
                const isSell = action.includes('SELL') || action.includes('SALE');
                const actionLabel = isBuy ? 'BUY' : isSell ? 'SELL' : action.slice(0, 6);
                const actionColor = isBuy ? 'var(--price-up)'
                  : isSell ? 'var(--price-down)' : 'var(--text-muted)';
                const ticker = t.ticker || '—';
                const member = t.member || t.representative || '—';
                // Show last name only, truncated
                const memberShort = member.split(' ').pop()?.slice(0, 10) || '—';

                return (
                  <div key={i} className="ofp-row ofp-row--congress">
                    <span className="ofp-col-tick ofp-ticker">{ticker}</span>
                    <span className="ofp-col-action" style={{ color: actionColor }}>{actionLabel}</span>
                    <span className="ofp-col-prem">{formatCurrency(t.amount)}</span>
                    <span className="ofp-col-member">{memberShort}</span>
                  </div>
                );
              })}
            </>
          )
        )}
      </div>

      {/* Footer — data source attribution */}
      <div className="ofp-footer">
        <span className="ofp-footer-src">via Unusual Whales</span>
      </div>
    </div>
  );
}

export default memo(OptionsFlowPanel);
