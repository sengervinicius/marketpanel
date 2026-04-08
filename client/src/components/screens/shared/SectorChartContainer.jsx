/**
 * SectorChartContainer.jsx — Sprint 5 Phase 5
 * Owns historical data fetching and per-chart timeframe selection.
 *
 * Part of SectorChartPanel refactor:
 * - SectorChartContainer: data fetching + timeframe state (one per ticker)
 * - SectorPriceLabel: live price subscription (one per ticker)
 * - SingleChart: renders the AreaChart visualization
 *
 * This separation ensures:
 * - Price updates don't trigger chart re-renders (independent subscriptions)
 * - Each chart can have its own timeframe selector
 * - Data is fetched only when timeframe changes
 */
import { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../../utils/api';

/* ── Timeframe ranges (same as home screen + SectorChartStrip) ── */
const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1   },
  { label: '1W', multiplier: 30, timespan: 'minute', days: 7   },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30  },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90  },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180 },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365 },
];

function CustomTooltip({ active, payload }) {
  if (active && payload && payload[0]) {
    const { date, close } = payload[0].payload;
    return (
      <div style={{
        background: 'var(--bg-tooltip, #0a0a0a)',
        border: '1px solid var(--border-subtle, #1e1e1e)',
        padding: '6px 8px',
        borderRadius: 3,
        fontSize: 9,
        color: 'var(--text-secondary, #e0e0e0)',
      }}>
        <div style={{ color: 'var(--text-muted, #999)' }}>{date}</div>
        <div>${close.toFixed(2)}</div>
      </div>
    );
  }
  return null;
}

function ChartSkeleton({ height = 200 }) {
  return (
    <div style={{
      height,
      background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-active) 50%, var(--bg-elevated) 75%)',
      backgroundSize: '200% 100%',
      animation: 'ds-shimmer 1.5s infinite',
      borderRadius: 2,
    }} />
  );
}

/**
 * TimeframeSelector — per-chart controls
 * Each chart gets its own independent selector
 */
