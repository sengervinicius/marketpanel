/**
 * Sparkline.jsx — H1.2 row sparkline v2.
 *
 * Pure-SVG mini trend line for ticker rows. Differences vs. the legacy
 * shared/Sparkline (which stays for non-home surfaces like SearchPanel):
 *
 *   • color derives from change vs. a baseline ('first' point or
 *     'prev-close' = second-to-last close) via the H0 TOKEN_HEX export
 *     (SVG attrs can't resolve CSS custom properties);
 *   • damped normalization — the y-domain is padded to a minimum span
 *     of 0.5% of the price level, so a symbol that moved 0.05% doesn't
 *     render as a dramatic min-max swing;
 *   • subtle area fill (0.15 opacity) under a 1.5px line.
 *
 * Rendered in its OWN narrow grid column (see panelColumns.js COL_SPARK),
 * never inside the CHG% cell.
 */
import { useMemo } from 'react';
import { TOKEN_HEX } from '../../utils/tokenHex';

// Minimum visual span as a fraction of the price level (0.5%).
const MIN_SPAN_FRAC = 0.005;

export default function Sparkline({
  data = [],
  width = 48,
  height = 14,
  baseline = 'first',        // 'first' | 'prev-close'
  showFill = true,
  className = '',
}) {
  const geom = useMemo(() => {
    const valid = (data || []).filter(v => v != null && Number.isFinite(v));
    if (valid.length < 2) return null;

    const last = valid[valid.length - 1];
    const base = baseline === 'prev-close' ? valid[valid.length - 2] : valid[0];

    let min = Math.min(...valid);
    let max = Math.max(...valid);
    const mid = (min + max) / 2;
    const level = Math.abs(mid) || Math.abs(last) || 1;
    const minSpan = level * MIN_SPAN_FRAC;
    if (max - min < minSpan) {
      // Damp: tiny ranges get centred inside a 0.5%-of-price window
      // instead of being stretched to full amplitude.
      min = mid - minSpan / 2;
      max = mid + minSpan / 2;
    }
    const span = max - min || 1;

    // 1px vertical inset so the 1.5px stroke doesn't clip.
    const innerH = height - 2;
    const pts = valid.map((v, i) => {
      const x = (i / (valid.length - 1)) * width;
      const y = 1 + innerH - ((v - min) / span) * innerH;
      return [Number(x.toFixed(2)), Number(y.toFixed(2))];
    });

    const line = pts.map(p => `${p[0]},${p[1]}`).join(' ');
    const area = `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')} L${width},${height} L0,${height} Z`;
    const up = last >= base;
    return { line, area, up };
  }, [data, width, height, baseline]);

  if (!geom) {
    return <span style={{ display: 'inline-block', width, height }} aria-hidden="true" />;
  }

  const color = geom.up ? TOKEN_HEX.up : TOKEN_HEX.down;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      {showFill && <path d={geom.area} fill={color} fillOpacity="0.15" stroke="none" />}
      <polyline
        points={geom.line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export { Sparkline };
