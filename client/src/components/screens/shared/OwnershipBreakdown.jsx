/**
 * OwnershipBreakdown.jsx
 * Pie-chart-style ownership breakdown (insiders vs institutions vs public float).
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

// Color palette for ownership segments
const COLORS = {
  insider:       'rgba(34, 197, 94, 0.6)',   // Green
  institutional: 'rgba(59, 130, 246, 0.6)',  // Blue
  float:         'rgba(255, 102, 0, 0.4)',   // Orange
};

function OwnershipRow({ ticker, breakdown, accentColor }) {
  const insider = breakdown.insider || 0;
  const institutional = breakdown.institutional || 0;
  const float = breakdown.float || 0;

  // Ensure segments add up to 100
  const total = insider + institutional + float;
  const insiderPct = total > 0 ? (insider / total) * 100 : 0;
  const institutionalPct = total > 0 ? (institutional / total) * 100 : 0;
  const floatPct = total > 0 ? (float / total) * 100 : 0;

  return (
    <tr>
      <td style={{
        padding: '8px 10px',
        fontSize: 11,
        fontWeight: 600,
        color: accentColor || TOKEN_HEX.accent,
        fontFamily: 'var(--font-mono, monospace)',
        whiteSpace: 'nowrap',
        width: 60,
      }}>
        {ticker}
      </td>
      <td style={{
        padding: '8px 10px',
        width: '100%',
        minWidth: 200,
      }}>
        <div style={{
          display: 'flex',
          height: 24,
          borderRadius: 2,
          overflow: 'hidden',
          border: `1px solid ${TOKEN_HEX.borderDefault}`,
          backgroundColor: 'rgba(255,255,255,0.02)',
        }}>
          {/* Insider segment */}
          {insiderPct > 0 && (
            <div
              style={{
                flex: insiderPct,
                background: COLORS.insider,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                color: insiderPct > 15 ? TOKEN_HEX.textPrimary : 'transparent',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
              }}
              title={`Insider: ${insider.toFixed(1)}%`}
            >
              {insiderPct > 15 ? `${insiderPct.toFixed(0)}%` : ''}
            </div>
          )}
          {/* Institutional segment */}
          {institutionalPct > 0 && (
            <div
              style={{
                flex: institutionalPct,
                background: COLORS.institutional,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                color: institutionalPct > 15 ? TOKEN_HEX.textPrimary : 'transparent',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
              }}
              title={`Institutional: ${institutional.toFixed(1)}%`}
            >
              {institutionalPct > 15 ? `${institutionalPct.toFixed(0)}%` : ''}
            </div>
          )}
          {/* Float segment */}
          {floatPct > 0 && (
            <div
              style={{
                flex: floatPct,
                background: COLORS.float,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                color: floatPct > 15 ? TOKEN_HEX.textPrimary : 'transparent',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
              }}
              title={`Float: ${float.toFixed(1)}%`}
            >
              {floatPct > 15 ? `${floatPct.toFixed(0)}%` : ''}
            </div>
          )}
        </div>
        {/* Labels below bar */}
        <div style={{
          display: 'flex',
          fontSize: 7,
          color: TOKEN_HEX.textFaint,
          marginTop: 3,
          justifyContent: 'space-between',
        }}>
          <span title="Insider">Insdr: {insider.toFixed(1)}%</span>
          <span title="Institutional">Inst: {institutional.toFixed(1)}%</span>
          <span title="Public Float">Float: {float.toFixed(1)}%</span>
        </div>
      </td>
    </tr>
  );
}

export const OwnershipBreakdown = memo(function OwnershipBreakdown({
  tickers = [],
  accentColor,
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
      if (json.data && Array.isArray(json.data)) {
        json.data.forEach(tickerData => {
          if (tickerData.yahoo && tickerData.yahoo.holdersBreakdown) {
            breakdownMap[tickerData.ticker] = tickerData.yahoo.holdersBreakdown;
          } else {
            breakdownMap[tickerData.ticker] = { insider: 0, institutional: 0, float: 0 };
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
        color: accentColor || 'var(--text-muted)',
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
          color: TOKEN_HEX.textFaint,
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
          color: TOKEN_HEX.textMuted,
          fontSize: 10,
        }}>
          No ownership data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            borderCollapse: 'collapse',
            width: '100%',
          }}>
            <tbody>
              {tickerList.map(ticker => (
                <tr key={ticker}>
                  <OwnershipRow
                    ticker={ticker}
                    breakdown={data[ticker] || { insider: 0, institutional: 0, float: 0 }}
                    accentColor={accentColor}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginTop: 10,
        fontSize: 8,
        color: TOKEN_HEX.textFaint,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 12, background: COLORS.insider, borderRadius: 1 }} />
          <span>Insider</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 12, background: COLORS.institutional, borderRadius: 1 }} />
          <span>Institutional</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 12, height: 12, background: COLORS.float, borderRadius: 1 }} />
          <span>Public Float</span>
        </div>
      </div>
    </div>
  );
});

export default OwnershipBreakdown;
