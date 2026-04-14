/**
 * OptionsFlowPanel.jsx — Compact options flow for terminal home screen
 *
 * Redesigned to match terminal design system:
 * - CSS variables instead of hardcoded colors
 * - Dense row-based layout (no cards, no glow, no rounded corners)
 * - Meaningful data: tide ratio as single row, flow alerts as ticker grid,
 *   congress trades as compact list
 * - Auto-refreshes every 2 minutes
 */

import React, { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './OptionsFlowPanel.css';

const formatCurrency = (value) => {
  if (!value) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${value}`;
};

function OptionsFlowPanel() {
  const [marketTide, setMarketTide] = useState(null);
  const [flowAlerts, setFlowAlerts] = useState([]);
  const [congressTrades, setCongressTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeTab, setActiveTab] = useState('flow'); // 'flow' | 'congress'

  const fetchData = useCallback(async () => {
    try {
      const [tideRes, alertsRes, tradesRes] = await Promise.all([
        apiFetch('/api/unusual-whales/market-tide').catch(() => null),
        apiFetch('/api/unusual-whales/flow-alerts').catch(() => null),
        apiFetch('/api/unusual-whales/congress-trades').catch(() => null),
      ]);

      const tideData = tideRes?.ok ? await tideRes.json() : null;
      const alertsData = alertsRes?.ok ? await alertsRes.json() : null;
      const tradesData = tradesRes?.ok ? await tradesRes.json() : null;

      if (tideData) setMarketTide(tideData);
      if (alertsData && Array.isArray(alertsData)) setFlowAlerts(alertsData);
      if (tradesData && Array.isArray(tradesData)) setCongressTrades(tradesData);
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

  const callPct = marketTide?.callRatio != null
    ? (marketTide.callRatio * 100).toFixed(0)
    : null;
  const putPct = callPct != null ? (100 - Number(callPct)) : null;

  const tideLabel = callPct == null ? '—'
    : Number(callPct) > 60 ? 'BULLISH'
    : Number(callPct) < 40 ? 'BEARISH'
    : 'NEUTRAL';

  const tideColor = tideLabel === 'BULLISH' ? 'var(--price-up)'
    : tideLabel === 'BEARISH' ? 'var(--price-down)'
    : 'var(--text-muted)';

  const ts = lastUpdate
    ? lastUpdate.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="ofp">
      {/* Header */}
      <div className="ofp-hdr">
        <span className="ofp-hdr-title">OPTIONS FLOW</span>
        <div className="ofp-hdr-right">
          <span className="ofp-hdr-ts">{loading ? 'LOADING...' : ts}</span>
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
          {tideLabel}
        </span>
      </div>

      {/* Tab row */}
      <div className="ofp-tabs">
        <button
          className={`ofp-tab ${activeTab === 'flow' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          FLOW ALERTS
        </button>
        <button
          className={`ofp-tab ${activeTab === 'congress' ? 'ofp-tab--active' : ''}`}
          onClick={() => setActiveTab('congress')}
        >
          CONGRESS
        </button>
      </div>

      {/* Content area */}
      <div className="ofp-body">
        {activeTab === 'flow' ? (
          flowAlerts.length === 0 ? (
            <div className="ofp-empty">
              {loading ? 'Loading flow data...' : 'No unusual flow alerts'}
            </div>
          ) : (
            <>
              {/* Column header */}
              <div className="ofp-row ofp-row--hdr">
                <span className="ofp-col-tick">TICKER</span>
                <span className="ofp-col-type">TYPE</span>
                <span className="ofp-col-prem">PREMIUM</span>
                <span className="ofp-col-sent">SENT</span>
              </div>
              {flowAlerts.slice(0, 12).map((a, i) => {
                const type = (a.type || 'ALERT').toUpperCase();
                const isSweep = type.includes('SWEEP');
                const isBlock = type.includes('BLOCK');
                const sentColor = (a.sentiment || '').toLowerCase() === 'bullish'
                  ? 'var(--price-up)' : (a.sentiment || '').toLowerCase() === 'bearish'
                  ? 'var(--price-down)' : 'var(--text-muted)';
                const typeColor = isSweep ? 'var(--price-up)'
                  : isBlock ? 'var(--text-secondary)' : 'var(--text-muted)';

                return (
                  <div key={i} className="ofp-row">
                    <span className="ofp-col-tick ofp-ticker">{a.ticker || '—'}</span>
                    <span className="ofp-col-type" style={{ color: typeColor }}>
                      {type.slice(0, 6)}
                    </span>
                    <span className="ofp-col-prem">{formatCurrency(a.premium || a.value)}</span>
                    <span className="ofp-col-sent" style={{ color: sentColor }}>
                      {(a.sentiment || '—').toUpperCase().slice(0, 4)}
                    </span>
                  </div>
                );
              })}
            </>
          )
        ) : (
          congressTrades.length === 0 ? (
            <div className="ofp-empty">
              {loading ? 'Loading congress data...' : 'No recent congress trades'}
            </div>
          ) : (
            <>
              <div className="ofp-row ofp-row--hdr">
                <span className="ofp-col-tick">TICKER</span>
                <span className="ofp-col-type">ACTION</span>
                <span className="ofp-col-prem">AMOUNT</span>
                <span className="ofp-col-sent">MEMBER</span>
              </div>
              {congressTrades.slice(0, 10).map((t, i) => {
                const action = (t.action || 'TRADE').toUpperCase();
                const actionColor = action === 'BUY' ? 'var(--price-up)'
                  : action === 'SELL' ? 'var(--price-down)' : 'var(--text-muted)';
                return (
                  <div key={i} className="ofp-row">
                    <span className="ofp-col-tick ofp-ticker">{t.ticker || '—'}</span>
                    <span className="ofp-col-type" style={{ color: actionColor }}>{action}</span>
                    <span className="ofp-col-prem">{formatCurrency(t.amount)}</span>
                    <span className="ofp-col-sent ofp-member">
                      {(t.member || '—').split(' ').pop()?.slice(0, 8)}
                    </span>
                  </div>
                );
              })}
            </>
          )
        )}
      </div>
    </div>
  );
}

export default memo(OptionsFlowPanel);
