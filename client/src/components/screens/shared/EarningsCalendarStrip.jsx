/**
 * EarningsCalendarStrip.jsx
 * Displays upcoming earnings dates for sector tickers as a compact horizontal strip.
 * Fetches from /api/market/td/earnings-calendar
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  bgPanel:       '#0a0a0f',
  bgSurface:     '#0d0d14',
  borderDefault: '#1a1a2a',
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EarningsRow({ event, accentColor }) {
  // Handle field name variations from TwelveData API
  const ticker = event.ticker || event.symbol || '?';
  const date = event.date || event.earnings_date || event.reportDate || null;
  const estimate = event.estimate ?? event.estimated_eps ?? event.eps_estimate ?? null;
  const actual = event.actual ?? event.actual_eps ?? event.eps_actual ?? null;

  const beatMiss = actual != null && estimate != null
    ? actual > estimate ? 'BEAT' : actual < estimate ? 'MISS' : '—'
    : '—';

  const beatMissColor = beatMiss === 'BEAT' ? TOKEN_HEX.up : beatMiss === 'MISS' ? TOKEN_HEX.down : TOKEN_HEX.textMuted;

  return (
    <tr>
      <td style={{
        padding: '6px 8px',
        fontSize: 11,
        fontWeight: 600,
        color: accentColor || TOKEN_HEX.accent,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
      }}>
        {ticker}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textMuted,
        whiteSpace: 'nowrap',
      }}>
        {formatDate(date)}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textSecondary,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {estimate != null ? `$${parseFloat(estimate).toFixed(2)}` : '—'}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: actual != null ? TOKEN_HEX.textPrimary : TOKEN_HEX.textMuted,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {actual != null ? `$${parseFloat(actual).toFixed(2)}` : '—'}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 9,
        color: beatMissColor,
        fontWeight: 600,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        letterSpacing: 0.3,
      }}>
        {beatMiss}
      </td>
    </tr>
  );
}

export const EarningsCalendarStrip = memo(function EarningsCalendarStrip({
  tickers = [],
  accentColor,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const tickerKey = JSON.stringify(tickers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tickerList = useMemo(() => tickers.slice(), [tickerKey]);

  const fetchEarnings = useCallback(async () => {
    if (tickerList.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/market/td/earnings-calendar');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Server returns { ok: true, data: [...], source: '...' }
      let allEvents = json.data || json.events || [];
      if (!Array.isArray(allEvents)) allEvents = [];

      // Filter to tickers we care about (handle various field name variations)
      allEvents = allEvents.filter(e => {
        const eventTicker = (e.ticker || e.symbol || '').toUpperCase();
        return tickerList.some(t => t.toUpperCase() === eventTicker);
      });

      // Sort by date, nearest first
      allEvents.sort((a, b) => {
        const dateA = new Date(a.date || a.earnings_date || 0);
        const dateB = new Date(b.date || b.earnings_date || 0);
        return dateA - dateB;
      });

      // Limit to 12
      allEvents = allEvents.slice(0, 12);
      if (mountedRef.current) setEvents(allEvents);
    } catch (err) {
      if (mountedRef.current) setEvents([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tickerList]);

  useEffect(() => {
    mountedRef.current = true;
    fetchEarnings();
    return () => { mountedRef.current = false; };
  }, [fetchEarnings]);

  if (tickerList.length === 0) return null;

  return (
    <div style={{ padding: '8px' }}>
      <div style={{
        fontSize: 9,
        color: accentColor || 'var(--text-muted)',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 600,
      }}>
        EARNINGS CALENDAR
      </div>

      {loading ? (
        <div style={{
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textFaint,
          fontSize: 10,
        }}>
          Loading earnings…
        </div>
      ) : events.length === 0 ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textMuted,
          fontSize: 10,
        }}>
          No upcoming earnings found
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            borderCollapse: 'collapse',
            fontSize: 11,
            width: '100%',
          }}>
            <thead>
              <tr>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'left',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Ticker
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'left',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Date
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Est. EPS
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'right',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Actual EPS
                </th>
                <th style={{
                  padding: '6px 8px',
                  color: TOKEN_HEX.textFaint,
                  fontSize: 8,
                  fontWeight: 500,
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                  borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
                }}>
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map(event => (
                <tr key={`${event.ticker}-${event.date}`}>
                  <EarningsRow event={event} accentColor={accentColor} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export default EarningsCalendarStrip;
