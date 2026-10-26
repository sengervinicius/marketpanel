// @ts-check
/**
 * tests/monitor/logged-in.spec.js — #292 Wave 6
 *
 * The one check that sees what the user sees. Everything in /api/selftest
 * is server-side; on 26 Oct 2026 the server reported "OK" while the
 * signed-in home grid showed Friday's prices with a green LIVE badge.
 * This signs in as a monitor account against PRODUCTION, loads the home
 * grid and the ^BVSP detail page, and fails on what a user would call
 * broken:
 *
 *   - any row in the home grid with no price while its market is open
 *   - more than 10% of rows with no change figure
 *   - a "DATA FEED DEGRADED" banner
 *   - the QUOTE badge saying LIVE when the as-of line is not within 2 min
 *   - the QUOTE badge saying TIME UNKNOWN (server lost the timestamp)
 *   - any "⚠ CHECK" tag on the Brazil board (sources disagree)
 *   - console errors other than the known pre-login 401
 *
 * Env (GitHub secrets):
 *   MONITOR_BASE_URL  default https://the-particle.com
 *   MONITOR_API_URL   default https://senger-server.onrender.com
 *   MONITOR_USERNAME  monitor account (Nuclear tier so every panel loads)
 *   MONITOR_PASSWORD
 *
 * Run locally: MONITOR_USERNAME=… MONITOR_PASSWORD=… npx playwright test -c tests/monitor/playwright.config.js
 */

'use strict';

const { test, expect } = require('@playwright/test');

const BASE = process.env.MONITOR_BASE_URL || 'https://the-particle.com';
const API  = process.env.MONITOR_API_URL  || 'https://senger-server.onrender.com';
const USER = process.env.MONITOR_USERNAME;
const PASS = process.env.MONITOR_PASSWORD;

test.skip(!USER || !PASS, 'MONITOR_USERNAME / MONITOR_PASSWORD not set');

// Session windows (approximate, holiday-unaware on purpose: a holiday
// shows as "no rows unpriced" anyway because the last close is a price).
function sessionOpen(tz, openMin, closeMin) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const g = (t) => (p.find(x => x.type === t) || {}).value;
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')] ?? 0;
  const m = (parseInt(g('hour'), 10) % 24) * 60 + parseInt(g('minute'), 10);
  return dow >= 1 && dow <= 5 && m >= openMin && m <= closeMin;
}
const US_OPEN = () => sessionOpen('America/New_York', 9 * 60 + 45, 16 * 60);
const B3_OPEN = () => sessionOpen('America/Sao_Paulo', 10 * 60 + 15, 17 * 60);

async function apiLogin(request) {
  const r = await request.post(`${API}/api/auth/login`, { data: { username: USER, password: PASS } });
  expect(r.ok(), `login HTTP ${r.status()}`).toBeTruthy();
  const j = await r.json();
  expect(j.token, 'login returned no token').toBeTruthy();
  return { token: j.token, refresh: j.refreshToken || null };
}

async function openSignedIn(page, request, path = '/') {
  const { token, refresh } = await apiLogin(request);
  await page.addInitScript(([t, r]) => {
    try { localStorage.setItem('arc_token', t); if (r) localStorage.setItem('arc_refresh', r); } catch {}
  }, [token, refresh]);
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/401|Refresh token invalid|Failed to load resource/.test(text)) return;
    consoleErrors.push(text.slice(0, 200));
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  // Decline non-essential cookies if a banner is present.
  const decline = page.getByRole('button', { name: /decline|reject|only necessary|recusar/i }).first();
  if (await decline.isVisible({ timeout: 2000 }).catch(() => false)) await decline.click().catch(() => {});
  return { consoleErrors };
}

test('home grid: prices present, change present, no degraded banner', async ({ page, request }) => {
  const { consoleErrors } = await openSignedIn(page, request, '/');
  // Wait for the first price rows to render.
  await expect(page.locator('[data-price-row]').first()).toBeVisible({ timeout: 45_000 });
  // Give the progressive merge a moment to fill in.
  await page.waitForTimeout(8_000);

  const rows = await page.locator('[data-price-row]').evaluateAll((els) => els.map(e => ({
    symbol: e.getAttribute('data-symbol'),
    hasPrice: e.getAttribute('data-has-price') === '1',
    hasChange: e.getAttribute('data-has-change') === '1',
    warn: e.getAttribute('data-warn'),
  })));
  expect(rows.length, 'no price rows rendered at all').toBeGreaterThan(10);

  const unpriced = rows.filter(r => !r.hasPrice).map(r => r.symbol);
  const noChange = rows.filter(r => r.hasPrice && !r.hasChange).map(r => r.symbol);
  const warned = rows.filter(r => r.warn).map(r => `${r.symbol}:${r.warn}`);

  test.info().annotations.push({ type: 'rows', description: `${rows.length} rows · unpriced ${unpriced.length} · noChange ${noChange.length} · warned ${warned.length}` });

  // Unpriced rows: a hard failure only while a major market is open.
  const marketOpen = US_OPEN() || B3_OPEN();
  if (marketOpen) {
    expect(unpriced, `rows with no price during session: ${unpriced.join(', ')}`).toHaveLength(0);
  } else {
    expect(unpriced.length / rows.length, `too many unpriced rows off-session: ${unpriced.join(', ')}`).toBeLessThan(0.2);
  }
  expect(noChange.length / rows.length, `rows with a price but no change: ${noChange.join(', ')}`).toBeLessThan(0.1);
  expect(warned, `cross-source / anomaly warnings on the board: ${warned.join(', ')}`).toHaveLength(0);

  const banner = page.getByText(/DATA FEED DEGRADED/i);
  expect(await banner.count(), 'DATA FEED DEGRADED banner is showing').toBe(0);

  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toHaveLength(0);
});

test('^BVSP detail: badge is honest about time', async ({ page, request }) => {
  // main.jsx bridges /?detail=SYMBOL onto the #/detail route.
  await openSignedIn(page, request, '/?detail=%5EBVSP');

  const badge = page.locator('.id-coverage-badge').filter({ hasText: /LIVE|DELAYED|STALE|OPENS|CLOSED|HOLIDAY|AFTER-HRS|TIME UNKNOWN|QUOTED/ }).first();
  await expect(badge).toBeVisible({ timeout: 30_000 });
  const text = (await badge.textContent() || '').trim();
  const asOfLine = (await page.locator('.id-hero-asof').first().textContent().catch(() => '')) || '';
  test.info().annotations.push({ type: 'bvsp', description: `badge "${text}" · asof "${asOfLine.trim()}"` });

  expect(text, 'server lost the quote timestamp').not.toMatch(/TIME UNKNOWN/);
  if (/^LIVE/.test(text)) {
    expect(B3_OPEN(), `badge says LIVE but B3 is not in session (${text})`).toBeTruthy();
    expect(asOfLine, `badge says LIVE but as-of is not recent: ${asOfLine}`).toMatch(/NOW|[01]m AGO|LIVE/i);
  }
  if (B3_OPEN()) {
    expect(text, `B3 is open but the Ibovespa quote is stale: ${text}`).not.toMatch(/STALE/);
  }
  // Index pages must not render stock-only sections.
  expect(await page.getByText(/INSIDER TRANSACTIONS/i).count(), 'insider section rendered on an index page').toBe(0);
});
