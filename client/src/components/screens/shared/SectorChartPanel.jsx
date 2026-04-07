/**
 * SectorChartPanel.jsx — Sprint 5 rewrite
 * Multi-chart grid for sector-wide technical analysis.
 *
 * Sprint 5 fixes:
 *  - Task 3: Fixed chart blinking — serialize tickers for useEffect deps
 *    instead of using array reference (new reference each render bypassed memo)
 *  - Task 4: Added timeframe selector (1D/1W/1M/3M/6M/1Y) matching home screen
 *    and SectorChartStrip patterns
 *  - Task 5: Updated visual styling to match home screen chart style
 */
import { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../../../utils/api';
import { useIsMobile } from '../../../hooks/useIsMobile';

/* ── Timeframe ranges (same as home screen ChartPanel + SectorChartStrip) ── */
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
        background: '#0a0a0a',
        border: '1px solid #1e1e1e',
        padding: '6px 8px',
        borderRadius: 3,
        fontSize: 9,
        color: '#e0e0e0',
      }}>
        <div style={{ color: '#999' }}>{date}</div>
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
      background: 'linear-gradient(90deg, #1a1a1a 25%, #222 50%, #1a1a1a 75%)',
      backgroundSize: '200% 100%',
      animation: 'ds-shimmer 1.5s infinite',
      borderRadius: 2,
    }} />
  );
}

const SingleChart = memo(function SingleChart({ ticker, data, height, onTickerClick }) {
  if (!data || data.length === 0) {
    return (
      <div style={{
        border: '1px solid #1e1e1e',
        borderRadius: 2,
        padding: 8,
        height,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#e0e0e0', marginBottom: 8, cursor: 'pointer' }} onClick={() => onTickerClick?.(ticker)}>
          {ticker}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ width: '60%', height: 1, background: '#1e1e1e' }} />
          <span style={{ color: '#888', fontSize: 10, fontWeight: 500, letterSpacing: '0.5px' }}>
            Chart data unavailable
          </span>
          <div style={{ width: '60%', height: 1, background: '#1e1e1e' }} />
        </div>
      </div>
    );
  }

  const first = data[0].close;
  const last = data[data.length - 1].close;
  const isUp = last >= first;
  const changePct = ((last - first) / first * 100).toFixed(2);
  const areaColor = isUp ? '#4caf50' : '#f44336';

  const dateRange = `${data[0].date} - ${data[data.length - 1].date}`;

  return (
    <div style={{
      border: '1px solid #1e1e1e',
      borderRadius: 2,
      padding: 8,
      height,
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0a',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        marginBottom: 8,
        borderBottom: '1px solid #151515',
        paddingBottom: 6,
      }}>
        <div
          style={{ fontSize: 11, fontWeight: 600, color: '#e0e0e0', cursor: 'pointer' }}
          onClick={() => onTickerClick?.(ticker)}
        >
          {ticker}
        </div>
        <div style={{ fontSize: 9, color: '#999' }}>${last.toFixed(2)}</div>
        <div style={{ fontSize: 9, color: isUp ? '#4caf50' : '#f44336', fontWeight: 500 }}>
          {isUp ? '+' : ''}{changePct}%
        </div>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 0, right: 8, bottom: 24, left: 30 }}>
          <defs>
            <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={areaColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={areaColor} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" style={{ fontSize: 8, fill: '#666' }} />
          <YAxis
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 8, fill: '#666' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v.toFixed(0)}`}
            width={45}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="close"
            fill={`url(#grad-${ticker})`}
            stroke={areaColor}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{
        fontSize: 8,
        color: '#555',
        marginTop: 6,
        textAlign: 'center',
      }}>
        {dateRange}
      </div>
    </div>
  );
});

/* ── Range Selector Bar ──────────────────────────────────────────────── */
function RangeBar({ rangeIdx, onChange, accentColor }) {
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
            background: i === rangeIdx ? (accentColor || '#ff6b00') : 'transparent',
            color: i === rangeIdx ? '#000' : '#888',
            border: i === rangeIdx ? 'none' : '1px solid #333',
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
}

export function SectorChartPanel({ tickers = [], height = 200, cols = 2, accentColor }) {
  const isMobile = useIsMobile();
  const [chartData, setChartData] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [rangeIdx, setRangeIdx] = useState(3); // Default to 3M

  const gridCols = isMobile ? 1 : cols;

  // Sprint 5: Serialize tickers for stable dependency comparison
  const tickerKey = useMemo(() => tickers.join(','), [tickers]);

  // Sprint 3: 10s loading timeout for charts
  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const timer = setTimeout(() => {
      setTimedOut(true);
      setLoading(false);
      setFetchError('Charts timed out after 10 seconds');
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (!tickerKey) {
      setChartData({});
      setLoading(false);
      return;
    }

    const tickerList = tickerKey.split(',');

    const fetchCharts = async () => {
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

        const promises = tickerList.map(ticker =>
          apiFetch(`/api/chart/${ticker}?from=${fromDate}&to=${toDate}&timespan=${range.timespan}&multiplier=${range.multiplier}`)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        );

        const results = await Promise.all(promises);
        const newChartData = {};

        results.forEach((result, idx) => {
          const ticker = tickerList[idx];
          if (result) {
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

            if (transformed.length > 0) {
              newChartData[ticker] = transformed;
            }
          }
        });

        setChartData(newChartData);
      } catch (err) {
        console.error('[SectorChartPanel] Error fetching charts:', err);
        setFetchError(err.message || 'Failed to load charts');
      } finally {
        setLoading(false);
      }
    };

    fetchCharts();
  }, [tickerKey, rangeIdx, retryCount]); // Sprint 5: tickerKey (string) instead of tickers (array ref)

  const handleTickerClick = useCallback((ticker) => {
    console.log('Chart ticker clicked:', ticker);
  }, []);

  if (loading) {
    return (
      <div>
        <RangeBar rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          gap: '1px',
          background: '#1e1e1e',
          padding: '1px',
        }}>
          {tickerKey.split(',').map(ticker => (
            <ChartSkeleton key={ticker} height={height} />
          ))}
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div>
        <RangeBar rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
        <div style={{
          padding: '20px 16px',
          textAlign: 'center',
          color: '#888',
          fontSize: 11,
        }}>
          <div style={{ color: '#ef5350', fontWeight: 600, marginBottom: 6 }}>Charts unavailable</div>
          <div style={{ color: '#666', fontSize: 10, marginBottom: 10 }}>{fetchError}</div>
          <button
            onClick={() => setRetryCount(c => c + 1)}
            style={{
              background: 'transparent',
              border: '1px solid #444',
              color: '#aaa',
              padding: '4px 12px',
              borderRadius: 3,
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >RETRY</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <RangeBar rangeIdx={rangeIdx} onChange={setRangeIdx} accentColor={accentColor} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: '1px',
        background: '#1e1e1e',
        padding: '1px',
      }}>
        {tickerKey.split(',').map(ticker => (
          <SingleChart
            key={ticker}
            ticker={ticker}
            data={chartData[ticker]}
            height={height}
            onTickerClick={handleTickerClick}
          />
        ))}
      </div>
    </div>
  );
}

export default SectorChartPanel;
