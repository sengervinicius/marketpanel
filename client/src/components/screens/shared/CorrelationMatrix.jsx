/**
 * CorrelationMatrix.jsx — Phase C
 * Heatmap-style correlation matrix for sector tickers.
 * Computes rolling correlation from price history and renders
 * as a compact color-coded grid with tooltips.
 */
import { useState, useEffect, useMemo, memo, useRef, useCallback } from 'react';
import { apiFetch } from '../../../utils/api';

/* SVG elements cannot resolve CSS custom properties */
const TOKEN_HEX = {
  bgPanel:       '#0a0a0f',
  bgSurface:     '#0d0d14',
  borderDefault: '#1a1a2a',
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#ff6600',
};

/** Convert -1…+1 correlation to color */
function corrColor(val) {
  if (val == null || isNaN(val)) return 'rgba(255,255,255,0.03)';
  // Deep red (-1) → neutral (0) → deep green (+1)
  const t = (val + 1) / 2; // 0 = -1, 0.5 = 0, 1 = +1
  const r = Math.round(t < 0.5 ? 200 : 200 - (t - 0.5) * 2 * 160);
  const g = Math.round(t < 0.5 ? 40 + t * 2 * 160 : 200);
  const b = 40;
  const a = 0.25 + Math.abs(val) * 0.35;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
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

  const tickerList = useMemo(() => tickers.slice(0, 12), [tickers]); // Cap at 12

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
    return (t || '').replace(/^C:/, '').replace(/^X:/, '').replace('.SA', '').replace('=F', '');
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
          fontWeight: 600,
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
                <th style={{ padding: '4px 6px', color: TOKEN_HEX.textFaint, fontSize: 8 }}></th>
                {tickerList.map(t => (
                  <th key={t} style={{
                    padding: '4px 4px',
                    color: TOKEN_HEX.textMuted,
                    fontSize: 8,
                    textAlign: 'center',
                    fontWeight: 500,
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
                    color: TOKEN_HEX.textSecondary,
                    fontWeight: 500,
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
                          color: val != null ? TOKEN_HEX.textPrimary : TOKEN_HEX.textFaint,
                          fontWeight: i === j ? 700 : 400,
                          fontSize: 9,
                          cursor: 'default',
                          border: `1px solid ${TOKEN_HEX.borderDefault}`,
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

          {/* Legend */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            fontSize: 8,
            color: TOKEN_HEX.textFaint,
          }}>
            <span>−1</span>
            <div style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: 'linear-gradient(90deg, rgba(200,40,40,0.5), rgba(120,120,40,0.2), rgba(40,200,40,0.5))',
            }} />
            <span>+1</span>
          </div>
        </div>
      )}
    </div>
  );
});

export default CorrelationMatrix;
