/**
 * ComparisonBarChart.jsx — Phase C
 * Horizontal bar chart for comparing metrics across tickers/sectors.
 * Supports: performance comparison, valuation comparison, volume comparison.
 */
import { memo, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

const TOKEN_HEX = {
  bgPanel:       '#0a0a0f',
  bgSurface:     '#0d0d14',
  borderDefault: '#1a1a2a',
  textPrimary:   '#e8e8ed',
  textSecondary: '#999999',
  textMuted:     '#555570',
  textFaint:     '#3a3a4a',
  accent:        '#F97316',
  up:            '#22c55e',
  down:          '#ef4444',
};

function barColor(val, accentColor) {
  if (val == null) return TOKEN_HEX.textFaint;
  if (val >= 0) return TOKEN_HEX.up;
  return TOKEN_HEX.down;
}

function CustomTooltip({ active, payload, label, valueLabel }) {
  if (active && payload && payload[0]) {
    const v = payload[0].value;
    return (
      <div style={{
        background: 'var(--bg-tooltip, #111118)',
        border: '1px solid var(--border-strong, #2a2a3a)',
        padding: '6px 10px',
        borderRadius: 4,
        fontSize: 10,
        color: TOKEN_HEX.textPrimary,
        boxShadow: '0 2px 12px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: v >= 0 ? TOKEN_HEX.up : TOKEN_HEX.down, marginTop: 2 }}>
          {valueLabel || 'Value'}: {v != null ? (typeof v === 'number' ? v.toFixed(2) : v) : '—'}
        </div>
      </div>
    );
  }
  return null;
}

export const ComparisonBarChart = memo(function ComparisonBarChart({
  data = [],
  title,
  valueLabel = 'Change %',
  height = 280,
  layout = 'horizontal',
  accentColor,
  showZeroLine = true,
  onBarClick,
}) {
  // data: [{ ticker: 'AAPL', label: 'Apple', value: 5.2 }, ...]
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => (b.value || 0) - (a.value || 0));
  }, [data]);

  if (!sortedData || sortedData.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 10 }}>
        No data available
      </div>
    );
  }

  const isHorizontal = layout === 'horizontal';

  return (
    <div style={{ padding: '8px' }}>
      {title && (
        <div style={{
          fontSize: 9,
          color: accentColor || 'var(--text-muted)',
          marginBottom: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 600,
        }}>
          {title}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={sortedData}
          layout={isHorizontal ? 'vertical' : 'horizontal'}
          margin={isHorizontal
            ? { top: 5, right: 20, bottom: 5, left: 60 }
            : { top: 5, right: 10, bottom: 30, left: 10 }
          }
        >
          {isHorizontal ? (
            <>
              <XAxis
                type="number"
                stroke={TOKEN_HEX.borderDefault}
                tick={{ fontSize: 9, fill: TOKEN_HEX.textMuted }}
              />
              <YAxis
                type="category"
                dataKey="label"
                stroke={TOKEN_HEX.borderDefault}
                tick={{ fontSize: 9, fill: TOKEN_HEX.textSecondary }}
                width={55}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                stroke={TOKEN_HEX.borderDefault}
                tick={{ fontSize: 8, fill: TOKEN_HEX.textSecondary, angle: -45, textAnchor: 'end' }}
                height={40}
              />
              <YAxis
                stroke={TOKEN_HEX.borderDefault}
                tick={{ fontSize: 9, fill: TOKEN_HEX.textMuted }}
              />
            </>
          )}
          <Tooltip content={<CustomTooltip valueLabel={valueLabel} />} />
          {showZeroLine && (
            <ReferenceLine
              {...(isHorizontal ? { x: 0 } : { y: 0 })}
              stroke="rgba(255,255,255,0.12)"
              strokeDasharray="3 3"
            />
          )}
          <Bar
            dataKey="value"
            radius={[2, 2, 2, 2]}
            maxBarSize={20}
            onClick={(entry) => {
              if (onBarClick && entry?.ticker) onBarClick(entry.ticker);
            }}
            cursor={onBarClick ? 'pointer' : 'default'}
          >
            {sortedData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={barColor(entry.value, accentColor)}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

export default ComparisonBarChart;
