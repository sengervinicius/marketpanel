/**
 * MiniFinancials.jsx — Minimalist horizontal bars
 * Clean 3-year revenue display with simple horizontal bars instead of complex chart.
 * Shows years (2023–2025) with proportional green bars and formatted values.
 * Red tint if net income is negative in that year.
 *
 * Design:
 *  - Simple horizontal bars (CSS divs, no Recharts)
 *  - Clean, minimalist look
 *  - Max width ~180px to fit table cells
 *  - Proportional bar widths based on revenue max
 *  - Loading skeleton and error states preserved
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
const FETCH_TIMEOUT = 25000; // 25s timeout for slow API responses
const MAX_RETRIES = 2;
const RETRY_DELAY = 2000; // 2s delay between retries

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
            return; // Success - exit retry loop
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
        opacity: 0.3,
      }}>
        <svg width="60" height="40" viewBox="0 0 60 40">
          <rect x="4" y="20" width="12" height="20" rx="1" fill="#555570" />
          <rect x="20" y="10" width="12" height="30" rx="1" fill="#555570" />
          <rect x="36" y="5" width="12" height="35" rx="1" fill="#555570" />
        </svg>
      </div>
    );
  }

  /* ── Determine if we have any meaningful data ───────────────────────── */
  const hasRevenue = data.some(d => d.revenue !== null && d.revenue !== undefined);
  const hasNetIncome = data.some(d => d.netIncome !== null && d.netIncome !== undefined);

  if (!hasRevenue && !hasNetIncome) {
    return (
      <div style={{
        height: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.3,
      }}>
        <svg width="60" height="40" viewBox="0 0 60 40">
          <rect x="4" y="20" width="12" height="20" rx="1" fill="#555570" />
          <rect x="20" y="10" width="12" height="30" rx="1" fill="#555570" />
          <rect x="36" y="5" width="12" height="35" rx="1" fill="#555570" />
        </svg>
      </div>
    );
  }

  // Find max revenue for proportional scaling
  const maxRevenue = Math.max(...data.map(d => d.revenue || 0));

  return (
    <div style={{
      width: '100%',
      maxWidth: 180,
      padding: '4px 0',
    }}>
      {/* Simple horizontal bars, no axes or labels */}
      {data.map((d, idx) => {
        const hasNegativeNI = d.netIncome !== null && d.netIncome !== undefined && d.netIncome < 0;
        const barWidthPercent = maxRevenue > 0 ? (d.revenue || 0) / maxRevenue * 100 : 0;
        const barColor = hasNegativeNI ? '#d32f2f' : '#4caf50'; // red if neg net income, else green

        return (
          <div key={idx} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: idx < data.length - 1 ? '6px' : 0,
            fontSize: '11px',
            height: '18px',
          }}>
            {/* Year label */}
            <span style={{
              minWidth: '28px',
              color: 'var(--text-secondary)',
              fontSize: '10px',
              fontWeight: 500,
            }}>
              {d.year}
            </span>

            {/* Horizontal bar */}
            <div style={{
              flex: 1,
              minHeight: '8px',
              backgroundColor: barColor,
              borderRadius: '2px',
              width: `${barWidthPercent}%`,
              opacity: hasNegativeNI ? 0.6 : 0.9,
              transition: 'width 0.3s ease',
            }} />

            {/* Revenue value */}
            <span style={{
              minWidth: '32px',
              textAlign: 'right',
              color: 'var(--text-primary)',
              fontSize: '10px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}>
              {fmtFinancial(d.revenue)}
            </span>
          </div>
        );
      })}
    </div>
  );
});

export default MiniFinancials;
