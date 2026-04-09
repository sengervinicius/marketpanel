/**
 * MiniFinancials.jsx — Professional Financial Snapshot Card
 * Compact 3-year revenue/net-income display for sector screen tables.
 *
 * Design:
 *  - 3-year horizontal bar chart with revenue proportional widths
 *  - YoY growth indicators (▲/▼ + %)
 *  - Net margin indicator per year
 *  - Color-coded: green for positive margin, red for negative
 *  - Fits in ~180px table cell width
 *  - Loading skeleton & error states
 */
import { useState, useEffect, useRef, memo } from 'react';
import { apiFetch } from '../../../utils/api';

/* ── Value formatter: $1.2T / $45B / $120M ────────────────────────────── */
function fmtFinancial(value) {
  if (value == null || isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function extractYear(entry) {
  const raw = entry.fiscal_date || entry.date || entry.fiscal_period || entry.period || '';
  if (!raw) return '—';
  if (typeof raw === 'string' && raw.length >= 4) return raw.slice(0, 4);
  return String(raw);
}

/* ── Main component ───────────────────────────────────────────────────── */
const FETCH_TIMEOUT = 25000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

export const MiniFinancials = memo(function MiniFinancials({ ticker, accentColor = '#4a90d9', onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!ticker) { setLoading(false); return; }

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const fetchData = async () => {
      try {
        setLoading(true);
        let lastError;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const res = await apiFetch(
              `/api/market/td/financials/${encodeURIComponent(ticker)}?period=annual`,
              { signal: controller.signal }
            );

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();

            const payload = json.data || json || {};
            const incomeData = payload.income_statement || payload;

            let results = [];
            if (Array.isArray(incomeData)) {
              results = incomeData.slice(0, 3).reverse();
            } else if (incomeData?.income_statement && Array.isArray(incomeData.income_statement)) {
              results = incomeData.income_statement.slice(0, 3).reverse();
            } else {
              const statements = json.statements || [];
              const incomeStmt = statements.find(s => s.type === 'income') || {};
              results = (incomeStmt.results || []).slice(0, 3).reverse();
            }

            const chartData = results.map(year => {
              const rev = parseFloat(year.revenue ?? year.total_revenue ?? year.totalRevenue);
              const ni = parseFloat(year.net_income ?? year.net_income_loss ?? year.netIncome ?? year.net_income_continuous_operations);
              return {
                year: extractYear(year),
                revenue: isNaN(rev) ? null : rev,
                netIncome: isNaN(ni) ? null : ni,
              };
            });

            if (!cancelled) setData(chartData);
            return;
          } catch (err) {
            lastError = err;
            if (err.name === 'AbortError') throw err;
            if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
          }
        }

        throw lastError;
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') {
          onErrorRef.current?.(err);
          setData([]);
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [ticker]);

  /* ── Loading state: shimmer ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ width: '100%', maxWidth: 200, padding: '4px 0' }}>
        <div style={{
          height: 72,
          background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)',
          backgroundSize: '200% 100%',
          animation: 'ds-shimmer 1.5s infinite',
          borderRadius: 3,
        }} />
      </div>
    );
  }

  /* ── No data state ──────────────────────────────────────────────────── */
  if (!data || data.length === 0) {
    return (
      <div style={{
        width: '100%',
        maxWidth: 200,
        height: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.25,
        fontSize: 9,
        color: 'var(--text-faint)',
        letterSpacing: '0.5px',
      }}>
        NO DATA
      </div>
    );
  }

  const hasRevenue = data.some(d => d.revenue != null);
  if (!hasRevenue) {
    return (
      <div style={{
        width: '100%',
        maxWidth: 200,
        height: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.25,
        fontSize: 9,
        color: 'var(--text-faint)',
        letterSpacing: '0.5px',
      }}>
        NO DATA
      </div>
    );
  }

  const maxRevenue = Math.max(...data.map(d => d.revenue || 0));

  return (
    <div style={{
      width: '100%',
      maxWidth: 200,
      padding: '2px 0',
      fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
        paddingBottom: 2,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <span style={{
          fontSize: 8,
          fontWeight: 600,
          color: 'var(--text-faint)',
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
        }}>
          Revenue & Net Income
        </span>
      </div>

      {/* Year rows */}
      {data.map((d, idx) => {
        const hasNegativeNI = d.netIncome != null && d.netIncome < 0;
        const margin = (d.revenue && d.netIncome != null) ? (d.netIncome / d.revenue * 100) : null;
        const barWidthPct = maxRevenue > 0 && d.revenue ? (d.revenue / maxRevenue * 100) : 0;

        // YoY growth
        const prevRev = idx > 0 ? data[idx - 1].revenue : null;
        const yoyGrowth = (prevRev && d.revenue) ? ((d.revenue - prevRev) / prevRev * 100) : null;

        const barColor = hasNegativeNI ? '#d32f2f' : '#4caf50';

        return (
          <div key={idx} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 18,
            marginBottom: idx < data.length - 1 ? 2 : 0,
          }}>
            {/* Year */}
            <span style={{
              width: 26,
              fontSize: 9,
              color: 'var(--text-muted)',
              fontWeight: 500,
              flexShrink: 0,
            }}>
              {d.year.slice(-2)}
            </span>

            {/* Bar container */}
            <div style={{
              flex: 1,
              height: 10,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 2,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div style={{
                width: `${barWidthPct}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${barColor}88, ${barColor}cc)`,
                borderRadius: 2,
                transition: 'width 0.4s ease',
              }} />
            </div>

            {/* Revenue value */}
            <span style={{
              width: 36,
              textAlign: 'right',
              fontSize: 9,
              color: 'var(--text-primary)',
              fontWeight: 500,
              flexShrink: 0,
            }}>
              {fmtFinancial(d.revenue)}
            </span>

            {/* YoY growth arrow */}
            <span style={{
              width: 32,
              textAlign: 'right',
              fontSize: 8,
              fontWeight: 600,
              flexShrink: 0,
              color: yoyGrowth == null ? 'transparent'
                : yoyGrowth >= 0 ? 'var(--semantic-up)' : 'var(--semantic-down)',
            }}>
              {yoyGrowth != null
                ? `${yoyGrowth >= 0 ? '▲' : '▼'}${Math.abs(yoyGrowth).toFixed(0)}%`
                : '—'
              }
            </span>

            {/* Net margin dot */}
            {margin != null && (
              <span
                title={`Net margin: ${margin.toFixed(1)}%`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: margin >= 0 ? '#4caf50' : '#d32f2f',
                  flexShrink: 0,
                  opacity: 0.8,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});

export default MiniFinancials;
