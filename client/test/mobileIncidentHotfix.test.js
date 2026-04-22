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
