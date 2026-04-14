/**
 * OptionsFlowWidget.jsx — Unusual Whales options flow and dark pool data
 *
 * Displays:
 * - Call/put ratio visualization at the top
 * - Options flow table: strike | expiry | C/P | premium | vol | OI | sentiment badge
 * - Dark pool section: large prints table
 * - Terminal dark theme (#0a0a0f background)
 * - Real-time sentiment indicators
 *
 * Props: { symbol }
 */

import React, { useState, useEffect } from 'react';
import './OptionsFlowWidget.css';

export default function OptionsFlowWidget({ symbol }) {
  const [flow, setFlow] = useState([]);
  const [darkPool, setDarkPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [callRatio, setCallRatio] = useState(0.5);

  useEffect(() => {
    if (symbol) {
      fetchData();
    }
  }, [symbol]);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);

      const [flowRes, dpRes] = await Promise.all([
        fetch(`/api/unusual-whales/flow/${symbol}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`/api/unusual-whales/dark-pool/${symbol}`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      if (!flowRes.ok || !dpRes.ok) {
        throw new Error(`HTTP ${flowRes.status}/${dpRes.status}`);
      }

      const flowData = await flowRes.json();
      const dpData = await dpRes.json();

      setFlow(flowData.flow || []);
      setDarkPool(dpData.darkPool || []);

      // Calculate call/put ratio
      const calls = (flowData.flow || []).filter(f => f.type === 'call');
      const puts = (flowData.flow || []).filter(f => f.type === 'put');
      const callVol = calls.reduce((sum, c) => sum + (c.volume || 0), 0);
      const putVol = puts.reduce((sum, p) => sum + (p.volume || 0), 0);
      const total = callVol + putVol;
      setCallRatio(total > 0 ? callVol / total : 0.5);
    } catch (err) {
      console.error('[OptionsFlowWidget] Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const getSentimentColor = (sentiment) => {
    switch (sentiment?.toLowerCase()) {
      case 'bullish':
        return '#00ff00';
      case 'bearish':
        return '#ff4444';
      case 'neutral':
      default:
        return '#ffaa00';
    }
  };

  if (loading) {
    return (
      <div className="options-flow-widget">
        <div className="widget-header">
          <h3>Options Flow {symbol && `- ${symbol}`}</h3>
        </div>
        <div className="widget-loading">Loading...</div>
      </div>
    );
  }

  if (error || (flow.length === 0 && darkPool.length === 0)) {
    return (
      <div className="options-flow-widget">
        <div className="widget-header">
          <h3>Options Flow {symbol && `- ${symbol}`}</h3>
        </div>
        <div className="widget-empty">
          {error ? `Error: ${error}` : 'No options flow data available'}
        </div>
      </div>
    );
  }

  return (
    <div className="options-flow-widget">
      {/* Header */}
      <div className="widget-header">
        <h3>Options Flow {symbol && `- ${symbol}`}</h3>
        <button
          className="widget-refresh"
          onClick={fetchData}
          title="Refresh data"
        >
          ↻
        </button>
      </div>

      {/* Call/Put Ratio Bar */}
      {flow.length > 0 && (
        <div className="ratio-container">
          <div className="ratio-label">Call/Put Ratio</div>
          <div className="ratio-bar">
            <div
              className="ratio-calls"
              style={{ width: `${callRatio * 100}%` }}
            />
            <div
              className="ratio-puts"
              style={{ width: `${(1 - callRatio) * 100}%` }}
            />
          </div>
          <div className="ratio-text">
            {(callRatio * 100).toFixed(0)}% calls / {((1 - callRatio) * 100).toFixed(0)}% puts
          </div>
        </div>
      )}

      {/* Options Flow Table */}
      {flow.length > 0 && (
        <div className="flow-section">
          <div className="section-header">Recent Options Flow</div>
          <div className="table-container">
            <table className="flow-table">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Expiry</th>
                  <th>Type</th>
                  <th>Premium</th>
                  <th>Volume</th>
                  <th>OI</th>
                  <th>Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {flow.slice(0, 10).map((item, idx) => (
                  <tr key={idx} className={`sentiment-${item.sentiment?.toLowerCase() || 'neutral'}`}>
                    <td className="strike">${item.strike?.toFixed(2)}</td>
                    <td className="expiry">{item.expiry}</td>
                    <td className={`type ${item.type?.toLowerCase()}`}>
                      {item.type?.toUpperCase()}
                    </td>
                    <td className="premium">
                      ${(item.premium / 1000 || 0).toFixed(0)}k
                    </td>
                    <td className="volume">{(item.volume || 0).toLocaleString()}</td>
                    <td className="oi">{(item.openInterest || 0).toLocaleString()}</td>
                    <td className="sentiment">
                      <span
                        className="sentiment-badge"
                        style={{
                          color: getSentimentColor(item.sentiment),
                        }}
                      >
                        {item.sentiment?.toUpperCase() || 'NEUTRAL'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">{flow.length} total records</div>
        </div>
      )}

      {/* Dark Pool Section */}
      {darkPool.length > 0 && (
        <div className="darkpool-section">
          <div className="section-header">Dark Pool Activity</div>
          <div className="table-container">
            <table className="darkpool-table">
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Exchange</th>
                  <th>% of Volume</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {darkPool.slice(0, 8).map((item, idx) => (
                  <tr key={idx}>
                    <td className="price">${item.price?.toFixed(2)}</td>
                    <td className="size">{(item.size || 0).toLocaleString()}</td>
                    <td className="exchange">{item.exchange}</td>
                    <td className="percent">{(item.percentOfVolume || 0).toFixed(2)}%</td>
                    <td className="timestamp">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">{darkPool.length} dark pool prints</div>
        </div>
      )}
    </div>
  );
}
