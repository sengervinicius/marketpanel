/**
 * ViewChips.jsx — Design v1 shared primitive.
 *
 * The chip group: mono 9px uppercase bordered chips, accent when active.
 * Extracted from DebtPanel's region chips and WatchlistPanel's VIEW
 * chips (approved home design) — identical styling in both.
 *
 *   <ViewChips
 *     options={[{ key: 'trader', label: 'TRADER', title: '…' }, …]}
 *     value={view}
 *     onChange={setView}
 *     storageKey="wlView_v1"        // optional: persist choice
 *     ariaLabel="Column view"
 *     renderLabel={(opt, on) => on ? `VIEW: ${opt.label}` : opt.label}
 *   />
 *
 * Persistence: pass `storageKey` and ViewChips writes the chosen key on
 * every change; use `loadPersistedChip(storageKey, options, fallback)`
 * for the initial state so the panel keeps owning its `value`.
 */
import './ViewChips.css';

export function loadPersistedChip(storageKey, options, fallback) {
  try {
    const v = localStorage.getItem(storageKey);
    return options.some(o => o.key === v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export default function ViewChips({
  options = [],
  value,
  onChange,
  storageKey,
  ariaLabel,
  renderLabel,
  className = '',
}) {
  const pick = (key) => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, key); } catch { /* private mode */ }
    }
    onChange?.(key);
  };

  return (
    <div className={`ds-chips ${className}`.trim()} role="group" aria-label={ariaLabel}>
      {options.map(opt => {
        const on = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            className={`ds-chip ${on ? 'ds-chip--on' : ''}`.trim()}
            onClick={() => pick(opt.key)}
            title={opt.title}
          >{renderLabel ? renderLabel(opt, on) : opt.label}</button>
        );
      })}
    </div>
  );
}
