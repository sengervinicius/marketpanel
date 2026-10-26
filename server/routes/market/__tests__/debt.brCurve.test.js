'use strict';
// #292 Wave 7 — brapi DI1 term structure as a BR curve source.
const { test: t7 } = require('node:test');
const assert7 = require('node:assert');
t7('buildBrCurve: brapi DI1 term structure becomes the curve when ANBIMA is absent', async () => {
  const brapi = require('../../../providers/brapi');
  const orig = brapi.getDiTermStructure;
  const now = new Date('2026-10-26T15:00:00Z');
  brapi.getDiTermStructure = async () => ({ asOfMs: Date.parse('2026-10-23T21:00:00Z'), errors: [], points: [
    { symbol: 'DI1X26', maturity: '2026-11-01', days: 6, months: 0, rate: 13.70, settlementPU: 99700, asOfMs: null },
    { symbol: 'DI1F27', maturity: '2027-01-01', days: 67, months: 2, rate: 14.05, settlementPU: 97500, asOfMs: null },
    { symbol: 'DI1N27', maturity: '2027-07-01', days: 248, months: 8, rate: 14.40, settlementPU: 91000, asOfMs: null },
    { symbol: 'DI1F28', maturity: '2028-01-01', days: 432, months: 14, rate: 14.60, settlementPU: 85000, asOfMs: null },
    { symbol: 'DI1F29', maturity: '2029-01-01', days: 798, months: 26, rate: 14.70, settlementPU: 73000, asOfMs: null },
  ] });
  try {
    const { buildBrCurve } = require('../debt');
    const selicRes = { status: 'fulfilled', value: [{ data: '23/10/2026', valor: '13.65' }] };
    const r = await buildBrCurve({ tdRes: { status: 'rejected', reason: new Error('TD 404') }, selicRes, now, fetchImpl: async () => { throw new Error('no anbima'); } });
    assert7.match(r.source, /DI1 FUTURES/);
    assert7.ok(r.curve.length >= 5);
    assert7.strictEqual(r.curve[0].tenor, 'SELIC');
    assert7.strictEqual(r.asOf, '2026-10-23T21:00:00.000Z');
    assert7.strictEqual(r.frequency, 'eod');
  } finally { brapi.getDiTermStructure = orig; }
});
t7('buildBrCurve: a DI1 curve whose front is 5pp from Selic is rejected, not shown', async () => {
  const brapi = require('../../../providers/brapi');
  const orig = brapi.getDiTermStructure;
  brapi.getDiTermStructure = async () => ({ asOfMs: Date.now(), errors: [], points: [1, 2, 3, 4, 5].map(i => ({ symbol: `DI1${i}`, maturity: '2027-01-01', days: 30 * i, months: i, rate: 19 + i, settlementPU: 1, asOfMs: null })) });
  try {
    const { buildBrCurve } = require('../debt');
    const r = await buildBrCurve({ tdRes: { status: 'rejected', reason: new Error('TD 404') }, selicRes: { status: 'fulfilled', value: [{ valor: '13.65' }] }, now: new Date('2026-10-26T15:00:00Z'), fetchImpl: async () => { throw new Error('no anbima'); } });
    assert7.strictEqual(r.source, 'unavailable');
    assert7.match(r.error, /di1: implausible/);
  } finally { brapi.getDiTermStructure = orig; }
});
