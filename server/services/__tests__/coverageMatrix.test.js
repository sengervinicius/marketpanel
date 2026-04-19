/**
 * coverageMatrix.test.js — W5.6 regression coverage.
 *
 * Proves the harness→DB pipeline does the right thing:
 *   - passed probe increments consecutive_greens, resets reds
 *   - failed probe increments consecutive_reds, resets greens
 *   - skipped probe records audit row but DOES NOT mutate counters
 *     (dev-box missing-key noise must not demote production)
 *   - unsupported probe writes nothing (operator must author a probe first)
 *   - confidence is capped by declared_confidence — we never auto-promote
 *     past what the adapter declared
 *   - 14 consecutive greens lifts confidence to declared level
 *   - 3 consecutive reds drops confidence to 'low' regardless of declared
 *   - syncDeclarations upserts every CoverageDeclaration cell
 *
 * Run:
 *   node --test server/services/__tests__/coverageMatrix.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../coverageMatrix');
const {
  syncDeclarations, recordProbeRun, queryCoverage, queryRecentProbes, _internal,
} = mod;
const {
  toProbeResult, computeConfidence,
  GREEN_PROMOTION_THRESHOLD, RED_DEMOTION_THRESHOLD,
} = _internal;

const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── Fake pg driver ───────────────────────────────────────────────────────
// Router uses [\s\S]+ (not .+) to match multi-line SQL — same regex-trap
// that bit iapReconciler.test.js and vaultReembed.test.js.

function makeFakePg({ cells = [], probeRows = [] } = {}) {
  const calls = [];
  const cellsById = new Map(cells.map(c => [c.id, { ...c }]));

  async function query(sql, params = []) {
    calls.push({ sql, params });

    // INSERT into coverage_matrix (syncDeclarations)
    if (/INSERT[\s\S]+INTO coverage_matrix/i.test(sql)) {
      // Simulate RETURNING (xmax=0) AS inserted — alternate per call for visibility
      const adapter = params[0], market = params[2], assetClass = params[3], cap = params[4];
      const existing = [...cellsById.values()].find(c =>
        c.adapter === adapter && c.market === market && c.asset_class === assetClass && c.capability === cap);
      if (existing) {
        existing.adapter_version = params[1];
        existing.declared_confidence = params[5];
        return { rows: [{ inserted: false }] };
      }
      const id = cellsById.size + 1;
      const row = {
        id, adapter, adapter_version: params[1],
        market, asset_class: assetClass, capability: cap,
        declared_confidence: params[5], confidence: params[5],
        consecutive_greens: 0, consecutive_reds: 0,
      };
      cellsById.set(id, row);
      return { rows: [{ inserted: true }] };
    }

    // SELECT cells in findTargetCells
    if (/SELECT[\s\S]+FROM coverage_matrix\s+WHERE adapter = \$1/i.test(sql)) {
      const [adapter, market, assetClass, cap] = params;
      const rows = [...cellsById.values()]
        .filter(c => c.adapter === adapter && c.market === market && c.asset_class === assetClass && c.capability === cap)
        .map(c => ({
          id: c.id,
          declared_confidence: c.declared_confidence,
          confidence: c.confidence,
          consecutive_greens: c.consecutive_greens || 0,
          consecutive_reds: c.consecutive_reds || 0,
        }));
      return { rows };
    }

    // INSERT into coverage_probes (audit row)
    if (/INSERT[\s\S]+INTO coverage_probes/i.test(sql)) {
      probeRows.push({
        matrix_id: params[0], result: params[1], latency_ms: params[2],
        error_code: params[3], error_message: params[4], probe_symbol: params[5],
      });
      return { rows: [], rowCount: 1 };
    }

    // UPDATE coverage_matrix after probe
    if (/UPDATE coverage_matrix/i.test(sql)) {
      const [result, latency, greens, reds, confidence, id] = params;
      const row = cellsById.get(id);
      if (row) {
        row.last_result = result;
        if (latency != null) row.latency_p95_observed_ms = latency;
        row.consecutive_greens = greens;
        row.consecutive_reds = reds;
        row.confidence = confidence;
        row.last_verified_at = new Date().toISOString();
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    // queryCoverage list SELECT
    if (/SELECT[\s\S]+FROM coverage_matrix\s+(WHERE|ORDER)/i.test(sql)) {
      return { rows: [...cellsById.values()].map(c => ({ ...c, stale: !c.last_verified_at })) };
    }

    // queryRecentProbes
    if (/FROM coverage_probes/i.test(sql)) {
      return { rows: [...probeRows] };
    }

    return { rows: [] };
  }

  return { query, _calls: calls, _cells: cellsById, _probeRows: probeRows };
}

// ── toProbeResult ────────────────────────────────────────────────────────

test('toProbeResult: passed → ok', () => {
  assert.equal(toProbeResult('passed', undefined), 'ok');
});

test('toProbeResult: SCHEMA_MISMATCH → schema_mismatch', () => {
  assert.equal(toProbeResult('failed', 'SCHEMA_MISMATCH'), 'schema_mismatch');
});

test('toProbeResult: TIMEOUT / THROW → timeout', () => {
  assert.equal(toProbeResult('failed', 'TIMEOUT'), 'timeout');
  assert.equal(toProbeResult('failed', 'THROW'), 'timeout');
});

test('toProbeResult: STALE_DATA → sla_miss', () => {
  assert.equal(toProbeResult('failed', 'STALE_DATA'), 'sla_miss');
});

test('toProbeResult: UPSTREAM_5XX / unknown → error', () => {
  assert.equal(toProbeResult('failed', 'UPSTREAM_5XX'), 'error');
  assert.equal(toProbeResult('failed', 'WEIRD'), 'error');
});

// ── computeConfidence ────────────────────────────────────────────────────

test('computeConfidence: ≥3 reds demotes to low even if declared high', () => {
  assert.equal(computeConfidence({ declared: 'high', consecutiveGreens: 0, consecutiveReds: RED_DEMOTION_THRESHOLD }), 'low');
  assert.equal(computeConfidence({ declared: 'high', consecutiveGreens: 0, consecutiveReds: RED_DEMOTION_THRESHOLD + 5 }), 'low');
});

test('computeConfidence: fresh row (no current) caps at medium until earned', () => {
  // Row just synced — current is absent; even though declared=high, we refuse
  // to claim high until a probe streak earns it.
  assert.equal(computeConfidence({ declared: 'high', current: undefined, consecutiveGreens: 5, consecutiveReds: 0 }), 'medium');
  assert.equal(computeConfidence({ declared: 'high', current: undefined, consecutiveGreens: 13, consecutiveReds: 0 }), 'medium');
});

test('computeConfidence: recovering from low stays low until 14 greens', () => {
  assert.equal(computeConfidence({ declared: 'high', current: 'low', consecutiveGreens: 13, consecutiveReds: 0 }), 'low');
});

test('computeConfidence: 14 greens lifts to declared level', () => {
  assert.equal(computeConfidence({ declared: 'high', current: 'medium', consecutiveGreens: GREEN_PROMOTION_THRESHOLD, consecutiveReds: 0 }), 'high');
  assert.equal(computeConfidence({ declared: 'high', current: 'low', consecutiveGreens: GREEN_PROMOTION_THRESHOLD, consecutiveReds: 0 }), 'high');
});

test('computeConfidence: steady-state preserves current between thresholds (no oscillation)', () => {
  // Adapter has been probed 100+ times and is at 'high'. One isolated red
  // bumps the counter but must NOT flip confidence to medium.
  assert.equal(computeConfidence({ declared: 'high', current: 'high', consecutiveGreens: 0, consecutiveReds: 1 }), 'high');
  assert.equal(computeConfidence({ declared: 'high', current: 'high', consecutiveGreens: 5, consecutiveReds: 0 }), 'high');
});

test('computeConfidence: never promotes above declared (even if current exceeds it)', () => {
  // Operator manually lowered declared from high → medium. Current was high,
  // but the cap forces it back down.
  assert.equal(computeConfidence({ declared: 'medium', current: 'high', consecutiveGreens: 1000, consecutiveReds: 0 }), 'medium');
  assert.equal(computeConfidence({ declared: 'medium', current: 'medium', consecutiveGreens: 1000, consecutiveReds: 0 }), 'medium');
});

test('computeConfidence: declared low stays low', () => {
  assert.equal(computeConfidence({ declared: 'low', current: 'low', consecutiveGreens: 1000, consecutiveReds: 0 }), 'low');
});

// ── syncDeclarations ─────────────────────────────────────────────────────

test('syncDeclarations: upserts every coverageCell across every adapter', async () => {
  const pg = makeFakePg();
  const registry = {
    declarations: () => [
      {
        name: 'polygon', version: '1.0.0',
        capabilities: ['quote', 'news'],
        coverageCells: [
          { market: 'US', assetClass: 'equity', capability: 'quote', confidence: 'high' },
          { market: 'US', assetClass: 'equity', capability: 'news',  confidence: 'medium' },
        ],
        latencyP95TargetMs: 900, freshnessSlaSec: 60, requiredEnvVars: ['POLYGON_API_KEY'],
      },
      {
        name: 'finnhub', version: '1.0.0',
        capabilities: ['quote'],
        coverageCells: [{ market: 'KRX', assetClass: 'equity', capability: 'quote', confidence: 'medium' }],
        latencyP95TargetMs: 1500, freshnessSlaSec: 900, requiredEnvVars: ['FINNHUB_API_KEY'],
      },
    ],
  };
  const r = await syncDeclarations({ registry, pg, logger: quietLogger });
  assert.equal(r.inserted + r.updated, 3);
  assert.equal(r.skipped, 0);
  // All three INSERT statements were issued.
  const inserts = pg._calls.filter(c => /INTO coverage_matrix/i.test(c.sql));
  assert.equal(inserts.length, 3);
});

test('syncDeclarations: gracefully skips declarations missing coverageCells', async () => {
  const pg = makeFakePg();
  const registry = {
    declarations: () => [
      { name: 'broken', version: '1.0.0', capabilities: ['quote'] }, // no coverageCells
    ],
  };
  const r = await syncDeclarations({ registry, pg, logger: quietLogger });
  assert.equal(r.skipped, 1);
  assert.equal(r.inserted + r.updated, 0);
});

test('syncDeclarations: DB error on one cell does not abort the whole sync', async () => {
  const warns = [];
  const pg = {
    query: async (sql, params) => {
      if (/INTO coverage_matrix/i.test(sql) && params[4] === 'news') {
        throw new Error('constraint violation');
      }
      if (/INTO coverage_matrix/i.test(sql)) {
        return { rows: [{ inserted: true }] };
      }
      return { rows: [] };
    },
  };
  const registry = {
    declarations: () => [{
      name: 'polygon', version: '1.0.0', capabilities: ['quote', 'news'],
      coverageCells: [
        { market: 'US', assetClass: 'equity', capability: 'quote', confidence: 'high' },
        { market: 'US', assetClass: 'equity', capability: 'news',  confidence: 'medium' },
      ],
      latencyP95TargetMs: 900, freshnessSlaSec: 60,
    }],
  };
  const logger = { ...quietLogger, warn: (mod, msg, ctx) => warns.push({ msg, ctx }) };
  const r = await syncDeclarations({ registry, pg, logger });
  assert.equal(r.inserted, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0].msg, /upsert failed/);
});

// ── recordProbeRun ───────────────────────────────────────────────────────

function reportWith({ adapter = 'polygon', probes }) {
  return {
    startedAt: '2026-04-20T00:00:00Z',
    finishedAt: '2026-04-20T00:00:01Z',
    aggregate: { adapters: 1, healthy: 1, degraded: 0 },
    perAdapter: {
      [adapter]: {
        name: adapter, version: '1.0.0',
        probes,
        summary: { passed: 0, failed: 0, skipped: 0, unsupported: 0 },
        overall: 'healthy',
      },
    },
  };
}

test('recordProbeRun: passed probe increments greens, resets reds, writes probe + update', async () => {
  const pg = makeFakePg({
    cells: [{
      id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
      declared_confidence: 'high', confidence: 'medium',
      consecutive_greens: 5, consecutive_reds: 2,
    }],
  });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'passed', latencyMs: 210 }],
  });
  const r = await recordProbeRun({ report, pg, logger: quietLogger });
  assert.equal(r.probesRecorded, 1);
  assert.equal(r.matrixUpdated, 1);
  const row = pg._cells.get(1);
  assert.equal(row.consecutive_greens, 6);
  assert.equal(row.consecutive_reds, 0);
  assert.equal(row.last_result, 'ok');
  assert.equal(row.latency_p95_observed_ms, 210);
  // 6 greens < 14 threshold → confidence stays at medium (declared=high)
  assert.equal(row.confidence, 'medium');
});

test('recordProbeRun: 14 consecutive greens promotes confidence to declared', async () => {
  const pg = makeFakePg({
    cells: [{
      id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
      declared_confidence: 'high', confidence: 'medium',
      consecutive_greens: GREEN_PROMOTION_THRESHOLD - 1, consecutive_reds: 0,
    }],
  });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'passed', latencyMs: 180 }],
  });
  await recordProbeRun({ report, pg, logger: quietLogger });
  const row = pg._cells.get(1);
  assert.equal(row.consecutive_greens, GREEN_PROMOTION_THRESHOLD);
  assert.equal(row.confidence, 'high');
});

test('recordProbeRun: failed probe increments reds, resets greens', async () => {
  const pg = makeFakePg({
    cells: [{
      id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
      declared_confidence: 'high', confidence: 'high',
      consecutive_greens: 20, consecutive_reds: 0,
    }],
  });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'failed', latencyMs: 9500, errorCode: 'UPSTREAM_5XX', errorMessage: '503' }],
  });
  await recordProbeRun({ report, pg, logger: quietLogger });
  const row = pg._cells.get(1);
  assert.equal(row.consecutive_reds, 1);
  assert.equal(row.consecutive_greens, 0);
  // 1 red < threshold → still high
  assert.equal(row.confidence, 'high');
  assert.equal(row.last_result, 'error');
});

test('recordProbeRun: 3 consecutive reds demotes confidence to low', async () => {
  const pg = makeFakePg({
    cells: [{
      id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
      declared_confidence: 'high', confidence: 'high',
      consecutive_greens: 0, consecutive_reds: RED_DEMOTION_THRESHOLD - 1,
    }],
  });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'failed', latencyMs: 1200, errorCode: 'UPSTREAM_5XX' }],
  });
  await recordProbeRun({ report, pg, logger: quietLogger });
  const row = pg._cells.get(1);
  assert.equal(row.consecutive_reds, RED_DEMOTION_THRESHOLD);
  assert.equal(row.confidence, 'low');
});

test('recordProbeRun: skipped probe writes audit row but DOES NOT touch counters', async () => {
  const pg = makeFakePg({
    cells: [{
      id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
      declared_confidence: 'high', confidence: 'high',
      consecutive_greens: 11, consecutive_reds: 0,
    }],
  });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'skipped', errorCode: 'AUTH', latencyMs: 2 }],
  });
  const r = await recordProbeRun({ report, pg, logger: quietLogger });
  assert.equal(r.probesRecorded, 1);
  assert.equal(r.matrixUpdated, 0); // no counter mutation
  const row = pg._cells.get(1);
  // Counters untouched.
  assert.equal(row.consecutive_greens, 11);
  assert.equal(row.consecutive_reds, 0);
  // Audit row was inserted.
  assert.equal(pg._probeRows.length, 1);
  assert.equal(pg._probeRows[0].error_code, 'AUTH');
});

test('recordProbeRun: unsupported probe writes nothing', async () => {
  const pg = makeFakePg({ cells: [] });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'unsupported', latencyMs: 0 }],
  });
  const r = await recordProbeRun({ report, pg, logger: quietLogger });
  assert.equal(r.probesRecorded, 0);
  assert.equal(r.matrixUpdated, 0);
  assert.equal(pg._probeRows.length, 0);
});

test('recordProbeRun: probe for cell that does not exist in DB is a no-op (no FK violation)', async () => {
  // Registry declares polygon/quote but DB has no matching cell yet (e.g. fresh DB pre-sync).
  const pg = makeFakePg({ cells: [] });
  const report = reportWith({
    probes: [{ capability: 'quote', status: 'passed', latencyMs: 200 }],
  });
  const r = await recordProbeRun({ report, pg, logger: quietLogger });
  assert.equal(r.probesRecorded, 0);
  assert.equal(r.matrixUpdated, 0);
});

test('recordProbeRun: error on one probe does not abort the run', async () => {
  const warns = [];
  const pg = {
    query: async (sql, params) => {
      if (/SELECT[\s\S]+FROM coverage_matrix\s+WHERE adapter = \$1/i.test(sql)) {
        return { rows: [{ id: 99, declared_confidence: 'high', confidence: 'high', consecutive_greens: 0, consecutive_reds: 0 }] };
      }
      if (/INTO coverage_probes/i.test(sql)) { throw new Error('out of disk'); }
      return { rows: [] };
    },
  };
  const report = reportWith({
    probes: [
      { capability: 'quote', status: 'passed', latencyMs: 100 },
      { capability: 'candles', status: 'passed', latencyMs: 200 },
    ],
  });
  const logger = { ...quietLogger, warn: (mod, msg, ctx) => warns.push({ msg, ctx }) };
  const r = await recordProbeRun({ report, pg, logger });
  assert.equal(r.errors, 2);
  assert.equal(r.probesRecorded, 0);
  assert.equal(warns.length, 2);
});

test('recordProbeRun: regional probe override routes to non-US cell', async () => {
  const pg = makeFakePg({
    cells: [
      {
        id: 1, adapter: 'finnhub', market: 'US', asset_class: 'equity', capability: 'quote',
        declared_confidence: 'high', confidence: 'medium',
        consecutive_greens: 0, consecutive_reds: 0,
      },
      {
        id: 2, adapter: 'finnhub', market: 'KRX', asset_class: 'equity', capability: 'quote',
        declared_confidence: 'medium', confidence: 'medium',
        consecutive_greens: 0, consecutive_reds: 0,
      },
    ],
  });
  const report = reportWith({
    adapter: 'finnhub',
    probes: [{ capability: 'quote', status: 'passed', latencyMs: 500 }],
  });
  await recordProbeRun({
    report, pg, logger: quietLogger,
    probes: { quote: { probedMarket: 'KRX', probedAssetClass: 'equity' } },
  });
  // US cell was NOT touched (no probe against it)
  assert.equal(pg._cells.get(1).consecutive_greens, 0);
  // KRX cell was incremented
  assert.equal(pg._cells.get(2).consecutive_greens, 1);
});

// ── queryCoverage ────────────────────────────────────────────────────────

test('queryCoverage: returns all rows with stale derived flag', async () => {
  const pg = makeFakePg({
    cells: [
      { id: 1, adapter: 'polygon', market: 'US', asset_class: 'equity', capability: 'quote',
        declared_confidence: 'high', confidence: 'high', consecutive_greens: 14, consecutive_reds: 0,
        last_verified_at: new Date().toISOString() },
    ],
  });
  const rows = await queryCoverage({ pg });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].adapter, 'polygon');
  assert.equal(rows[0].stale, false);
});

test('queryCoverage: adapter filter narrows SQL params', async () => {
  const pg = makeFakePg({ cells: [] });
  await queryCoverage({ pg, filter: { adapter: 'polygon', market: 'US' } });
  const select = pg._calls.find(c => /FROM coverage_matrix/i.test(c.sql));
  assert.match(select.sql, /adapter = \$1/);
  assert.match(select.sql, /market = \$2/);
  assert.deepEqual(select.params, ['polygon', 'US']);
});

// ── queryRecentProbes ────────────────────────────────────────────────────

test('queryRecentProbes: respects adapter filter and caps limit', async () => {
  const pg = makeFakePg({ cells: [], probeRows: [{ id: 1 }] });
  const rows = await queryRecentProbes({ pg, adapter: 'polygon', limit: 10 });
  assert.ok(Array.isArray(rows));
  const call = pg._calls.find(c => /FROM coverage_probes/i.test(c.sql));
  assert.match(call.sql, /WHERE m\.adapter = \$1/);
  assert.match(call.sql, /LIMIT 10/);
});

test('queryRecentProbes: defaults to limit=50 when bad value passed', async () => {
  const pg = makeFakePg({ cells: [], probeRows: [] });
  await queryRecentProbes({ pg, limit: -1 });
  const call = pg._calls.find(c => /FROM coverage_probes/i.test(c.sql));
  assert.match(call.sql, /LIMIT 50/);
});
