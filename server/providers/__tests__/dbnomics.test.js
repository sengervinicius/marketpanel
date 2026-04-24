/**
 * providers/__tests__/dbnomics.test.js — R1.1 smoke.
 *
 * Stubs node-fetch so no network call reaches DBnomics.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const fetchPath = require.resolve('node-fetch');
const modPath = require.resolve('../dbnomics');

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

describe('dbnomics provider', () => {
  before(() => { installFetchStub(); delete require.cache[modPath]; });
  after(uninstallFetchStub);

  it('lookupSeries with missing args returns error envelope', async () => {
    const dbn = require('../dbnomics');
    const out = await dbn.lookupSeries({});
    assert.match(out.error, /required/);
  });

  it('lookupSeries normalises a plausible DBnomics reply', async () => {
    setFetchResponse({
      series: {
        docs: [
          {
            series_name: 'USD / EUR exchange rate',
            unit: 'Index',
            '@frequency': 'monthly',
            period: ['2024-11', '2024-12', '2025-01'],
            value: [1.08, 1.05, 'NA'],
            indexed_at: '2026-04-20T00:00:00Z',
          },
        ],
      },
    });
    const dbn = require('../dbnomics');
    const out = await dbn.lookupSeries({
      providerCode: 'ECB',
      datasetCode: 'EXR',
      seriesCode: 'M.USD.EUR.SP00.A',
    });
    assert.equal(out.provider, 'ECB');
    assert.equal(out.dataset, 'EXR');
    assert.equal(out.observations.length, 2); // NA dropped
    assert.equal(out.observations_count, 2);
    assert.equal(out.observations[0].t, '2024-11');
    assert.equal(out.observations[1].v, 1.05);
    assert.match(out.source_url, /ECB\/EXR\/M\.USD\.EUR\.SP00\.A$/);
  });

  it('lookupSeries surfaces HTTP error', async () => {
    setFetchResponse('rate limit', { ok: false, status: 429 });
    // Purge cache to force a fresh fetch
    const dbn = require('../dbnomics');
    dbn._cache.clear();
    const out = await dbn.lookupSeries({
      providerCode: 'X', datasetCode: 'Y', seriesCode: 'Z',
    });
    assert.match(out.error, /dbnomics 429/);
  });
});
