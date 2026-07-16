/**
 * news.intelligence.test.js — Phase 3 news-intelligence features.
 *
 * Proves:
 *   1. GET /news?tickers=AAPL,PETR4 (watchlist-scoped feed):
 *      - validates / uppercases / dedupes the list and caps it at 30,
 *      - filters the merged normalized items by ticker match on the
 *        item's tickers field (Finnhub `related` is surfaced as tickers),
 *      - enriches with Finnhub company news for the requested symbols,
 *      - all-invalid tickers fall back to the general (unscoped) feed.
 *   2. GET /news/ticker-summary/:symbol:
 *      - validates the symbol (400 on garbage),
 *      - pulls the ticker's 7-day news and makes ONE LLM call,
 *      - Perplexity → Anthropic Haiku fallback (#291 W1.15 pattern),
 *      - 503 only when BOTH providers fail,
 *      - 30-min in-memory cache (second call is cached:true, no new LLM call),
 *      - zero-article tickers short-circuit without an LLM call,
 *      - AI quota middleware (dailyAILimit + aiQuotaGate) runs on the route.
 *
 * The provider layer and middleware are stubbed via require.cache (same
 * pattern as stocks.snapshotTickers.test.js) so the test is deterministic
 * and offline-safe.
 *
 *   cd server && node --test routes/market/__tests__/news.intelligence.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

process.env.FINNHUB_API_KEY   = 'test-finnhub-key';
process.env.PERPLEXITY_API_KEY = 'test-pplx-key';
process.env.ANTHROPIC_API_KEY  = 'test-anthropic-key';

// ── Controllable fake upstreams ──────────────────────────────────────
const calls = { finnhubGeneral: 0, companyNews: [], perplexity: 0, anthropic: 0 };
const state = {
  perplexityMode: 'ok',   // 'ok' | 'fail'
  anthropicMode:  'ok',
  llmPayload: { summary: 'Strong week driven by earnings beat.', bullets: ['b1', 'b2', 'b3'], sentiment: 'bullish' },
};

function jsonRes(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

const COMPANY_NEWS = {
  AAPL: [
    { headline: 'AAPL company story',  url: 'https://x/aapl-co',  source: 'Finnhub', datetime: 1760000300, summary: 's1' },
    { headline: 'AAPL supplier story', url: 'https://x/aapl-co2', source: 'Finnhub', datetime: 1760000400, summary: 's2' },
  ],
  MSFT: [
    { headline: 'MSFT cloud story', url: 'https://x/msft-co', source: 'Finnhub', datetime: 1760000500, summary: 's3' },
  ],
  NVDA: [
    { headline: 'NVDA chip story', url: 'https://x/nvda-co', source: 'Finnhub', datetime: 1760000600, summary: 's4' },
  ],
};

async function fakeFetch(url) {
  const u = String(url);
  if (u.includes('finnhub.io/api/v1/news?')) {
    calls.finnhubGeneral++;
    return jsonRes([
      { headline: 'Apple beats estimates',    url: 'https://x/apple', source: 'Reuters',   datetime: 1760000000, summary: 'aapl',  related: 'AAPL' },
      { headline: 'Macro melt-up continues',  url: 'https://x/macro', source: 'Bloomberg', datetime: 1760000100, summary: 'macro', related: '' },
      { headline: 'Petrobras output rises',   url: 'https://x/petr',  source: 'Valor',     datetime: 1760000200, summary: 'petr',  related: 'PETR4' },
    ]);
  }
  if (u.includes('/company-news?symbol=')) {
    const sym = decodeURIComponent(u.match(/symbol=([^&]+)/)[1]);
    calls.companyNews.push(sym);
    return jsonRes(COMPANY_NEWS[sym] || []);
  }
  if (u.includes('bloomberg.com') || u.includes('ft.com')) {
    return { ok: false, status: 404, text: async () => '' };
  }
  if (u.includes('api.perplexity.ai')) {
    calls.perplexity++;
    if (state.perplexityMode !== 'ok') return jsonRes({ error: 'down' }, 500);
    return jsonRes({ choices: [{ message: { content: JSON.stringify(state.llmPayload) } }] });
  }
  if (u.includes('api.anthropic.com')) {
    calls.anthropic++;
    if (state.anthropicMode !== 'ok') return jsonRes({ error: 'down' }, 500);
    return jsonRes({ content: [{ type: 'text', text: JSON.stringify(state.llmPayload) }] });
  }
  throw new Error('unexpected fetch in test: ' + u);
}

// ── Stub ../lib/providers + AI middleware via require.cache ─────────
const providersPath = require.resolve('../lib/providers');
const dailyPath     = require.resolve('../../../middleware/dailyAILimit');
const quotaPath     = require.resolve('../../../middleware/aiQuotaGate');
const newsPath      = require.resolve('../news');

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    fetch: fakeFetch,
    polyFetch: async () => ({ results: [] }),
    parseRss: () => [],
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
    YF_UA: 'test-ua',
  },
};

const mwCalls = { daily: 0, quota: 0 };
require.cache[dailyPath] = {
  id: dailyPath, filename: dailyPath, loaded: true,
  exports: { dailyAILimit: (req, res, next) => { mwCalls.daily++; next(); } },
};
require.cache[quotaPath] = {
  id: quotaPath, filename: quotaPath, loaded: true,
  exports: { aiQuotaGate: (req, res, next) => { mwCalls.quota++; next(); } },
};

// Bust the route module so the stubs take effect.
delete require.cache[newsPath];
const newsRouter = require('../news');

function getJson(port, pathStr) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathStr, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
        });
      })
      .on('error', reject);
  });
}

describe('news intelligence (Phase 3)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(newsRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  // ── 1. Watchlist-scoped feed ───────────────────────────────────────
  describe('GET /news?tickers=', () => {
    it('filters the merged feed to the requested tickers (uppercased)', async () => {
      const { status, body } = await getJson(port, '/news?tickers=aapl,petr4&limit=40');
      assert.equal(status, 200);
      assert.equal(body.scope, 'tickers');
      assert.deepEqual(body.tickers, ['AAPL', 'PETR4']);

      const titles = body.results.map(r => r.title);
      // Matching general-feed items (via Finnhub `related`) are kept…
      assert.ok(titles.includes('Apple beats estimates'));
      assert.ok(titles.includes('Petrobras output rises'));
      // …company-news enrichment items are kept…
      assert.ok(titles.includes('AAPL company story'));
      assert.ok(titles.includes('AAPL supplier story'));
      // …non-matching general items are filtered out.
      assert.ok(!titles.includes('Macro melt-up continues'));

      // Every returned item carries at least one requested ticker.
      for (const item of body.results) {
        const t = (item.tickers || []).map(x => String(x).toUpperCase());
        assert.ok(t.includes('AAPL') || t.includes('PETR4'),
          `item "${item.title}" does not match the requested tickers`);
      }
    });

    it('drops invalid symbols and dedupes', async () => {
      const raw = encodeURIComponent('aapl, $$bad$$, AAPL, spy!!,  ');
      const { status, body } = await getJson(port, `/news?tickers=${raw}&limit=41`);
      assert.equal(status, 200);
      assert.deepEqual(body.tickers, ['AAPL']);
    });

    it('caps the list at 30 tickers', async () => {
      const many = Array.from({ length: 35 }, (_, i) => `T${i + 1}`).join(',');
      const { status, body } = await getJson(port, `/news?tickers=${many}&limit=42`);
      assert.equal(status, 200);
      assert.equal(body.tickers.length, 30);
      assert.equal(body.tickers[29], 'T30');
      assert.ok(!body.tickers.includes('T31'));
    });

    it('falls back to the general (unscoped) feed when nothing valid remains', async () => {
      const raw = encodeURIComponent('$$$,!!!');
      const { status, body } = await getJson(port, `/news?tickers=${raw}&limit=43`);
      assert.equal(status, 200);
      assert.equal(body.scope, undefined);
      const titles = body.results.map(r => r.title);
      assert.ok(titles.includes('Macro melt-up continues'));
    });

    it('legacy single-ticker path (?ticker=) is unchanged', async () => {
      const { status, body } = await getJson(port, '/news?ticker=MSFT&limit=44');
      assert.equal(status, 200);
      assert.equal(body.results[0].title, 'MSFT cloud story');
      assert.deepEqual(body.results[0].tickers, ['MSFT']);
    });
  });

  // ── 2. Per-ticker 7-day AI summary ─────────────────────────────────
  describe('GET /news/ticker-summary/:symbol', () => {
    it('rejects invalid symbols with 400', async () => {
      const { status, body } = await getJson(port, `/news/ticker-summary/${encodeURIComponent('BAD$$')}`);
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid_symbol');
    });

    it('summarizes 7-day news via Perplexity and runs AI quota middleware', async () => {
      const dailyBefore = mwCalls.daily;
      const quotaBefore = mwCalls.quota;
      const pplxBefore  = calls.perplexity;

      const { status, body } = await getJson(port, '/news/ticker-summary/aapl');
      assert.equal(status, 200);
      assert.equal(body.symbol, 'AAPL');
      assert.equal(body.sentiment, 'bullish');
      assert.deepEqual(body.bullets, ['b1', 'b2', 'b3']);
      assert.equal(body.articleCount, 2);
      assert.equal(body.cached, false);
      assert.equal(body.provider, 'perplexity');
      assert.equal(body.degraded, false);
      assert.ok(body.summary.length > 0);

      assert.equal(calls.perplexity, pplxBefore + 1, 'exactly one LLM call');
      assert.ok(mwCalls.daily > dailyBefore, 'dailyAILimit ran');
      assert.ok(mwCalls.quota > quotaBefore, 'aiQuotaGate ran');
    });

    it('serves the second request from the 30-min cache (no new LLM call)', async () => {
      const pplxBefore = calls.perplexity;
      const { status, body } = await getJson(port, '/news/ticker-summary/AAPL');
      assert.equal(status, 200);
      assert.equal(body.cached, true);
      assert.equal(body.symbol, 'AAPL');
      assert.equal(calls.perplexity, pplxBefore, 'cache hit must not call the LLM');
    });

    it('falls back to Anthropic Haiku when Perplexity fails (degraded:true)', async () => {
      state.perplexityMode = 'fail';
      state.llmPayload = { summary: 'Cloud momentum.', bullets: ['m1', 'm2', 'm3'], sentiment: 'neutral' };
      try {
        const { status, body } = await getJson(port, '/news/ticker-summary/MSFT');
        assert.equal(status, 200);
        assert.equal(body.provider, 'anthropic');
        assert.equal(body.degraded, true);
        assert.equal(body.sentiment, 'neutral');
        assert.equal(body.articleCount, 1);
        assert.ok(calls.anthropic >= 1);
      } finally {
        state.perplexityMode = 'ok';
      }
    });

    it('returns 503 only when BOTH providers fail', async () => {
      state.perplexityMode = 'fail';
      state.anthropicMode  = 'fail';
      try {
        const { status, body } = await getJson(port, '/news/ticker-summary/NVDA');
        assert.equal(status, 503);
        assert.equal(body.error, 'summary_temporarily_unavailable');
      } finally {
        state.perplexityMode = 'ok';
        state.anthropicMode  = 'ok';
      }
    });

    it('short-circuits tickers with no 7-day news without an LLM call', async () => {
      const pplxBefore = calls.perplexity;
      const anthBefore = calls.anthropic;
      const { status, body } = await getJson(port, '/news/ticker-summary/TSLA');
      assert.equal(status, 200);
      assert.equal(body.articleCount, 0);
      assert.equal(body.sentiment, 'neutral');
      assert.deepEqual(body.bullets, []);
      assert.equal(calls.perplexity, pplxBefore);
      assert.equal(calls.anthropic, anthBefore);
    });
  });
});
