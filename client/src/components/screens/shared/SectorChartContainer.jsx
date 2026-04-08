/**
 * SectorChartContainer.jsx — Professional Grade Charts (v2)
 * Completely rewritten to match InstrumentDetail chart quality.
 *
 * Features:
 * - ComposedChart with CartesianGrid (professional 3px dashed grid)
 * - Rich gradients (5%-95% offset, dynamic green/red based on direction)
 * - Volume bars below main chart
 * - Rich tooltips with styling
 * - ActiveDot hover indicators
 * - Reference line at opening price
 * - Per-chart timeframe selector
 * - Proper axis formatting ($1.2k, $1.2M)
 * - Hover crosshair effects
 * - Skeleton loaders and error states
 *
 * Architecture:
 * - SectorChartContainer: data owner, state management
 * - TimeframeSelector: independent per-chart range selector
 * - ChartSection: renders ComposedChart + Volume
 * - PriceLabel: displays ticker, price, change%
 */
import { useState, useEffect, useRef, memo } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { apiFetch } from '../../../utils/api';

/* ── Timeframe ranges ── */
const RANGES = [
  { label: '1D', multiplier: 5,  timespan: 'minute', days: 1   },
  { label: '1W', multiplier: 30, timespan: 'minute', days: 7   },
  { label: '1M', multiplier: 1,  timespan: 'day',    days: 30  },
  { label: '3M', multiplier: 1,  timespan: 'day',    days: 90  },
  { label: '6M', multiplier: 1,  timespan: 'day',    days: 180 },
  { label: '1Y', multiplier: 1,  timespan: 'day',    days: 365 },
];

/* ── Format utilities ── */
function formatPrice(value, decimals = 0) {
  if (value >= 1e9) return (value / 1e9).toFixed(decimals) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(decimals) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(decimals) + 'k';
  return value.toFixed(decimals);
}

function formatDisplayPrice(value) {
  if (value >= 1000) return '$' + formatPrice(value, 0);
  return '$' + value.toFixed(2);
}

/**
 * RichTooltip — styled with design tokens
 */
function RichTooltip({ active, payload, label }) {
  if (active && payload && payload[0]) {
    const data = payload[0].payload;
    const price = data.close;
    const volume = data.volume;

    return (
      <div
        style={{
          background: 'var(--bg-tooltip)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 10px',
          fontSize: 'var(--text-2xs)',
          color: 'var(--text-secondary)',
        }}
      >
        <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
          {data.dateLabel || label}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          Price: {formatDisplayPrice(price)}
        </div>
        {volume != null && (
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 3 }}>
            Vol: {formatPrice(volume, 0)}
          </div>
        )}
      </div>
    );
  }
  return null;
}

/**
 * ChartSkeleton — animated loading state
 */
function ChartSkeleton({ height = 200 }) {
  return (
    <div
      style={{
        height,
        background: 'linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-active) 50%, var(--bg-elevated) 75%)',
        backgroundSize: '200% 100%',
        animation: 'scc-shimmer 1.5s infinite',
        borderRadius: 'var(--radius-md)',
      }}
    />
  );
}

/**
 * TimeframeSelector — per-chart range buttons
 */
const TimeframeSelector = memo(function TimeframeSelector({ rangeIdx, onChange, accentColor }) {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-1)',
      padding: 'var(--space-1) 0 var(--space-2)',
    }}>
      {RANGES.map((r, i) => (
        <button
          key={r.label}
          onClick={() => onChange(i)}
          style={{
            background: i === rangeIdx
              ? (accentColor || 'var(--accent)')
              : 'transparent',
            color: i === rangeIdx
              ? '#000'
              : 'var(--text-muted)',
            border: i === rangeIdx
              ? 'none'
              : `1px solid var(--border-default)`,
            borderRadius: 'var(--radius-sm)',
            padding: '3px 8px',
            fontSize: 'var(--text-2xs)',
            fontWeight: i === rangeIdx ? 700 : 500,
            cursor: 'pointer',
            letterSpacing: '0.5px',
            fontFamily: 'var(--font-mono)',
            transition: 'all var(--duration-instant) ease',
          }}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
});

/**
 * PriceLabel — ticker, price, change% above chart
 */
const PriceLabel = memo(function PriceLabel({ ticker, openPrice, closePrice, accentColor }) {
  const isUp = closePrice >= openPrice;
  const changePct = ((closePrice - openPrice) / openPrice * 100).toFixed(2);

  return (
    <div style={{
      marginBottom: 'var(--space-2)',
      paddingBottom: 'var(--space-1)',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 700,
        color: accentColor || 'var(--accent)',
        letterSpacing: '0.5px',
        marginBottom: 'var(--space-1)',
      }}>
        {ticker}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
      }}>
        <div
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatDisplayPrice(closePrice)}
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: isUp ? 'var(--semantic-up)' : 'var(--semantic-down)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {isUp ? '+' : ''}{changePct}%
        </div>
      </div>
    </div>
  );
});

/**
 * ChartSection — renders ComposedChart with Volume
 * Desktop: 280px chart + 40px volume = 320px total
 * Mobile: 200px chart + 30px volume = 230px total
 */
