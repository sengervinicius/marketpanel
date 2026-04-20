/**
 * SignalsFeed.jsx
 * Compact feed panel showing recent AI-generated market signals.
 *
 * Features:
 *   - Real-time push updates via WebSocket
 *   - Signal icons by type (momentum, earnings, market status)
 *   - Severity color coding (high=red, medium=orange, low=gray)
 *   - Time ago display
 *   - AI-generated insights (2-3 lines)
 *   - Mark all read button
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiJSON } from '../../utils/api';
import './SignalsFeed.css';

const SIGNAL_ICONS = {
  momentum_break: '📈',
  earnings_alert: '📊',
  market_status: '🔔',
  // Phase 9.6 composite signals
  vol_flip: '⚡',
  correlation_break: '🔀',
  news_spike: '📰',
};

// Phase 9.6: friendly label chips for composite signals (shown next to title)
const COMPOSITE_SIGNAL_LABELS = {
  vol_flip: 'VOL FLIP',
  correlation_break: 'DECOUPLE',
  news_spike: 'NEWS',
};

const SEVERITY_COLORS = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#6b7280',
};

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function SignalsFeed({ className = '', compact = false, wsConnection = null }) {
  const [signals, setSignals] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const signalCountRef = useRef(0);

  // Fetch initial signals
  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJSON('/api/signals/recent?limit=20');
      setSignals(data.data?.signals || []);
      setUnreadCount(data.data?.count || 0);
      signalCountRef.current = data.data?.count || 0;
    } catch (e) {
      console.error('Failed to fetch signals:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  // Listen for WebSocket signals
  useEffect(() => {
    if (!wsConnection) return;

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'signal' && msg.data) {
          setSignals((prev) => {
            const newSignals = [msg.data, ...prev];
            return newSignals.slice(0, 20);
          });
          signalCountRef.current += 1;
          setUnreadCount(signalCountRef.current);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    wsConnection.addEventListener('message', handleMessage);
    return () => wsConnection.removeEventListener('message', handleMessage);
  }, [wsConnection]);

  const handleMarkAllRead = useCallback(() => {
    signalCountRef.current = 0;
    setUnreadCount(0);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchSignals();
  }, [fetchSignals]);

  if (compact && signals.length === 0) {
    return (
      <div className={`signals-feed signals-feed--compact-empty ${className}`}>
        <div className="signals-feed__empty">
          No signals yet
        </div>
      </div>
    );
  }

  return (
    <div className={`signals-feed ${compact ? 'signals-feed--compact' : ''} ${className}`}>
      <div className="signals-feed__header">
        <div className="signals-feed__title">
          Market Signals
          {unreadCount > 0 && (
            <span className="signals-feed__badge">{unreadCount}</span>
          )}
        </div>
        <div className="signals-feed__actions">
          {unreadCount > 0 && (
            <button
              className="signals-feed__btn signals-feed__btn--read"
              onClick={handleMarkAllRead}
              title="Mark all as read"
            >
              ✓ Read
            </button>
          )}
          <button
            className="signals-feed__btn signals-feed__btn--refresh"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh signals"
          >
            ↻
          </button>
        </div>
      </div>

      {loading && signals.length === 0 ? (
        <div className="signals-feed__loading">Loading signals...</div>
      ) : signals.length === 0 ? (
        <div className="signals-feed__empty">No signals available</div>
      ) : (
        <div className="signals-feed__list">
          {signals.map((signal, idx) => (
            <div
              key={`${signal.timestamp}-${idx}`}
              className="signals-feed__item"
              style={{
                '--severity-color': SEVERITY_COLORS[signal.severity] || SEVERITY_COLORS.low,
              }}
            >
              <div className="signals-feed__icon">
                {SIGNAL_ICONS[signal.type] || '💡'}
              </div>
              <div className="signals-feed__content">
                <div className="signals-feed__title-row">
                  {COMPOSITE_SIGNAL_LABELS[signal.type] && (
                    <span className="signals-feed__tag">
                      {COMPOSITE_SIGNAL_LABELS[signal.type]}
                    </span>
                  )}
                  <span className="signals-feed__title-text">{signal.title}</span>
                  <span className="signals-feed__time">
                    {formatTimeAgo(signal.timestamp)}
                  </span>
                </div>
                <div className="signals-feed__insight">
                  {signal.insight || signal.context}
                </div>
              </div>
              <div
                className="signals-feed__severity-dot"
                title={signal.severity}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
