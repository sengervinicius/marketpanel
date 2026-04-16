/**
 * SectorScatterPlot.jsx
 * Enhanced scatter plot for valuation vs growth/size analysis.
 * Features: bubble sizing, better tooltips, quadrant labels, click-to-detail.
 */
import { useMemo } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

const TOKEN_HEX = {
  bgPanel:      '#0a0a0f',
  bgSurface:    '#0d0d14',
  borderDefault:'#1a1a2a',
  borderSubtle: '#141420',
  textPrimary:  '#e8e8ed',
  textSecondary:'#999999',
  textMuted:    '#555570',
  textFaint:    '#3a3a4a',
  accent:       '#F97316',
};

/* ── Dot colors by relative position ────────────────────────────────────── */
const DOT_COLORS = ['#00bcd4', '#F97316', '#4caf50', '#e91e63', '#ffc107', '#9c27b0', '#03a9f4', '#ff5722', '#8bc34a', '#cddc39'];

function EnhancedTooltip({ active, payload, xLabel, yLabel }) {
  if (active && payload && payload[0]) {
    const d = payload[0].payload;
    return (
      <div style={{
        background: '#111118',
        border: '1px solid #2a2a3a',
        padding: '10px 14px',
        borderRadius: 6,
        fontSize: 12,
        color: TOKEN_HEX.textPrimary,
        boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
        minWidth: 140,
      }}>
        <div style={{
          fontWeight: 700,
          fontSize: 14,
          marginBottom: 6,
          color: d.color || TOKEN_HEX.accent,
          letterSpacing: '0.5px',
        }}>
          {d.ticker}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3 }}>
          <span style={{ color: TOKEN_HEX.textMuted, fontSize: 11 }}>{xLabel}:</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {d.x >= 1000 ? d.x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : d.x.toFixed(1)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: TOKEN_HEX.textMuted, fontSize: 11 }}>{yLabel}:</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {d.y >= 1000 ? '$' + (d.y / 1).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'B' : d.y.toFixed(1)}
          </span>
        </div>
        {d.z != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 3 }}>
            <span style={{ color: TOKEN_HEX.textMuted, fontSize: 11 }}>Size:</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{d.z.toFixed(1)}</span>
          </div>
        )}
      </div>
    );
  }
  return null;
}

/**
 * TickerLabel — per-dot label with alternating positions to reduce overlap.
 * Position cycles: top → right → bottom → left based on dot index.
 */
