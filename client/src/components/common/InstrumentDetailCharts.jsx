// InstrumentDetailCharts.jsx – Chart overlay components for InstrumentDetail

import { ORANGE, GREEN, RED, fmt } from './InstrumentDetailHelpers';

// ── Custom SVG overlay: diagonal line A→B with delta badge ─────────────────
export function DeltaLineOverlay({ xAxisMap, yAxisMap, bars, deltaA, deltaB, deltaInfo }) {
  if (!deltaInfo || deltaA === null || deltaB === null) return null;
  const [i1, i2] = [deltaA, deltaB].sort((a, b) => a - b);
  const barA = bars[i1], barB = bars[i2];
  if (!barA || !barB) return null;

  const xAxis = xAxisMap && xAxisMap[0];
  const yAxis = yAxisMap && yAxisMap[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const bw = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() / 2 : 0;
  const xA = xAxis.scale(barA.label);
  const xB = xAxis.scale(barB.label);
  if (xA == null || xB == null) return null;
  const xAc = xA + bw, xBc = xB + bw;
  const yAc = yAxis.scale(barA.close);
  const yBc = yAxis.scale(barB.close);

  if ([xAc, xBc, yAc, yBc].some(v => isNaN(v) || v == null)) return null;

  const midX = (xAc + xBc) / 2;
  const midY = (yAc + yBc) / 2 - 18;

  const color  = deltaInfo.pct >= 0 ? GREEN : RED;
  const pctStr = (deltaInfo.pct >= 0 ? '+' : '') + deltaInfo.pct.toFixed(2) + '%';
  const absStr = (deltaInfo.delta >= 0 ? '+' : '') + fmt(Math.abs(deltaInfo.delta));
  const daysStr = deltaInfo.days != null ? `${deltaInfo.days}d` : null;
  const badgeW = 76;
  const badgeH = daysStr ? 44 : 32;

  return (
    <g>
      <line x1={xAc} y1={yAc} x2={xBc} y2={yBc} stroke="#000" strokeWidth={4} opacity={0.4} />
      <line x1={xAc} y1={yAc} x2={xBc} y2={yBc} stroke={color} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.9} />
      <circle cx={xAc} cy={yAc} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      <circle cx={xBc} cy={yBc} r={5} fill={color} stroke="#000" strokeWidth={1.5} />
      <text x={xAc} y={yAc - 10} textAnchor="middle" fill={ORANGE} fontSize={9} fontFamily="var(--font-mono)" fontWeight="bold">A</text>
      <text x={xBc} y={yBc - 10} textAnchor="middle" fill={ORANGE} fontSize={9} fontFamily="var(--font-mono)" fontWeight="bold">B</text>
      <rect x={midX - badgeW / 2} y={midY - badgeH / 2} width={badgeW} height={badgeH} rx={4}
        fill="#0a0a0a" stroke={color} strokeWidth={1} />
      <text x={midX} y={midY - (daysStr ? 8 : 2)} textAnchor="middle" fill={color}
        fontSize={12} fontFamily="var(--font-mono)" fontWeight="bold">{pctStr}</text>
      <text x={midX} y={midY + (daysStr ? 8 : 12)} textAnchor="middle" fill="#888"
        fontSize={9} fontFamily="var(--font-mono)">{absStr}</text>
      {daysStr && (
        <text x={midX} y={midY + 22} textAnchor="middle" fill="#444"
          fontSize={8} fontFamily="var(--font-mono)">{daysStr}</text>
      )}
    </g>
  );
}

// ── Candlestick overlay via Customized — uses Y-axis scale directly ─────────
export function CandlestickOverlay({ formattedGraphicalItems, xAxisMap, yAxisMap, data }) {
  if (!data || !data.length) return null;
  const xAxis = xAxisMap && Object.values(xAxisMap)[0];
  const yAxis = yAxisMap && Object.values(yAxisMap)[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const bandwidth = xAxis.scale.bandwidth ? xAxis.scale.bandwidth() : 8;
  const barWidth = Math.max(bandwidth * 0.7, 2);

  return (
    <g>
      {data.map((bar, i) => {
        const { open, high, low, close, label } = bar;
        if (open == null || close == null || high == null || low == null) return null;

        const xCenter = xAxis.scale(label) + bandwidth / 2;
        if (xCenter == null || isNaN(xCenter)) return null;

        const yOpen  = yAxis.scale(open);
        const yClose = yAxis.scale(close);
        const yHigh  = yAxis.scale(high);
        const yLow   = yAxis.scale(low);
        if ([yOpen, yClose, yHigh, yLow].some(v => v == null || isNaN(v))) return null;

        const isUp = close >= open;
        const color = isUp ? GREEN : RED;
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(Math.abs(yOpen - yClose), 1);

        return (
          <g key={i}>
            {/* Wick */}
            <line x1={xCenter} y1={yHigh} x2={xCenter} y2={yLow}
              stroke={color} strokeWidth={1} />
            {/* Body */}
            <rect
              x={xCenter - barWidth / 2} y={bodyTop}
              width={barWidth} height={bodyH}
              fill={color} stroke={color} strokeWidth={0.5}
              fillOpacity={isUp ? 0.3 : 0.85}
            />
          </g>
        );
      })}
    </g>
  );
}
