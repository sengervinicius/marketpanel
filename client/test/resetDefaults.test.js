/**
 * resetDefaults.test.js — pins the exact settings partial that RESET DEFAULT
 * applies (config/resetDefaults.js). Guards against the H0/H2a regression
 * where reset restored the pre-H0 layout (optionsFlow/predictions) and the
 * legacy ETF commodities list instead of the current client defaults.
 */
import { describe, it, expect } from 'vitest';
import { buildResetDefaultsPayload, buildDefaultPanelSettings } from '../src/config/resetDefaults';
import { DEFAULT_LAYOUT, PANEL_DEFINITIONS } from '../src/config/panels';
import { COMMODITY_DEFAULT_SYMBOLS } from '../src/utils/constants';
import { isValidLayoutsState } from '../src/components/home/gridLayoutModel';

describe('buildResetDefaultsPayload', () => {
  const payload = buildResetDefaultsPayload();

  it('applies the CURRENT DEFAULT_LAYOUT desktop rows and mobile tabs', () => {
    expect(payload.layout.desktopRows).toEqual(DEFAULT_LAYOUT.desktopRows);
    expect(payload.layout.mobileTabs).toEqual(DEFAULT_LAYOUT.mobileTabs);
  });

  it('does NOT restore the removed optionsFlow/predictions panels (H0.4d)', () => {
    const ids = payload.layout.desktopRows.flat();
    expect(ids).not.toContain('optionsFlow');
    expect(ids).not.toContain('predictions');
  });

  it('includes the H2a movers + calendar panels in the default rows', () => {
    const ids = payload.layout.desktopRows.flat();
    expect(ids).toContain('movers');
    expect(ids).toContain('calendar');
  });

  it('resets commodities to the current futures defaults, not legacy ETFs', () => {
    expect(payload.panels.commodities.symbols).toEqual(COMMODITY_DEFAULT_SYMBOLS);
    expect(payload.panels.commodities.symbols).toEqual(
      PANEL_DEFINITIONS.commodities.defaultSymbols
    );
    for (const legacy of ['GLD', 'SLV', 'USO', 'UNG', 'CORN', 'WEAT', 'SOYB', 'CPER', 'BHP']) {
      expect(payload.panels.commodities.symbols).not.toContain(legacy);
    }
    // Sanity: futures list is non-empty and all front-month '=F' symbols
    expect(payload.panels.commodities.symbols.length).toBeGreaterThan(0);
    expect(payload.panels.commodities.symbols.every(s => s.endsWith('=F'))).toBe(true);
  });

  it('overwrites every editable panel with its PANEL_DEFINITIONS defaults', () => {
    for (const [id, cfg] of Object.entries(payload.panels)) {
      expect(PANEL_DEFINITIONS[id]).toBeTruthy();
      expect(PANEL_DEFINITIONS[id].editable).toBe(true);
      expect(cfg.title).toBe(PANEL_DEFINITIONS[id].defaultTitle);
      expect(cfg.symbols).toEqual(PANEL_DEFINITIONS[id].defaultSymbols);
    }
    // The panels the CIO layout depends on must all be present
    for (const id of ['usEquities', 'brazilB3', 'globalIndices', 'forex', 'commodities']) {
      expect(payload.panels[id]).toBeTruthy();
    }
  });

  it('resets the home_grid_v2 layouts state to a valid grid of DEFAULT_LAYOUT', () => {
    expect(isValidLayoutsState(payload.layouts)).toBe(true);
    const grid = payload.layouts.items[payload.layouts.activeId].grid;
    expect(grid.map(g => g.i).sort()).toEqual(
      [...new Set(DEFAULT_LAYOUT.desktopRows.flat())].sort()
    );
  });

  it('clears panel visibility overrides', () => {
    expect(payload.panelVisible).toEqual({});
  });

  it('returns fresh copies — mutating the payload cannot corrupt the canon', () => {
    const a = buildResetDefaultsPayload();
    a.layout.desktopRows[0].push('hacked');
    a.panels.commodities.symbols.push('HACKED');
    const b = buildResetDefaultsPayload();
    expect(b.layout.desktopRows[0]).not.toContain('hacked');
    expect(b.panels.commodities.symbols).not.toContain('HACKED');
    expect(DEFAULT_LAYOUT.desktopRows[0]).not.toContain('hacked');
    expect(PANEL_DEFINITIONS.commodities.defaultSymbols).not.toContain('HACKED');
  });
});

describe('buildDefaultPanelSettings', () => {
  it('skips non-editable and symbol-less panels', () => {
    const panels = buildDefaultPanelSettings();
    expect(panels.charts).toBeUndefined();   // special, editable: false
    expect(panels.debt).toBeUndefined();     // country selector, no symbols
    expect(panels.watchlist).toBeUndefined();
    expect(panels.news).toBeUndefined();
  });
});
