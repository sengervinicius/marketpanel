/**
 * HomeGrid.jsx — H3: editable 12-col home grid (feature flag `home_grid_v2`).
 *
 * LAZY-LOADED from App.jsx (lazyWithRetry) so react-grid-layout and its CSS
 * live in this chunk only — the legacy desktopRows path pays zero bytes.
 *
 * Panels are the exact same PANEL_REGISTRY renderers as the legacy rows
 * (makePanelRenderer — lazy + Suspense inside, wrapped here in the same
 * PanelErrorBoundary), so there are ZERO data-flow changes: only the
 * positioning container differs.
 *
 * Drag: by the panel header title area (PanelChrome `.panel-chrome` /
 * EditablePanelHeader `.eph-header`); buttons/inputs inside headers are
 * excluded via dragConfig.cancel. Resize: 'se' handle. Compaction: vertical.
 */

import { useMemo } from 'react';
import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import PanelErrorBoundary from '../common/PanelErrorBoundary';
import { makePanelRenderer } from '../app/AppLayoutHelpers';
import { GRID_COLS, GRID_ROW_HEIGHT, normalizeGrid } from './gridLayoutModel';
import './HomeGrid.css';

const DRAG_HANDLE = '.panel-chrome, .eph-header';
const DRAG_CANCEL = 'button, input, select, textarea, a, [contenteditable="true"], .eph-title, .eph-sub';

export default function HomeGrid({ grid, onGridChange, panelCtx }) {
  const { width, containerRef, mounted } = useContainerWidth();

  // RGL mutates its own copies; hand it fresh objects each time the
  // persisted grid changes identity.
  const layout = useMemo(() => grid.map(it => ({ ...it })), [grid]);

  const children = useMemo(() => grid.map(it => (
    <div key={it.i} className="home-grid-item" data-panel-id={it.i}>
      <PanelErrorBoundary name={it.i}>
        {makePanelRenderer(it.i, panelCtx)}
      </PanelErrorBoundary>
    </div>
  )), [grid, panelCtx]);

  // Persist ONLY on drag/resize stop (debounced upstream ~1s) — not on
  // every intermediate onLayoutChange tick.
  const commit = (nextLayout) => onGridChange(normalizeGrid(nextLayout), { debounce: true });

  return (
    <div ref={containerRef} className="home-grid-scroll" data-testid="home-grid-v2">
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight: GRID_ROW_HEIGHT, margin: [6, 6], containerPadding: [6, 6] }}
          dragConfig={{ enabled: true, handle: DRAG_HANDLE, cancel: DRAG_CANCEL }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          compactor={verticalCompactor}
          onDragStop={(nextLayout) => commit(nextLayout)}
          onResizeStop={(nextLayout) => commit(nextLayout)}
        >
          {children}
        </GridLayout>
      )}
    </div>
  );
}
