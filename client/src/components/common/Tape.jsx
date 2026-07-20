/**
 * Tape.jsx — Design v1 shared primitive.
 *
 * The "tape": a single strip of N bordered metric cells, extracted from
 * DebtPanel's RATES & CREDIT tape (approved home design). Each cell is
 * label (8.5px mono uppercase muted) / value (14px mono 700) / delta
 * (9.5px mono, colored by the caller).
 *
 *   <Tape
 *     title="FRED — 30 min server cache"       // optional tooltip
 *     tone="gold"                               // optional: vault-gold tint
 *     cells={[
 *       { key: 'us10y', label: 'US 10Y', value: '4.28%', delta: '+2.1bp',
 *         deltaColor: 'var(--color-down)' },
 *     ]}
 *   />
 *
 * Cells degrade independently: value ?? '—', delta ?? ' ' (keeps the
 * 12px delta line so the tape never jumps).
 */
import './Tape.css';

export function TapeCell({ label, value, delta, deltaColor }) {
  return (
    <div className="ds-tape-cell">
      <div className="ds-tape-k">{label}</div>
      <div className="ds-tape-v">{value ?? '—'}</div>
      <div className="ds-tape-d" style={deltaColor ? { color: deltaColor } : undefined}>
        {delta ?? ' '}
      </div>
    </div>
  );
}

export default function Tape({ cells = [], tone, title, className = '' }) {
  const toneClass = tone ? ` ds-tape--${tone}` : '';
  return (
    <div
      className={`ds-tape${toneClass} ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${cells.length || 1}, 1fr)` }}
      title={title}
    >
      {cells.map((c, i) => (
        <TapeCell
          key={c.key ?? c.label ?? i}
          label={c.label}
          value={c.value}
          delta={c.delta}
          deltaColor={c.deltaColor}
        />
      ))}
    </div>
  );
}
