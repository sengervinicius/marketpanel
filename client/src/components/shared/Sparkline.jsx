/**
 * Sparkline.jsx — Mini inline chart component
 *
 * Renders a 60×20px SVG polyline showing price trend.
 * Features:
 * - Auto-normalizes data to fit height
 * - Color based on price direction (green if up, red if down)
 * - 1px stroke weight
 * - Smooth polyline rendering
 */

import React, { useMemo } from 'react';

export default function Sparkline({
  data = [],
  width = 60,
  height = 20,
  color = null,
  strokeWidth = 1.5,
  className = '',
}) {
  const points = useMemo(() => {
    if (!data || data.length < 2) return [];

    // Filter out null values
    const validData = data.filter(v => v != null && !isNaN(v));
    if (validData.length < 2) return [];

    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const range = max - min || 1; // Avoid division by zero

    // Map data to SVG coordinates
    return data.map((val, idx) => {
      if (val == null || isNaN(val)) return null;
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return { x, y, value: val };
    }).filter(p => p != null);
  }, [data, width, height]);

  if (points.length < 2) {
    return <span style={{ display: 'inline-block', width, height }} />;
  }

  // Determine color: green if trend is up, red if down
  const first = data[0];
  const last = data[data.length - 1];
  const isUp = (last ?? 0) >= (first ?? 0);
  const finalColor = color || (isUp ? 'var(--semantic-up)' : 'var(--semantic-down)');

  // Build polyline points string
  const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        marginLeft: 4,
      }}
      aria-hidden="true"
    >
      <polyline
        points={pointsStr}
        fill="none"
        stroke={finalColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
