/**
 * TableExportBar.jsx
 * Reusable component for CSV/clipboard export functionality in tables
 * Provides small buttons for downloading table data as CSV or copying to clipboard as tab-separated values
 */
import { useCallback } from 'react';
import './TableExportBar.css';

export function TableExportBar({ columns, getData }) {
  // Handle CSV export
  const handleCsvExport = useCallback(() => {
    if (!columns || !getData) return;

    const data = getData();
    if (!data || data.length === 0) return;

    // Create CSV header
    const headers = columns.map(col => col.label || '').join(',');

    // Create CSV rows
    const rows = data.map(row => {
      return columns.map(col => {
        const key = col.key || col.label?.toLowerCase();
        if (!key) return '';
        const value = row[key];
        // Escape quotes and wrap in quotes if contains comma
        if (value == null) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
    });

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `export-${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [columns, getData]);

  // Handle clipboard copy (tab-separated)
  const handleCopyClipboard = useCallback(() => {
    if (!columns || !getData) return;

    const data = getData();
    if (!data || data.length === 0) return;

    // Create tab-separated header
    const headers = columns.map(col => col.label || '').join('\t');

    // Create tab-separated rows
    const rows = data.map(row => {
      return columns.map(col => {
        const key = col.key || col.label?.toLowerCase();
        if (!key) return '';
        const value = row[key];
        return value == null ? '' : String(value);
      }).join('\t');
    });

    const tsv = [headers, ...rows].join('\n');

    navigator.clipboard.writeText(tsv).then(() => {
      // Optional: Show brief success feedback
      console.log('Data copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }, [columns, getData]);

  return (
    <div className="teb-bar">
      <button className="teb-btn" onClick={handleCsvExport} title="Download as CSV">
        ⬇ CSV
      </button>
      <button className="teb-btn" onClick={handleCopyClipboard} title="Copy to clipboard">
        ⧉ Copy
      </button>
    </div>
  );
}

export default TableExportBar;
