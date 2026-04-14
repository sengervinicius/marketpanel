import { useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { DEFAULT_LAYOUT } from '../config/panels';
import { useResizableFlex, useResizableColumns } from '../components/app/AppLayoutHelpers';

// ── Safe localStorage wrapper ──────────────────────────────────────────────
const safeGet = (key, fallback = null) => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
};

const LS_CHART_GRID = 'chartGrid_v3';

/**
 * useLayoutManager — owns the desktop grid layout state.
 *
 * Manages: panel layout, edit mode, visibility toggling,
 * row/column resize hooks, and layout move handling.
 */
export function useLayoutManager() {
  const { settings, updateLayout } = useSettings();

  const desktopRows = settings?.layout?.desktopRows || DEFAULT_LAYOUT.desktopRows;

  const row0 = desktopRows[0] || [];
  const row1 = desktopRows[1] || [];
  const row2 = desktopRows[2] || [];

  const [layoutEdit, setLayoutEdit] = useState(false);

  const handleLayoutMove = useCallback((panelId, rowIdx, colIdx, direction) => {
    const newRows = desktopRows.map(r => [...r]);

    if (direction === 'left' && colIdx > 0) {
      [newRows[rowIdx][colIdx], newRows[rowIdx][colIdx - 1]] = [newRows[rowIdx][colIdx - 1], newRows[rowIdx][colIdx]];
    } else if (direction === 'right' && colIdx < newRows[rowIdx].length - 1) {
      [newRows[rowIdx][colIdx], newRows[rowIdx][colIdx + 1]] = [newRows[rowIdx][colIdx + 1], newRows[rowIdx][colIdx]];
    } else if (direction === 'up' && rowIdx > 0) {
      newRows[rowIdx].splice(colIdx, 1);
      newRows[rowIdx - 1].push(panelId);
    } else if (direction === 'down' && rowIdx < newRows.length - 1) {
      newRows[rowIdx].splice(colIdx, 1);
      newRows[rowIdx + 1].unshift(panelId);
    } else if (direction === 'down' && rowIdx === newRows.length - 1 && newRows.length < 4) {
      newRows[rowIdx].splice(colIdx, 1);
      newRows.push([panelId]);
    }

    const nonEmptyRows = newRows.filter(r => r.length > 0);
    if (nonEmptyRows.length === 0) return;
    while (nonEmptyRows.length < 3) nonEmptyRows.push([]);
    updateLayout({ desktopRows: nonEmptyRows });
  }, [desktopRows, updateLayout]);

  const [rowSizes, startRowResize] = useResizableFlex('rowFlexSizes_v2', [2, 1.5, 1.5]);
  const [colSizes0, startColResize0] = useResizableColumns('colSizes_r0_' + row0.length, Array(Math.max(1, row0.length)).fill(1));
  const [colSizes1, startColResize1] = useResizableColumns('colSizes_r1_' + row1.length, Array(Math.max(1, row1.length)).fill(1));
  const [colSizes2, startColResize2] = useResizableColumns('colSizes_r2_' + row2.length, Array(Math.max(1, row2.length)).fill(1));
  const colSizesPerRow = [colSizes0, colSizes1, colSizes2];
  const startResizePerRow = [startColResize0, startColResize1, startColResize2];

  const [chartGridCount, setChartGridCount] = useState(() => {
    try {
      const arr = safeGet(LS_CHART_GRID, ['SPY', 'QQQ']);
      return Array.isArray(arr) ? Math.max(2, arr.length) : 2;
    } catch { return 2; }
  });

  // Panel visibility
  const [panelVisible, setPanelVisible] = useState(() => {
    try { return JSON.parse(localStorage.getItem('panelVisible_v1')) || {}; } catch { return {}; }
  });
  const togglePanel = useCallback((id) => {
    setPanelVisible(prev => {
      const next = { ...prev, [id]: !(prev[id] ?? true) };
      localStorage.setItem('panelVisible_v1', JSON.stringify(next));
      return next;
    });
  }, []);
  const isPanelVisible = useCallback((id) => panelVisible[id] ?? true, [panelVisible]);

  return {
    desktopRows,
    row0, row1, row2,
    layoutEdit, setLayoutEdit,
    handleLayoutMove,
    rowSizes, startRowResize,
    colSizesPerRow, startResizePerRow,
    chartGridCount, setChartGridCount,
    panelVisible, togglePanel, isPanelVisible,
  };
}
