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
      <div style={{ padding: '10px', color: '#666', fontSize: 10, textAlign: 'center' }}>
        No insider activity
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
              ? { background: 'rgba(76, 175, 80, 0.05)' }
              : { background: 'rgba(244, 67, 54, 0.05)' };

            return (
              <tr
                key={idx}
                className={onTickerClick ? 'ds-row-clickable' : ''}
                onClick={() => onTickerClick?.(row.ticker)}
                style={rowStyle}
              >
                <td style={{ fontSize: 9, color: '#999' }}>
                  {row.transaction_date ? new Date(row.transaction_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  }) : '—'}
                </td>
                <td style={{ fontWeight: 600, color: '#e0e0e0', cursor: 'pointer' }}>{row.ticker}</td>
                <td style={{ fontSize: 9, color: '#aaa' }}>
                  {row.name ? row.name.substring(0, 20) : '—'}
                </td>
                <td style={{
                  color: isBuy ? '#4caf50' : '#f44336',
                  fontWeight: 500,
                  fontSize: 9,
                }}>
                  {isBuy ? 'BUY' : 'SELL'}
                </td>
                <td style={{ fontSize: 9, color: '#aaa' }}>
                  {formatShares(row.shares)}
                </td>
                <td style={{ fontSize: 9, color: '#aaa' }}>
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
