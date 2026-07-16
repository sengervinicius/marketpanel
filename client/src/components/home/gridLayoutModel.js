/**
 * gridLayoutModel.js — H3: pure layout-model helpers for the editable
 * home grid (home_grid_v2). NO React, NO react-grid-layout imports —
 * this module is shared by the eager useGridLayouts hook and the lazy
 * HomeGrid chunk, and is unit-tested in isolation (vitest, node env).
 *
 * Persisted shape (settings.layouts, synced via /api/settings):
 *   {
 *     activeId: 'default',
 *     items: {
 *       [layoutId]: {
 *         name: 'My Layout',
 *         grid: [{ i: panelId, x, y, w, h }, ...]   // 12-col units
 *       }
 *     }
 *   }
 */

export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 90;

/** Default size for a panel added via Cmd+K in grid mode. */
export const DEFAULT_PANEL_W = 4;
export const DEFAULT_PANEL_H = 4;
/** The charts panel is the visual anchor of the home screen — taller. */
export const CHARTS_PANEL_H = 8;

export const DEFAULT_LAYOUT_ID = 'default';
export const DEFAULT_LAYOUT_NAME = 'My Layout';

/**
 * One-time migration: legacy `settings.layout.desktopRows` (3 flexbox rows
 * of panel ids) → grid items.
 *
 * Mapping:
 *   - row order is preserved: each legacy row becomes a horizontal band;
 *     y = cumulative height of the bands above it (so the charts row,
 *     h=8, pushes later rows down instead of overlapping them).
 *   - within a row the 12 columns are split equally; when 12 % n !== 0
 *     the leftmost panels get the extra column so widths always sum to 12.
 *   - h = 4 for every panel except `charts`, which gets h = 8.
 *   - duplicate ids and empty rows are dropped (grid keys must be unique).
 *
 * Legacy `desktopRows` is NOT touched — it remains the fallback used when
 * the `home_grid_v2` flag is off.
 *
 * @param {Array<Array<string>>} desktopRows
 * @returns {Array<{i:string,x:number,y:number,w:number,h:number}>}
 */
export function migrateDesktopRowsToGrid(desktopRows) {
  const grid = [];
  const seen = new Set();
  let y = 0;
  for (const row of Array.isArray(desktopRows) ? desktopRows : []) {
    const ids = [];
    for (const id of Array.isArray(row) ? row : []) {
      if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id); // dedupes across AND within rows
        ids.push(id);
      }
    }
    if (ids.length === 0) continue;
    const base = Math.floor(GRID_COLS / ids.length);
    const remainder = GRID_COLS % ids.length;
    let x = 0;
    let rowMaxH = 0;
    ids.forEach((id, idx) => {
      const w = Math.max(1, base + (idx < remainder ? 1 : 0));
      const h = id === 'charts' ? CHARTS_PANEL_H : DEFAULT_PANEL_H;
      grid.push({ i: id, x, y, w, h });
      x += w;
      rowMaxH = Math.max(rowMaxH, h);
    });
    y += rowMaxH;
  }
  return grid;
}

/**
 * Build the initial `settings.layouts` state from legacy desktopRows.
 * @param {Array<Array<string>>} desktopRows
 */
export function makeDefaultLayoutsState(desktopRows) {
  return {
    activeId: DEFAULT_LAYOUT_ID,
    items: {
      [DEFAULT_LAYOUT_ID]: {
        name: DEFAULT_LAYOUT_NAME,
        grid: migrateDesktopRowsToGrid(desktopRows),
      },
    },
  };
}

/** Structural validation of a persisted settings.layouts blob. */
export function isValidLayoutsState(s) {
  return Boolean(
    s && typeof s === 'object' && !Array.isArray(s)
    && typeof s.activeId === 'string'
    && s.items && typeof s.items === 'object' && !Array.isArray(s.items)
    && s.items[s.activeId]
    && Array.isArray(s.items[s.activeId].grid)
  );
}

/**
 * Clamp/clean a react-grid-layout item back to the persisted plain shape.
 * Drops RGL-internal fields (moved, static, isDraggable, ...).
 */
export function normalizeGridItem(it) {
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  return {
    i: String(it.i),
    x: Math.max(0, Math.min(GRID_COLS - 1, Math.round(num(it.x)))),
    y: Math.max(0, Math.round(num(it.y))),
    w: Math.max(1, Math.min(GRID_COLS, Math.round(num(it.w, DEFAULT_PANEL_W)))),
    h: Math.max(1, Math.round(num(it.h, DEFAULT_PANEL_H))),
  };
}

/** Normalize a whole RGL layout array for persistence. */
export function normalizeGrid(layout) {
  return (Array.isArray(layout) ? layout : []).map(normalizeGridItem);
}

/**
 * Cmd+K "Add panel" in grid mode: append at the bottom, w=4 h=4.
 * No-op (returns same array) if the panel is already in the grid.
 */
export function addPanelToGrid(grid, panelId) {
  const g = Array.isArray(grid) ? grid : [];
  if (!panelId || g.some(it => it.i === panelId)) return g;
  const bottom = g.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  return [...g, { i: panelId, x: 0, y: bottom, w: DEFAULT_PANEL_W, h: DEFAULT_PANEL_H }];
}

/** Cmd+K "Remove panel" in grid mode: filter the item out. */
export function removePanelFromGrid(grid, panelId) {
  return (Array.isArray(grid) ? grid : []).filter(it => it.i !== panelId);
}

/** Generate a fresh layout id not colliding with existing ones. */
export function genLayoutId(items) {
  const existing = items && typeof items === 'object' ? items : {};
  let n = Object.keys(existing).length + 1;
  let id = `layout-${n}`;
  while (existing[id]) { n += 1; id = `layout-${n}`; }
  return id;
}
