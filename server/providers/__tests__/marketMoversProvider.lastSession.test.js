/**
 * marketMoversProvider.lastSession.test.js — Polish W2 item 4: session-aware
 * MOVERS fallback.
 *
 * Outside US RTH Polygon zeroes the live snapshot's day.* fields; the
 * quality gate then rejects every row and the panel used to show NO DATA.
 * Proves getMarketMovers:
 *   - detects a zero-eligible live pull and serves the last COMPLETED
 *     session from grouped daily aggs (close-over-close change, session
 *     volume), tagged { session:'last', sessionLabel:'LAST SESSION · <DOW>' };
 *   - applies the same strict quality gate to fallback rows (quality:'all'
 *     bypasses it);
 *   - caches the grouped pull (one pair of aggs requests, later directions
 *     reuse it);
 *   - keeps session:'live' when the live snapshot has eligible rows.
 *
 * Polygon HTTP stubbed via require.cache on node-fetch — offline-safe.
 *
 *   cd server && node --test providers/__tests__/marketMoversProvider.lastSession.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub node-fetch BEFORE the provider is loaded ────────────────────
const fetchPath = require.resolve('node-fetch');
const providerPath = require.resolve('../marketMoversProvider');

// Overnight snapshot state: day.* zeroed, so every row fails the
// dollar-volume gate (price*0 < $50M) → zero eligible live rows.
const ZEROED_LIVE = [
  { ticker: 'AAA', day: { c: 0, v: 0 }, lastTrade: { p: 110 }, prevDay: { c: 100 }, todaysChange: 0, todaysChangePerc: 0 },
  { ticker: 'BBB', day: { c: 0, v: 0 }, lastTrade: { p: 47.5 }, prevDay: { c: 50 }, todaysChange: 0, todaysChangePerc: 0 },
];

// Grouped daily aggs — first call answers the most recent trading day,
// second call the one before it (the provider walks back in that order).
const GROUPED_LAST = [
  { T: 'AAA',  c: 110.0, v: 10_000_000 },   // +10.00% · $1.1B traded
  { T: 'BBB',  c: 47.5,  v: 2_000_000 },    //  -5.00% · $95M traded
  { T: 'PENY', c: 0.9,   v: 200_000_000 },  // +200% but sub-$5 junk
  { T: 'NOPC', c: 12.0,  v: 5_000_000 },    // no prior close → dropped
];
const GROUPED_PRIOR = [
  { T: 'AAA',  c: 100.0, v: 9_000_000 },
  { T: 'BBB',  c: 50.0,  v: 3_000_000 },
  { T: 'PENY', c: 0.3,   v: 150_000_000 },
];

const calls = { live: 0, grouped: 0 };

require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: async (url) => {
    if (url.includes('/v2/aggs/grouped/')) {
      calls.grouped += 1;
      return {
        ok: true,
        json: async () => ({ results: calls.grouped % 2 === 1 ? GROUPED_LAST : GROUPED_PRIOR }),
      };
    }
    calls.live += 1;
    return { ok: true, json: async () => ({ tickers: ZEROED_LIVE }) };
  },
};

delete require.cache[providerPath];
const { getMarketMovers } = require(providerPath);

const LABEL_RE = /^LAST SESSION · (MON|TUE|WED|THU|FRI)$/;

describe('marketMoversProvider last-session fallback (Polish W2 item 4)', () => {
  const savedKey = process.env.POLYGON_API_KEY;
  before(() => { process.env.POLYGON_API_KEY = 'test-key'; });
  after(() => {
    if (savedKey === undefined) delete process.env.POLYGON_API_KEY;
    else process.env.POLYGON_API_KEY = savedKey;
  });

  it('zero-eligible live snapshot → last-session gainers with sessionLabel', async () => {
    const res = await getMarketMovers({ direction: 'gainers', limit: 10 });
    assert.equal(res.session, 'last');
    assert.match(res.sessionLabel, LABEL_RE);
    // Close-over-close: AAA +10%, BBB -5%; PENY fails price gate, NOPC has
    // no prior close. Gainers rank AAA first.
    assert.deepEqual(res.movers.map(m => m.symbol), ['AAA', 'BBB']);
    assert.equal(res.movers[0].price, 110.0);
    assert.equal(res.movers[0].changePct, 10.0);
    assert.equal(res.movers[0].prevClose, 100.0);
    assert.equal(calls.grouped, 2); // exactly one pair of aggs pulls
  });

  it('losers reuse the cached grouped pull and invert the ranking', async () => {
    const res = await getMarketMovers({ direction: 'losers', limit: 10 });
    assert.equal(res.session, 'last');
    assert.equal(res.movers[0].symbol, 'BBB');
    assert.equal(res.movers[0].changePct, -5.0);
    assert.equal(calls.grouped, 2); // no new aggs requests
  });

  it('actives rank fallback rows by session volume', async () => {
    const res = await getMarketMovers({ direction: 'actives', limit: 10 });
    assert.equal(res.session, 'last');
    // $100M actives gate: AAA $1.1B passes, BBB $95M fails, PENY sub-$5 fails.
    assert.deepEqual(res.movers.map(m => m.symbol), ['AAA']);
  });

  it("quality:'all' bypasses the gate — raw live rows still count as live", async () => {
    // With the gate off, the zeroed-but-present snapshot rows ARE the
    // universe (debug view), so no fallback fires.
    const res = await getMarketMovers({ direction: 'gainers', limit: 10, quality: 'all' });
    assert.equal(res.session, 'live');
    assert.equal(res.sessionLabel, undefined);
    assert.deepEqual(res.movers.map(m => m.symbol).sort(), ['AAA', 'BBB']);
  });
});
