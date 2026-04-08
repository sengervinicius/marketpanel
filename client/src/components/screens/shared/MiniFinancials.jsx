/**
 * MiniFinancials.jsx — Sprint 5 fix
 * Compact 3-year revenue + net income bar chart for sector table rows.
 * Shows side-by-side bars (not stacked) with formatted Y-axis, year labels,
 * metric title, and proper color coding.
 *
 * Sprint 5 fixes:
 *  - useEffect deps: only [ticker] — removes onError/accentColor re-fetch loop
 *  - Year label: uses fiscal_date (not fiscal_period) from Twelve Data API
 *  - Increased chart height (90 -> 110px) and bar size for visibility
 *  - Brighter bar colors for dark background contrast
 */
import { useState, useEffect, useRef, memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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

/* ── Custom tooltip ───────────────────────────────────────────────────── */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'var(--bg-tooltip)',
      border: '1px solid var(--border-strong)',
      padding: '5px 8px',
      borderRadius: 4,
      fontSize: 9,
      lineHeight: '14px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
    }}>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2, fontWeight: 600 }}>{label}</div>
      {(Array.isArray(payload) ? payload : []).map((entry, idx) => (
        <div key={idx} style={{ color: entry.fill || entry.color }}>
          {entry.name}: {fmtFinancial(entry.value)}
        </div>
      ))}
    </div>
  );
}

/* ── Y-axis tick formatter ────────────────────────────────────────────── */
function yAxisFormatter(value) {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}${(abs / 1e9).toFixed(0)}B`;
  if (abs >= 1e6)  return `${sign}${(abs / 1e6).toFixed(0)}M`;
  return `${sign}${abs.toFixed(0)}`;
}

/**
 * Extract a 4-char year string from a Twelve Data income_statement entry.
 * Twelve Data fields vary — try fiscal_date, date, fiscal_period, period in order.
 */
function extractYear(entry) {
  const raw = entry.fiscal_date || entry.date || entry.fiscal_period || entry.period || '';
  if (!raw) return '—';
  // If ISO date like "2024-12-31", take first 4 chars
  if (typeof raw === 'string' && raw.length >= 4) return raw.slice(0, 4);
  return String(raw);
}

/* ── Main component ───────────────────────────────────────────────────── */
const FETCH_TIMEOUT = 15000; // 15s timeout (was 12s)

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

        const chartData = results.map(year => ({
          year: extractYear(year),
          revenue: parseFloat(year.revenue) || parseFloat(year.total_revenue) || 0,
          netIncome: parseFloat(year.net_income) || parseFloat(year.net_income_loss) || 0,
        }));

        if (!cancelled) setData(chartData);
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
  }, [ticker]); // Sprint 5: ONLY depend on ticker — not onError or accentColor

  /* ── Loading state: shimmer ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ height: 110, padding: '4px 0' }}>
        <div style={{
          height: '100%',
          background: 'linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)',
          backgroundSize: '200% 100%',
          animation: 'ds-shimmer 1.5s infinite',
          borderRadius: 2,
        }} />
      </div>
    );
  }

  /* ── No data state ──────────────────────────────────────────────────── */
  if (!data || data.length === 0) {
    return (
      <div style={{
        height: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-faint)',
        fontSize: 9,
      }}>
        No financials
      </div>
    );
  }

  /* ── Determine if we have any meaningful data ───────────────────────── */
  const hasRevenue = data.some(d => d.revenue !== 0);
  const hasNetIncome = data.some(d => d.netIncome !== 0);

  if (!hasRevenue && !hasNetIncome) {
    return (
      <div style={{
        height: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-faint)',
        fontSize: 9,
      }}>
        No financials
      </div>
    );
  }

  return (
    <div style={{ height: 110, position: 'relative' }}>
      {/* Metric label */}
      <div style={{
        fontSize: 8,
        color: 'var(--text-secondary)',
        textAlign: 'center',
        lineHeight: '10px',
        marginBottom: 2,
        letterSpacing: '0.3px',
        fontWeight: 500,
      }}>
        Revenue{hasNetIncome ? ' & Net Income' : ''}
      </div>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart
          data={data}
          margin={{ top: 2, right: 4, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="15%"
        >
          <XAxis
            dataKey="year"
            tick={{ fontSize: 9, fill: '#555570' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={yAxisFormatter}
            tick={{ fontSize: 7, fill: '#666' }}
            tickLine={false}
            axisLine={false}
            width={38}
            tickCount={3}
          />
          <Tooltip content={<CustomTooltip />} />
          {hasRevenue && (
            <Bar
              dataKey="revenue"
              name="Revenue"
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
            >
              {data.map((entry, idx) => (
                <Cell key={`rev-${idx}`} fill={accentColor} fillOpacity={0.95} />
              ))}
            </Bar>
          )}
          {hasNetIncome && (
            <Bar
              dataKey="netIncome"
              name="Net Income"
              radius={[2, 2, 0, 0]}
              maxBarSize={28}
            >
              {data.map((entry, idx) => (
                <Cell
                  key={`ni-${idx}`}
                  fill={entry.netIncome >= 0 ? '#66bb6a' : '#ef5350'}
                  fillOpacity={0.95}
                />
              ))}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default MiniFinancials;
