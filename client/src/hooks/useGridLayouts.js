/**
 * useGridLayouts.js — H3: state owner for the editable home grid
 * (feature flag `home_grid_v2`).
 *
 * Owns `settings.layouts` (multi-layout model — see gridLayoutModel.js for
 * the persisted shape) and persists it through the existing /api/settings
 * sync in SettingsContext. Geometry changes (drag/resize stop) are debounced
 * ~1s before hitting updateSettings; structural changes (add/remove panel,
 * switch/rename/duplicate/new/delete layout) persist immediately.
 *
 * IMPORTANT (flag-off safety): this hook imports NO react-grid-layout code —
 * only the pure gridLayoutModel helpers — and performs no writes until the
 * user actually edits the grid, so the legacy desktopRows path pays nothing.
 *
 * Migration: if settings.layouts is absent/invalid, the effective state is
 * derived on the fly from the user's current desktopRows
 * (migrateDesktopRowsToGrid) and only persisted on first edit — this avoids
 * writing a migration before the async /api/settings load has completed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { DEFAULT_LAYOUT } from '../config/panels';
import {
  addPanelToGrid,
  genLayoutId,
  isValidLayoutsState,
  makeDefaultLayoutsState,
  migrateDesktopRowsToGrid,
  removePanelFromGrid,
} from '../components/home/gridLayoutModel';

const PERSIST_DEBOUNCE_MS = 1000;

export function useGridLayouts(desktopRows) {
  const { settings, updateSettings } = useSettings();
  const serverLayouts = settings?.layouts;

  // Local optimistic copy. Server value (arriving async from /api/settings)
  // wins until the user touches the grid in this session.
  const [local, setLocal] = useState(null);
  const touchedRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!touchedRef.current && isValidLayoutsState(serverLayouts)) {
      setLocal(serverLayouts);
    }
  }, [serverLayouts]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const layouts = useMemo(() => {
    if (isValidLayoutsState(local)) return local;
    if (isValidLayoutsState(serverLayouts)) return serverLayouts;
    return makeDefaultLayoutsState(desktopRows); // one-time migration (persisted on first edit)
  }, [local, serverLayouts, desktopRows]);

  const persist = useCallback((next, { debounce = false } = {}) => {
    touchedRef.current = true;
    setLocal(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounce) {
      timerRef.current = setTimeout(() => updateSettings({ layouts: next }), PERSIST_DEBOUNCE_MS);
    } else {
      updateSettings({ layouts: next });
    }
  }, [updateSettings]);

  const activeId = layouts.items[layouts.activeId] ? layouts.activeId : Object.keys(layouts.items)[0];
  const active = layouts.items[activeId] || { name: 'My Layout', grid: [] };
  const activeGrid = Array.isArray(active.grid) ? active.grid : [];

  /** Replace the active layout's grid. opts.debounce=true for drag/resize. */
  const setActiveGrid = useCallback((grid, opts) => {
    persist({
      ...layouts,
      items: { ...layouts.items, [activeId]: { ...active, grid } },
    }, opts);
  }, [layouts, activeId, active, persist]);

  // ── Cmd+K panel add/remove (grid mode) ───────────────────────────────────
  const addPanel = useCallback((panelId) => {
    setActiveGrid(addPanelToGrid(activeGrid, panelId));
  }, [setActiveGrid, activeGrid]);

  const removePanel = useCallback((panelId) => {
    setActiveGrid(removePanelFromGrid(activeGrid, panelId));
  }, [setActiveGrid, activeGrid]);

  // ── LAYOUT dropdown operations ───────────────────────────────────────────
  const switchLayout = useCallback((id) => {
    if (!layouts.items[id] || id === layouts.activeId) return;
    persist({ ...layouts, activeId: id });
  }, [layouts, persist]);

  const renameLayout = useCallback((id, name) => {
    const item = layouts.items[id];
    const clean = String(name || '').trim().slice(0, 40);
    if (!item || !clean) return;
    persist({ ...layouts, items: { ...layouts.items, [id]: { ...item, name: clean } } });
  }, [layouts, persist]);

  const duplicateLayout = useCallback((id) => {
    const src = layouts.items[id];
    if (!src) return;
    const newId = genLayoutId(layouts.items);
    persist({
      ...layouts,
      activeId: newId,
      items: {
        ...layouts.items,
        [newId]: { name: `${src.name || id} copy`, grid: (src.grid || []).map(it => ({ ...it })) },
      },
    });
  }, [layouts, persist]);

  /** New layout seeded from the app-default desktop rows. */
  const createLayout = useCallback(() => {
    const newId = genLayoutId(layouts.items);
    persist({
      ...layouts,
      activeId: newId,
      items: {
        ...layouts.items,
        [newId]: { name: `Layout ${Object.keys(layouts.items).length + 1}`, grid: migrateDesktopRowsToGrid(DEFAULT_LAYOUT.desktopRows) },
      },
    });
  }, [layouts, persist]);

  /** Delete a layout — always keeps at least one. */
  const deleteLayout = useCallback((id) => {
    const ids = Object.keys(layouts.items);
    if (!layouts.items[id] || ids.length <= 1) return;
    const items = { ...layouts.items };
    delete items[id];
    const nextActive = layouts.activeId === id ? Object.keys(items)[0] : layouts.activeId;
    persist({ ...layouts, activeId: nextActive, items });
  }, [layouts, persist]);

  return {
    layouts, activeId, activeGrid,
    setActiveGrid, addPanel, removePanel,
    switchLayout, renameLayout, duplicateLayout, createLayout, deleteLayout,
  };
}

export default useGridLayouts;
