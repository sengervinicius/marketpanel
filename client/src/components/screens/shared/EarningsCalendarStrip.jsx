/**
 * EarningsCalendarStrip.jsx
 * Displays upcoming earnings dates for sector tickers as a compact horizontal strip.
 * Fetches from /api/market/td/earnings-calendar
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Compact earnings chip — "LMT · Earnings · Apr 22" */
function EarningsChip({ event, accentColor }) {
  const ticker = event.ticker || event.symbol || '?';
  const date = event.date || event.earnings_date || event.reportDate || null;
  const eventType = event.event_type || 'Earnings';

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0,
      padding: '5px 10px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 4,
      fontSize: 10,
      whiteSpace: 'nowrap',
      lineHeight: 1,
      flexShrink: 0,
    }}>
      <span style={{
        fontWeight: 700,
        color: accentColor || 'var(--text-primary)',
        fontFamily: 'var(--font-mono, monospace)',
        letterSpacing: '0.3px',
      }}>
        {ticker}
      </span>
      <span style={{ color: 'var(--text-faint)', margin: '0 5px' }}>&middot;</span>
      <span style={{ color: 'var(--text-muted)' }}>{eventType}</span>
      <span style={{ color: 'var(--text-faint)', margin: '0 5px' }}>&middot;</span>
      <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
        {formatDate(date)}
      </span>
    </span>
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
    <div style={{ padding: '4px' }}>
      <div style={{
        fontSize: 9,
        color: 'var(--color-table-header, var(--text-muted))',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 500,
      }}>
        UPCOMING EARNINGS
      </div>

      {loading ? (
        <div style={{
          height: 32,
          display: 'flex',
          alignItems: 'center',
          color: 'var(--text-faint)',
          fontSize: 10,
        }}>
          Loading earnings…
        </div>
      ) : events.length === 0 ? (
        <div style={{
          height: 32,
          display: 'flex',
          alignItems: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          No upcoming earnings found
        </div>
      ) : (
        <div style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollbarWidth: 'thin',
        }}>
          {events.map(event => (
            <EarningsChip
              key={`${event.ticker || event.symbol}-${event.date}`}
              event={event}
              accentColor={accentColor}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default EarningsCalendarStrip;
