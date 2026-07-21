/**
 * CurveChart — plain-SVG multi-series yield-curve plot for the overlay
 * rooms (Phase S §4). Deliberately NOT recharts: the overlay cells match
 * the mockup's hand-drawn curve look (thin strokes, mono axis labels)
 * and shouldn't pull the recharts chunk for a 70px sparkline.
 *
 * props:
 *   series: [{ id, label, color, points: [{ tenor, months?, rate }], dashed? }]
 *   height: svg pixel height (width is fluid, viewBox 720)
 *   compact: no y-axis labels + tighter padding (mini cells)
 */

// Tenor → months fallback for series that don't carry months (US ghost).
const TENOR_MONTHS = {
  DI: 0.5, '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36, '4Y': 48,
  '5Y': 60, '7Y': 84, '10Y': 120, '20Y': 240, '30Y': 360,
};

function monthsOf(p) {
  if (Number.isFinite(p.months)) return p.months;
  if (TENOR_MONTHS[p.tenor] != null) return TENOR_MONTHS[p.tenor];
  const m = /^(\d+(?:\.\d+)?)Y$/.exec(p.tenor || '');
  return m ? parseFloat(m[1]) * 12 : null;
}

export default function CurveChart({ series = [], height = 220, compact = false }) {
  const W = 720;
  const H = height;
  const padL = compact ? 6 : 40;
  const padR = 10;
  const padT = 8;
  const padB = compact ? 16 : 20;

  // Normalized point lists (drop points without months/rate).
  const norm = series
    .map(s => ({
      ...s,
      pts: (s.points || [])
        .map(p => ({ ...p, m: monthsOf(p) }))
        .filter(p => p.m != null && Number.isFinite(p.rate))
        .sort((a, b) => a.m - b.m),
    }))
    .filter(s => s.pts.length >= 2);

  if (!norm.length) {
    return <div className="ol-placeholder">NO CURVE DATA</div>;
  }

  const allPts = norm.flatMap(s => s.pts);
  const maxM = Math.max(...allPts.map(p => p.m));
  const minR0 = Math.min(...allPts.map(p => p.rate));
  const maxR0 = Math.max(...allPts.map(p => p.rate));
  const pad = Math.max((maxR0 - minR0) * 0.12, 0.15);
  const minR = minR0 - pad;
  const maxR = maxR0 + pad;

  // sqrt-of-months x scale: short end readable, long end not squashed.
  const x = (m) => padL + (Math.sqrt(m) / Math.sqrt(maxM)) * (W - padL - padR);
  const y = (r) => padT + (1 - (r - minR) / (maxR - minR)) * (H - padT - padB);

  const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ');

  // Y gridlines (skip in compact mode).
  const gridN = 4;
  const grid = compact ? [] : Array.from({ length: gridN + 1 }, (_, i) => minR + (i * (maxR - minR)) / gridN);

  // X tenor labels from the series with the most points, thinned to ≤7.
  const primary = norm.reduce((a, b) => (b.pts.length > a.pts.length ? b : a), norm[0]);
  const step = Math.max(1, Math.ceil(primary.pts.length / 7));
  const xLabels = primary.pts.filter((_, i) => i % step === 0 || i === primary.pts.length - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Yield curve chart">
      {grid.map((r, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(r)} y2={y(r)} stroke="var(--border-subtle)" strokeWidth="1" />
          <text x={padL - 5} y={y(r) + 3} fontSize="9" fill="var(--text-muted)" textAnchor="end" fontFamily="var(--font-mono)">
            {r.toFixed(1)}
          </text>
        </g>
      ))}
      {xLabels.map((p, i) => (
        <text key={i} x={x(p.m)} y={H - 4} fontSize={compact ? 8 : 9} fill="var(--text-muted)" textAnchor="middle" fontFamily="var(--font-mono)">
          {p.tenor}
        </text>
      ))}
      {norm.map(s => (
        <g key={s.id}>
          <path
            d={pathOf(s.pts)}
            fill="none"
            stroke={s.color || 'var(--accent)'}
            strokeWidth={s.dashed ? 1 : 1.5}
            strokeDasharray={s.dashed ? '4 4' : undefined}
            opacity={s.dashed ? 0.7 : 1}
          />
          {!s.dashed && !compact && s.pts.map((p, i) => (
            <circle key={i} cx={x(p.m)} cy={y(p.rate)} r="2" fill={s.color || 'var(--accent)'}>
              <title>{`${s.label || s.id} ${p.tenor}: ${p.rate.toFixed(2)}%`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
  );
}
