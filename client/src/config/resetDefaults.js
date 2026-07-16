/**
 * resetDefaults.js — single source of truth for what "RESET DEFAULT" applies.
 *
 * Builds the exact /api/settings partial that restores the CURRENT client
 * defaults:
 *   - layout.desktopRows / mobileTabs  → DEFAULT_LAYOUT (config/panels.js)
 *   - layouts (home_grid_v2 grid)      → DEFAULT_LAYOUT migrated to grid items
 *   - panels                           → PANEL_DEFINITIONS defaultTitle/defaultSymbols
 *                                        (incl. the H0 commodities futures list)
 *   - panelVisible                     → {} (clears hide/show overrides)
 *
 * Kept as a pure module (no React, no context) so the reset payload is
 * unit-testable in isolation — see client/test/resetDefaults.test.js.
 */
import { DEFAULT_LAYOUT, PANEL_DEFINITIONS } from './panels';
import { makeDefaultLayoutsState } from '../components/home/gridLayoutModel';

/**
 * Default per-panel settings derived from PANEL_DEFINITIONS.
 * Only editable panels with a non-empty default symbol list are included —
 * these are the ones whose server-saved symbol lists must be overwritten on
 * reset (e.g. a pre-H0 ETF commodities list → current futures defaults).
 * @returns {Object.<string, {title: string, symbols: string[]}>}
 */
export function buildDefaultPanelSettings() {
  const panels = {};
  for (const def of Object.values(PANEL_DEFINITIONS)) {
    if (!def || !def.editable) continue;
    if (!Array.isArray(def.defaultSymbols) || def.defaultSymbols.length === 0) continue;
    panels[def.id] = {
      title: def.defaultTitle,
      symbols: [...def.defaultSymbols],
    };
  }
  return panels;
}

/**
 * Full settings partial applied (and persisted) by RESET DEFAULT.
 * Fresh copies everywhere — callers/mutations can never corrupt the
 * canonical DEFAULT_LAYOUT / PANEL_DEFINITIONS objects.
 * @returns {Object}
 */
export function buildResetDefaultsPayload() {
  return {
    layout: {
      desktopRows: DEFAULT_LAYOUT.desktopRows.map(row => [...row]),
      mobileTabs: [...DEFAULT_LAYOUT.mobileTabs],
    },
    // home_grid_v2: reset the editable grid too — otherwise a stale saved
    // grid (e.g. one still holding optionsFlow/predictions) survives reset.
    layouts: makeDefaultLayoutsState(DEFAULT_LAYOUT.desktopRows),
    panels: buildDefaultPanelSettings(),
    // Clear hide/show overrides so every default panel is visible again.
    panelVisible: {},
  };
}
