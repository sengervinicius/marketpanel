/**
 * regionalProbeRunner.test.js — W6.1 regression coverage.
 *
 * Verifies cell-level probes pick the correct regional ticker and
 * attribute results to the right (adapter, market, asset_class, capability)
 * row in coverage_matrix.
 *
 * Run:
 *   node --test server/services/__tests__/regionalProbeRunner.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../regionalProbeRunner');
const { runRegionalProbes, REGIONAL_PROBES, _internal } = mod;
const { probesForCell, argsForCapability } = _internal;

const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── argsForCapability ────────────────────────────────────────────────────

test('argsForCapability: quote → [symbol]', () => {
  assert.deepEqual(argsForCapability('quote', '7203.T'), ['7203.T']);
});

test('argsForCapability: candles → [symbol, opts]', () => {
  const args = argsForCapability('candles', '0700.HK');
  assert.equal(args[0], '0700.HK');
  assert.equal(args[1].interval, '1d');
  assert.equal(args[1].limit, 5);
});

test('argsForCapability: fundamentals → [symbol, period, statement]', () => {
  assert.deepEqual(argsForCapability('fundamentals', 'D05.SI'), ['D05.SI', 'annual', 'income_statement']);
});

test('argsForCapability: unknown capability → null', () => {
  assert.equal(argsForCapability('chain', 'X'), null);
  assert.equal(argsForCapability('curve', 'X'), null);
  assert.equal(argsForCapability('health', 'X'), null);
});

// ── probesForCell ────────────────────────────────────────────────────────

test('probesForCell: KRX/equity/quote → Samsung', () => {
  const probes = probesForCell({ market: 'KRX', asset_class: 'equity', capability: 'quote' });
  assert.ok(probes);
  assert.equal(probes.probes.quote.args[0], '005930.KS');
  assert.equal(probes.probes.quote.probedMarket, 'KRX');
  assert.equal(probes.probes.quote.probedAssetClass, 'equity');
  assert.equal(probes.probes.quote.probeSymbol, '005930.KS');
});

test('probesForCell: SGX/equity/quote → DBS', () => {
  const probes = probesForCell({ market: 'SGX', asset_class: 'equity', capability: 'quote' });
  assert.ok(probes);
  assert.equal(probes.probes.quote.args[0], 'D05.SI');
});

test('probesForCell: unknown market → null (fall-through to declared-only state)', () => {
  assert.equal(probesForCell({ market: 'ASX', asset_class: 'equity', capability: 'quote' }), null);
});

test('probesForCell: capability without symbol shape → null', () => {
  assert.equal(probesForCell({ market: 'US', asset_class: 'equity', capability: 'health' }), null);
});

test('REGIONAL_PROBES covers all Asian + Brazilian + EU markets declared by adapters', () => {
  for (const m of ['KRX', 'TSE', 'HKEX', 'SGX', 'B3', 'EU', 'US']) {
    assert.ok(REGIONAL_PROBES[m], `missing REGIONAL_PROBES[${m}]`);
    assert.ok(REGIONAL_PROBES[m].symbol, `REGIONAL_PROBES[${m}] missing symbol`);
  }
});

// ── runRegionalProbes ────────────────────────────────────────────────────

function makeCoverageRow(patch = {}) {
  return {
    id: patch.id || 1,
    adapter: patch.adapter || 'finnhub',
    market: patch.market || 'KRX',
    asset_class: patch.assetClass || 'equity',
    capability: patch.capability || 'quote',
    declared_confidence: patch.declared || 'medium',
    confidence: patch.confidence || 'medium',
    consecutive_greens: patch.greens || 0,
    consecutive_reds: patch.reds || 0,
    last_verified_at: patch.lastVerifiedAt || null,
  };
}

function makeFakePg({ cells = [], probeRows = [] } = {}) {
  const cellsById = new Map(cells.map(c => [c.id, { ...c }]));
  const calls = [];

  async function query(sql, params = []) {
    calls.push({ sql, params });
    // Order matters: the single-cell lookup (findTargetCells) is more
    // specific and must run BEFORE the broad queryCoverage match —
    // otherwise every probe is attributed to every cell in the fake.
    if (/SELECT[\s\S]+FROM coverage_matrix\s+WHERE adapter = \$1/i.test(sql)) {
      const [adapter, market, assetClass, cap] = params;
      const match = [...cellsById.values()].find(c =>
        c.adapter === adapter && c.market === market && c.asset_class === assetClass && c.capability === cap);
      return {
        rows: match ? [{
          id: match.id, declared_confidence: match.declared_confidence,
          confidence: match.confidence,
          consecutive_greens: match.consecutive_greens,
          consecutive_reds: match.consecutive_reds,
        }] : [],
      };
    }
    if (/SELECT[\s\S]+FROM coverage_matrix[\s\S]*ORDER BY/i.test(sql)) {
      return { rows: [...cellsById.values()].map(c => ({ ...c, stale: !c.last_verified_at })) };
    }
    if (/INTO coverage_probes/i.test(sql)) {
      probeRows.push({
        matrix_id: params[0], result: params[1], latency_ms: params[2],
        error_code: params[3], probe_symbol: params[5],
      });
      return { rowCount: 1, rows: [] };
    }
    if (/UPDATE coverage_matrix/i.test(sql)) {
      const [result, latency, greens, reds, confidence, id] = params;
      const row = cellsById.get(id);
      if (row) {
        row.last_result = result;
        row.latency_p95_observed_ms = latency;
        row.consecutive_greens = greens;
        row.consecutive_reds = reds;
        row.confidence = confidence;
        row.last_verified_at = new Date().toISOString();
      }
      return { rowCount: row ? 1 : 0, rows: [] };
    }
    return { rows: [] };
  }
  return { query, _calls: calls, _cells: cellsById, _probeRows: probeRows };
}

test('runRegionalProbes: passes Samsung on KRX/finnhub → increments greens on that cell only', async () => {
  const pg = makeFakePg({
    cells: [
      makeCoverageRow({ id: 1, adapter: 'finnhub', market: 'KRX' }),
      makeCoverageRow({ id: 2, adapter: 'finnhub', market: 'US' }), // should also get a probe (US is in REGIONAL_PROBES)
    ],
  });
  let receivedSymbol;
  const fakeAdapter = {
    describe: () => ({ name: 'finnhub', version: '1.0.0', capabilities: ['quote'] }),
    quote: async (symbol) => { receivedSymbol = symbol; return { ok: true, data: { last: 71400 } }; },
  };
  const registry = { get: (name) => (name === 'finnhub' ? fakeAdapter : null) };

  const summary = await runRegionalProbes({ pg, registry, logger: quietLogger });
  assert.equal(summary.cells, 2);
  assert.equal(summary.greens, 2);
  // The last probe symbol observed — verified at least that regional tickers flow through
  assert.ok(['005930.KS', 'AAPL'].includes(receivedSymbol));

  assert.equal(pg._cells.get(1).consecutive_greens, 1);
  assert.equal(pg._cells.get(1).confidence, 'medium');
});

test('runRegionalProbes: adapter not in registry is counted as skipped', async () => {
  const pg = makeFakePg({
    cells: [makeCoverageRow({ id: 1, adapter: 'ghost_adapter', market: 'KRX' })],
  });
  const registry = { get: () => null };
  const summary = await runRegionalProbes({ pg, registry, logger: quietLogger });
  assert.equal(summary.cells, 0);
  assert.equal(summary.skipped, 1);
});

test('runRegionalProbes: upstream failure on KRX bumps reds, preserves US greens', async () => {
  const pg = makeFakePg({
    cells: [
      makeCoverageRow({ id: 1, adapter: 'finnhub', market: 'KRX', greens: 10 }),
      makeCoverageRow({ id: 2, adapter: 'finnhub', market: 'US',  greens: 10 }),
    ],
  });
  const fakeAdapter = {
    describe: () => ({ name: 'finnhub', version: '1.0.0', capabilities: ['quote'] }),
    quote: async (symbol) => {
      if (symbol === '005930.KS') return { ok: false, error: { code: 'UPSTREAM_5XX', message: '503' } };
      return { ok: true, data: { last: 177.5 } };
    },
  };
  const registry = { get: () => fakeAdapter };
  const summary = await runRegionalProbes({ pg, registry, logger: quietLogger });
  assert.equal(summary.greens, 1);
  assert.equal(summary.reds, 1);

  // KRX cell: greens reset to 0, reds=1
  assert.equal(pg._cells.get(1).consecutive_greens, 0);
  assert.equal(pg._cells.get(1).consecutive_reds, 1);
  // US cell: greens bumped to 11
  assert.equal(pg._cells.get(2).consecutive_greens, 11);
  assert.equal(pg._cells.get(2).consecutive_reds, 0);
});

test('runRegionalProbes: ASX cell (no canonical ticker) is skipped, no DB writes', async () => {
  const pg = makeFakePg({
    cells: [makeCoverageRow({ id: 1, adapter: 'finnhub', market: 'ASX' })],
  });
  const registry = { get: () => ({
    describe: () => ({ name: 'finnhub', capabilities: ['quote'] }),
    quote: async () => ({ ok: true, data: {} }),
  }) };
  const summary = await runRegionalProbes({ pg, registry, logger: quietLogger });
  assert.equal(summary.cells, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(pg._probeRows.length, 0);
});
