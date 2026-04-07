/**
 * MiniFinancials.jsx — Sprint 4 rewrite
 * Compact 3-year revenue + net income bar chart for sector table rows.
 * Shows side-by-side bars (not stacked) with formatted Y-axis, year labels,
 * metric title, and proper color coding.
 */
import { useState, useEffect, memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend } from 'recharts';
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
      background: '#111',
      border: '1px solid #333',
      padding: '5px 8px',
      borderRadius: 3,
      fontSize: 9,
      lineHeight: '14px',
    }}>
      <div style={{ color: '#aaa', marginBottom: 2, fontWeight: 600 }}>{label}</div>
      {payload.map((entry, idx) => (
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

/* ── Main component ───────────────────────────────────────────────────── */
const FETCH_TIMEOUT = 12000; // 12s timeout

export const MiniFinancials = memo(function MiniFinancials({ ticker, accentColor = '#4a90d9', onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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
          year: year.fiscal_period ? year.fiscal_period.slice(0, 4) : '—',
          revenue: parseFloat(year.revenue) || 0,
          netIncome: parseFloat(year.net_income) || 0,
        }));

        if (!cancelled) setData(chartData);
      } catch (err) {
        if (!cancelled && err.name !== 'AbortError') {
          onError?.(err);
          setData([]);
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [ticker, onError, accentColor]);

  /* ── Loading state: shimmer ─────────────────────────────────────────── */
  if (loading) {
    return (
      <div style={{ height: 90, padding: '4px 0' }}>
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
        height: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#444',
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
        height: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#444',
        fontSize: 9,
      }}>
        No financials
      </div>
    );
  }

  return (
    <div style={{ height: 90, position: 'relative' }}>
      {/* Metric label */}
      <div style={{
        fontSize: 8,
        color: '#666',
        textAlign: 'center',
        lineHeight: '10px',
        marginBottom: 1,
        letterSpacing: '0.3px',
      }}>
        Revenue{hasNetIncome ? ' & Net Income' : ''}
      </div>
      <ResponsiveContainer width="100%" height={78}>
        <BarChart
          data={data}
          margin={{ top: 2, right: 2, bottom: 0, left: 0 }}
          barGap={1}
          barCategoryGap="20%"
        >
          <XAxis
            dataKey="year"
            tick={{ fontSize: 8, fill: '#666' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={yAxisFormatter}
            tick={{ fontSize: 7, fill: '#555' }}
            tickLine={false}
            axisLine={false}
            width={36}
            tickCount={3}
          />
          <Tooltip content={<CustomTooltip />} />
          {hasRevenue && (
            <Bar
              dataKey="revenue"
              name="Revenue"
              radius={[2, 2, 0, 0]}
              maxBarSize={20}
            >
              {data.map((entry, idx) => (
                <Cell key={`rev-${idx}`} fill={accentColor} fillOpacity={0.85} />
              ))}
            </Bar>
          )}
          {hasNetIncome && (
            <Bar
              dataKey="netIncome"
              name="Net Income"
              radius={[2, 2, 0, 0]}
              maxBarSize={20}
            >
              {data.map((entry, idx) => (
                <Cell
                  key={`ni-${idx}`}
                  fill={entry.netIncome >= 0 ? '#4caf50' : '#ef5350'}
                  fillOpacity={0.85}
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
