import React from 'react';
import './PanelTabRow.css';

/**
 * Canonical tabs/pills row for lower-row panels.
 *   <PanelTabRow
 *     value={active}
 *     onChange={setActive}
 *     items={[{id:'all', label:'ALL', count:42}, ...]}
 *     equal           // optional — flex tabs to equal width
 *   />
 */
export function PanelTabRow({ value, onChange, items, equal = false, className = '' }) {
  const cls = `pp-tabs ${equal ? 'pp-tabs--equal' : ''} ${className}`.trim();
  return (
    <div className={cls} role="tablist">
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`pp-tab ${active ? 'pp-tab--active' : ''}`.trim()}
            onClick={() => onChange?.(it.id)}
          >
            <span>{it.label}</span>
            {it.count != null ? <span className="pp-tab-count">{it.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export default PanelTabRow;
