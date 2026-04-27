/**
 * providers/__tests__/akshare.test.js — R1.2 smoke.
 *
 * Stubs node-fetch so no network call reaches a Python worker.
 * Verifies graceful "not configured" behaviour, normal flow, and
 * input validation.
 */

'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const fetchPath = require.resolve('node-fetch');
const modPath = require.resolve('../akshare');

let nextResponse = null;
function setFetchResponse(body, { ok = true, status = 200 } = {}) {
  nextResponse = {
    ok, status,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
  };
}
function installFetchStub() {
  require.cache[fetchPath] = {
    id: fetchPath, filename: fetchPath, loaded: true,
    exports: async () => nextResponse,
  };
}
function uninstallFetchStub() {
  delete require.cache[fetchPath];
  delete require.cache[modPath];
}

describe('akshare provider — not configured', () => {
  before(() => { delete process.env.AKSHARE_URL; delete require.cache[modPath]; });

  it('quote returns akshare_not_configured when AKSHARE_URL unset', async () => {
    const ak = require('../akshare');
    const out = await ak.quote({ symbol: '600519' });
    assert.equal(out.error, 'akshare_not_configured');
  });

  it('breadth returns akshare_not_configured when AKSHARE_URL unset', async () => {
    const ak = require('../akshare');
    const out = await ak.breadth({ index: '000001' });
    assert.equal(out.error, 'akshare_not_configured');
  });

  it('flow returns akshare_not_configured when AKSHARE_URL unset', async () => {
    const ak = require('../akshare');
    const out = await ak.flow({ direction: 'northbound' });
    assert.equal(out.error, 'akshare_not_configured');
  });
});

describe('akshare provider — configured', () => {
  before(() => {
    process.env.AKSHARE_URL = 'http://localhost:7800';
    installFetchStub();
    delete require.cache[modPath];
  });
  after(() => {
    uninstallFetchStub();
    delete process.env.AKSHARE_URL;
  });

  beforeEach(() => {
    const ak = require('../akshare');
    ak._cache.clear();
  });

  it('quote validates missing symbol', async () => {
    const ak = require('../akshare');
    const out = await ak.quote({});
    assert.match(out.error, /symbol required/);
  });

  it('breadth validates missing index', async () => {
    const ak = require('../akshare');
    const out = await ak.breadth({});
    assert.match(out.error, /index required/);
  });

  it('flow validates direction', async () => {
    const ak = require('../akshare');
    const out = await ak.flow({ direction: 'sideways' });
    assert.match(out.error, /northbound\|southbound/);
  });

  it('quote passes through worker JSON', async () => {
    setFetchResponse({ symbol: '600519', rows: [{ name: 'Kweichow Moutai' }] });
    const ak = require('../akshare');
    const out = await ak.quote({ symbol: '600519' });
    assert.equal(out.symbol, '600519');
    assert.equal(out.rows.length, 1);
  });

  it('flow surfaces worker 503', async () => {
    setFetchResponse('upstream busy', { ok: false, status: 503 });
    const ak = require('../akshare');
    const out = await ak.flow({ direction: 'northbound' });
    assert.match(out.error, /akshare 503/);
  });
});
