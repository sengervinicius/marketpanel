/**
 * data.earningsCalendar.liveShape.test.js — calendar root-cause fix.
 *
 * The two prior calendar fixes (fallback-on-failure, empty-cascade) were
 * proven against a STUBBED services/earnings + STUBBED yahooQuote, so both
 * shipped green while production still answered
 * {source:'finnhub', empty:'no-data', data:[]} with NFLX reporting tonight.
 *
 * This suite closes that gap: it exercises the REAL route handler, the REAL
 * services/earnings.js and the REAL lib/providers.js Yahoo leg, stubbing
 * only `node-fetch` with byte-faithful provider payloads:
 *
 *   1. Finnhub /calendar/earnings answers {earningsCalendar:[...]} — NOT
 *      {data:[...]}. The service must read the right envelope key.
 *   2. Yahoo v7 /finance/quote honors the &fields= allow-list: a field the
 *      caller did not ask for is NOT in the response. The provider must
 *      request earningsTimestamp or the fallback can never see a date.
 *   3. ?debug=1 returns the additive per-provider instrumentation object.
 *
 *   cd server && node --test routes/market/__tests__/data.earningsCalendar.liveShape.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// ── node-fetch stub (network boundary — everything above it is real) ─
const fetchPath = require.resolve('node-fetch');

const net = {
  // Finnhub /calendar/earnings behavior
  finnhubStatus: 200,
  finnhubBody: { earningsCalendar: [] },
  finnhubUrls: [],
  // Yahoo v7 quote universe: symbol → { earningsTimestamp, shortName }
  yahooSymbols: {},
  yahooQuoteUrls: [],
  // Yahoo quoteSummary: symbol → currentQtr EPS consensus (raw number)
  yahooEpsAvg: {},
};

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      raw: () => ({ 'set-cookie': headers.setCookie ? [headers.setCookie] : [] }),
      get: (name) => (String(name).toLowerCase() === 'set-cookie' ? (headers.setCookie || null) : null),
    },
  };
}

async function fakeFetch(url) {
  const u = String(url);

  // Finnhub earnings calendar — REAL envelope is {earningsCalendar:[...]}
  if (u.includes('finnhub.io/api/v1/calendar/earnings')) {
    net.finnhubUrls.push(u);
    return jsonResponse(net.finnhubStatus, net.finnhubBody);
  }

  // Yahoo crumb bootstrap
  if (u === 'https://finance.yahoo.com/' || u === 'https://fc.yahoo.com/') {
    return jsonResponse(200, '<html></html>', { setCookie: 'A3=test-cookie; Path=/; Domain=.yahoo.com' });
  }
  if (u.includes('/v1/test/getcrumb')) {
    return jsonResponse(200, 'test-crumb');
  }

  // Yahoo v7 batched quote — faithfully honors the &fields= allow-list,
  // exactly like the live endpoint: unrequested fields are omitted.
  if (u.includes('/v7/finance/quote')) {
    net.yahooQuoteUrls.push(u);
    const parsed = new URL(u);
    const symbols = String(parsed.searchParams.get('symbols') || '').split(',').filter(Boolean);
    const fields = new Set(String(parsed.searchParams.get('fields') || '').split(',').filter(Boolean));
    const result = [];
    for (const sym of symbols) {
      const spec = net.yahooSymbols[sym];
      if (!spec) continue;
      const q = { symbol: sym, quoteType: 'EQUITY' };
      if (fields.size === 0 || fields.has('shortName')) q.shortName = spec.shortName || sym;
      if ((fields.size === 0 || fields.has('earningsTimestamp')) && spec.earningsTimestamp != null) {
        q.earningsTimestamp = spec.earningsTimestamp;
      }
      if ((fields.size === 0 || fields.has('earningsTimestampStart')) && spec.earningsTimestamp != null) {
        q.earningsTimestampStart = spec.earningsTimestamp;
      }
      result.push(q);
    }
    return jsonResponse(200, { quoteResponse: { result, error: null } });
  }

  // Yahoo v10 quoteSummary — earningsTrend module, raw {raw,fmt} wrappers.
  if (u.includes('/v10/finance/quoteSummary/')) {
    const sym = decodeURIComponent(u.split('/v10/finance/quoteSummary/')[1].split('?')[0]);
    const avg = net.yahooEpsAvg[sym];
    return jsonResponse(200, {
      quoteSummary: {
        result: [{
          earningsTrend: {
            trend: avg != null
              ? [{ period: '0q', endDate: '2026-09-30', growth: { raw: 0.12 }, earningsEstimate: { avg: { raw: avg }, low: { raw: avg - 0.2 }, high: { raw: avg + 0.2 }, numberOfAnalysts: { raw: 30 } } }]
              : [],
          },
        }],
        error: null,
      },
    });
  }

  return jsonResponse(404, { error: `unexpected fetch in test: ${u}` });
}
// node-fetch v2 compat surface
fakeFetch.default = fakeFetch;
fakeFetch.Headers = class {};
fakeFetch.Request = class {};
fakeFetch.Response = class {};

require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true, exports: fakeFetch,
};

// Real modules on top of the stubbed network.
const earningsSvcPath = require.resolve('../../../services/earnings');
const providersPath   = require.resolve('../lib/providers');
const routePath       = require.resolve('../data');
delete require.cache[earningsSvcPath];
delete require.cache[providersPath];
delete require.cache[routePath];

process.env.FINNHUB_API_KEY = 'test-finnhub-key';
delete process.env.EULERPOOL_API_KEY;

const earningsSvc = require('../../../services/earnings');
const dataRouter  = require('../data');
// Yahoo quote LRU (server/cache.js singleton) — cleared per test so batch
// responses from one scenario never satisfy the next scenario's fetches.
const yahooLru = require('../../../cache');

function resetCaches() {
  earningsSvc.clearCache();
  yahooLru.cache.clear();
}

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

describe('earnings-calendar against live provider shapes', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(dataRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    delete process.env.FINNHUB_API_KEY;
    server.closeAllConnections?.();
    server.close();
  });

  it('finnhub: real {earningsCalendar:[...]} envelope → normalized rows (NFLX reports tonight)', async () => {
    resetCaches();
    net.finnhubStatus = 200;
    net.finnhubUrls = [];
    // Byte-faithful Finnhub /calendar/earnings payload.
    net.finnhubBody = {
      earningsCalendar: [
        { date: '2026-07-20', epsActual: null, epsEstimate: 4.93, hour: 'amc', quarter: 2, revenueActual: null, revenueEstimate: 11040000000, symbol: 'NFLX', year: 2026 },
        { date: '2026-07-22', epsActual: null, epsEstimate: 3.35, hour: 'amc', quarter: 4, revenueActual: null, revenueEstimate: 73500000000, symbol: 'MSFT', year: 2026 },
      ],
    };
    // Yahoo knows about NFLX too — pre-fix, the route MUST NOT need it here.
    net.yahooSymbols = { NFLX: { shortName: 'Netflix, Inc.', earningsTimestamp: Math.floor(Date.UTC(2026, 6, 20, 21, 0, 0) / 1000) } };

    const r = await getJson(port, '/market/earnings-calendar?from=2026-07-20&to=2026-07-27&symbols=NFLX,MSFT,GOOGL');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'finnhub', `expected finnhub rows, got ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.body.empty, undefined);
    assert.equal(r.body.data.length, 2);
    const nflx = r.body.data.find((d) => d.ticker === 'NFLX');
    assert.ok(nflx, 'NFLX row must survive normalization');
    assert.equal(nflx.date, '2026-07-20');
    assert.equal(nflx.timing, 'AMC');
    assert.equal(nflx.epsEstimate, 4.93);
    assert.equal(nflx.revenueEstimate, 11040000000);
    // Sanity: the service passed the requested window straight through.
    assert.match(net.finnhubUrls[0], /from=2026-07-20/);
    assert.match(net.finnhubUrls[0], /to=2026-07-27/);
  });

  it('yahoo leg: v7 fields allow-list includes earningsTimestamp → fallback rows survive', async () => {
    resetCaches();
    net.finnhubStatus = 500; // Finnhub hard-down → cascade must reach Yahoo
    net.finnhubBody = {};
    net.yahooQuoteUrls = [];
    net.yahooSymbols = {
      NFLX: { shortName: 'Netflix, Inc.', earningsTimestamp: Math.floor(Date.UTC(2026, 7, 3, 21, 0, 0) / 1000) },
      ORCL: { shortName: 'Oracle Corp.', earningsTimestamp: Math.floor(Date.UTC(2026, 9, 20, 21, 0, 0) / 1000) },
    };
    net.yahooEpsAvg = { NFLX: 4.93 };

    const r = await getJson(port, '/market/earnings-calendar?from=2026-08-01&to=2026-08-08&symbols=NFLX,MSFT,GOOGL');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'yahoo', `expected yahoo fallback rows, got ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].symbol, 'NFLX');
    assert.equal(r.body.data[0].date, '2026-08-03');
    assert.equal(r.body.data[0].timing, 'AMC');
    assert.equal(r.body.data[0].epsEstimate, 4.93); // quoteSummary enrichment
    // The provider must have asked Yahoo for the earnings timestamp fields.
    assert.match(net.yahooQuoteUrls[0], /earningsTimestamp/);
  });

  it('?debug=1: additive per-provider instrumentation (window, counts, drop reasons)', async () => {
    resetCaches();
    net.finnhubStatus = 200;
    net.finnhubBody = { earningsCalendar: [] }; // quiet week on Finnhub
    net.yahooSymbols = {
      NFLX: { shortName: 'Netflix, Inc.', earningsTimestamp: Math.floor(Date.UTC(2026, 9, 20, 21, 0, 0) / 1000) }, // out of window
      MSFT: { shortName: 'Microsoft' }, // no timestamp at all
    };
    net.yahooEpsAvg = {};

    const r = await getJson(port, '/market/earnings-calendar?from=2026-09-01&to=2026-09-08&symbols=NFLX,MSFT&debug=1');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.debug, 'debug=1 must attach a debug object');
    const dbg = r.body.debug;
    assert.equal(dbg.window.from, '2026-09-01');
    assert.equal(dbg.window.to, '2026-09-08');

    const fh = dbg.providers.finnhub;
    assert.ok(fh, 'finnhub debug block present');
    assert.equal(fh.attempted, true);
    assert.equal(fh.rawCount, 0);
    assert.equal(fh.normalizedCount, 0);

    const yh = dbg.providers.yahoo;
    assert.ok(yh, 'yahoo debug block present');
    assert.equal(yh.attempted, true);
    assert.equal(yh.rawCount, 2);          // Yahoo answered for NFLX + MSFT
    assert.equal(yh.normalizedCount, 0);   // both dropped, with reasons:
    assert.equal(yh.dropReasons.outOfWindow, 1);
    assert.equal(yh.dropReasons.noTimestamp, 1);
    assert.ok(yh.firstRawRow, 'first raw row echoed (keys + date/symbol only)');
    assert.ok(Array.isArray(yh.firstRawRow.keys));

    const ep = dbg.providers.eulerpool;
    assert.ok(ep, 'eulerpool debug block present');
    assert.equal(ep.attempted, false);

    // debug never mutates the business envelope itself.
    assert.equal(r.body.source, 'finnhub');
    assert.equal(r.body.empty, 'no-data');
  });

  it('debug=0 (default): no debug key leaks into the envelope', async () => {
    resetCaches();
    net.finnhubStatus = 200;
    net.finnhubBody = { earningsCalendar: [] };
    net.yahooSymbols = {};
    const r = await getJson(port, '/market/earnings-calendar?from=2026-10-01&to=2026-10-08');
    assert.equal(r.status, 200);
    assert.equal(r.body.debug, undefined);
  });
});
