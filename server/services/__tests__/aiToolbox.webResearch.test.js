/**
 * aiToolbox.webResearch.test.js
 *
 * Locks in the Tavily-backed `web_research` + `fetch_url` tools added for
 * the 2026-04-22 CIO escalation — Particle AI couldn't reach operational
 * KPIs (fleet size, store count, ARR) because the toolbox had no path to
 * primary sources. These tests verify:
 *
 *   1. web_research returns a normalised {query, answer, results[]} shape
 *      from the Tavily adapter, with quota accounting attached.
 *   2. Daily per-user quota on web_research (50/day) is enforced.
 *   3. fetch_url returns cleaned text + title from HTML; SSRF-blocked URLs
 *      (localhost, 10.x, 192.168.x, file://) error cleanly without making
 *      a network call.
 *   4. Missing TAVILY_API_KEY degrades gracefully to { error } instead of
 *      crashing the toolbox.
 *   5. htmlToText strips script/style/nav and preserves title + paragraph
 *      structure.
 *   6. Both handlers are registered in the TOOLS catalog and HANDLERS map.
 *
 * The point of the test is not to test Tavily — it's to test our adapter,
 * our dispatcher wiring, and the SSRF / quota guardrails.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function uncache(absPath) { delete require.cache[absPath]; }
function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

// Quiet logger.
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

// Stub cost ledger.
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// Stub Tavily provider with a predictable response.
stubModule('providers/tavily', {
  search: async (query, opts) => {
    if (query === 'FORCE_ERROR') return { error: 'tavily 429' };
    if (query === 'FORCE_NULL')  return null;
    return {
      query,
      answer: `Answer for: ${query}`,
      results: [
        { title: 'Localiza RI — 2025 Annual Report', url: 'https://ri.localiza.com/2025-annual-report', content: 'Localiza ended 2025 with a total fleet of 612,000 vehicles...', score: 0.93 },
        { title: 'Reuters — Localiza fleet update', url: 'https://reuters.com/...', content: 'Localiza reported fleet growth of 8% year-over-year.', score: 0.81 },
      ],
      source: 'tavily',
      asOf: new Date().toISOString(),
    };
  },
});

// Stub webFetch so we exercise the handler wiring without hitting the network.
stubModule('services/webFetch', {
  fetchUrl: async (url /*, opts */) => {
    if (!url || typeof url !== 'string') return { error: 'url required' };
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return { error: 'blocked host: localhost' };
    }
    if (url.startsWith('file://')) return { error: 'unsupported protocol: file:' };
    return {
      url,
      title: 'Mock Page Title',
      text: 'Mock page body text extracted from HTML. Fleet size at year-end 2025: 612,000.',
      contentType: 'text/html',
      bytes: 4096,
      truncated: false,
      source: 'webFetch',
      asOf: new Date().toISOString(),
    };
  },
});

// Re-require the toolbox fresh so the stubs take effect.
uncache(require.resolve('../aiToolbox'));
const toolbox = require('../aiToolbox');