function TickerLabel({ cx, cy, payload, index }) {
  if (!payload?.ticker) return null;
  // Alternate label position by index to avoid crowding
  const positions = [
    { dx: 0, dy: -14, anchor: 'middle' },   // top
    { dx: 14, dy: 3, anchor: 'start' },      // right
    { dx: 0, dy: 18, anchor: 'middle' },     // bottom
    { dx: -14, dy: 3, anchor: 'end' },       // left
  ];
  const pos = positions[(index || 0) % 4];
  return (
    <text
      x={cx + pos.dx}
      y={cy + pos.dy}
      textAnchor={pos.anchor}
      fill="rgba(255,255,255,0.7)"
      fontSize={12}
      fontWeight={600}
      fontFamily="var(--font-mono)"
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
  height = 320,
  accentColor,
}) {
  // Enrich data with colors and calculate medians for reference lines
  const enrichedData = useMemo(() => {
    return data
      .filter(d => d != null && d.ticker != null && typeof d.x === 'number' && typeof d.y === 'number')
      .map((d, i) => ({
        ...d,
        color: DOT_COLORS[i % DOT_COLORS.length],
      }));
  }, [data]);

  const medianX = useMemo(() => {
    const validData = data.filter(d => d != null && typeof d.x === 'number');
    if (validData.length === 0) return 0;
    const sorted = [...validData].sort((a, b) => a.x - b.x);
    return sorted[Math.floor(sorted.length / 2)]?.x || 0;
  }, [data]);

  const medianY = useMemo(() => {
    const validData = data.filter(d => d != null && typeof d.y === 'number');
    if (validData.length === 0) return 0;
    const sorted = [...validData].sort((a, b) => a.y - b.y);
    return sorted[Math.floor(sorted.length / 2)]?.y || 0;
  }, [data]);

  if (!data || data.length === 0) {
    return (
      <div style={{
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 12,
        background: 'rgba(255,255,255,0.02)',
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.04)',
      }}>
        No valuation data available
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px',
      background: 'var(--bg-elevated)',
      borderRadius: 6,
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      {title && (
        <div style={{
          fontSize: 13,
          color: accentColor || 'var(--text-secondary)',
          marginBottom: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          fontWeight: 700,
        }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 45, left: 55 }}>
          {/* Median reference lines — create quadrant feel */}
          <ReferenceLine
            x={medianX}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 4"
          />
          <ReferenceLine
            y={medianY}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 4"
          />
          <XAxis
            type="number"
            dataKey="x"
            stroke={TOKEN_HEX.borderDefault}
            tick={{ fontSize: 12, fill: TOKEN_HEX.textMuted }}
            tickLine={{ stroke: TOKEN_HEX.borderSubtle }}
            axisLine={{ stroke: TOKEN_HEX.borderDefault }}
            label={{
              value: xLabel,
              position: 'insideBottom',
              offset: -10,
              fontSize: 13,
              fill: TOKEN_HEX.textSecondary,
              fontWeight: 600,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            stroke={TOKEN_HEX.borderDefault}
            tick={{ fontSize: 12, fill: TOKEN_HEX.textMuted }}
            tickLine={{ stroke: TOKEN_HEX.borderSubtle }}
            axisLine={{ stroke: TOKEN_HEX.borderDefault }}
            tickFormatter={(v) => {
              if (v >= 1000) return `$${(v / 1).toFixed(0)}B`;
              if (v >= 1) return v.toFixed(0);
              return v.toFixed(1);
            }}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              fontSize: 13,
              fill: TOKEN_HEX.textSecondary,
              fontWeight: 600,
            }}
          />
          {/* Quadrant labels — subtle, muted text */}
          <text x="15%" y="12%" fill="rgba(255,255,255,0.08)" fontSize={11} fontWeight={500}>Cheap &amp; Large</text>
          <text x="75%" y="12%" fill="rgba(255,255,255,0.08)" fontSize={11} fontWeight={500} textAnchor="end">Expensive &amp; Large</text>
          <text x="15%" y="92%" fill="rgba(255,255,255,0.08)" fontSize={11} fontWeight={500}>Cheap &amp; Small</text>
          <text x="75%" y="92%" fill="rgba(255,255,255,0.08)" fontSize={11} fontWeight={500} textAnchor="end">Expensive &amp; Small</text>

          <Tooltip
            content={<EnhancedTooltip xLabel={xLabel} yLabel={yLabel} />}
            cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.1)' }}
          />
          <Scatter
            name="Tickers"
            data={enrichedData}
            onClick={(entry) => {
              if (entry?.ticker && onDotClick) onDotClick(entry.ticker);
            }}
            label={<TickerLabel />}
          >
            {enrichedData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                fillOpacity={0.85}
                stroke={entry.color}
                strokeWidth={1}
                r={8}
                style={{ cursor: onDotClick ? 'pointer' : 'default' }}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Compact legend row */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 12px',
        marginTop: 8,
        paddingTop: 8,
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}>
        {enrichedData.slice(0, 15).map((d) => {
          if (!d?.ticker) return null;
          return (
            <span
              key={d.ticker}
              onClick={() => onDotClick?.(d.ticker)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: TOKEN_HEX.textSecondary,
                cursor: onDotClick ? 'pointer' : 'default',
              }}
            >
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: d.color,
                flexShrink: 0,
              }} />
              {d.ticker}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default SectorScatterPlot;
