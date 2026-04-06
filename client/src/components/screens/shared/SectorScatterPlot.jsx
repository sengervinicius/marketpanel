/**
 * SectorScatterPlot.jsx
 * Scatter plot for valuation vs growth analysis using Recharts.
 */
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Label } from 'recharts';

function CustomTooltip({ active, payload }) {
  if (active && payload && payload[0]) {
    const { ticker, x, y } = payload[0].payload;
    return (
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #1e1e1e',
        padding: '6px 8px',
        borderRadius: 3,
        fontSize: 9,
        color: '#e0e0e0',
      }}>
        <div style={{ fontWeight: 600 }}>{ticker}</div>
        <div style={{ color: '#999', marginTop: 2 }}>X: {x.toFixed(2)}</div>
        <div style={{ color: '#999' }}>Y: {y.toFixed(2)}</div>
      </div>
    );
  }
  return null;
}

function renderDotLabel(props) {
  const { cx, cy, payload } = props;
  return (
    <text
      x={cx}
      y={cy - 10}
      textAnchor="middle"
      fill="#e0e0e0"
      fontSize={9}
      fontWeight={500}
      style={{ pointerEvents: 'none' }}
    >
      {payload.ticker}
    </text>
  );
}

export function SectorScatterPlot({
  data = [],
  xLabel = 'X Axis',
  yLabel = 'Y Axis',
  title,
  onDotClick,
  height = 280,
}) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 10 }}>
        No data available
      </div>
    );
  }

  return (
    <div style={{ padding: '8px' }}>
      {title && (
        <div style={{
          fontSize: 9,
          color: '#666',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 50 }} style={{ background: '#111' }}>
          <XAxis
            type="number"
            dataKey="x"
            stroke="#333"
            style={{ fontSize: 9, fill: '#888' }}
            label={{ value: xLabel, position: 'insideBottomRight', offset: -15, fontSize: 9, fill: '#666' }}
          />
          <YAxis
            type="number"
            dataKey="y"
            stroke="#333"
            style={{ fontSize: 9, fill: '#888' }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: '#666' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter
            name="Tickers"
            data={data}
            fill="#ff6b00"
            onClick={(_, index) => {
              const ticker = data[index]?.ticker;
              if (ticker && onDotClick) onDotClick(ticker);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill="#ff6b00"
                style={{ cursor: onDotClick ? 'pointer' : 'default', opacity: 0.8 }}
              />
            ))}
            <Label dataKey="ticker" position="top" content={renderDotLabel} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SectorScatterPlot;
