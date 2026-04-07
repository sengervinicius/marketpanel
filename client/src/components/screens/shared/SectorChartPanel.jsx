/**
 * SectorChartPanel.jsx
 * Multi-chart grid for sector-wide technical analysis.
 */
import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, defs, linearGradient, stop } from 'recharts';
import { apiFetch } from '../../../utils/api';
import { useIsMobile } from '../../../hooks/useIsMobile';

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

function SingleChart({ ticker, data, height, onTickerClick }) {
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
          <YAxis domain="dataMin" style={{ fontSize: 8, fill: '#666' }} />
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
}

export function SectorChartPanel({ tickers = [], height = 200, cols = 2 }) {
  const isMobile = useIsMobile();
  const [chartData, setChartData] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const gridCols = isMobile ? 1 : cols;

  useEffect(() => {
    if (!tickers || tickers.length === 0) {
      setChartData({});
      setLoading(false);
      return;
    }

    const fetchCharts = async () => {
      try {
        setLoading(true);
        setFetchError(null);

        // Build correct query params: server expects from, to, timespan, multiplier
        const now = new Date();
        const toDate = now.toISOString().split('T')[0];
        const fromDate = (() => {
          const d = new Date(now);
          d.setMonth(d.getMonth() - 3);
          return d.toISOString().split('T')[0];
        })();

        const promises = tickers.map(ticker =>
          apiFetch(`/api/chart/${ticker}?from=${fromDate}&to=${toDate}&timespan=day&multiplier=1`)
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
        );

        const results = await Promise.all(promises);
        const newChartData = {};

        results.forEach((result, idx) => {
          const ticker = tickers[idx];
          if (result) {
            let dataArray = [];

            // Handle all server response shapes:
            // - direct array: [...]
            // - Polygon/Yahoo/TwelveData: { results: [...] }
            // - wrapped: { ok, data: [...] }
            if (Array.isArray(result)) {
              dataArray = result;
            } else if (result.results && Array.isArray(result.results)) {
              dataArray = result.results;
            } else if (result.data && Array.isArray(result.data)) {
              dataArray = result.data;
            }

            // Transform OHLCV to chartable format
            // Server may return { t, c, o, h, l } (Polygon/Yahoo) or { date, close } (TwelveData)
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
  }, [tickers, retryCount]);

  const handleTickerClick = (ticker) => {
    // Navigation would happen in parent
    console.log('Chart ticker clicked:', ticker);
  };

  if (loading) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: '1px',
        background: '#1e1e1e',
        padding: '1px',
      }}>
        {tickers.map(ticker => (
          <ChartSkeleton key={ticker} height={height} />
        ))}
      </div>
    );
  }

  if (fetchError) {
    return (
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
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
      gap: '1px',
      background: '#1e1e1e',
      padding: '1px',
    }}>
      {tickers.map(ticker => (
        <SingleChart
          key={ticker}
          ticker={ticker}
          data={chartData[ticker]}
          height={height}
          onTickerClick={handleTickerClick}
        />
      ))}
    </div>
  );
}

export default SectorChartPanel;
