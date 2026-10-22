/**
 * selftest.js — one endpoint that answers "is the product actually working?"
 *
 * WHY THIS EXISTS
 * ---------------
 * Every failure in the 4 Aug incident was invisible until a human opened the app
 * and saw em-dashes: trials 402'd by a type bug, admins paywalled out of their own
 * data, 22 symbols rejected on a format mismatch, a live feed that had never
 * delivered a single tick across 183 reconnects. Each of those is trivially
 * detectable from inside the server. None of them was being checked.
 *
 * So this runs the checks server-side and reports pass/fail. It is deliberately
 * UNAUTHENTICATED and deliberately returns no user data, no prices and no
 * secrets — only shapes, counts, ages and booleans. That keeps it safe to expose
 * (same posture as /api/feed/health) while letting it be polled after every
 * deploy without needing anyone's credentials.
 *
 * GET /api/selftest        full report
 * GET /api/selftest?brief=1  just { ok, failed:[names] }
 */

const express = require('express');
const router = express.Router();

const pg = require('../db/postgres');
const logger = require('../utils/logger');
const providerBudget = require('../utils/providerBudget');
const { decideSubscription } = require('../authMiddleware');

const DAY = 86_400_000;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((r) => ({ name, ok: r.ok !== false, ...r }))
    .catch((e) => ({ name, ok: false, error: e.message }));
}

/**
 * The access gate, exercised against synthetic users. No database, no accounts.
 * These five cases are exactly the ones that broke in production.
 */
function gateChecks() {
  const now = Date.now();
  const base = { id: 999999, username: '__selftest__', isPaid: false, subscriptionActive: true };
  const cases = [
    ['gate.trial_active',   { ...base, trialEndsAt: now + 10 * DAY, createdAt: now - DAY },        true],
    ['gate.trial_expired',  { ...base, trialEndsAt: now - DAY, createdAt: now - 30 * DAY },        false],
    // Regression guard: trial_ends_at missing must fall back to created_at, not lock the user out.
    ['gate.trial_null_new', { ...base, trialEndsAt: null, createdAt: now - 2 * DAY },              true],
    ['gate.trial_null_old', { ...base, trialEndsAt: null, createdAt: now - 300 * DAY },            false],
    ['gate.paid',           { ...base, isPaid: true, trialEndsAt: null, createdAt: null },          true],
  ];
  return cases.map(([name, user, expectAllow]) => {
    const d = decideSubscription(user, now);
    return { name, ok: d.allow === expectAllow, expected: expectAllow ? 'allow' : 'block',
             got: d.allow ? 'allow' : 'block', reason: d.reason };
  });
}

/**
 * Live data probe: ask the SAME provider helper the market routes use for a few
 * representative instruments and require real positive prices back.
 *
 * An earlier draft of this file called getStocksSnapshot()/getForexSnapshot()
 * — functions that do not exist in this codebase. Every one of those checks would
 * have silently skipped and the endpoint would have reported all-green while
 * testing nothing. A self-test that can pass without checking anything is worse
 * than no self-test, so this now goes through a helper that is verifiably
 * exported and asserts on the numbers.
 */
const PROBE_SYMBOLS = {
  'probe.us_equity': 'AAPL',
  'probe.brazil':    'PETR4.SA',
  'probe.etf':       'SPY',
};

async function probeQuote(symbol) {
  const { yahooQuote } = require('./market/lib/providers');
  if (typeof yahooQuote !== 'function') {
    return { ok: false, detail: 'yahooQuote helper missing — provider layer changed shape' };
  }
  const t0 = Date.now();
  const raw = await yahooQuote(symbol);
  const rows = raw?.quoteResponse?.result || raw?.result || (Array.isArray(raw) ? raw : []);
  const row = rows[0] || null;
  const price = row?.regularMarketPrice ?? row?.price ?? null;
  return {
    ok: typeof price === 'number' && price > 0,
    symbol,
    hasRow: !!row,
    priced: typeof price === 'number' && price > 0,
    ms: Date.now() - t0,
  };
}

