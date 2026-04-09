/**
 * MacroCalendarStrip.jsx
 * Shows upcoming macro-economic events (FOMC, CPI, NFP, ECB, COPOM, etc.)
 * Fetches from /api/market/macro-calendar (Eulerpool macro calendar API).
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

const IMPACT_COLORS = {
  high:   '#ef4444',
  medium: '#eab308',
  low:    '#555570',
};

function impactDot(impact) {
  const color = IMPACT_COLORS[impact?.toLowerCase?.()] || TOKEN_HEX.textMuted;
  return (
    <span style={{
      display: 'inline-block',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: color,
      marginRight: 4,
      flexShrink: 0,
    }} />
  );
}

function formatEventDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dateFmt = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diffDays === 0) return `Today`;
  if (diffDays === 1) return `Tomorrow`;
  if (diffDays > 0 && diffDays <= 7) return `${dateFmt} (${diffDays}d)`;
  return dateFmt;
}

function countryFlag(country) {
  // Simple country code → emoji flag fallback
  const flags = {
    US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', DE: '🇩🇪', JP: '🇯🇵', CN: '🇨🇳',
    BR: '🇧🇷', IN: '🇮🇳', KR: '🇰🇷', AU: '🇦🇺', CA: '🇨🇦', MX: '🇲🇽',
    CH: '🇨🇭', FR: '🇫🇷', IT: '🇮🇹', ES: '🇪🇸', ZA: '🇿🇦',
  };
  return flags[country?.toUpperCase?.()] || '';
}

function EventRow({ event, accentColor }) {
  return (
    <tr>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontWeight: 600,
        color: TOKEN_HEX.textSecondary,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
      }}>
        {formatEventDate(event.date || event.datetime)}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textMuted,
        whiteSpace: 'nowrap',
      }}>
        {countryFlag(event.country)} {event.country || '—'}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textPrimary,
        fontWeight: 500,
      }}>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {impactDot(event.impact)}
          {event.event || event.title || event.name || '—'}
        </span>
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        color: TOKEN_HEX.textSecondary,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {event.forecast ?? event.expected ?? '—'}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        color: TOKEN_HEX.textMuted,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {event.previous ?? event.prior ?? '—'}
      </td>
    </tr>
  );
}

export const MacroCalendarStrip = memo(function MacroCalendarStrip({
  countries = [],
  limit = 15,
  accentColor,
}) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  const countriesKey = JSON.stringify(countries);

  const fetchCalendar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/market/macro-calendar');
      if (!mountedRef.current) return;

      let items = Array.isArray(res) ? res : (res?.events || res?.data || []);
      // Filter by countries if specified
      if (countries.length > 0) {
        const countrySet = new Set(countries.map(c => c.toUpperCase()));
        items = items.filter(e => {
          const c = (e.country || '').toUpperCase();
          return countrySet.has(c);
        });
      }
      // Sort by date ascending (upcoming first)
      items.sort((a, b) => {
        const da = new Date(a.date || a.datetime || 0);
        const db = new Date(b.date || b.datetime || 0);
        return da - db;
      });
      setEvents(items.slice(0, limit));
      setLoading(false);
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message || 'Failed to load calendar');
        setLoading(false);
      }
    }
  }, [countriesKey, limit]);

  useEffect(() => {
    mountedRef.current = true;
    fetchCalendar();
    return () => { mountedRef.current = false; };
  }, [fetchCalendar]);

  return (
    <div style={{
      background: TOKEN_HEX.bgSurface,
      border: `1px solid ${TOKEN_HEX.borderDefault}`,
      borderRadius: 4,
      overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        borderBottom: `1px solid ${TOKEN_HEX.borderDefault}`,
      }}>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '1.2px',
          color: TOKEN_HEX.textSecondary,
          textTransform: 'uppercase',
        }}>
          Macro Calendar {countries.length > 0 ? `(${countries.join(', ')})` : ''}
        </span>
        <span style={{ fontSize: 8, color: TOKEN_HEX.textFaint }}>
          EULERPOOL
        </span>
      </div>

      {/* body */}
      {loading ? (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: TOKEN_HEX.textMuted, fontSize: 10 }}>
          Loading macro events…
        </div>
      ) : error || events.length === 0 ? (
        <div style={{ padding: '20px 10px', textAlign: 'center', color: TOKEN_HEX.textMuted, fontSize: 10 }}>
          {error || 'No upcoming macro events'}
        </div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'auto',
          }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${TOKEN_HEX.borderDefault}` }}>
                <th style={{ padding: '4px 8px', fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'left' }}>DATE</th>
                <th style={{ padding: '4px 8px', fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'left' }}>COUNTRY</th>
                <th style={{ padding: '4px 8px', fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'left' }}>EVENT</th>
                <th style={{ padding: '4px 8px', fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'right' }}>FORECAST</th>
                <th style={{ padding: '4px 8px', fontSize: 8, color: TOKEN_HEX.textMuted, fontWeight: 600, textAlign: 'right' }}>PREVIOUS</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <EventRow key={`${event.date || i}-${event.event || i}`} event={event} accentColor={accentColor} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* legend */}
      <div style={{
        display: 'flex',
        gap: 12,
        padding: '5px 10px',
        borderTop: `1px solid ${TOKEN_HEX.borderDefault}`,
      }}>
        {['High', 'Medium', 'Low'].map(level => (
          <span key={level} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: TOKEN_HEX.textMuted }}>
            {impactDot(level)} {level}
          </span>
        ))}
      </div>
    </div>
  );
});

export default MacroCalendarStrip;
