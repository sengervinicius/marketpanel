/**
 * BoardRow.jsx — Design v1 shared primitive.
 *
 * A board row: label | optional mini-svg | value + delta, at the 11.5px
 * scale of DebtPanel's GLOBAL 10Y / CREDIT & INFLATION board (approved
 * home design).
 *
 *   <BoardRow
 *     label={<>🇺🇸 UST</>}          // mono by default
 *     labelSans                     // opt out of mono (prose labels)
 *     mini={<MiniCurveSvg … />}     // optional 54×16 svg slot
 *     value="4.28"
 *     delta="+2.1"
 *     deltaColor="var(--color-down)"
 *     active onClick={…} title="Load UST curve"
 *   />
 *
 * BoardSectionLabel is the matching 8.5px mono section header
 * ("GLOBAL 10Y", "CREDIT & INFLATION").
 */
import './BoardRow.css';

export function BoardSectionLabel({ children, className = '' }) {
  return <div className={`ds-brow-sec ${className}`.trim()}>{children}</div>;
}

export default function BoardRow({
  label,
  labelSans = false,
  mini,
  value,
  delta,
  deltaColor,
  active = false,
  onClick,
  title,
  className = '',
}) {
  const classes = [
    'ds-brow',
    onClick ? 'ds-brow--click' : '',
    active ? 'ds-brow--active' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={onClick} title={title}>
      <span className={`ds-brow-k${labelSans ? ' ds-brow-k--sans' : ''}`}>{label}</span>
      {mini != null ? <span className="ds-brow-mini">{mini}</span> : null}
      <span className="ds-brow-v">
        {value ?? '—'}
        {delta !== undefined && (
          <i
            className="ds-brow-chg"
            style={{ color: deltaColor || 'var(--text-faint)' }}
          >{delta ?? '—'}</i>
        )}
      </span>
    </div>
  );
}
