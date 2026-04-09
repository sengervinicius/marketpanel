/**
 * AnalystActionsCard.jsx
 * Shows recent analyst upgrade/downgrade actions for sector tickers.
 * Fetches from /api/market/enriched-batch?tickers=...
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

const TOKEN_HEX = {
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  borderDefault: '#1a1a2a',
  accent:        '#ff6600',
  up:            '#22c55e',
  down:          '#ef4444',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ActionBadge({ action }) {
  let bgColor, textColor, label;
  if (action === 'upgrade') {
    bgColor = 'rgba(34, 197, 94, 0.15)';
    textColor = TOKEN_HEX.up;
    label = 'UPG';
  } else if (action === 'downgrade') {
    bgColor = 'rgba(239, 68, 68, 0.15)';
    textColor = TOKEN_HEX.down;
    label = 'DWN';
  } else {
    bgColor = 'rgba(255, 102, 0, 0.1)';
    textColor = TOKEN_HEX.accent;
    label = 'INIT';
  }

  return (
    <span style={{
      background: bgColor,
      color: textColor,
      padding: '2px 5px',
      borderRadius: 2,
      fontSize: 8,
      fontWeight: 700,
      letterSpacing: 0.3,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function ActionRow({ action, accentColor }) {
  return (
    <tr>
      <td style={{
        padding: '6px 8px',
        fontSize: 9,
        color: TOKEN_HEX.textMuted,
        whiteSpace: 'nowrap',
      }}>
        {formatDate(action.date)}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        color: TOKEN_HEX.textSecondary,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
        maxWidth: 100,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {action.firm}
      </td>
      <td style={{
        padding: '6px 8px',
        textAlign: 'center',
      }}>
        <ActionBadge action={action.action} />
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 9,
        color: TOKEN_HEX.textMuted,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
      }}>
        {action.fromGrade} → {action.toGrade}
      </td>
      <td style={{
        padding: '6px 8px',
        fontSize: 10,
        fontWeight: 600,
        color: accentColor || TOKEN_HEX.accent,
        fontFamily: 'var(--font-mono, monospace)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
      }}>
        {action.ticker}
      </td>
    </tr>
  );
}

export const AnalystActionsCard = memo(function AnalystActionsCard({
  tickers = [],
  limit = 10,
  accentColor,
}) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const tickerKey = JSON.stringify(tickers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tickerList = useMemo(() => tickers.slice(), [tickerKey]);

  const fetchActions = useCallback(async () => {
    if (tickerList.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const tickerParam = tickerList.join(',');
      const res = await apiFetch(`/api/market/enriched-batch?tickers=${encodeURIComponent(tickerParam)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      // Flatten analyst actions from all tickers
      const allActions = [];
      if (json.data && typeof json.data === 'object') {
        // API returns data as { TICKER: { analystActions, ... }, ... }
        Object.entries(json.data).forEach(([ticker, tickerData]) => {
          if (tickerData && Array.isArray(tickerData.analystActions)) {
            tickerData.analystActions.forEach(act => {
              allActions.push({
                ...act,
                ticker: ticker,
                // Convert epochGradeDate to date if needed
                date: act.epochGradeDate ? new Date(act.epochGradeDate * 1000).toISOString() : act.date,
              });
            });
          }
        });
      }

      // Sort by date, newest first
      allActions.sort((a, b) => new Date(b.date) - new Date(a.date));
      // Limit
      const limited = allActions.slice(0, limit);
      if (mountedRef.current) setActions(limited);
    } catch {
      if (mountedRef.current) setActions([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tickerList, limit]);

  useEffect(() => {
    mountedRef.current = true;
    fetchActions();
    return () => { mountedRef.current = false; };
  }, [fetchActions]);

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
        ANALYST ACTIONS
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
          Loading actions…
        </div>
      ) : actions.length === 0 ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: TOKEN_HEX.textMuted,
          fontSize: 10,
        }}>
          No analyst actions found
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            borderCollapse: 'collapse',
            fontSize: 10,
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
                  whiteSpace: 'nowrap',
                }}>
                  Date
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
                  Firm
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
                  Action
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
                  Rating
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
                  Ticker
                </th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action, idx) => (
                <tr key={idx}>
                  <ActionRow action={action} accentColor={accentColor} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export default AnalystActionsCard;
