/**
 * mobileIncidentHotfix.test.js
 * ─────────────────────────────────────────────────────────────────────
 * Regression tests for the mobile-incident hotfix.
 *
 * Background (CIO, 2026-04-22):
 *   "mobile app is completely broken... particle AI section has a weird
 *    black rectangle... [AI error pill reads] ERROR ... feedback button
 *    is ridiculous... why is the vault not available on mobile???"
 *
 * This file nails down the four contract-level changes so they do not
 * silently regress:
 *
 *   1. Coverage matrix returns MUTED ('N/A', neutral grey) for chart
 *      and AI transient failures on mobile — never alarming red.
 *   2. FeedbackButton exports a named `FeedbackLink` (mobile entry
 *      point in Settings) in addition to the default floating pill.
 *   3. VaultPanel renders its inner panel unconditionally — no
 *      DesktopOnlyPlaceholder wrapper.
 *   4. Provider matrix coverage level resolution is stable for the
 *      representative tickers (HTZ, PETR4.SA, USDBRL) so that
 *      mobile degraded banners do not trigger spuriously.
 * ─────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import {
  getDataTypeCoverage,
  getProviderRouting,
  COVERAGE,
} from '../src/config/providerMatrix';

describe('mobile hotfix — coverage matrix label softening', () => {
  it('chart label falls back to N/A (muted grey), not red UNAVAILABLE, when no bars are present', () => {
    const out = getDataTypeCoverage('HTZ', null, {
      hasBars: false,
      chartLoading: false,
    });

    expect(out.chart.label).toBe('N/A');
    // Neutral grey on near-black bg, not alarming red.
    expect(out.chart.color).toBe('#888');
    expect(out.chart.bg).toBe('#1a1a1a');
    // Whatever we return, it MUST NOT be the old red alert.
    expect(out.chart.label).not.toBe('UNAVAILABLE');
    expect(out.chart.color).not.toBe('#f44336');
  });

  it('AI label falls back to N/A (muted grey), not red ERROR, when the AI call failed for one ticker', () => {
    const out = getDataTypeCoverage('HTZ', null, {
      hasAI: false,
      aiLoading: false,
      aiError: true,
    });

    expect(out.ai.label).toBe('N/A');
    expect(out.ai.color).toBe('#888');
    expect(out.ai.bg).toBe('#1a1a1a');
    expect(out.ai.label).not.toBe('ERROR');
    expect(out.ai.color).not.toBe('#f44336');
  });

  it('still shows LIVE (green) when a live quote is present — softening must not swallow success', () => {
    const out = getDataTypeCoverage('AAPL', null, { hasLiveQuote: true });
    expect(out.quote.label).toBe('LIVE');
    expect(out.quote.color).toBe('#4caf50');
  });

  it('still shows AVAILABLE (green) when bars are present', () => {
    const out = getDataTypeCoverage('AAPL', null, { hasBars: true });
    expect(out.chart.label).toBe('AVAILABLE');
    expect(out.chart.color).toBe('#4caf50');
  });

  it('still shows AVAILABLE (green) when AI content is present', () => {
    const out = getDataTypeCoverage('AAPL', null, { hasAI: true });
    expect(out.ai.label).toBe('AVAILABLE');
    expect(out.ai.color).toBe('#4caf50');
  });
});

describe('mobile hotfix — provider routing sanity', () => {
  it('HTZ resolves to US / FULL coverage (no degraded banner on mobile)', () => {
    const r = getProviderRouting('HTZ');
    expect(r.group).toBe('US');
    expect(r.coverage).toBe(COVERAGE.FULL);
  });

  it('PETR4.SA resolves to B3 / DELAYED coverage (banner expected, but soft)', () => {
    const r = getProviderRouting('PETR4.SA');
    expect(r.group).toBe('B3');
    expect(r.coverage).toBe(COVERAGE.DELAYED);
  });

  it('C:USDBRL resolves to FX / FULL (no degraded banner)', () => {
    const r = getProviderRouting('C:USDBRL');
    expect(r.group).toBe('FX');
    expect(r.coverage).toBe(COVERAGE.FULL);
  });
});

describe('mobile hotfix — FeedbackButton exports', () => {
  it('exports a default component (desktop floating pill) and a named FeedbackLink (mobile settings entry)', async () => {
    const mod = await import('../src/components/common/FeedbackButton.jsx');
    expect(typeof mod.default).toBe('function');
    expect(typeof mod.FeedbackLink).toBe('function');
  });

  it('default FeedbackButton source renders NULL on mobile (DOM-level guard)', async () => {
    // v2 relied on a CSS media query inside a modal-only <style> block,
    // which unmounted when the modal was closed and left iOS to render a
    // native white pill full-width at the top of the screen. v3 gates at
    // the component level: if useIsMobile() is true we return null BEFORE
    // emitting any DOM. Pin this at the source-text level so a future
    // refactor that re-introduces the bug fails loudly.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'components', 'common', 'FeedbackButton.jsx'),
      'utf8',
    );
    // Default export must import and call useIsMobile and must early-return.
    expect(src).toMatch(/import\s*{\s*useIsMobile\s*}\s*from\s*['"][^'"]+useIsMobile['"]/);
    expect(src).toMatch(/export default function FeedbackButton[\s\S]{0,400}useIsMobile\(\)[\s\S]{0,200}if\s*\(\s*isMobile\s*\)\s*return\s*null/);
  });

  it('pill CSS lives in the default FeedbackButton component, not only in the modal', async () => {
    // The v2 regression root cause was that .particle-feedback-btn CSS
    // lived inside FeedbackModal, which returns null when closed. Pin
    // that the pill styles ship with the button itself now.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'components', 'common', 'FeedbackButton.jsx'),
      'utf8',
    );
    // Find the slice starting at "export default function FeedbackButton"
    // and assert the pill class styling appears inside it.
    const defaultIdx = src.indexOf('export default function FeedbackButton');
    expect(defaultIdx).toBeGreaterThan(0);
    const defaultSlice = src.slice(defaultIdx);
    expect(defaultSlice).toMatch(/\.particle-feedback-btn\s*\{/);
  });
});

describe('mobile hotfix v4 — Particle bottom opaque rectangle + chart axes', () => {
  /**
   * CIO (2026-04-22, second wave):
   *   1. "there is still an opaque rectangle in the bottom of the
   *      particle screen on mobile.. also don't understand why this
   *      still hasen't been fixed"
   *   2. "chart still out of format on mobile.. axis y too much to
   *      the right.. then the volume bars completely messed up"
   *
   * Fixes pinned here:
   *   - .particle-conv-input loses backdrop-filter on mobile (same
   *     iOS rendering pathology as the search-input v2/v3) and
   *     becomes a solid bg that matches --color-bg; desktop re-adds
   *     the blur inside @media (min-width: 768px).
   *   - .particle-chip similarly ditches backdrop-filter on mobile;
   *     desktop keeps the subtle raised surface + blur.
   *   - InstrumentDetail.jsx price YAxis uses `orientation="right"`
   *     (the previous `position="right"` was silently ignored —
   *     `position` is not a valid Recharts prop — so the axis
   *     rendered on the LEFT by default, with width={64} eating
   *     ~18% of a 360px-wide mobile chart).
   *   - Volume + RSI + MACD Y-axes also pinned to right-orientation
   *     so the bars span the full chart width.
   *   - All four Y-axes use width={isMobile ? 44 : 64}.
   */
  // Use dynamic ESM imports inside each test to match the pattern the
  // rest of this file uses (the v3 FeedbackButton tests).
  async function readAsync(rel) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    return fs.readFileSync(path.join(here, '..', rel), 'utf8');
  }

  // Strip /* ... */ comments so we can scan actual CSS declarations
  // without false positives from explanatory text.
  function stripCssComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '');
  }

  it('.particle-conv-input base rule has NO backdrop-filter (iOS opaque-rectangle fix)', async () => {
    const css = await readAsync('src/components/app/ParticleNav.css');
    // Slice from the rule header up to the next selector so we test the
    // base rule, not the @media desktop override.
    const idx = css.indexOf('.particle-conv-input {');
    expect(idx).toBeGreaterThan(0);
    const end = css.indexOf('}', idx);
    const rule = stripCssComments(css.slice(idx, end));
    expect(rule).not.toMatch(/backdrop-filter/);
    // Must still have a solid bg so scrolled messages don't bleed through.
    expect(rule).toMatch(/background:\s*var\(--color-bg/);
  });

  it('.particle-conv-input under @media (min-width: 768px) re-adds the blur (desktop polish preserved)', async () => {
    const css = await readAsync('src/components/app/ParticleNav.css');
    // Find the desktop @media block that contains .particle-conv-input
    // and assert backdrop-filter is re-applied there.
    const media = css.indexOf('@media (min-width: 768px)');
    expect(media).toBeGreaterThan(0);
    const slice = css.slice(media);
    // The desktop override for conv-input must exist AND must have blur.
    expect(slice).toMatch(/\.particle-conv-input\s*\{[\s\S]*?backdrop-filter:\s*blur/);
  });

  it('.particle-chip base rule has NO backdrop-filter (chip cluster no longer reads as a frosted rectangle on iOS)', async () => {
    const css = await readAsync('src/components/app/ParticleNav.css');
    const idx = css.indexOf('.particle-chip {');
    expect(idx).toBeGreaterThan(0);
    const end = css.indexOf('}', idx);
    const rule = stripCssComments(css.slice(idx, end));
    expect(rule).not.toMatch(/backdrop-filter/);
    // Mobile-first chip is transparent — canvas shows through.
    expect(rule).toMatch(/background:\s*transparent/);
  });

  it('InstrumentDetail price YAxis uses orientation="right" (Bloomberg-standard) — NOT the old invalid `position` prop', async () => {
    const jsx = await readAsync('src/components/common/InstrumentDetail.jsx');
    // The old bug: `position="right"` which Recharts ignored.
    expect(jsx).not.toMatch(/position=["']right["']/);
    // The fix: `orientation="right"` on at least the main price axis.
    expect(jsx).toMatch(/orientation=["']right["']/);
  });

  it('InstrumentDetail YAxis width is responsive to isMobile (44 vs 64)', async () => {
    const jsx = await readAsync('src/components/common/InstrumentDetail.jsx');
    // At least one axis uses the mobile-responsive width ternary.
    expect(jsx).toMatch(/width=\{isMobile\s*\?\s*44\s*:\s*64\}/);
  });
});

describe('mobile hotfix — VaultPanel has no DesktopOnlyPlaceholder gate', () => {
  it('VaultPanel module source does not import DesktopOnlyPlaceholder', async () => {
    // Load the raw source to assert the gate has truly been removed.
    // We cannot mount it (needs app context) but we CAN assert the
    // code path is gone — that is the regression we want to prevent.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'src', 'components', 'app', 'VaultPanel.jsx'),
      'utf8',
    );
    expect(src).not.toMatch(/^\s*import\s+DesktopOnlyPlaceholder/m);
    expect(src).not.toMatch(/<DesktopOnlyPlaceholder/);
  });
});
