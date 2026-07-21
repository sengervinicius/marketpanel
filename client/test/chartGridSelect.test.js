/**
 * chartGridSelect.test.js — fix/ux-round4 FIX 4 invariant.
 *
 * This file used to unit-test selectTickerInGrid(), the pure helper behind
 * "a ticker click replaces the primary chart tile". That behaviour is GONE
 * by design: ticker clicks open the instrument DETAIL view and must NEVER
 * touch the chart grid. The grid changes only through explicit user edits
 * inside ChartPanel (+ ADD, empty slot, drag-and-drop, × remove).
 *
 * No pure click→grid logic remains to unit-test, so these tests pin the
 * invariant at the source level: the helper is deleted, ChartPanel has no
 * external-ticker grid effect, every panel click path wires to openDetail,
 * and the drag-and-drop add/replace handlers are still present.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// vitest runs with cwd = client/ (jsdom rewrites import.meta.url to http:).
const srcPath = (rel) => path.resolve(process.cwd(), 'src', rel);
const src = (rel) => readFileSync(srcPath(rel), 'utf8');

describe('FIX 4 — ticker clicks never touch the chart grid', () => {
  it('selectTickerInGrid helper is deleted', () => {
    expect(existsSync(srcPath('utils/chartGridSelect.js'))).toBe(false);
  });

  it('ChartPanel has no external-ticker grid effect', () => {
    const s = src('components/panels/ChartPanel.jsx');
    expect(s).not.toContain('selectTickerInGrid');
    expect(s).not.toContain('externalTicker');
    // No `ticker` prop on the desktop grid panel at all — nothing outside
    // the panel can address the grid.
    expect(s).toMatch(/function ChartPanel\(\{ onGridChange, mobile = false \}\)/);
  });

  it('ChartPanel keeps its explicit edit paths (drag-drop / +ADD / remove)', () => {
    const s = src('components/panels/ChartPanel.jsx');
    expect(s).toContain("dataTransfer.getData('application/x-ticker')"); // drop targets
    expect(s).toContain('const addTicker');
    expect(s).toContain('const replaceTicker');
    expect(s).toContain('const swapTickers');
    expect(s).toContain('const removeTicker');
  });

  it('no panel wires onTickerClick to setChartTicker — clicks go to openDetail', () => {
    const s = src('components/app/AppLayoutHelpers.jsx');
    expect(s).not.toContain('onTickerClick: c.setChartTicker');
    expect(s).toContain('onTickerClick: c.openDetail');
    // charts entry passes no ticker prop
    expect(s).not.toContain('ticker: c.chartTicker');
  });

  it("App no longer listens for 'chart:set-ticker', and exposes openDetail in panel context", () => {
    const s = src('App.jsx');
    expect(s).not.toContain("addEventListener('chart:set-ticker'");
    expect(s).toMatch(/setChartGridCount, openDetail,?\s*\n?\s*\}\)/);
  });

  it("NewsPanel briefing chips open detail instead of dispatching 'chart:set-ticker'", () => {
    const s = src('components/panels/NewsPanel.jsx');
    expect(s).not.toContain("CustomEvent('chart:set-ticker'");
    expect(s).toContain('useOpenDetail');
  });
});
