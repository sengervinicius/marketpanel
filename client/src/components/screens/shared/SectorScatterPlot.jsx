/**
 * SectorScatterPlot.jsx
 * Scatter plot for valuation vs growth analysis using Recharts.
 * Phase 8: Migrated to design tokens for visual consistency.
 */
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Label } from 'recharts';

/* SVG elements cannot resolve CSS custom properties —
   hardcoded hex values here are intentional (matching tokens.css) */
const TOKEN_HEX = {
  bgPanel:      '#0a0a0f',
  bgSurface:    '#0d0d14',
  borderDefault:'#1a1a2a',
  borderSubtle: '#141420',
  textPrimary:  '#e8e8ed',
  textSecondary:'#999999',
  textMuted:    '#555570',
  textFaint:    '#3a3a4a',
  accent:       '#ff6600',
};

function CustomTooltip({ active, payload }) {
  if (active && payload && payload[0]) {
    const { ticker, x, y } = payload[0].payload;
    return (
      <div style={{
        background: 'var(--bg-tooltip)',
        border: '1px solid var(--border-strong)',
        padding: '6px 8px',
        borderRadius: 4,
        fontSize: 9,
        color: 'var(--text-primary)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 600 }}>{ticker}</div>
        <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>X: {x.toFixed(2)}</div>
        <div style={{ color: 'var(--text-secondary)' }}>Y: {y.toFixed(2)}</div>
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
      fill={TOKEN_HEX.textPrimary}
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
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
        No data available
      </div>
    );
  }

  return (
    <div style={{ padding: '8px' }}>
      {title && (
        <div style={{
          fontSize: 9,
          color: 'var(--text-muted)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 50 }} style={{ background: TOKEN_HEX.bgSurface }}>
          <XAxis
            type="number"
            dataKey="x"
            stroke={TOKEN_HEX.borderDefault}
            style={{ fontSize: 9, fill: TOKEN_HEX.textMuted }}
            label={{ value: xLabel, position: 'insideBottomRight', offset: -15, fontSize: 9, fill: TOKEN_HEX.textMuted }}
          />
          <YAxis
            type="number"
            dataKey="y"
            stroke={TOKEN_HEX.borderDefault}
            style={{ fontSize: 9, fill: TOKEN_HEX.textMuted }}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: TOKEN_HEX.textMuted }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter
            name="Tickers"
            data={data}
            fill={TOKEN_HEX.accent}
            onClick={(_, index) => {
              const ticker = data[index]?.ticker;
              if (ticker && onDotClick) onDotClick(ticker);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={TOKEN_HEX.accent}
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
