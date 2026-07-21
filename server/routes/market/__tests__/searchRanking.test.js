/**
 * FEAT-4 — searchRanking unit tests.
 * Run: node --test server/routes/market/__tests__/searchRanking.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rankSearchResults, normalizeCompanyName, exchangeScore,
} = require('../lib/searchRanking');

test('normalizeCompanyName strips suffixes/ADR noise', () => {
  assert.equal(normalizeCompanyName('Deutsche Telekom AG'), 'deutsche telekom');
  assert.equal(normalizeCompanyName('Deutsche Telekom AG Sponsored ADR'), 'deutsche telekom');
  assert.equal(normalizeCompanyName('Apple Inc. Common Stock'), 'apple');
  assert.equal(normalizeCompanyName(''), '');
});

test('exchangeScore prefers big boards over OTC', () => {
  assert.ok(exchangeScore('XNYS') > exchangeScore('OTC'));
  assert.ok(exchangeScore('XETR') > exchangeScore('PNK'));
  assert.ok(exchangeScore('GER') > exchangeScore('OTCQX'));
  assert.equal(exchangeScore('SOMEVENUE'), 50);
  assert.equal(exchangeScore(''), 50);
});

test('rankSearchResults: home big board beats OTC listings, group annotated', () => {
  const input = [
    { ticker: 'DTEGY', name: 'Deutsche Telekom AG Sponsored ADR', primaryExchange: 'OTC',  type: 'ADRC' },
    { ticker: 'DTEGF', name: 'Deutsche Telekom AG',               primaryExchange: 'PINK', type: 'OS' },
    { ticker: 'DTE.DE', name: 'Deutsche Telekom AG',              primaryExchange: 'GER',  type: 'EQUITY' },
  ];
  const out = rankSearchResults(input);
  assert.equal(out.length, 3);
  assert.equal(out[0].ticker, 'DTE.DE');
  assert.equal(out[0].primary, true);
  assert.equal(out[0].listings, 3);
  assert.ok(out[0].groupId);
  assert.equal(out[1].primary, false);
  assert.equal(out[2].primary, false);
  assert.ok(out.slice(1).every(r => r.groupId === out[0].groupId));
});

test('rankSearchResults: unrelated companies stay separate, solo has no groupId', () => {
  const out = rankSearchResults([
    { ticker: 'AAPL', name: 'Apple Inc.', primaryExchange: 'XNAS', type: 'CS' },
    { ticker: 'MSFT', name: 'Microsoft Corporation', primaryExchange: 'XNAS', type: 'CS' },
  ]);
  assert.equal(out[0].ticker, 'AAPL');
  assert.equal(out[0].primary, true);
  assert.equal(out[0].groupId, undefined);
  assert.equal(out[1].ticker, 'MSFT');
  assert.equal(out[1].primary, true);
});

test('rankSearchResults: market cap breaks big-board ties', () => {
  const out = rankSearchResults([
    { ticker: 'SMALL', name: 'Acme Industries', primaryExchange: 'XNYS', marketCap: 1e9 },
    { ticker: 'BIG',   name: 'Acme Industries', primaryExchange: 'XNAS', marketCap: 5e10 },
  ]);
  assert.equal(out[0].ticker, 'BIG');
  assert.equal(out[0].primary, true);
});

test('rankSearchResults: group order follows first-hit relevance', () => {
  const out = rankSearchResults([
    { ticker: 'TSLA', name: 'Tesla Inc', primaryExchange: 'XNAS' },
    { ticker: 'NIO',  name: 'NIO Inc',  primaryExchange: 'XNYS' },
    { ticker: 'TSLA34', name: 'Tesla Inc', primaryExchange: 'BVMF' },
  ]);
  assert.deepEqual(out.map(r => r.ticker), ['TSLA', 'TSLA34', 'NIO']);
});
