/**
 * InlineChart.jsx — Lightweight, self-contained inline chart component
 *
 * Renders small charts directly in AI responses using pure SVG.
 * Types: sparkline (single ticker over time), comparison (multi-ticker overlay),
 *        bar (horizontal bar chart for metrics/sectors)
 *
 * Props:
 *   - type: 'sparkline' | 'comparison' | 'bar'
 *   - tickers: string or array of ticker strings
 *   - period: '1M', '3M', '6M', '1Y' (default '1M')
 *   - title: optional title
 *   - height: optional custom height in px (default 80 for sparkline, 120 for others)
 *
 * Data source: Fetches from /api/instruments/history or mock data
 * Theme: Dark terminal (#111116 bg), colored lines (#00ff88 green, #ff4444 red, #4488ff blue)
 */

import { TOKEN_HEX } from '../../utils/tokenHex';
import { useEffect, useState, useRef, memo } from 'react';
import { API_BASE, apiFetch } from '../../utils/api';
import './InlineChart.css';

// Color palette for terminal
const COLORS = {
  green: '#00ff88',
  red: '#ff4444',
  blue: '#4488ff',
  purple: '#aa44ff',
  orange: '#ff8844',
  yellow: '#ffdd44',
};

const COLOR_LIST = [COLORS.green, COLORS.blue, COLORS.orange, COLORS.purple];

/**
 * Parse period string to days
 */
function periodToDays(period) {
  const map = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365 };
  return map[period] || 30;
}

/**
 * Fetch historical price data for a ticker
 */
async function fetchHistoricalData(ticker, period = '1M') {
  // Real candles only. This previously returned generateMockPriceData() — a
  // Math.random() walk — so any AI answer containing [chart:...] rendered a
  // plausible-looking chart of INVENTED prices. Never synthesise market data.
  try {
    const resp = await apiFetch(
      `/api/history/${encodeURIComponent(String(ticker).toUpperCase())}?period=${encodeURIComponent(period)}&interval=1d`
    );
    if (!resp || !resp.ok) return null;
    const json = await resp.json();
    const candles = Array.isArray(json?.candles) ? json.candles : [];
    if (!candles.length) return null;
    return candles
      .filter(c => c && c.c != null)
      .map(c => {
        const ts = typeof c.t === 'number' ? (c.t < 1e12 ? c.t * 1000 : c.t) : Date.parse(c.t);
        return {
          timestamp: ts,
          date: new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          open: c.o ?? c.c,
          high: c.h ?? c.c,
          low: c.l ?? c.c,
          close: c.c,
          volume: c.v ?? 0,
        };
      });
  } catch (err) {
    console.error('[InlineChart] Data fetch error:', err);
    return null;
  }
}


/**
 * SparklineChart — Mini line chart with gradient fill
 */
