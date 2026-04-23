/**
 * debt.sovereignFallback.test.js — #242 / P1.4 integration test.
 *
 * Pins the /bond-detail/:symbol cold-start fallback chain for every
 * non-US sovereign 10Y. Cold start = /yield-curves has never been hit,
 * so the in-memory yield-curves-data cache is empty and the handler
 * must fall through to its direct source:
 *
 *   DE10Y → FRED OECD series IRLTLT01DEM156N
 *   GB10Y → FRED OECD series IRLTLT01GBM156N
 *   JP10Y → FRED OECD series IRLTLT01JPM156N
 *   BR10Y → Tesouro Direto treasurybondsfile.json (closest-to-10Y prefixado)
 *
 * The external world is fully stubbed via require.cache so the test is
 * deterministic and runs offline.
 *
 *   node server/routes/market/__tests__/debt.sovereignFallback.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

// ── Stub ./lib/providers so we never hit live APIs ─────────────────
const providersPath = require.resolve('../lib/providers');

const calls = [];

function stubFetch(url, _opts) {
  calls.push(url);

  // FRED sovereign 10Y CSV
  if (url.includes('fredgraph.csv?id=IRLTLT01DEM156N')) {
    return Promise.resolve({
      ok: true,
      text: async () => 'DATE,IRLTLT01DEM156N\n2026-01-01,.\n2026-02-01,2.48\n2026-03-01,2.55\n',
    });
  }
  if (url.includes('fredgraph.csv?id=IRLTLT01GBM156N')) {
    return Promise.resolve({
      ok: true,
      text: async () => 'DATE,IRLTLT01GBM156N\n2026-02-01,4.12\n2026-03-01,4.21\n',
    });
  }
  if (url.includes('fredgraph.csv?id=IRLTLT01JPM156N')) {
    return Promise.resolve({
      ok: true,
      text: async () => 'DATE,IRLTLT01JPM156N\n2026-02-01,0.98\n2026-03-01,1.06\n',
    });
  }

  // Tesouro Direto — return one prefixado maturing ~10Y from now.
  if (url.includes('treasurybondsfile.json')) {
    const mat = new Date();
    mat.setFullYear(mat.getFullYear() + 10);
    return Promise.resolve({
      ok: true,
      json: async () => ({
        response: {
          TrsrBdTradgList: [
            {
              TrsrBd: {
                nm: 'Tesouro Prefixado 2036',
                mtrtyDt: mat.toISOString(),
                anulInvstmtRate: 13.85,
                untrInvstmtVal: 512.33,
                untrRedVal: 1000.0,
                minInvstmtAmt: 30.0,
              },
            },
          ],
        },
      }),
    });
  }

  // ^TNX spread calc — return an empty quote array so spread falls through
  return Promise.resolve({ ok: false, status: 404, text: async () => '' });
}

require.cache[providersPath] = {
  id: providersPath,
  filename: providersPath,
  loaded: true,
  exports: {
    fetch: stubFetch,
    // Yahoo quote returns no data for DE/GB/JP/BR (their meta.yahoo === null
    // anyway); ensure spread-to-US10Y fallback also returns null cleanly.
    yahooQuote: async () => [],
    sendError: (res, e) => res.status(500).json({ error: String(e?.message || e) }),
    YF_UA: 'test-ua',
  },
};

// Disable integrity validator side-effects — we only care about the
// response shape, not async post-validation.
const integrityPath = require.resolve('../../../services/dataIntegrityValidator');
require.cache[integrityPath] = {
  id: integrityPath,
  filename: integrityPath,
  loaded: true,
  exports: {
    validateYieldCurves: () => {},
    validateRates: () => {},
    getIntegrityStatus: () => null,
    getAllIntegrityStatus: () => ({}),
  },
};

// Bust the route module from require.cache so the stubs take effect.
const debtPath = require.resolve('../debt');
delete require.cache[debtPath];
const debtRouter = require('../debt');

(async () => {
  const app = express();
  app.use(debtRouter);
  const server = app.listen(0);
  const { port } = server.address();

  async function getJson(pathStr) {
    return new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: pathStr }, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
            catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
          });
        })
        .on('error', reject);
    });
  }

  let pass = 0, fail = 0;
  function check(name, condition, detail) {
    if (condition) { console.log(`  ok  — ${name}`); pass++; }
    else           { console.error(`  FAIL— ${name}${detail ? ': ' + detail : ''}`); fail++; }
  }

  try {
    for (const sym of ['DE10Y', 'GB10Y', 'JP10Y', 'BR10Y']) {
      const { status, body } = await getJson(`/bond-detail/${sym}`);
      check(`${sym} HTTP 200`, status === 200, `got ${status}`);
      check(`${sym} yield non-null`, body.yield != null, `yield=${body.yield}`);
      check(`${sym} yield in plausible 0.1–25 range`,
        typeof body.yield === 'number' && body.yield > 0.1 && body.yield < 25,
        `yield=${body.yield}`);
      check(`${sym} modifiedDuration computed`,
        body.modifiedDuration != null, `got ${body.modifiedDuration}`);
      check(`${sym} dv01 computed`,
        body.dv01 != null, `got ${body.dv01}`);
    }

    // BR should additionally expose the richer brBond block from TD.
    const { body: br } = await getJson('/bond-detail/BR10Y');
    check('BR10Y brBond.yield from Tesouro Direto',
      br.brBond?.yield != null && Math.abs(br.brBond.yield - 13.85) < 0.01,
      `got ${br.brBond?.yield}`);

    // Verify at least one FRED CSV URL was called for the non-BR ones.
    const fredHits = calls.filter(u => u.includes('fredgraph.csv?id=IRLTLT01'));
    check('FRED OECD CSV hit for DE/GB/JP',
      fredHits.length >= 3, `saw ${fredHits.length} fred calls`);
  } finally {
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('debt.sovereignFallback: all assertions passed.');
  // setInterval in cache.js may be unref'd; force exit to be safe.
  setTimeout(() => process.exit(0), 50).unref();
})().catch(err => { console.error(err); process.exit(1); });