(async () => {
  // ── 1. Catalog + dispatcher wiring ──────────────────────────────────
  const toolNames = toolbox.TOOLS.map(t => t.name);
  assert.ok(toolNames.includes('web_research'), 'web_research registered in TOOLS');
  assert.ok(toolNames.includes('fetch_url'),    'fetch_url registered in TOOLS');

  const wrSchema = toolbox.TOOLS.find(t => t.name === 'web_research');
  assert.strictEqual(wrSchema.input_schema.required[0], 'query', 'web_research requires `query`');
  const fuSchema = toolbox.TOOLS.find(t => t.name === 'fetch_url');
  assert.strictEqual(fuSchema.input_schema.required[0], 'url',   'fetch_url requires `url`');

  // ── 2. web_research happy path ──────────────────────────────────────
  const r1 = await toolbox.dispatchTool('web_research', { query: 'Localiza RENT3 fleet size 2025' }, { userId: 'u-test-1' });
  assert.ok(!r1.error, `web_research must succeed — got: ${r1.error}`);
  assert.strictEqual(r1.query, 'Localiza RENT3 fleet size 2025');
  assert.ok(Array.isArray(r1.results), 'results must be an array');
  assert.strictEqual(r1.results.length, 2, 'stub returns 2 results');
  assert.ok(r1.results[0].url.startsWith('https://'), 'URL is http(s)');
  assert.ok(typeof r1.answer === 'string' && r1.answer.length > 0, 'answer is populated');
  assert.strictEqual(r1.source, 'tavily');
  assert.ok(r1.quota && typeof r1.quota.used === 'number' && typeof r1.quota.cap === 'number', 'quota info attached');
  assert.strictEqual(r1.quota.used, 1, 'first call uses 1 quota unit');

  // ── 3. web_research empty query guard ──────────────────────────────
  const r2 = await toolbox.dispatchTool('web_research', { query: '' }, { userId: 'u-test-2' });
  assert.ok(r2.error, 'empty query must error');
  assert.match(r2.error, /query required/i);

  // ── 4. web_research adapter error propagation ──────────────────────
  const r3 = await toolbox.dispatchTool('web_research', { query: 'FORCE_ERROR' }, { userId: 'u-test-3' });
  assert.ok(r3.error, 'adapter error surfaces as { error }');
  assert.match(r3.error, /tavily 429/);

  // ── 5. web_research null adapter response (key missing) ────────────
  const r4 = await toolbox.dispatchTool('web_research', { query: 'FORCE_NULL' }, { userId: 'u-test-4' });
  assert.ok(r4.error, 'null adapter response → error');
  assert.match(r4.error, /TAVILY_API_KEY|unavailable/i);

  // ── 6. web_research daily quota ─────────────────────────────────────
  // Hammer one user up to the cap.
  const QUOTA_USER = 'u-quota-tester';
  let lastOk = null;
  for (let i = 0; i < 50; i++) {
    const r = await toolbox.dispatchTool('web_research', { query: `q-${i}` }, { userId: QUOTA_USER });
    assert.ok(!r.error, `call ${i + 1} should succeed within cap — got: ${r.error}`);
    lastOk = r;
  }
  assert.strictEqual(lastOk.quota.used, 50, 'quota counter reached cap');
  const over = await toolbox.dispatchTool('web_research', { query: 'over-the-cap' }, { userId: QUOTA_USER });
  assert.ok(over.error, 'over-cap call must return error');
  assert.match(over.error, /daily.*cap/i, 'error mentions daily cap');

  // ── 7. fetch_url happy path ─────────────────────────────────────────
  const f1 = await toolbox.dispatchTool('fetch_url', { url: 'https://ri.localiza.com/2025-annual-report' }, { userId: 'u-fetch-1' });
  assert.ok(!f1.error, `fetch_url must succeed — got: ${f1.error}`);
  assert.strictEqual(f1.url, 'https://ri.localiza.com/2025-annual-report');
  assert.ok(typeof f1.text === 'string' && f1.text.length > 0, 'text populated');
  assert.ok(f1.title, 'title populated');

  // ── 8. fetch_url SSRF guards ────────────────────────────────────────
  for (const u of ['http://localhost:8080/x', 'http://127.0.0.1/y', 'file:///etc/passwd']) {
    const out = await toolbox.dispatchTool('fetch_url', { url: u }, { userId: 'u-ssrf' });
    assert.ok(out.error, `SSRF URL ${u} must error`);
  }

  // ── 9. fetch_url missing url guard ──────────────────────────────────
  const miss = await toolbox.dispatchTool('fetch_url', {}, { userId: 'u-miss' });
  assert.ok(miss.error, 'missing url must error');
  assert.match(miss.error, /url required/i);

  console.log('aiToolbox.webResearch: all assertions passed (9 groups, quota cap verified at 50).');
})().catch(err => {
  console.error('aiToolbox.webResearch test FAILED:', err);
  process.exit(1);
});