function SparklineChart({ data, ticker, height = 80, width = '100%' }) {
  if (!data || data.length === 0) {
    return <div className="inline-chart-error">No data for {ticker}</div>;
  }

  const closes = data.map(d => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;

  // SVG dimensions
  const svgHeight = height;
  const svgWidth = typeof width === 'number' ? width : 300; // fallback
  const padding = { top: 8, bottom: 20, left: 8, right: 8 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  // Scale functions
  const scaleX = (i) => (i / (closes.length - 1)) * chartWidth + padding.left;
  const scaleY = (val) => svgHeight - padding.bottom - ((val - min) / range) * chartHeight;

  // Create polyline path
  const points = closes.map((val, i) => `${scaleX(i)},${scaleY(val)}`).join(' ');

  // Determine color: green if up, red if down
  const isUp = closes[closes.length - 1] >= closes[0];
  const lineColor = isUp ? COLORS.green : COLORS.red;

  // Price range labels
  const maxPrice = Math.max(...closes).toFixed(2);
  const minPrice = Math.min(...closes).toFixed(2);

  return (
    <div className="inline-chart-container sparkline">
      <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="inline-chart-svg">
        <defs>
          <linearGradient id={`grad-${ticker}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines (subtle) */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={svgHeight - padding.bottom} stroke="#333333" strokeWidth="1" />
        <line x1={padding.left} y1={svgHeight - padding.bottom} x2={svgWidth - padding.right} y2={svgHeight - padding.bottom} stroke="#333333" strokeWidth="1" />

        {/* Filled area under line */}
        <polyline
          points={`${padding.left},${svgHeight - padding.bottom} ${points} ${svgWidth - padding.right},${svgHeight - padding.bottom}`}
          fill={`url(#grad-${ticker})`}
          stroke="none"
        />

        {/* Line */}
        <polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Min/Max labels */}
        <text x={padding.left + 4} y={scaleY(max) - 4} fontSize="10" fill={lineColor} className="inline-chart-label">
          {maxPrice}
        </text>
        <text x={padding.left + 4} y={scaleY(min) + 12} fontSize="10" fill={lineColor} className="inline-chart-label">
          {minPrice}
        </text>
      </svg>
      <div className="inline-chart-footer">
        <span className="inline-chart-ticker">{ticker}</span>
        <span className={`inline-chart-change ${isUp ? 'up' : 'down'}`}>
          {isUp ? '▲' : '▼'} {Math.abs((closes[closes.length - 1] - closes[0]) / closes[0] * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

/**
 * ComparisonChart — Multi-line overlay chart
 */
function ComparisonChart({ dataMap, tickers, height = 120 }) {
  if (!dataMap || tickers.length === 0) {
    return <div className="inline-chart-error">No data for comparison</div>;
  }

  const svgHeight = height;
  const svgWidth = 400;
  const padding = { top: 20, bottom: 30, left: 40, right: 40 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;

  // Normalize all data to percentage change
  const normalized = {};
  let globalMin = 0;
  let globalMax = 100;

  for (const ticker of tickers) {
    const data = dataMap[ticker];
    if (!data || data.length === 0) continue;

    const closes = data.map(d => d.close);
    const basePrice = closes[0];
    const pctChanges = closes.map(c => ((c - basePrice) / basePrice) * 100);
    normalized[ticker] = pctChanges;

    globalMin = Math.min(globalMin, ...pctChanges);
    globalMax = Math.max(globalMax, ...pctChanges);
  }

  const range = globalMax - globalMin || 1;
  const scaleX = (i, len) => (i / (len - 1)) * chartWidth + padding.left;
  const scaleY = (val) => svgHeight - padding.bottom - ((val - globalMin) / range) * chartHeight;

  return (
    <div className="inline-chart-container comparison">
      <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="inline-chart-svg">
        {/* Axes */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={svgHeight - padding.bottom} stroke="#333333" strokeWidth="1" />
        <line x1={padding.left} y1={svgHeight - padding.bottom} x2={svgWidth - padding.right} y2={svgHeight - padding.bottom} stroke="#333333" strokeWidth="1" />

        {/* Y-axis labels */}
        <text x={padding.left - 8} y={padding.top + 8} fontSize="10" fill="#888888" textAnchor="end">
          {globalMax.toFixed(0)}%
        </text>
        <text x={padding.left - 8} y={svgHeight - padding.bottom + 4} fontSize="10" fill="#888888" textAnchor="end">
          {globalMin.toFixed(0)}%
        </text>

        {/* Lines for each ticker */}
        {tickers.map((ticker, idx) => {
          const pcts = normalized[ticker];
          if (!pcts || pcts.length === 0) return null;

          const color = COLOR_LIST[idx % COLOR_LIST.length];
          const points = pcts.map((val, i) => `${scaleX(i, pcts.length)},${scaleY(val)}`).join(' ');

          return (
            <polyline
              key={ticker}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>

      {/* Legend */}
      <div className="inline-chart-legend">
        {tickers.map((ticker, idx) => (
          <div key={ticker} className="inline-chart-legend-item">
            <span className="legend-dot" style={{ backgroundColor: COLOR_LIST[idx % COLOR_LIST.length] }}></span>
            <span className="legend-label">{ticker}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * BarChart — Horizontal bar chart for metrics/sectors
 */
function BarChart({ data, height = 120 }) {
  if (!data || data.length === 0) {
    return <div className="inline-chart-error">No data for bar chart</div>;
  }

  const svgHeight = height;
  const svgWidth = 400;
  const padding = { top: 10, bottom: 10, left: 120, right: 30 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;
  const barHeight = chartHeight / data.length;

  // Get value range
  const values = data.map(d => d.value);
  const maxVal = Math.max(...values);
  const scaleBar = (val) => (val / maxVal) * chartWidth;

  return (
    <div className="inline-chart-container bar">
      <svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="inline-chart-svg">
        {data.map((item, idx) => {
          const y = padding.top + idx * barHeight + barHeight / 2;
          const isPositive = item.value >= 0;
          const color = isPositive ? COLORS.green : COLORS.red;
          const barWidth = Math.abs(scaleBar(item.value));

          return (
            <g key={idx}>
              {/* Label */}
              <text
                x={padding.left - 8}
                y={y + 4}
                fontSize="12"
                fill="#cccccc"
                textAnchor="end"
                className="inline-chart-bar-label"
              >
                {item.label}
              </text>

              {/* Bar */}
              <rect
                x={padding.left}
                y={y - barHeight * 0.35}
                width={barWidth}
                height={barHeight * 0.7}
                fill={color}
                rx="2"
              />

              {/* Value label */}
              <text x={padding.left + barWidth + 4} y={y + 4} fontSize="11" fill={TOKEN_HEX.textSecondary} className="inline-chart-bar-value">
                {item.value.toFixed(1)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Main InlineChart component
 * Memoized to prevent unnecessary re-renders when used in chat responses
 */
const InlineChart = memo(function InlineChart({ type = 'sparkline', tickers, period = '1M', title, height }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataMap, setDataMap] = useState({});
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch data for all tickers
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        const tickerArray = Array.isArray(tickers) ? tickers : [tickers];
        const newDataMap = {};

        // Fetch data for each ticker in parallel
        const promises = tickerArray.map(async (ticker) => {
          const data = await fetchHistoricalData(ticker, period);
          if (data) {
            newDataMap[ticker.toUpperCase()] = data;
          }
        });

        await Promise.all(promises);

        if (mountedRef.current) {
          setDataMap(newDataMap);
          setLoading(false);
        }
      } catch (err) {
        console.error('[InlineChart] Load error:', err);
        if (mountedRef.current) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    load();
  }, [tickers, period]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="inline-chart-skeleton">
        <div className="inline-chart-skeleton-line"></div>
      </div>
    );
  }

  // Error state
  if (error || Object.keys(dataMap).length === 0) {
    return <div className="inline-chart-error">Chart data unavailable</div>;
  }

  // Render based on type
  const defaultHeight = type === 'sparkline' ? 80 : 120;
  const chartHeight = height || defaultHeight;

  return (
    <div className="inline-chart-wrapper">
      {title && <div className="inline-chart-title">{title}</div>}

      {type === 'sparkline' && (
        <SparklineChart data={dataMap[Object.keys(dataMap)[0]]} ticker={Object.keys(dataMap)[0]} height={chartHeight} />
      )}

      {type === 'comparison' && (
        <ComparisonChart dataMap={dataMap} tickers={Object.keys(dataMap)} height={chartHeight} />
      )}

      {type === 'bar' && <BarChart data={parseBarData(tickers)} height={chartHeight} />}
    </div>
  );
});

export default InlineChart;

/**
 * Parse bar chart data from comma-separated label=value pairs
 * Example: "AAPL=5.2,MSFT=3.8,NVDA=7.1"
 */
function parseBarData(tickersStr) {
  if (typeof tickersStr !== 'string') return [];
  return tickersStr.split(',').map((item) => {
    const [label, valueStr] = item.trim().split('=');
    return {
      label: label || 'N/A',
      value: parseFloat(valueStr) || 0,
    };
  });
}