router.get('/', async (req, res) => {
  const started = Date.now();
  const checks = [];

  checks.push(await check('db.postgres', async () => {
    if (!pg.isConnected()) return { ok: false, detail: 'not connected' };
    const r = await pg.query('SELECT 1 AS ok');
    return { ok: r?.rows?.[0]?.ok === 1 };
  }));

  checks.push(...gateChecks());

  // Providers: report configuration and live rate-budget state without leaking keys.
  checks.push(await check('provider.twelvedata', async () => {
    const td = require('../providers/twelvedata');
    return { ok: !!td.isConfigured?.(), configured: !!td.isConfigured?.(),
             maxRpm: parseInt(process.env.TWELVEDATA_MAX_RPM, 10) || 28 };
  }));

  checks.push(await check('provider.polygon_ws', async () => {
    // Reported as a WARNING rather than a failure: the Polygon key has no
    // WebSocket entitlement, so nothing streams, but REST polling still supplies
    // prices and the product works. Recorded here so it stops being a surprise.
    return { ok: true, warn: true,
             detail: 'live streaming needs a Polygon real-time plan; REST polling supplies prices' };
  }));

  // Real data, through the real provider helper.
  for (const [name, symbol] of Object.entries(PROBE_SYMBOLS)) {
    checks.push(await check(name, () => probeQuote(symbol)));
  }

  // ── #292 grid — exercise what the HOME SCREEN actually calls ──────────
  //
  // The single-symbol probes above kept passing while the logged-in grid
  // was a wall of "—": every /snapshot/* route is Yahoo, the default stock
  // list is ~80 tickers in parallel batches, and a 429'd batch used to be
  // dropped silently with status:'OK'. These checks run the same batch
  // builders (cache-aware, so hitting /selftest doesn't itself hammer
  // Yahoo), report requested vs received, the newest quote's age, and the
  // crumb circuit + rate budget so "providers are down" is visible here
  // instead of only in the user's screenshot.
  const providers = require('./market/lib/providers');
  checks.push(await check('yahoo.circuit', async () => {
    const st = providers.getYahooCircuitState();
    return { ok: !st.open, warn: st.failures > 0 && !st.open, ...st };
  }));
  checks.push(await check('yahoo.budget', async () => {
    const u = providerBudget.usage('yahoo');
    if (!u) return { ok: true, warn: true, detail: 'no budget declared' };
    return { ok: u.pct < 0.95, warn: u.pct >= 0.8, used: u.used, limit: u.limit, pct: Math.round(u.pct * 100) / 100, windowMs: u.windowMs,
             // #292 grid — which code path is spending it (since process start)
             bySite: providerBudget.sites('yahoo') };
  }));

  const STALE_MS = 36 * 60 * 60 * 1000; // > 36h = older than any weekend close
  function gridSummary(label, requested, quotes, failed) {
    const received = quotes.length;
    const newest = quotes.reduce((m, q) => Math.max(m, (q.regularMarketTime || 0) * 1000), 0);
    const ageMs = newest ? Date.now() - newest : null;
    const priced = quotes.filter(q => typeof q.regularMarketPrice === 'number' && q.regularMarketPrice > 0).length;
    const ok = received > 0 && priced >= Math.ceil(requested * 0.8) && (ageMs == null || ageMs < STALE_MS);
    const warn = ok && (received < requested || priced < requested);
    return {
      ok, warn,
      requested, received, priced,
      missing: requested - received,
      newestQuoteAgeMs: ageMs,
      stale: ageMs != null && ageMs >= STALE_MS,
      firstError: failed && failed[0] ? failed[0].error : null,
      label,
    };
  }

  checks.push(await check('grid.stocks', async () => {
    const stocks = require('./market/stocks');
    const d = await stocks.batchYahooQuoteDetailed(stocks.DEFAULT_STOCK_TICKERS);
    return gridSummary('/snapshot/stocks', d.requested, d.quotes, d.failed);
  }));
  checks.push(await check('grid.forex', async () => {
    const syms = ['EURUSD=X','GBPUSD=X','USDJPY=X','USDBRL=X','USDCHF=X','AUDUSD=X'];
    const q = await providers.yahooQuote(syms.join(','));
    return gridSummary('/snapshot/forex', syms.length, q || [], null);
  }));
  checks.push(await check('grid.crypto', async () => {
    const syms = ['BTC-USD','ETH-USD','SOL-USD'];
    const q = await providers.yahooQuote(syms.join(','));
    return gridSummary('/snapshot/crypto', syms.length, q || [], null);
  }));
  checks.push(await check('grid.brazil', async () => {
    const syms = ['PETR4.SA','VALE3.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','B3SA3.SA'];
    const q = await providers.yahooQuote(syms.join(','));
    return gridSummary('/snapshot/brazil', syms.length, q || [], null);
  }));
  checks.push(await check('grid.rates', async () => {
    const syms = ['^IRX','^FVX','^TNX','^TYX'];
    const q = await providers.yahooQuote(syms.join(','));
    return gridSummary('/snapshot/rates', syms.length, q || [], null);
  }));

  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  const warned = checks.filter((c) => c.ok && c.warn).map((c) => c.name);
  const body = {
    ok: failed.length === 0,
    ts: new Date().toISOString(),
    ms: Date.now() - started,
    failed, warned,
  };
  if (!req.query.brief) body.checks = checks;

  if (failed.length) logger.warn('selftest', `FAILING: ${failed.join(', ')}`);
  res.status(failed.length ? 503 : 200).json(body);
});

module.exports = router;
