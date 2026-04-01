/**
 * ColumnHeaders.jsx
 * Shared sortable column header row for data panels.
 * Renders a grid of clickable column labels with sort indicators.
 */
import { memo } from 'react';

function ColumnHeaders({ columns, gridColumns, sortKey, sortDir, onSortClick }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: gridColumns,
      padding: '2px 8px',
      borderBottom: '1px solid var(--border-default)',
      flexShrink: 0,
    }}>
      {columns.map(({ key, label, align }) => {
        const active = sortKey === key;
        const arrow = active ? (sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
        return (
          <span
            key={key}
            onClick={() => onSortClick(key)}
            style={{
              color: active ? 'var(--accent-text)' : 'var(--text-muted)',
              fontSize: 'var(--font-sm)',
              fontWeight: 700,
              letterSpacing: '1px',
              textAlign: align === 'right' ? 'right' : 'left',
              paddingRight: align === 'right' ? 4 : 0,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {label}{arrow}
          </span>
        );
      })}
    </div>
  );
}

export default memo(ColumnHeaders);
