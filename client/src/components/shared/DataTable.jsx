/**
 * DataTable — Universal table component for all screens
 *
 * Features:
 * - Sortable columns with ▲/▼ indicators
 * - Row hover and active states
 * - Keyboard navigation (↑↓ arrows, Enter)
 * - Loading skeleton rows
 * - CSV export and copy-to-clipboard
 * - Mobile horizontal scroll with sticky first column
 * - Tabular-nums formatting for numbers
 * - Accessible and keyboard-friendly
 */

import React, { useState, useRef, useEffect } from 'react';
import './DataTable.css';

export default function DataTable({
  columns = [],
  data = [],
  onRowClick = null,
  loading = false,
  emptyMessage = 'No data available',
  className = '',
  stickyFirstColumn = false,
  keyboardNav = false,
}) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [activeRowIndex, setActiveRowIndex] = useState(null);
  const tableRef = useRef(null);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!sortConfig.key) return data;

    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortConfig.direction === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });

    return sorted;
  }, [data, sortConfig]);

  // Handle header click for sorting
  const handleHeaderClick = (column) => {
    if (!column.sortable) return;

    setSortConfig(prev => ({
      key: column.key,
      direction: prev.key === column.key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Format cell value
  const formatCellValue = (value, column) => {
    if (value == null) {
      return <span className="dt-cell-empty">—</span>;
    }

    if (column.format) {
      return column.format(value);
    }

    return value;
  };

  // Handle row click
  const handleRowClick = (row, index) => {
    if (keyboardNav) setActiveRowIndex(index);
    if (onRowClick) onRowClick(row);
  };

  // Handle row touch (for mobile)
  const handleRowTouchEnd = (row, index) => {
    handleRowClick(row, index);
  };

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (!keyboardNav) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveRowIndex(prev => Math.max(0, (prev ?? sortedData.length) - 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveRowIndex(prev => Math.min(sortedData.length - 1, (prev ?? -1) + 1));
    } else if (e.key === 'Enter' && activeRowIndex != null) {
      e.preventDefault();
      if (onRowClick) onRowClick(sortedData[activeRowIndex]);
    }
  };

  // Attach keyboard listener to document
  useEffect(() => {
    if (!keyboardNav) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [keyboardNav, activeRowIndex, sortedData, onRowClick]);

  // CSV export
  const exportCSV = () => {
    if (sortedData.length === 0) return;

    // Headers
    const headers = columns.map(c => `"${c.label}"`).join(',');

    // Rows
    const rows = sortedData.map(row => {
      return columns.map(col => {
        let val = row[col.key];
        if (val == null) val = '';
        val = String(val).replace(/"/g, '""'); // Escape quotes
        return `"${val}"`;
      }).join(',');
    });

    const csv = [headers, ...rows].join('\n');

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `data-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy to clipboard
  const copyToClipboard = () => {
    if (sortedData.length === 0) return;

    // Headers
    const headers = columns.map(c => c.label).join('\t');

    // Rows
    const rows = sortedData.map(row => {
      return columns.map(col => {
        let val = row[col.key];
        if (val == null) val = '';
        return String(val);
      }).join('\t');
    });

    const text = [headers, ...rows].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      // Optional: show toast notification
      console.log('Copied to clipboard');
    });
  };

  // Loading state: show skeleton rows
  const displayData = loading ? Array(Math.max(5, sortedData.length)) : sortedData;

  return (
    <div className={`dt-container ${className}`} ref={tableRef}>
      {/* Toolbar */}
      <div className="dt-toolbar">
        <div className="dt-toolbar-actions">
          <button
            className="dt-button dt-button-export"
            onClick={exportCSV}
            disabled={sortedData.length === 0}
            title="Export to CSV"
          >
            ⬇ CSV
          </button>
          <button
            className="dt-button dt-button-copy"
            onClick={copyToClipboard}
            disabled={sortedData.length === 0}
            title="Copy to clipboard (tab-separated)"
          >
            ⧉ Copy
          </button>
        </div>
        {loading && <div className="dt-loading-indicator">Loading...</div>}
      </div>

      {/* Table */}
      <div className={`dt-wrapper ${stickyFirstColumn ? 'dt-sticky-first' : ''}`}>
        <table className="dt-table">
          {/* Head */}
          <thead>
            <tr className="dt-header-row">
              {columns.map((col, idx) => (
                <th
                  key={col.key}
                  className={`dt-header-cell ${col.sortable ? 'dt-sortable' : ''} ${col.align || 'left'}`}
                  style={{ width: col.width }}
                  onClick={() => handleHeaderClick(col)}
                  role={col.sortable ? 'button' : undefined}
                  tabIndex={col.sortable ? 0 : undefined}
                >
                  <div className="dt-header-content">
                    <span>{col.label}</span>
                    {col.sortable && sortConfig.key === col.key && (
                      <span className="dt-sort-indicator">
                        {sortConfig.direction === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {sortedData.length === 0 && !loading ? (
              <tr className="dt-empty-row">
                <td colSpan={columns.length} className="dt-empty-cell">
                  {emptyMessage}
                </td>
              </tr>
            ) : null}

            {displayData.map((row, idx) => (
              <tr
                key={idx}
                className={`dt-body-row ${
                  keyboardNav && activeRowIndex === idx ? 'dt-row-active' : ''
                } ${loading ? 'dt-row-skeleton' : ''}`}
                onClick={() => !loading && handleRowClick(row, idx)}
                onTouchEnd={() => !loading && handleRowTouchEnd(row, idx)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`dt-cell ${col.align || 'left'} ${
                      typeof row[col.key] === 'number' ? 'tabular-nums' : ''
                    }`}
                    style={{ width: col.width }}
                  >
                    {loading ? (
                      <div className="dt-skeleton-content" />
                    ) : (
                      formatCellValue(row[col.key], col)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
