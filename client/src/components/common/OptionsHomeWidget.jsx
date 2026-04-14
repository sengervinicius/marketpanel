/**
 * OptionsHomeWidget.jsx — Compact options flow widget for home screen
 *
 * Displays:
 * - Market Tide bar (calls vs puts ratio, colored green/red)
 * - Top 5 flow alerts (ticker, type badge like "SWEEP" or "BLOCK", premium amount)
 * - "Powered by Unusual Whales" footer
 *
 * Click on any alert navigates to the full OptionsFlowPanel
 * Compact size for home screen block
 * Terminal theme
 * Auto-refresh every 3 minutes
 */

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../../utils/api';
import './OptionsHomeWidget.css';

export default function OptionsHomeWidget({ onNavigate }) {
  const [marketTide, setMarketTide] = useState(null);
  const [flowAlerts, setFlowAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [tideRes, alertsRes] = await Promise.all([
        fetch(`${API_BASE}/api/unusual-whales/market-tide`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`${API_BASE}/api/unusual-whales/flow-alerts`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      const tideData = tideRes.ok ? await tideRes.json() : null;
      const alertsData = alertsRes.ok ? await alertsRes.json() : null;

      if (tideData) {
        setMarketTide(tideData);
      }
      if (alertsData && Array.isArray(alertsData)) {
        setFlowAlerts(alertsData.slice(0, 5));
      }
    } catch (err) {
      console.error('[OptionsHomeWidget] Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and auto-refresh every 3 minutes
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 180000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const getSentimentLabel = (callRatio) => {
    if (callRatio > 0.65) return 'BULLISH';
    if (callRatio < 0.35) return 'BEARISH';
    return 'NEUTRAL';
  };

  const getSentimentColor = (callRatio) => {
    if (callRatio > 0.65) return '#00ff88';
    if (callRatio < 0.35) return '#ff4444';
    return '#ffaa00';
  };

  const getAlertTypeColor = (type) => {
    const typeUpper = (type || '').toUpperCase();
    if (typeUpper.includes('SWEEP')) return '#00ff88';
    if (typeUpper.includes('BLOCK')) return '#ff9900';
    if (typeUpper.includes('UNUSUAL')) return '#ff4444';
    return '#ffaa00';
  };

  const formatCurrency = (value) => {
    if (!value) return '$0';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
    return `$${value}`;
  };

  const handleAlertClick = (alert) => {
    if (onNavigate) {
      onNavigate('options-flow');
    }
  };

  if (loading || error) {
    return null; // Don't show widget on error or loading state
  }

  if (!marketTide && flowAlerts.length === 0) {
    return null; // Hide if no data
  }

  const callRatio = marketTide?.callRatio ?? 0.5;
  const sentiment = getSentimentLabel(callRatio);
  const sentimentColor = getSentimentColor(callRatio);

  return (
    <div className="ohw-widget">
      {/* Header */}
      <div className="ohw-header">
        <h3 className="ohw-title">Options Flow</h3>
        <span className="ohw-sentiment" style={{ color: sentimentColor }}>
          {sentiment}
        </span>
      </div>

      {/* Market Tide Bar */}
      {marketTide && (
        <div className="ohw-tide">
          <div className="ohw-ratio-bar">
            <div
              className="ohw-ratio-calls"
              style={{ width: `${callRatio * 100}%` }}
            />
            <div
              className="ohw-ratio-puts"
              style={{ width: `${(1 - callRatio) * 100}%` }}
            />
          </div>
          <div className="ohw-ratio-label">
            <span>{(callRatio * 100).toFixed(0)}%</span>
            <span>Calls/Puts</span>
            <span>{((1 - callRatio) * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Top 5 Alerts */}
      {flowAlerts.length > 0 && (
        <div className="ohw-alerts">
          <div className="ohw-alerts-title">Top Unusual Activity</div>
          <div className="ohw-alerts-list">
            {flowAlerts.map((alert, idx) => (
              <div
                key={idx}
                className="ohw-alert-row"
                onClick={() => handleAlertClick(alert)}
                style={{ cursor: 'pointer' }}
              >
                <div className="ohw-alert-left">
                  <span className="ohw-alert-ticker">{alert.ticker || 'N/A'}</span>
                  <span
                    className="ohw-alert-type"
                    style={{ color: getAlertTypeColor(alert.type) }}
                  >
                    {(alert.type || 'ALERT').toUpperCase().substring(0, 5)}
                  </span>
                </div>
                <span className="ohw-alert-value">
                  {formatCurrency(alert.premium || alert.value || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="ohw-footer">
        Powered by Unusual Whales
      </div>
    </div>
  );
}
