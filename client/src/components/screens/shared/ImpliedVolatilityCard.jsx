/**
 * ImpliedVolatilityCard.jsx — Phase C
 * Compact card showing implied volatility metrics for a ticker.
 * Fetches from /api/derivatives/iv/:ticker.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { apiFetch } from '../../../utils/api';
import { sanitizeTicker } from '../../../utils/ticker';

export const ImpliedVolatilityCard = memo(function ImpliedVolatilityCard({
  ticker,
  label,
  accentColor,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchIV = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/derivatives/iv/${encodeURIComponent(ticker)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (mountedRef.current) setData(json);
    } catch {
      if (mountedRef.current) setData(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    mountedRef.current = true;
    fetchIV();
    return () => { mountedRef.current = false; };
  }, [fetchIV]);

  const displayTicker = label || sanitizeTicker(ticker || '');

  return (
    <div style={{
      background: 'var(--bg-elevated, #111118)',
      border: '1px solid var(--border-default, #1a1a2a)',
      borderRadius: 4,
      padding: '2px 4px',
      minWidth: 160,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--text-primary)',
        marginBottom: 4,
        paddingBottom: 4,
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}>
        IMPLIED VOLATILITY
      </div>

      {loading ? (
        <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 9 }}>
          Loading…
        </div>
      ) : !data || data.source === 'unavailable' || (data.iv == null && data.ivRank == null && data.putCallRatio == null) ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 10, padding: '10px 0', lineHeight: 1.5 }}>
          Options data not available
          <br />
          <span style={{ fontSize: 9, color: 'var(--text-faint)' }}>Requires options data feed</span>
        </div>
      ) : (
        <table className="ds-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 0' }}>TICKER</td>
              <td style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right', padding: '2px 4px', fontFamily: 'var(--font-mono, monospace)' }} className="ds-ticker-col">{displayTicker}</td>
            </tr>
            {data.iv != null && (
              <tr>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 0' }}>IV</td>
                <td style={{ fontSize: 10, color: 'var(--text-primary)', textAlign: 'right', padding: '2px 4px', fontFamily: 'var(--font-mono, monospace)' }}>{(data.iv * 100).toFixed(1)}%</td>
              </tr>
            )}
            {data.ivRank != null && (
              <tr>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 0' }}>IV RANK</td>
                <td style={{ fontSize: 10, color: 'var(--text-primary)', textAlign: 'right', padding: '2px 4px', fontFamily: 'var(--font-mono, monospace)' }}>{data.ivRank.toFixed(0)}</td>
              </tr>
            )}
            {data.ivPercentile != null && (
              <tr>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 0' }}>IV PERCENTILE</td>
                <td style={{ fontSize: 10, color: 'var(--text-primary)', textAlign: 'right', padding: '2px 4px', fontFamily: 'var(--font-mono, monospace)' }}>{data.ivPercentile.toFixed(0)}th</td>
              </tr>
            )}
            {data.putCallRatio != null && (
              <tr>
                <td style={{ fontSize: 9, color: 'var(--text-secondary)', textTransform: 'uppercase', padding: '2px 0' }}>PUT/CALL RATIO</td>
                <td style={{ fontSize: 10, color: 'var(--text-primary)', textAlign: 'right', padding: '2px 4px', fontFamily: 'var(--font-mono, monospace)' }}>{data.putCallRatio.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
});

export default ImpliedVolatilityCard;
