/**
 * FundamentalsTable.jsx — Sprint 5 fix
 * Sortable comparison table for batch fundamentals data.
 *
 * Sprint 5 fixes:
 *  - Accepts optional `statsMap` prop (from useDeepScreenData) as a fallback
 *    for fields the batch endpoint doesn't return (revenue, margins, ROE, etc.)
 *  - Server's Yahoo fallback only returns pe, eps, marketCap;
 *    Twelve Data statistics (via statsMap) fills in the rest.
 */
import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../../../utils/api';
import { DeepSkeleton, DeepError } from '../DeepScreenBase';

const METRIC_INFO = {
  pe: { label: 'P/E', format: 'number', decimals: 1 },
  eps: { label: 'EPS', format: 'number', decimals: 2 },
  marketCap: { label: 'Mkt Cap', format: 'abbrev' },
  revenue: { label: 'Revenue', format: 'abbrev' },
  ebitda: { label: 'EBITDA', format: 'abbrev' },
  dividendYield: { label: 'Div %', format: 'percent', decimals: 2 },
  grossMargins: { label: 'Gross %', format: 'percent', decimals: 1 },
  operatingMargins: { label: 'Op %', format: 'percent', decimals: 1 },
  profitMargins: { label: 'Net %', format: 'percent', decimals: 1 },
  totalCash: { label: 'Cash', format: 'abbrev' },
  totalDebt: { label: 'Debt', format: 'abbrev' },
  returnOnEquity: { label: 'ROE %', format: 'percent', decimals: 1 },
  beta: { label: 'Beta', format: 'number', decimals: 2 },
  sharesOutstanding: { label: 'Shares Out', format: 'abbrev' },
};

/**
 * Map from useDeepScreenData's Twelve Data stats fields to FundamentalsTable field names.
 * This lets us fill in missing values from the batch endpoint.
 */
const TD_STATS_MAP = {
  pe_ratio: 'pe',
  earnings_per_share: 'eps',
  market_capitalization: 'marketCap',
  revenue: 'revenue',
  ebitda: 'ebitda',
  // Twelve Data gross_margin, operating_margin, profit_margin are 0-1 ratios → multiply by 100
  gross_margin: { key: 'grossMargins', multiply: 100 },
  operating_margin: { key: 'operatingMargins', multiply: 100 },
  profit_margin: { key: 'profitMargins', multiply: 100 },
  dividend_yield: { key: 'dividendYield', multiply: 100 }, // Twelve Data 0-1 ratio → percent
  return_on_equity: { key: 'returnOnEquity', multiply: 100 },
  return_on_assets: null, // no corresponding field in fundamentals table
  beta: 'beta',
  shares_outstanding: 'sharesOutstanding',
};

function formatValue(value, format, decimals = 2) {
  if (value == null || value === '') return '—';

  if (format === 'number') {
    const n = parseFloat(value);
    return isNaN(n) ? '—' : n.toFixed(decimals);
  }
  if (format === 'percent') {
    const n = parseFloat(value);
    return isNaN(n) ? '—' : `${n.toFixed(decimals)}%`;
  }
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


/**
 * Merge batch endpoint data with Twelve Data statistics for a single ticker.
 * Batch data takes priority; TD stats fill gaps.
 */
function mergeWithStats(batchRow, tdStats) {
  if (!tdStats) return batchRow;
  const merged = { ...batchRow };

  for (const [tdKey, mapping] of Object.entries(TD_STATS_MAP)) {
    if (!mapping) continue;
    const tdVal = tdStats[tdKey];
    if (tdVal == null) continue;

    let targetKey, multiplier;
    if (typeof mapping === 'string') {
      targetKey = mapping;
      multiplier = 1;
    } else {
      targetKey = mapping.key;
      multiplier = mapping.multiply || 1;
    }

    // Only fill if the batch endpoint didn't provide a value
    if (merged[targetKey] == null || merged[targetKey] === '' || merged[targetKey] === '—') {
      const numVal = parseFloat(tdVal);
      if (!isNaN(numVal)) {
        merged[targetKey] = numVal * multiplier;
      }
    }
  }

  return merged;
}

/**
 * Note: `title` is a LEGACY prop. Every sector screen wraps this
 * component inside a `ScreenSection`, which already renders a section
 * header. When both rendered we got the "CONSTITUENTS / CONSTITUENTS"
 * double header users reported. We now render the internal header
 * only when `renderOwnHeader` is explicitly opted into — sector
 * screens never should. The `title` prop is still accepted for
 * backwards compatibility with saved callers and shows up nowhere
 * unless `renderOwnHeader` is set.
 */
export function FundamentalsTable({ tickers, metrics = null, title, onTickerClick, statsMap, renderOwnHeader = false }) {
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

  // Sprint 5: Merge batch data with Twelve Data statistics (from useDeepScreenData)
  const mergedData = useMemo(() => {
    if (!data || data.length === 0) return data;
    if (!statsMap || statsMap.size === 0) return data;

    return data.map(row => {
      const tdStats = statsMap.get(row.ticker);
      return mergeWithStats(row, tdStats);
    });
  }, [data, statsMap]);

  const handleSort = (metric) => {
    if (sortConfig.key === metric) {
      setSortConfig({ key: metric, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortConfig({ key: metric, dir: 'asc' });
    }
  };

  let sortedData = [...(mergedData || [])];
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
  if (!mergedData || mergedData.length === 0) return <div style={{ padding: '12px', color: 'var(--text-muted)', fontSize: 12 }}>No data</div>;

  return (
    <div style={{ overflow: 'auto' }}>
      {title && renderOwnHeader && <div className="section-header">{title}</div>}
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
              <td className="ds-ticker-col" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.ticker}</td>
              {displayMetrics.map(metric => {
                const value = row[metric];
                const info = METRIC_INFO[metric];
                return (
                  <td key={metric} style={{ color: 'var(--text-primary)' }}>
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