const TimeframeSelector = memo(function TimeframeSelector({ rangeIdx, onChange, accentColor }) {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      padding: '4px 0 8px',
    }}>
      {RANGES.map((r, i) => (
        <button
          key={r.label}
          onClick={() => onChange(i)}
          style={{
            background: i === rangeIdx ? (accentColor || 'var(--accent, #ff6b00)') : 'transparent',
            color: i === rangeIdx ? '#000' : 'var(--text-muted, #888)',
            border: i === rangeIdx ? 'none' : '1px solid var(--border-default, #333)',
            borderRadius: 3,
            padding: '3px 8px',
            fontSize: 9,
            fontWeight: i === rangeIdx ? 700 : 500,
            cursor: 'pointer',
            letterSpacing: '0.5px',
            transition: 'all 0.15s ease',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
});

/**
 * SingleChart — renders the area chart for one ticker
 * Props:
 *   ticker: string
 *   data: array of { date, close }
 *   height: number (px)
 *   accentColor: string (hex or CSS var)
 *   isHighlighted: boolean (for linked ticker selection)
 */
const SingleChart = memo(function SingleChart({ ticker, data, height, accentColor, isHighlighted }) {
  if (!data || data.length === 0) {
    return (
      <div style={{
        border: isHighlighted ? `2px solid ${accentColor || 'var(--accent)'}` : '1px solid var(--border-default, #1e1e1e)',
        borderRadius: 2,
        padding: 8,
        height,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface, #0a0a0a)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary, #e0e0e0)', marginBottom: 8, cursor: 'pointer' }}>
          {ticker}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: '60%', height: 1, background: 'var(--border-default, #1e1e1e)' }} />
          <span style={{ color: 'var(--text-muted, #888)', fontSize: 10, fontWeight: 500, letterSpacing: '0.5px' }}>
            Chart data unavailable
          </span>
          <div style={{ width: '60%', height: 1, background: 'var(--border-default, #1e1e1e)' }} />
        </div>
      </div>
    );
  }

  const first = data[0].close;
  const last = data[data.length - 1].close;
  const isUp = last >= first;
  const changePct = ((last - first) / first * 100).toFixed(2);
  const areaColor = isUp ? 'var(--price-up, #4caf50)' : 'var(--price-down, #f44336)';

  const dateRange = `${data[0].date} - ${data[data.length - 1].date}`;

  return (
    <div style={{
      border: isHighlighted ? `2px solid ${accentColor || 'var(--accent)'}` : '1px solid var(--border-default, #1e1e1e)',
      borderRadius: 2,
      padding: 8,
      height,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-surface, #0a0a0a)',
      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
      boxShadow: isHighlighted ? `0 0 8px ${accentColor || 'var(--accent)'}33` : 'none',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        marginBottom: 8,
        borderBottom: '1px solid var(--border-subtle, #151515)',
        paddingBottom: 6,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary, #e0e0e0)', cursor: 'pointer' }}>
          {ticker}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted, #999)' }}>${last.toFixed(2)}</div>
        <div style={{ fontSize: 9, color: isUp ? 'var(--price-up, #4caf50)' : 'var(--price-down, #f44336)', fontWeight: 500 }}>
          {isUp ? '+' : ''}{changePct}%
        </div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 8, bottom: 24, left: 30 }}>
          <defs>
            <linearGradient id={`grad-container-${ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={areaColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={areaColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" style={{ fontSize: 8, fill: 'var(--text-muted, #666)' }} />
          <YAxis
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 8, fill: 'var(--text-muted, #666)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v.toFixed(0)}`}
            width={45}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="close"
            fill={`url(#grad-container-${ticker})`}
            stroke={areaColor}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{
        fontSize: 8,
        color: 'var(--text-faint, #555)',
        marginTop: 6,
        textAlign: 'center',
      }}>
        {dateRange}
      </div>
    </div>
  );
});

/**
 * SectorChartContainer — per-chart data owner
 * Props:
 *   ticker: string
 *   height: number (px)
 *   accentColor: string (hex or CSS var)
 *   isHighlighted: boolean (for linked ticker selection)
 *   onChartClick: callback when chart is clicked
 */
export function SectorChartContainer({
  ticker,
  height = 200,
  accentColor,
  isHighlighted = false,
  onChartClick,
}) {
  const [rangeIdx, setRangeIdx] = useState(3); // Default 3M
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const mountedRef = useRef(true);

  // 10s loading timeout
  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const timer = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
      setFetchError('Chart timed out after 10 seconds');
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Fetch chart data when ticker or timeframe changes
  useEffect(() => {
    mountedRef.current = true;

    if (!ticker) {
      setChartData(null);
      setLoading(false);
      return;
    }

    const fetchChart = async () => {
      try {
        setLoading(true);
        setFetchError(null);

        const range = RANGES[rangeIdx];
        const now = new Date();
        const toDate = now.toISOString().split('T')[0];
        const fromDate = (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - range.days);
          return d.toISOString().split('T')[0];
        })();

        const url = `/api/chart/${encodeURIComponent(ticker)}?from=${fromDate}&to=${toDate}&timespan=${range.timespan}&multiplier=${range.multiplier}`;
        const res = await apiFetch(url);

        if (!res.ok) throw new Error(`Status ${res.status}`);
        const result = await res.json();

        if (!mountedRef.current) return;

        let dataArray = [];
        if (Array.isArray(result)) {
          dataArray = result;
        } else if (result.results && Array.isArray(result.results)) {
          dataArray = result.results;
        } else if (result.data && Array.isArray(result.data)) {
          dataArray = result.data;
        }

        const transformed = dataArray
          .filter(bar => (bar.close ?? bar.c) != null)
          .map(bar => {
            const closeVal = parseFloat(bar.close ?? bar.c);
            const rawDate = bar.date || (bar.t ? new Date(bar.t) : null);
            const dateStr = rawDate
              ? new Date(rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—';
            return { date: dateStr, close: closeVal };
          });

        if (mountedRef.current) {
          setChartData(transformed.length > 0 ? transformed : null);
        }
      } catch (err) {
        if (mountedRef.current) {
          console.error(`[SectorChartContainer] Error fetching ${ticker}:`, err);
          setFetchError(err.message || 'Failed to load chart');
          setChartData(null);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    };

    fetchChart();

    return () => {
      mountedRef.current = false;
    };
  }, [ticker, rangeIdx, retryCount]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <ChartSkeleton height={height} />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          color: 'var(--text-muted, #888)',
          fontSize: 11,
          border: '1px solid var(--border-default, #1e1e1e)',
          borderRadius: 2,
          background: 'var(--bg-surface, #0a0a0a)',
        }}>
          <div style={{ color: 'var(--semantic-error, #ef5350)', fontWeight: 600, marginBottom: 6 }}>
            Chart unavailable
          </div>
          <div style={{ color: 'var(--text-faint, #666)', fontSize: 10, marginBottom: 10 }}>
            {fetchError}
          </div>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default, #444)',
              color: 'var(--text-secondary, #aaa)',
              padding: '4px 12px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, cursor: onChartClick ? 'pointer' : 'default' }}
      onClick={() => onChartClick?.(ticker)}
    >
      <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
      <SingleChart
        ticker={ticker}
        data={chartData}
        height={height}
        accentColor={accentColor}
        isHighlighted={isHighlighted}
      />
    </div>
  );
}

export default SectorChartContainer;
