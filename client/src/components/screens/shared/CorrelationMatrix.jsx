/**
 * CorrelationMatrix.jsx — Phase C
 * Heatmap-style correlation matrix for sector tickers.
 * Computes rolling correlation from price history and renders
 * as a compact color-coded grid with tooltips.
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';
import { sanitizeTicker } from '../../../utils/ticker';

/**
 * Convert -1…+1 correlation to color-coded background.
 * Phase 3 redesign: clean 3-tier heatmap for quick visual scanning.
 *   High positive (>=0.7)  → subtle green tint
 *   Moderate (0.4–0.69)    → neutral (transparent)
 *   Low/negative (<0.4)    → subtle amber tint
 */
function corrColor(val) {
  if (val == null || isNaN(val)) return 'transparent';
  if (val >= 0.7)  return 'rgba(74, 222, 128, 0.15)';
  if (val >= 0.4)  return 'transparent';
  return 'rgba(251, 191, 36, 0.12)';
}

/** Text color for correlation value — ensures readability on colored bg */
function corrTextColor(val) {
  if (val == null || isNaN(val)) return 'var(--text-faint)';
  if (val >= 0.7) return 'var(--text-primary)';
  if (val >= 0.4) return 'var(--text-secondary)';
  return 'var(--text-muted)';
}

/** Fetch daily close prices for a ticker */
async function fetchDailyCloses(ticker, days = 90) {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - days * 86400e3).toISOString().split('T')[0];
  const url = `/api/chart/${encodeURIComponent(ticker)}?from=${from}&to=${to}&multiplier=1&timespan=day`;
  try {
    const res = await apiFetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.results || []).map(b => ({ t: b.t, c: b.c })).filter(b => b.c != null);
  } catch {
    return [];
  }
}

/** Compute Pearson correlation between two arrays */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA  += a[i];
    sumB  += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));
  return den === 0 ? 0 : num / den;
}

/** Align two price series by timestamp and compute returns */
function computeReturns(series) {
  if (series.length < 2) return [];
  return series.slice(1).map((b, i) => (b.c - series[i].c) / series[i].c);
}

export const CorrelationMatrix = memo(function CorrelationMatrix({
  tickers = [],
  labels = {},
  title = 'CORRELATION MATRIX',
  days = 90,
  height,
  accentColor,
}) {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null);
  const mountedRef = useRef(true);

  // Stabilize tickers reference using JSON key — prevents infinite re-fetch
  // when parent passes a new array literal with the same values
  const tickerKey = JSON.stringify(tickers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tickerList = useMemo(() => tickers.slice(0, 12), [tickerKey]);

  const fetchMatrix = useCallback(async () => {
    if (tickerList.length < 2) return;
    setLoading(true);

    // Fetch all price series
    const allSeries = await Promise.all(tickerList.map(t => fetchDailyCloses(t, days)));
    if (!mountedRef.current) return;

    // Compute returns
    const allReturns = allSeries.map(computeReturns);

    // Build correlation matrix
    const n = tickerList.length;
    const corr = Array.from({ length: n }, () => Array(n).fill(null));

    for (let i = 0; i < n; i++) {
      corr[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        // Align by taking the last min(len_i, len_j) returns
        const minLen = Math.min(allReturns[i].length, allReturns[j].length);
        const ai = allReturns[i].slice(-minLen);
        const bi = allReturns[j].slice(-minLen);
        const r = pearson(ai, bi);
        corr[i][j] = r;
        corr[j][i] = r;
      }
    }

    if (mountedRef.current) {
      setMatrix(corr);
      setLoading(false);
    }
  }, [tickerList, days]);

  useEffect(() => {
    mountedRef.current = true;
    fetchMatrix();
    return () => { mountedRef.current = false; };
  }, [fetchMatrix]);

  const displayTicker = (t) => {
    if (labels[t]) return labels[t];
    return sanitizeTicker(t || '').replace('.SA', '').replace('=F', '');
  };

  if (tickerList.length < 2) return null;

  const cellSize = Math.min(48, Math.max(32, Math.floor(360 / tickerList.length)));

  return (
    <div style={{ padding: '8px' }}>
      {title && (
        <div style={{
          fontSize: 9,
          color: accentColor || 'var(--text-muted)',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 700,
        }}>
          {title} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({days}D)</span>
        </div>
      )}
      {loading ? (
        <div style={{
          height: height || 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
          fontSize: 10,
        }}>
          Computing correlations…
        </div>
      ) : !matrix ? (
        <div style={{ height: height || 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
          No data available
        </div>
      ) : (
        <div style={{ overflowX: 'auto', position: 'relative' }}>
          <table style={{
            borderCollapse: 'collapse',
            fontSize: 9,
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 6px', color: 'var(--text-faint)', fontSize: 8 }}></th>
                {tickerList.map(t => (
                  <th key={t} style={{
                    padding: '4px 4px',
                    color: 'var(--text-muted)',
                    fontSize: 8,
                    textAlign: 'center',
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    width: cellSize,
                    maxWidth: cellSize,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {displayTicker(t)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickerList.map((rowT, i) => (
                <tr key={rowT}>
                  <td style={{
                    padding: '4px 6px',
                    color: 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: 8,
                    whiteSpace: 'nowrap',
                  }}>
                    {displayTicker(rowT)}
                  </td>
                  {tickerList.map((colT, j) => {
                    const val = matrix[i][j];
                    return (
                      <td
                        key={colT}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          textAlign: 'center',
                          background: corrColor(val),
                          color: i === j ? 'var(--text-primary)' : corrTextColor(val),
                          fontWeight: i === j ? 700 : 400,
                          fontSize: 9,
                          cursor: 'default',
                          border: `1px solid var(--border-default)`,
                          transition: 'background 0.15s',
                        }}
                        title={`${displayTicker(rowT)} ↔ ${displayTicker(colT)}: ${val != null ? val.toFixed(3) : 'N/A'}`}
                        onMouseEnter={() => setTooltip({ row: rowT, col: colT, val })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {i === j ? '1.00' : (val != null ? val.toFixed(2) : '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Color legend */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginTop: 10,
            fontSize: 8,
            color: 'var(--text-muted)',
            letterSpacing: '0.02em',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(74, 222, 128, 0.15)', border: '1px solid rgba(74, 222, 128, 0.25)', flexShrink: 0 }} />
              <span>High correlation (&gt;0.7) — tickers move together</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'transparent', border: '1px solid var(--border-default)', flexShrink: 0 }} />
              <span>Moderate (0.4 - 0.7) — partial relationship</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.2)', flexShrink: 0 }} />
              <span>Low / negative (&lt;0.4) — diversification opportunity</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default CorrelationMatrix;
