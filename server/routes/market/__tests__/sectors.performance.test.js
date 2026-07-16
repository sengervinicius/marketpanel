/**
 * sectors.performance.test.js — H2 W1 sector performance grid endpoint.
 *
 * Proves GET /market/sector-performance:
 *   - Returns all 11 SPDR sector ETFs with { symbol, name, price,
 *     perf: {1D,1W,1M,YTD} }; 1D comes from the yahooQuote batch,
 *     1W/1M/YTD from v8 chart daily closes.
 *   - Horizon math: 1W = last vs 5 trading days back, 1M = 21 back,
 *     YTD = last vs the final close of the previous calendar year.
 *   - Sectors whose chart fetch fails degrade to null horizons (row
 *     still present); sectors missing from the quote batch get a null
 *     price/1D but keep computed horizons.
 *   - Whole payload is cached 10 min — the second request must not hit
 *     the providers again.
 *
 * Provider layer stubbed via require.cache (same pattern as
 * stocks.snapshotTickers.test.js) — deterministic and offline-safe.
 *
 *   cd server && node --test routes/market/__tests__/sectors.performance.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const providersPath = require.resolve('../lib/providers');
const routePath = require.resolve('../sectors');

// ── Synthetic daily series ───────────────────────────────────────────
// 24 points: 2 in the previous calendar year (final close 55) then 22 in
// the current year, ending at 110. Chosen so:
//   1W  = 110 / close(5 back)  - 1 = 110/100 - 1 = +10%
//   1M  = 110 / close(21 back) - 1 = 110/88  - 1 = +25%
//   YTD = 110 / 55             - 1 = +100%
const DAY = 86400;
function buildSeries() {
  const now = Math.floor(Date.now() / 1000);
  const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000;
  const ts = [];
  // 2 points last year, 22 points this year, all strictly ascending.
  ts.push(yearStart - 2 * DAY, yearStart - 1 * DAY);
  for (let i = 0; i < 22; i++) ts.push(Math.min(yearStart + (i + 1) * DAY, now - (21 - i)));
  const closes = new Array(24).fill(90);
  closes[0] = 50;
  closes[1] = 55;   // final close of previous year → YTD base
  closes[2] = 88;   // 21 back from last (idx 23)
  closes[18] = 100; // 5 back from last
  closes[23] = 110; // last
  return { timestamp: ts, closes };
}
const SERIES = buildSeries();

let quoteCalls = 0;
let chartCalls = 0;

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    yahooQuote: async (symbols) => {
      quoteCalls += 1;
      // Quote batch covers all ETFs EXCEPT XLC (null price/1D path).
      return String(symbols).split(',')
        .filter(s => s !== 'XLC')
        .map(s => ({
          symbol: s,
          regularMarketPrice: 100 + s.length,
          regularMarketChangePercent: s === 'XLE' ? -1.5 : 0.42,
        }));
    },
    // v8 chart fetch — XLF simulates a provider failure (!ok).
    fetch: async (url) => {
      chartCalls += 1;
      const sym = decodeURIComponent(url.match(/chart\/([^?]+)\?/)[1]);
      if (sym === 'XLF') return { ok: false, status: 500, text: async () => '' };
      return {
        ok: true,
        json: async () => ({
          chart: {
            result: [{
              timestamp: SERIES.timestamp,
              indicators: { quote: [{ close: SERIES.closes }] },
            }],
          },
        }),
      };
    },
    YF_UA: 'test-ua',
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};

delete require.cache[routePath];
const sectorsRouter = require('../sectors');

function getJson(port, pathStr) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathStr, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

const ETFS = ['XLK','XLF','XLV','XLE','XLI','XLY','XLP','XLU','XLB','XLRE','XLC'];

describe('GET /market/sector-performance (H2 W1)', () => {
  let server, port, first;

  before(async () => {
    const app = express();
    app.use(sectorsRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
    first = await getJson(port, '/market/sector-performance');
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('returns all 11 SPDR ETFs with the contract shape', () => {
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.deepEqual(first.body.horizons, ['1D', '1W', '1M', 'YTD']);
    assert.equal(first.body.source, 'yahoo');
    assert.deepEqual(first.body.data.map(d => d.symbol), ETFS);
    for (const row of first.body.data) {
      assert.equal(typeof row.name, 'string');
      assert.deepEqual(Object.keys(row.perf), ['1D', '1W', '1M', 'YTD']);
    }
  });

  it('1D comes from the quote batch (incl. negative moves)', () => {
    const xlk = first.body.data.find(d => d.symbol === 'XLK');
    const xle = first.body.data.find(d => d.symbol === 'XLE');
    assert.equal(xlk.perf['1D'], 0.42);
    assert.equal(xlk.price, 103);
    assert.equal(xle.perf['1D'], -1.5);
  });

  it('1W/1M/YTD computed from daily closes (5 / 21 back, prior-year close)', () => {
    const xlk = first.body.data.find(d => d.symbol === 'XLK');
    assert.ok(Math.abs(xlk.perf['1W'] - 10) < 1e-9, `1W was ${xlk.perf['1W']}`);
    assert.ok(Math.abs(xlk.perf['1M'] - 25) < 1e-9, `1M was ${xlk.perf['1M']}`);
    assert.ok(Math.abs(xlk.perf['YTD'] - 100) < 1e-9, `YTD was ${xlk.perf['YTD']}`);
  });

  it('chart failure degrades that sector to null horizons, row kept', () => {
    const xlf = first.body.data.find(d => d.symbol === 'XLF');
    assert.equal(xlf.perf['1W'], null);
    assert.equal(xlf.perf['1M'], null);
    assert.equal(xlf.perf['YTD'], null);
    assert.equal(xlf.perf['1D'], 0.42); // quote still present
  });

  it('sector missing from the quote batch keeps computed horizons, null price/1D', () => {
    const xlc = first.body.data.find(d => d.symbol === 'XLC');
    assert.equal(xlc.price, null);
    assert.equal(xlc.perf['1D'], null);
    assert.ok(Math.abs(xlc.perf['1W'] - 10) < 1e-9);
  });

  it('second request is served from the 10-min cache (no provider calls)', async () => {
    const q = quoteCalls, c = chartCalls;
    const second = await getJson(port, '/market/sector-performance');
    assert.equal(second.status, 200);
    assert.deepEqual(second.body.data, first.body.data);
    assert.equal(quoteCalls, q);
    assert.equal(chartCalls, c);
  });
});
