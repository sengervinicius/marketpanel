/**
 * OwnershipBreakdown.jsx
 * Clean table-based ownership breakdown (insiders vs institutions vs public float).
 * Fetches from /api/market/enriched-batch?tickers=...
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

function OwnershipRow({ ticker, breakdown }) {
  const insider = breakdown.insider || 0;
  const institutional = breakdown.institutional || 0;
  const float = breakdown.float || 0;

  return (
    <tr>
      <td className="ds-ticker-col" style={{ fontWeight: 700 }}>
        {ticker}
      </td>
      <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
        {insider.toFixed(1)}%
      </td>
      <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
        {institutional.toFixed(1)}%
      </td>
      <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
        {float.toFixed(1)}%
      </td>
    </tr>
  );
}

export const OwnershipBreakdown = memo(function OwnershipBreakdown({
  tickers = [],
}) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const tickerKey = JSON.stringify(tickers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tickerList = useMemo(() => tickers.slice(0, 6), [tickerKey]);

  const fetchOwnership = useCallback(async () => {
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

      const breakdownMap = {};
      if (json.data && typeof json.data === 'object') {
        // API returns data as { TICKER: { holdersBreakdown, ... }, ... }
        Object.entries(json.data).forEach(([ticker, tickerData]) => {
          if (tickerData && tickerData.holdersBreakdown) {
            // Map API field names to component field names
            breakdownMap[ticker] = {
              insider: tickerData.holdersBreakdown.insidersPercentHeld || 0,
              institutional: tickerData.holdersBreakdown.institutionsPercentHeld || 0,
              float: 100 - (tickerData.holdersBreakdown.insidersPercentHeld || 0) - (tickerData.holdersBreakdown.institutionsPercentHeld || 0),
            };
          } else {
            breakdownMap[ticker] = { insider: 0, institutional: 0, float: 0 };
          }
        });
      }
      if (mountedRef.current) setData(breakdownMap);
    } catch {
      if (mountedRef.current) setData({});
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [tickerList]);

  useEffect(() => {
    mountedRef.current = true;
    fetchOwnership();
    return () => { mountedRef.current = false; };
  }, [fetchOwnership]);

  if (tickerList.length === 0) return null;

  return (
    <div style={{ padding: '8px' }}>
      <div style={{
        fontSize: 9,
        color: 'var(--text-primary)',
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: 600,
      }}>
        OWNERSHIP BREAKDOWN
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
          Loading ownership…
        </div>
      ) : Object.keys(data).length === 0 ? (
        <div style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 10,
        }}>
          No ownership data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="ds-table" style={{
            width: '100%',
          }}>
            <thead>
              <tr>
                <th>TICKER</th>
                <th>INSIDER</th>
                <th>INST.</th>
                <th>PUBLIC FLOAT</th>
              </tr>
            </thead>
            <tbody>
              {tickerList.map(ticker => (
                <OwnershipRow
                  key={ticker}
                  ticker={ticker}
                  breakdown={data[ticker] || { insider: 0, institutional: 0, float: 0 }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export default OwnershipBreakdown;