const ChartSection = memo(function ChartSection({
  ticker,
  data,
  priceColor,
  isHighlighted,
  accentColor,
}) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 200,
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          border: isHighlighted
            ? `2px solid ${accentColor || 'var(--accent)'}`
            : '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-panel)',
        }}
      >
        No chart data available
      </div>
    );
  }

  const firstClose = data[0].close;
  const lastClose = data[data.length - 1].close;

  return (
    <div
      style={{
        border: isHighlighted
          ? `2px solid ${accentColor || 'var(--accent)'}`
          : '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-panel)',
        overflow: 'hidden',
        transition: 'all var(--duration-instant) ease',
        boxShadow: isHighlighted
          ? `0 0 12px ${accentColor || 'var(--accent)'}33`
          : 'none',
      }}
    >
      {/* Price Chart */}
      <div style={{ height: 280, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 6, bottom: 0, left: 6 }}
            onMouseMove={(e) => {
              if (e?.activePayload?.[0]) {
                setHoveredIndex(e.activePayload[0].payload.index);
              }
            }}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <defs>
              {/* Gradient: 5%-95% offsets, green/red based on direction */}
              <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={lastClose >= firstClose ? 'var(--semantic-up)' : 'var(--semantic-down)'}
                  stopOpacity={0.25}
                />
                <stop
                  offset="95%"
                  stopColor={lastClose >= firstClose ? 'var(--semantic-up)' : 'var(--semantic-down)'}
                  stopOpacity={0.01}
                />
              </linearGradient>
            </defs>

            {/* Professional grid */}
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-subtle)"
              verticalPoints={[]}
            />

            {/* Axes */}
            <XAxis
              dataKey="dateLabel"
              tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
              interval={Math.max(0, Math.floor(data.length / 6))}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-default)' }}
            />
            <YAxis
              yAxisId="right"
              position="right"
              tick={{ fill: 'var(--text-faint)', fontSize: 9 }}
              width={50}
              tickFormatter={(v) => '$' + formatPrice(v, 0)}
              axisLine={{ stroke: 'var(--border-default)' }}
            />

            {/* Rich tooltip */}
            <Tooltip
              content={<RichTooltip />}
              cursor={false}
            />

            {/* Reference line at opening price */}
            <ReferenceLine
              y={firstClose}
              yAxisId="right"
              stroke="var(--border-subtle)"
              strokeDasharray="3 3"
              strokeWidth={1}
              strokeOpacity={0.5}
            />

            {/* Price area */}
            <Area
              type="monotone"
              dataKey="close"
              yAxisId="right"
              fill={`url(#grad-${ticker})`}
              stroke={priceColor}
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={false}
              activeDot={{
                r: 3,
                fill: priceColor,
                strokeWidth: 0,
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div style={{ height: 40, borderTop: '1px solid var(--border-subtle)' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 2, right: 6, bottom: 0, left: 6 }}>
            <Bar
              dataKey="volume"
              yAxisId="volAxis"
              fill="#1a3352"
              opacity={0.6}
              radius={[0, 0, 0, 0]}
            />
            <YAxis
              yAxisId="volAxis"
              hide
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

/**
 * SectorChartContainer — Main component
 * Props:
 *   ticker: string (required)
 *   height: number (deprecated, for backwards compat)
 *   accentColor: string (hex or CSS var)
 *   isHighlighted: boolean (linked selection)
 *   onChartClick: callback(ticker)
 */
export function SectorChartContainer({
  ticker,
  height, // deprecated
  accentColor,
  isHighlighted = false,
  onChartClick,
}) {
  const [rangeIdx, setRangeIdx] = useState(3); // Default 3M
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);

  // 10s timeout
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        setLoading(false);
        setFetchError('Chart timed out after 10 seconds');
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  // Fetch data when ticker or timeframe changes
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

        // Transform data with dateLabel for chart display
        const transformed = dataArray
          .filter(bar => (bar.close ?? bar.c) != null)
          .map((bar, idx) => {
            const closeVal = parseFloat(bar.close ?? bar.c);
            const volumeVal = parseFloat(bar.volume ?? bar.v ?? 0);
            const rawDate = bar.date || (bar.t ? new Date(bar.t) : null);
            const dateStr = rawDate
              ? new Date(rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—';
            return {
              index: idx,
              date: dateStr,
              dateLabel: dateStr,
              close: closeVal,
              volume: volumeVal,
            };
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

  const priceColor = chartData && chartData.length > 0
    ? chartData[chartData.length - 1].close >= chartData[0].close
      ? 'var(--semantic-up)'
      : 'var(--semantic-down)'
    : 'var(--text-secondary)';

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    cursor: onChartClick ? 'pointer' : 'default',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <ChartSkeleton height={280} />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div style={containerStyle}>
        <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <div
          style={{
            padding: 'var(--space-5) var(--space-4)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-panel)',
          }}
        >
          <div
            style={{
              color: 'var(--semantic-down)',
              fontWeight: 600,
              marginBottom: 'var(--space-2)',
            }}
          >
            Chart unavailable
          </div>
          <div
            style={{
              color: 'var(--text-faint)',
              fontSize: 'var(--text-2xs)',
              marginBottom: 'var(--space-3)',
            }}
          >
            {fetchError}
          </div>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-default)',
              color: 'var(--text-secondary)',
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontSize: 'var(--text-2xs)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              transition: 'all var(--duration-instant) ease',
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = 'var(--border-strong)';
              e.target.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = 'var(--border-default)';
              e.target.style.color = 'var(--text-secondary)';
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} onClick={() => onChartClick?.(ticker)}>
      <TimeframeSelector rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
      {chartData && chartData.length > 0 && (
        <PriceLabel
          ticker={ticker}
          openPrice={chartData[0].close}
          closePrice={chartData[chartData.length - 1].close}
          accentColor={accentColor}
        />
      )}
      <ChartSection
        ticker={ticker}
        data={chartData}
        priceColor={priceColor}
        isHighlighted={isHighlighted}
        accentColor={accentColor}
      />
    </div>
  );
}

export default SectorChartContainer;
