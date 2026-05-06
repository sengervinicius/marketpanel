/**
 * freshnessLedger.test.js — #289 part 1
 * Usage: node server/services/__tests__/freshnessLedger.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const ledger = require('../freshnessLedger');

function t(name, fn) {
  return (async () => {
    try { await fn(); console.log(`  ok — ${name}`); }
    catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
  })();
}

(async () => {
  console.log('freshnessLedger');

  await t('record + getOne roundtrip', () => {
    ledger._clear();
    ledger.record({ symbol: 'spy', source: 'yahoo', asOf: 1700000000000, latencyMs: 220 });
    const r = ledger.getOne('SPY');
    assert.equal(r.symbol, 'SPY');
    assert.equal(r.source, 'yahoo');
    assert.equal(r.asOf, 1700000000000);
    assert.equal(r.latencyMs, 220);
  });

  await t('multiple sources for same symbol — getOne returns freshest', () => {
    ledger._clear();
    ledger.record({ symbol: 'AAPL', source: 'yahoo',  asOf: 1700000000000 });
    ledger.record({ symbol: 'AAPL', source: 'finnhub', asOf: 1700000000500 });
    ledger.record({ symbol: 'AAPL', source: 'polygon-ws', asOf: 1700000000200 });
    const r = ledger.getOne('AAPL');
    assert.equal(r.source, 'finnhub');
    assert.equal(r.asOf, 1700000000500);
  });

  await t('getAllForSymbol returns rows sorted newest-first', () => {
    ledger._clear();
    ledger.record({ symbol: 'NVDA', source: 'yahoo',   asOf: 1700000000000 });
    ledger.record({ symbol: 'NVDA', source: 'finnhub', asOf: 1700000005000 });
    ledger.record({ symbol: 'NVDA', source: 'polygon', asOf: 1700000003000 });
    const rows = ledger.getAllForSymbol('NVDA');
    assert.equal(rows.length, 3);
    assert.equal(rows[0].source, 'finnhub');
    assert.equal(rows[1].source, 'polygon');
    assert.equal(rows[2].source, 'yahoo');
  });

  await t('record overwrites same (symbol, source) pair', () => {
    ledger._clear();
    ledger.record({ symbol: 'BTC', source: 'polygon-ws', asOf: 1700000000000 });
    ledger.record({ symbol: 'BTC', source: 'polygon-ws', asOf: 1700000010000 });
    const rows = ledger.getAllForSymbol('BTC');
    assert.equal(rows.length, 1, 'should not have duplicate rows for same source');
    assert.equal(rows[0].asOf, 1700000010000);
  });

  await t('record never throws on bad input', () => {
    ledger._clear();
    ledger.record(null);
    ledger.record({});
    ledger.record({ symbol: '' });
    ledger.record({ symbol: 'AAPL', asOf: 'not-a-number', latencyMs: NaN });
    // shouldn't throw; we accept the AAPL entry with default asOf
    const r = ledger.getOne('AAPL');
    assert.ok(r, 'AAPL should be recorded with defaults');
  });

  await t('recordBatch handles arrays + skips nulls', () => {
    ledger._clear();
    ledger.recordBatch([
      { symbol: 'A', source: 'x', asOf: 1 },
      null,
      { symbol: 'B', source: 'x', asOf: 2 },
      { foo: 'bar' }, // no symbol — silently skipped
    ]);
    assert.equal(ledger.snapshot().length, 2);
  });

  await t('snapshot filters by source + staleSinceMs', () => {
    ledger._clear();
    const now = Date.now();
    ledger.record({ symbol: 'A', source: 'x', asOf: now - 10_000 });
    ledger.record({ symbol: 'B', source: 'y', asOf: now - 100 });
    ledger.record({ symbol: 'C', source: 'x', asOf: now - 60_000 });
    const onlyX = ledger.snapshot({ source: 'x' });
    assert.equal(onlyX.length, 2);
    const stale = ledger.snapshot({ staleSinceMs: 5_000 });
    // A (10s old) and C (60s old) should be returned; B (100ms) should not
    assert.equal(stale.length, 2);
    assert.ok(stale.every(r => r.symbol === 'A' || r.symbol === 'C'));
  });

  await t('health summary buckets fresh/stale per source', () => {
    ledger._clear();
    const now = Date.now();
    ledger.record({ symbol: 'A', source: 'yahoo',   asOf: now - 100 });
    ledger.record({ symbol: 'B', source: 'yahoo',   asOf: now - 10 * 60 * 1000 });
    ledger.record({ symbol: 'C', source: 'polygon', asOf: now - 100 });
    const h = ledger.health({ staleThresholdMs: 5 * 60 * 1000 });
    const yahoo = h.bySource.find(s => s.source === 'yahoo');
    const polygon = h.bySource.find(s => s.source === 'polygon');
    assert.equal(yahoo.fresh, 1);
    assert.equal(yahoo.stale, 1);
    assert.equal(polygon.fresh, 1);
    assert.equal(polygon.stale, 0);
    assert.equal(h.totalSymbols, 3);
    assert.equal(h.oldest.symbol, 'B');
  });

  console.log('done');
})();
