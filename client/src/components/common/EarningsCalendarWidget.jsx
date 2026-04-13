/**
 * EarningsCalendarWidget.jsx — Upcoming earnings calendar for next 7 days
 *
 * Displays upcoming earnings for the user's watchlist tickers with:
 * - Ticker symbol and date
 * - Time (BMO/AMC)
 * - EPS estimate
 * - Color-coded status (today, upcoming, past)
 */

import React, { useState, useEffect } from 'react';
import './EarningsCalendarWidget.css';

export default function EarningsCalendarWidget() {
  const [earnings, setEarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchEarnings();
  }, []);

  async function fetchEarnings() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/earnings/watchlist', {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setEarnings(data.data || []);
    } catch (err) {
      console.error('[EarningsWidget] Fetch error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="earnings-widget">
        <div className="earnings-header">
          <h3>Upcoming Earnings</h3>
        </div>
        <div className="earnings-loading">Loading...</div>
      </div>
    );
  }

  if (error || earnings.length === 0) {
    return (
      <div className="earnings-widget">
        <div className="earnings-header">
          <h3>Upcoming Earnings</h3>
        </div>
        <div className="earnings-empty">
          {error ? `Error: ${error}` : 'No upcoming earnings in next 7 days'}
        </div>
      </div>
    );
  }

  return (
    <div className="earnings-widget">
      <div className="earnings-header">
        <h3>Upcoming Earnings</h3>
        <button
          className="earnings-refresh"
          onClick={fetchEarnings}
          title="Refresh earnings data"
        >
          ↻
        </button>
      </div>

      <div className="earnings-list">
        {earnings.map((item, idx) => {
          const earningsDate = new Date(item.date);
          const today = new Date();
          const isToday = earningsDate.toDateString() === today.toDateString();
          const isPast = earningsDate < today;

          const dateStr = earningsDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          });

          const timeStr = item.hour === 'amc' ? 'After' : item.hour === 'dmh' ? 'During' : 'Before';

          return (
            <div
              key={idx}
              className={`earnings-item ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''}`}
            >
              <div className="earnings-ticker">
                <span className="ticker-symbol">${item.symbol}</span>
                <span className="earnings-date">{dateStr}</span>
              </div>

              <div className="earnings-meta">
                <span className="earnings-time">{timeStr} open</span>
                {item.daysUntil !== undefined && (
                  <span className="earnings-days">
                    {item.daysUntil === 0
                      ? 'Today'
                      : item.daysUntil === 1
                        ? 'Tomorrow'
                        : `${item.daysUntil}d`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="earnings-footer">
        {earnings.length} upcoming earnings
      </div>
    </div>
  );
}
