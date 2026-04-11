/**
 * AnalystActionsCard.jsx
 * Shows recent analyst upgrade/downgrade actions for sector tickers.
 * Fetches from /api/market/enriched-batch?tickers=...
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getActionColor(action) {
  if (action === 'upgrade') return 'var(--price-up)';
  if (action === 'downgrade') return 'var(--semantic-down)';
  return 'var(--text-muted)';
}

function getActionLabel(action) {
  if (action === 'upgrade') return 'Upgrade';
  if (action === 'downgrade') return 'Downgrade';
  if (action === 'init') return 'Init';
  return 'Reiterate';
}

function ActionRow({ action }) {
  return (
    <tr>
      <td style={{
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}>
        {formatDate(action.date)}
      </td>
      <td style={{
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
        maxWidth: 100,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {action.firm}
      </td>
      <td style={{
        color: getActionColor(action.action),
        whiteSpace: 'nowrap',
      }}>
        {getActionLabel(action.action)}
      </td>
      <td style={{
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
      }}>
        {action.fromGrade} → {action.toGrade}
      </td>
      <td className="ds-ticker-col" style={{
        fontWeight: 700,
        color: 'var(--text-primary)',
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
    <div style={{ padding: '4px' }}>
      <div style={{
        fontSize: 9,
        color: 'var(--text-muted)',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 500,
      }}>
        Analyst Actions
      </div>

      {loading ? (
        <div style={{
          height: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
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
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          No analyst actions found
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ds-table" style={{
            width: '100%',
          }}>
            <thead>
              <tr>
                <th style={{
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}>
                  Date
                </th>
                <th style={{
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}>
                  Firm
                </th>
                <th style={{
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}>
                  Action
                </th>
                <th style={{
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}>
                  Rating
                </th>
                <th style={{
                  textAlign: 'left',
                  whiteSpace: 'nowrap',
                }}>
                  Ticker
                </th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action, idx) => (
                <ActionRow key={idx} action={action} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export default AnalystActionsCard;
