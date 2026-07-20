// @ts-check
/**
 * design-lint.spec.js — painted-style guard for the home terminal.
 *
 * Walks every rendered element on the logged-in home screen, collects the
 * COMPUTED colors (text / background / border / SVG fill+stroke) and font
 * families, and asserts:
 *
 *   1. every painted color resolves to an entry in
 *      client/src/styles/paintAllowlist.js (token values + chart exceptions),
 *      tolerating — but counting — the KNOWN_OFFENDERS burn-down list;
 *   2. every painted font-family leads with an approved family
 *      (the token sans/mono/display stacks);
 *   3. (logged, non-fatal) font sizes below the 8.5px type-scale floor.
 *
 * Tolerant by design: existing legacy grays are reported with counts, the
 * test only FAILS when a color outside allowlist + known-offenders shows up
 * — i.e. it blocks NEW off-token paint without flaking on the backlog.
 *
 * Skips gracefully like home-smoke.spec.js:
 *   - E2E_BASE_URL unset            -> whole file skipped
 *   - E2E_TEST_EMAIL/PASSWORD unset -> whole file skipped
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const { loginUI } = require('./helpers');

const BASE_URL = process.env.E2E_BASE_URL;
const HAS_CREDS = !!(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

const ALLOWLIST_PATH = path.join(__dirname, '..', '..', 'client', 'src', 'styles', 'paintAllowlist.js');

/** Browser-side scanner. Serialized into page.evaluate — keep self-contained. */
function scanPaintedStyles() {
  const colorProps = [
    'color', 'backgroundColor',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'fill', 'stroke', 'outlineColor', 'textDecorationColor', 'caretColor',
  ];
  const widthFor = {
    borderTopColor: 'borderTopWidth',
    borderRightColor: 'borderRightWidth',
    borderBottomColor: 'borderBottomWidth',
    borderLeftColor: 'borderLeftWidth',
    outlineColor: 'outlineWidth',
  };
  const colors = {};   // normalized color -> count
  const fonts = {};    // first font family -> count
  const smallText = {}; // font-size below floor -> count

  const norm = (raw) => {
    if (!raw || raw === 'none' || raw === 'transparent' || raw === 'currentcolor') return null;
    const m = raw.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (!m) return raw.toLowerCase().replace(/\s+/g, '');
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) return null; // never paints
    const hex = '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
    if (a === 1) return hex;
    return `rgba(${m[1]},${m[2]},${m[3]},${m[4]})`;
  };

  const els = document.querySelectorAll('body *');
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    for (const prop of colorProps) {
      if ((prop === 'fill' || prop === 'stroke') && !isSvg) continue;
      const wProp = widthFor[prop];
      if (wProp && parseFloat(cs[wProp]) === 0) continue;
      const v = norm(cs[prop]);
      if (v) colors[v] = (colors[v] || 0) + 1;
    }

    const hasText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0
    );
    if (hasText) {
      const fam = (cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (fam) fonts[fam] = (fonts[fam] || 0) + 1;
      const size = parseFloat(cs.fontSize);
      if (size && size < 8.45) smallText[cs.fontSize] = (smallText[cs.fontSize] || 0) + 1;
    }
  }
  return { colors, fonts, smallText, scanned: els.length };
}

test.describe('design lint (painted styles)', () => {
  test.skip(!BASE_URL, 'E2E_BASE_URL not set — skipping design lint');
  test.skip(!HAS_CREDS, 'E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — home requires login');

  test('home paints only allowlisted colors and fonts', async ({ page }) => {
    const allow = await import(pathToFileURL(ALLOWLIST_PATH).href);
    const allowed = new Set(
      allow.ALL_ALLOWED.map((c) => c.toLowerCase().replace(/\s+/g, ''))
    );
    const knownOffenders = new Set(
      allow.KNOWN_OFFENDERS.map((c) => c.toLowerCase().replace(/\s+/g, ''))
    );
    const allowedFonts = new Set(allow.ALLOWED_FONT_FAMILIES.map((f) => f.toLowerCase()));

    await loginUI(page);
    await expect(page.locator('[data-tour="workspace"]')).toBeVisible({ timeout: 20_000 });
    // Let panels stream in so their painted styles are representative.
    await page.waitForTimeout(3000);

    const { colors, fonts, smallText, scanned } = await page.evaluate(scanPaintedStyles);
    console.log(`[design-lint] scanned ${scanned} elements; ${Object.keys(colors).length} distinct colors, ${Object.keys(fonts).length} font families`);

    // ── Colors ──────────────────────────────────────────────────────────
    const isAllowedRgba = (c) => {
      // rgba() paints: exact token-rgba match, or the rgb triple matches an
      // allowed hex (arbitrary-alpha tint of a token color is acceptable).
      const m = c.match(/^rgba\((\d+),(\d+),(\d+),/);
      if (!m) return false;
      const hex = '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
      return allowed.has(hex) || knownOffenders.has(hex);
    };
    const newOffenders = [];
    let knownCount = 0;
    for (const [c, n] of Object.entries(colors)) {
      if (allowed.has(c)) continue;
      if (knownOffenders.has(c)) { knownCount += n; continue; }
      if (c.startsWith('rgba(') && isAllowedRgba(c)) continue;
      newOffenders.push(`${c} (${n} paints)`);
    }
    if (knownCount) console.log(`[design-lint] tolerated ${knownCount} paints from KNOWN_OFFENDERS (burn-down list)`);
    if (newOffenders.length) console.log('[design-lint] NEW off-token colors:', newOffenders.join(', '));
    expect(newOffenders, 'colors painted outside paintAllowlist.js').toEqual([]);

    // ── Fonts ───────────────────────────────────────────────────────────
    const badFonts = Object.entries(fonts)
      .filter(([f]) => !allowedFonts.has(f.toLowerCase()))
      .map(([f, n]) => `${f} (${n} elements)`);
    if (badFonts.length) console.log('[design-lint] off-stack font families:', badFonts.join(', '));
    expect(badFonts, 'font families outside the token stacks').toEqual([]);

    // ── Type-scale floor (informational) ────────────────────────────────
    const small = Object.entries(smallText).map(([s, n]) => `${s} (${n})`);
    if (small.length) console.log('[design-lint] WARNING: text below 8.5px floor:', small.join(', '));
  });
});
