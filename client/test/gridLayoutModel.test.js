/**
 * gridLayoutModel.test.js — H3: unit tests for the pure desktopRows→grid
 * migration and grid helpers behind the home_grid_v2 flag.
 */
import { describe, it, expect } from 'vitest';
import {
  GRID_COLS,
  DEFAULT_PANEL_W,
  DEFAULT_PANEL_H,
  CHARTS_PANEL_H,
  migrateDesktopRowsToGrid,
  makeDefaultLayoutsState,
  isValidLayoutsState,
  addPanelToGrid,
  removePanelFromGrid,
  normalizeGrid,
  genLayoutId,
} from '../src/components/home/gridLayoutModel';
import { DEFAULT_LAYOUT } from '../src/config/panels';

describe('migrateDesktopRowsToGrid', () => {
  const rows = DEFAULT_LAYOUT.desktopRows; // current 3-row default

  it('produces one grid item per unique panel id', () => {
    const grid = migrateDesktopRowsToGrid(rows);
    expect(grid.map(g => g.i).sort()).toEqual([...new Set(rows.flat())].sort());
  });

  it('splits each row into equal 12-col widths that sum to 12', () => {
    const grid = migrateDesktopRowsToGrid(rows);
    const byY = new Map();
    for (const it of grid) byY.set(it.y, [...(byY.get(it.y) || []), it]);
    for (const items of byY.values()) {
      expect(items.reduce((a, b) => a + b.w, 0)).toBe(GRID_COLS);
    }
  });

  it('handles rows that do not divide 12 evenly (leftmost gets remainder)', () => {
    const grid = migrateDesktopRowsToGrid([['a', 'b', 'c', 'd', 'e']]);
    expect(grid.map(g => g.w)).toEqual([3, 3, 2, 2, 2]); // 12 = 3+3+2+2+2
    expect(grid.reduce((a, b) => a + b.w, 0)).toBe(GRID_COLS);
    // x positions are contiguous
    let x = 0;
    for (const it of grid) { expect(it.x).toBe(x); x += it.w; }
  });

  it('gives charts h=8 and everything else h=4', () => {
    const grid = migrateDesktopRowsToGrid(rows);
    for (const it of grid) {
      expect(it.h).toBe(it.i === 'charts' ? CHARTS_PANEL_H : DEFAULT_PANEL_H);
    }
  });

  it('maps row order to cumulative y offsets (charts row pushes later rows down)', () => {
    const grid = migrateDesktopRowsToGrid(rows);
    const yOf = id => grid.find(g => g.i === id).y;
    expect(yOf('charts')).toBe(0);          // row 0
    expect(yOf('forex')).toBe(8);           // row 1 sits below the h=8 charts band
    expect(yOf('debt')).toBe(12);           // row 2
  });

  it('uses plain row-height offsets when no charts panel is present', () => {
    const grid = migrateDesktopRowsToGrid([['a', 'b'], ['c'], ['d']]);
    expect(grid.find(g => g.i === 'a').y).toBe(0);
    expect(grid.find(g => g.i === 'c').y).toBe(4);
    expect(grid.find(g => g.i === 'd').y).toBe(8);
  });

  it('drops empty rows, duplicate ids and junk input', () => {
    expect(migrateDesktopRowsToGrid([[], ['a', 'a', ''], null, ['a', 'b']]))
      .toEqual([
        { i: 'a', x: 0, y: 0, w: 12, h: 4 },
        { i: 'b', x: 0, y: 4, w: 12, h: 4 },
      ]);
    expect(migrateDesktopRowsToGrid(undefined)).toEqual([]);
    expect(migrateDesktopRowsToGrid('nope')).toEqual([]);
  });
});

describe('makeDefaultLayoutsState / isValidLayoutsState', () => {
  it('builds a valid single-layout state from desktopRows', () => {
    const state = makeDefaultLayoutsState(DEFAULT_LAYOUT.desktopRows);
    expect(isValidLayoutsState(state)).toBe(true);
    expect(state.activeId).toBe('default');
    expect(state.items.default.grid.length).toBe(new Set(DEFAULT_LAYOUT.desktopRows.flat()).size);
  });

  it('rejects malformed blobs', () => {
    expect(isValidLayoutsState(null)).toBe(false);
    expect(isValidLayoutsState([])).toBe(false);
    expect(isValidLayoutsState({ activeId: 'x', items: {} })).toBe(false);
    expect(isValidLayoutsState({ activeId: 'a', items: { a: { name: 'a' } } })).toBe(false); // grid missing
    expect(isValidLayoutsState({ activeId: 'a', items: { a: { grid: [] } } })).toBe(true);
  });
});

describe('addPanelToGrid / removePanelFromGrid', () => {
  const grid = [
    { i: 'charts', x: 0, y: 0, w: 6, h: 8 },
    { i: 'news', x: 6, y: 0, w: 6, h: 4 },
  ];

  it('appends new panel at the bottom with w=4 h=4', () => {
    const next = addPanelToGrid(grid, 'movers');
    const added = next.find(g => g.i === 'movers');
    expect(added).toEqual({ i: 'movers', x: 0, y: 8, w: DEFAULT_PANEL_W, h: DEFAULT_PANEL_H });
    expect(next.length).toBe(3);
  });

  it('is a no-op when the panel already exists', () => {
    expect(addPanelToGrid(grid, 'news')).toBe(grid);
  });

  it('removes by id', () => {
    expect(removePanelFromGrid(grid, 'news').map(g => g.i)).toEqual(['charts']);
    expect(removePanelFromGrid(grid, 'ghost').length).toBe(2);
  });
});

describe('normalizeGrid', () => {
  it('strips RGL-internal fields and clamps values', () => {
    const out = normalizeGrid([
      { i: 'a', x: -2, y: -1, w: 99, h: 0.4, moved: true, static: false, isDraggable: true },
      { i: 'b', x: 3.6, y: 2.2, w: NaN, h: undefined },
    ]);
    expect(out).toEqual([
      { i: 'a', x: 0, y: 0, w: 12, h: 1 },
      { i: 'b', x: 4, y: 2, w: DEFAULT_PANEL_W, h: DEFAULT_PANEL_H },
    ]);
  });
});

describe('genLayoutId', () => {
  it('never collides with existing ids', () => {
    const items = { 'layout-1': {}, 'layout-2': {}, 'layout-3': {} };
    const id = genLayoutId(items);
    expect(items[id]).toBeUndefined();
  });
});
