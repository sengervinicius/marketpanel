/**
 * search.fundamentalsFallback.test.js — fix/bug-wave3 BUG 3 (LLM leg).
 *
 * POST /search/fundamentals must only read "unavailable" when the LLM AND
 * the data legs all failed. buildFundamentalsFallback turns gathered
 * fundamentals/quote data into a degraded (non-AI) card; null only when
 * there is truly nothing to show.
 *
 *   cd server && node --test routes/__tests__/search.fundamentalsFallback.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildFundamentalsFallback } = require('../search.helpers');

const FUNDS = {
  marketCap: 512e9, peRatio: 38.2, eps: 13.1, totalRevenue: 27e9,
  profitMargins: 0.452, returnOnEquity: 1.69, dividendYield: 0.0049,
  sector: 'Financial Services', industry: 'Credit Services',
  source: 'twelvedata',
};

describe('buildFundamentalsFallback', () => {
  it('builds a degraded card from fundamentals + quote', () => {
    const fb = buildFundamentalsFallback('MA', FUNDS, { price: 540.2, changePct: 1.2 }, ['h1', 'h2']);
    assert.ok(fb);
    assert.equal(fb.symbol, 'MA');
    assert.equal(fb.aiDegraded, true);
    assert.equal(fb.dataSource, 'twelvedata'); // which source served
    assert.equal(fb.livePrice, 540.2);
    assert.match(fb.summary, /Financial Services/);
    assert.ok(fb.financialHighlights.some(h => h.includes('Revenue (TTM): $27.0B')));
    assert.ok(fb.valuationSnapshot.some(v => v.includes('P/E (TTM): 38.2x')));
  });

  it('works quote-only (fundamentals fully down)', () => {
    const fb = buildFundamentalsFallback('MA', null, { price: 540.2, changePct: -0.4 });
    assert.ok(fb);
    assert.equal(fb.dataSource, 'quote');
    assert.match(fb.summary, /540\.2/);
  });

  it('returns null when there is nothing to show (only then is "unavailable" honest)', () => {
    assert.equal(buildFundamentalsFallback('MA', null, null), null);
    assert.equal(buildFundamentalsFallback('MA', { beta: 1.1 }, { price: null }), null);
  });
});
