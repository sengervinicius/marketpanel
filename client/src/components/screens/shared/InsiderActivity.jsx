/**
 * InsiderActivity.jsx
 * Sector-wide insider buy/sell summary.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../utils/api';
import { DeepSkeleton, DeepError } from '../DeepScreenBase';

function formatValue(value) {
  if (value == null) return '—';
  const num = parseFloat(value);
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatShares(shares) {
  if (shares == null) return '—';
  const num = parseFloat(shares);
  if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return num.toFixed(0);
}

export function InsiderActivity({ tickers, limit = 5, onTickerClick }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!tickers || tickers.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch for up to 8 tickers in parallel
        const tickersToFetch = tickers.slice(0, 8);
        const promises = tickersToFetch.map(ticker =>
          apiFetch(`/api/market/insider/${ticker}`)
            .then(res => res.ok ? res.json() : [])
            .catch(() => [])
        );

        const results = await Promise.all(promises);
        const allTransactions = [];

        results.forEach((txList, idx) => {
          // Server returns { ok, data: [...] } — unwrap if needed
          const items = Array.isArray(txList)
            ? txList
            : Array.isArray(txList?.data) ? txList.data : [];
          items.slice(0, limit).forEach(tx => {
            allTransactions.push({
              ...tx,
              ticker: tickersToFetch[idx],
            });
          });
        });

        // Sort by date, newest first
        allTransactions.sort((a, b) => {
          const dateA = new Date(a.transaction_date || 0);
          const dateB = new Date(b.transaction_date || 0);
          return dateB - dateA;
        });

        setData(allTransactions.slice(0, 30));
      } catch (err) {
        setError(err.message);
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tickers, limit]);

  const handleRetry = () => {
    setLoading(true);
  };

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DeepError message={`Error: ${error}`} />;
  if (!data || data.length === 0) {
    return (
      <div style={{
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '120px',
        background: 'rgba(76, 175, 80, 0.02)',
        borderRadius: 4,
        border: '1px solid rgba(76, 175, 80, 0.1)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Insider Data
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--text-muted)',
          textAlign: 'center',
          lineHeight: 1.4,
        }}>
          Requires premium data feed
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Ticker</th>
            <th>Name</th>
            <th>Type</th>
            <th>Shares</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const isBuy = (row.transaction_type || '').toLowerCase().includes('buy');
            const rowStyle = isBuy
              ? { background: 'rgba(76, 175, 80, 0.05)' }   /* semantic-up with transparency */
              : { background: 'rgba(239, 83, 80, 0.05)' };  /* semantic-down with transparency */

            return (
              <tr
                key={idx}
                className={onTickerClick ? 'ds-row-clickable' : ''}
                onClick={() => onTickerClick?.(row.ticker)}
                style={rowStyle}
              >
                <td style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  {row.transaction_date ? new Date(row.transaction_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  }) : '—'}
                </td>
                <td style={{ fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>{row.ticker}</td>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  {row.name ? row.name.substring(0, 20) : '—'}
                </td>
                <td style={{
                  color: isBuy ? 'var(--semantic-up)' : 'var(--semantic-down)',
                  fontWeight: 500,
                  fontSize: 9,
                }}>
                  {isBuy ? 'BUY' : 'SELL'}
                </td>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  {formatShares(row.shares)}
                </td>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                  {formatValue(row.value)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default InsiderActivity;
