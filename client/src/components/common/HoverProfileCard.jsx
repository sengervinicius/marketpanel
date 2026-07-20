/**
 * HoverProfileCard.jsx — Design v1 shared primitive.
 *
 * Positioning + styling shell for hover mini-profile cards, extracted
 * from WatchlistPanel's approved hover card: absolutely positioned in a
 * `position: relative` scroller, surface-2 bg, 3px accent left border,
 * deep shadow, pointer-events: none (never blocks row clicks).
 *
 *   <HoverProfileCard top={140} title="AAPL · APPLE INC">
 *     <HoverProfileRow label="Mkt cap" value="3.1T" />
 *     <HoverProfileRow footer value={<span>click row → full view ↗</span>} />
 *   </HoverProfileCard>
 *
 * Callers own the hover timing/state and the row content.
 */
import './HoverProfileCard.css';

export function HoverProfileRow({ label, value, footer = false, className = '' }) {
  return (
    <div className={`ds-hcard-row${footer ? ' ds-hcard-footer' : ''} ${className}`.trim()}>
      {label != null ? <span>{label}</span> : null}
      {footer ? value : <b>{value}</b>}
    </div>
  );
}

/* 52w-range style position indicator: pos in [0,1]. */
export function HoverProfileRange({ pos }) {
  if (pos == null) return null;
  return (
    <span className="ds-hcard-range"><i style={{ left: `${pos * 100}%` }} /></span>
  );
}

export default function HoverProfileCard({ top, title, children, className = '', style }) {
  return (
    <div className={`ds-hcard ${className}`.trim()} style={{ top, ...style }}>
      {title != null ? <div className="ds-hcard-title">{title}</div> : null}
      {children}
    </div>
  );
}
