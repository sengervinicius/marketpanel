/**
 * FundamentalsTable.jsx
 * Sortable comparison table for batch fundamentals data.
 */
import { useState, useEffect } from 'react';
import { apiFetch } from '../../../utils/api';
import { DeepSkeleton, DeepError } from '../DeepScreenBase';

const METRIC_INFO = {
  pe: { label: 'P/E', format: 'number', decimals: 1 },
  eps: { label: 'EPS', format: 'number', decimals: 2 },
  marketCap: { label: 'Mkt Cap', format: 'abbrev' },
  revenue: { label: 'Revenue', format: 'abbrev' },
  ebitda: { label: 'EBITDA', format: 'abbrev' },
  grossMargins: { label: 'Gross %', format: 'percent', decimals: 1 },
  operatingMargins: { label: 'Op %', format: 'percent', decimals: 1 },
  profitMargins: { label: 'Net %', format: 'percent', decimals: 1 },
  totalCash: { label: 'Cash', format: 'abbrev' },
  totalDebt: { label: 'Debt', format: 'abbrev' },
  returnOnEquity: { label: 'ROE %', format: 'percent', decimals: 1 },
  beta: { label: 'Beta', format: 'number', decimals: 2 },
  sharesOutstanding: { label: 'Shares Out', format: 'abbrev' },
};

function formatValue(value, format, decimals = 2) {
  if (value == null || value === '') return '—';

  if (format === 'number') return value.toFixed(decimals);
  if (format === 'percent') return `${value.toFixed(decimals)}%`;
  if (format === 'abbrev') {
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    if (num >= 1e12) return `${(num / 1e12).toFixed(1)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    return num.toFixed(0);
  }
  return value;
}

function getCellColor(metric, value) {
  if (value == null || value === '') return {};
  const num = parseFloat(value);

  if (metric === 'pe') {
    if (num < 15) return { color: '#4caf50' };
    if (num > 30) return { color: '#f44336' };
  } else if (metric === 'grossMargins' || metric === 'operatingMargins' || metric === 'profitMargins') {
    if (num > 20) return { color: '#4caf50' };
    if (num < 10) return { color: '#ff9800' };
    if (num < 0) return { color: '#f44336' };
  }
  return {};
}

export function FundamentalsTable({ tickers, metrics = null, title, onTickerClick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'ticker', dir: 'asc' });

  const defaultMetrics = Object.keys(METRIC_INFO);
  const displayMetrics = metrics || defaultMetrics;

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
        const tickerList = tickers.slice(0, 20).join(',');
        const res = await apiFetch(`/api/market/fundamentals/batch?tickers=${encodeURIComponent(tickerList)}`);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        // Server returns { ok, data: { TICKER: {...}, ... } } — convert object to array
        const raw = json.data || json || {};
        if (Array.isArray(raw)) {
          setData(raw);
        } else if (raw && typeof raw === 'object') {
          setData(Object.entries(raw).map(([ticker, vals]) => ({ ticker, ...(vals || {}) })));
        } else {
          setData([]);
        }
      } catch (err) {
        setError(err.message);
        setData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tickers]);

  const handleSort = (metric) => {
    if (sortConfig.key === metric) {
      setSortConfig({ key: metric, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortConfig({ key: metric, dir: 'asc' });
    }
  };

  let sortedData = [...(data || [])];
  if (sortConfig.key !== 'ticker') {
    sortedData.sort((a, b) => {
      const aVal = parseFloat(a[sortConfig.key]) || 0;
      const bVal = parseFloat(b[sortConfig.key]) || 0;
      return sortConfig.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  } else {
    sortedData.sort((a, b) => {
      const aVal = (a.ticker || '').toUpperCase();
      const bVal = (b.ticker || '').toUpperCase();
      return sortConfig.dir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DeepError message={`Error: ${error}`} />;
  if (!data || data.length === 0) return <div style={{ padding: '10px', color: '#666', fontSize: 10 }}>No data</div>;

  return (
    <div style={{ padding: '0 6px', overflow: 'auto' }}>
      {title && <div style={{ fontSize: 9, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>}
      <table className="ds-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('ticker')} style={{ cursor: 'pointer', userSelect: 'none' }}>
              Ticker {sortConfig.key === 'ticker' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
            </th>
            {displayMetrics.map(metric => (
              <th
                key={metric}
                onClick={() => handleSort(metric)}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {METRIC_INFO[metric]?.label || metric} {sortConfig.key === metric && (sortConfig.dir === 'asc' ? '↑' : '↓')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, idx) => (
            <tr key={row.ticker || idx} className={onTickerClick ? 'ds-row-clickable' : ''} onClick={() => onTickerClick?.(row.ticker)}>
              <td style={{ fontWeight: 500, color: '#e0e0e0' }}>{row.ticker}</td>
              {displayMetrics.map(metric => {
                const value = row[metric];
                const info = METRIC_INFO[metric];
                const cellStyle = getCellColor(metric, value);
                return (
                  <td key={metric} style={cellStyle}>
                    {formatValue(value, info.format, info.decimals)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default FundamentalsTable;
