/**
 * OptionsFlowPanel.jsx — Terminal UI panel for Unusual Whales data
 *
 * Displays:
 * - Market Tide: call/put ratio bar at top with sentiment label
 * - Flow Alerts: scrollable list of unusual activity alerts (sweeps, blocks)
 * - Congress Trades: recent congressional trading activity
 * - Top Tickers: congress most-traded tickers tab
 *
 * Terminal dark theme (#0a0a0f bg, #00ff88 accent, monospace)
 * Auto-refreshes every 2 minutes
 */

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../../utils/api';
import './OptionsFlowPanel.css';

function OptionsFlowPanel() {
  const [marketTide, setMarketTide] = useState(null);
  const [flowAlerts, setFlowAlerts] = useState([]);
  const [congressTrades, setCongressTrades] = useState([]);
  const [topTickers, setTopTickers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('alerts'); // 'alerts' or 'tickers'
  const [expandedSections, setExpandedSections] = useState({
    marketTide: true,
    flowAlerts: true,
    congressTrades: true,
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [tideRes, alertsRes, tradesRes, tickersRes] = await Promise.all([
        fetch(`${API_BASE}/api/unusual-whales/market-tide`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`${API_BASE}/api/unusual-whales/flow-alerts`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`${API_BASE}/api/unusual-whales/congress-trades`, {
          headers: { 'Content-Type': 'application/json' },
        }),
        fetch(`${API_BASE}/api/unusual-whales/top-tickers`, {
          headers: { 'Content-Type': 'application/json' },
        }),
      ]);

      const tideData = tideRes.ok ? await tideRes.json() : null;
      const alertsData = alertsRes.ok ? await alertsRes.json() : null;
      const tradesData = tradesRes.ok ? await tradesRes.json() : null;
      const tickersData = tickersRes.ok ? await tickersRes.json() : null;

      if (tideData) {
        setMarketTide(tideData);
      }
      if (alertsData && Array.isArray(alertsData)) {
        setFlowAlerts(alertsData);
      }
      if (tradesData && Array.isArray(tradesData)) {
        setCongressTrades(tradesData);
      }
      if (tickersData && Array.isArray(tickersData)) {
        setTopTickers(tickersData);
      }
    } catch (err) {
      console.error('[OptionsFlowPanel] Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and auto-refresh every 2 minutes
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleSection = useCallback((section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

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

  const formatNumber = (value) => {
    if (!value) return '0';
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
    return String(value);
  };

  if (loading && !marketTide) {
    return (
      <div className="ofp-container">
        <div className="ofp-header">
          <h2 className="ofp-title">OPTIONS FLOW</h2>
          <button className="ofp-refresh" onClick={fetchData} title="Refresh">↻</button>
        </div>
        <div className="ofp-loading">Loading unusual whales data...</div>
      </div>
    );
  }

  if (error && !marketTide) {
    return (
      <div className="ofp-container">
        <div className="ofp-header">
          <h2 className="ofp-title">OPTIONS FLOW</h2>
          <button className="ofp-refresh" onClick={fetchData} title="Refresh">↻</button>
        </div>
        <div className="ofp-error">Error: {error}</div>
      </div>
    );
  }

  const callRatio = marketTide?.callRatio ?? 0.5;
  const sentiment = getSentimentLabel(callRatio);
  const sentimentColor = getSentimentColor(callRatio);

  return (
    <div className="ofp-container">
      {/* Panel Header */}
      <div className="ofp-header">
        <h2 className="ofp-title">OPTIONS FLOW</h2>
        <button className="ofp-refresh" onClick={fetchData} title="Refresh data">↻</button>
      </div>

      {/* Market Tide Section */}
      {expandedSections.marketTide && (
        <div className="ofp-section">
          <div
            className="ofp-section-header"
            onClick={() => toggleSection('marketTide')}
            style={{ cursor: 'pointer' }}
          >
            <span>▼ MARKET TIDE</span>
            <span className="ofp-section-count">{sentiment}</span>
          </div>
          <div className="ofp-section-content">
            <div className="ofp-tide-ratio">
              <div className="ofp-ratio-bar">
                <div
                  className="ofp-ratio-calls"
                  style={{ width: `${callRatio * 100}%` }}
                />
                <div
                  className="ofp-ratio-puts"
                  style={{ width: `${(1 - callRatio) * 100}%` }}
                />
              </div>
              <div className="ofp-ratio-labels">
                <span className="ofp-ratio-label-left">CALLS {(callRatio * 100).toFixed(0)}%</span>
                <span
                  className="ofp-ratio-sentiment"
                  style={{ color: sentimentColor }}
                >
                  {sentiment}
                </span>
                <span className="ofp-ratio-label-right">PUTS {((1 - callRatio) * 100).toFixed(0)}%</span>
              </div>
            </div>
            {marketTide?.sentiment && (
              <div className="ofp-tide-meta">
                <span>Sentiment: <span style={{ color: sentimentColor }}>{marketTide.sentiment.toUpperCase()}</span></span>
                {marketTide.timestamp && (
                  <span className="ofp-time">{new Date(marketTide.timestamp).toLocaleTimeString()}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed Market Tide */}
      {!expandedSections.marketTide && (
        <div
          className="ofp-section-collapsed"
          onClick={() => toggleSection('marketTide')}
          style={{ cursor: 'pointer' }}
        >
          <span>▶ MARKET TIDE</span>
          <span style={{ color: sentimentColor }}>{sentiment}</span>
        </div>
      )}

      {/* Flow Alerts Section */}
      {expandedSections.flowAlerts && (
        <div className="ofp-section">
          <div
            className="ofp-section-header"
            onClick={() => toggleSection('flowAlerts')}
            style={{ cursor: 'pointer' }}
          >
            <span>▼ FLOW ALERTS</span>
            <span className="ofp-section-count">{flowAlerts.length}</span>
          </div>
          <div className="ofp-section-content">
            {flowAlerts.length === 0 ? (
              <div className="ofp-empty">No unusual flow alerts</div>
            ) : (
              <div className="ofp-alerts-list">
                {flowAlerts.slice(0, 15).map((alert, idx) => (
                  <div key={idx} className="ofp-alert-item">
                    <div className="ofp-alert-header">
                      <span className="ofp-alert-ticker">{alert.ticker || 'N/A'}</span>
                      <span
                        className="ofp-alert-type"
                        style={{ color: getAlertTypeColor(alert.type) }}
                      >
                        {(alert.type || 'ALERT').toUpperCase()}
                      </span>
                    </div>
                    <div className="ofp-alert-details">
                      <span className="ofp-alert-value">
                        {formatCurrency(alert.premium || alert.value || 0)}
                      </span>
                      {alert.timestamp && (
                        <span className="ofp-alert-time">
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                    {alert.description && (
                      <div className="ofp-alert-desc">{alert.description}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsed Flow Alerts */}
      {!expandedSections.flowAlerts && (
        <div
          className="ofp-section-collapsed"
          onClick={() => toggleSection('flowAlerts')}
          style={{ cursor: 'pointer' }}
        >
          <span>▶ FLOW ALERTS</span>
          <span>{flowAlerts.length} alerts</span>
        </div>
      )}

      {/* Congress Trades / Top Tickers Tabs */}
      {expandedSections.congressTrades && (
        <div className="ofp-section">
          <div
            className="ofp-section-header"
            onClick={() => toggleSection('congressTrades')}
            style={{ cursor: 'pointer' }}
          >
            <span>▼ CONGRESS TRADES</span>
            <div className="ofp-tab-switcher">
              <button
                className={`ofp-tab-btn ${activeTab === 'alerts' ? 'ofp-tab-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab('alerts');
                }}
              >
                Recent
              </button>
              <button
                className={`ofp-tab-btn ${activeTab === 'tickers' ? 'ofp-tab-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab('tickers');
                }}
              >
                Top Tickers
              </button>
            </div>
          </div>
          <div className="ofp-section-content">
            {activeTab === 'alerts' ? (
              congressTrades.length === 0 ? (
                <div className="ofp-empty">No congress trades</div>
              ) : (
                <div className="ofp-trades-list">
                  {congressTrades.slice(0, 10).map((trade, idx) => (
                    <div key={idx} className="ofp-trade-item">
                      <div className="ofp-trade-header">
                        <span className="ofp-trade-ticker">{trade.ticker || 'N/A'}</span>
                        <span className={`ofp-trade-action ${(trade.action || '').toLowerCase()}`}>
                          {(trade.action || 'TRADE').toUpperCase()}
                        </span>
                      </div>
                      <div className="ofp-trade-details">
                        <span className="ofp-trade-member">{trade.member || 'Unknown'}</span>
                        <span className="ofp-trade-amount">{formatCurrency(trade.amount || 0)}</span>
                      </div>
                      {trade.date && (
                        <div className="ofp-trade-date">
                          {new Date(trade.date).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              topTickers.length === 0 ? (
                <div className="ofp-empty">No top tickers data</div>
              ) : (
                <div className="ofp-tickers-list">
                  {topTickers.slice(0, 10).map((ticker, idx) => (
                    <div key={idx} className="ofp-ticker-item">
                      <span className="ofp-ticker-rank">{idx + 1}</span>
                      <span className="ofp-ticker-symbol">{ticker.ticker || 'N/A'}</span>
                      <span className="ofp-ticker-count">{formatNumber(ticker.count || 0)} trades</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Collapsed Congress Trades */}
      {!expandedSections.congressTrades && (
        <div
          className="ofp-section-collapsed"
          onClick={() => toggleSection('congressTrades')}
          style={{ cursor: 'pointer' }}
        >
          <span>▶ CONGRESS TRADES</span>
          <span>{congressTrades.length} trades</span>
        </div>
      )}

      {/* Footer */}
      <div className="ofp-footer">
        <span>Powered by Unusual Whales</span>
      </div>
    </div>
  );
}

export default OptionsFlowPanel;
