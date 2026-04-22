/**
 * aiToolbox.test.js — unit tests for s3 LLM tool-use.
 *
 * These tests run without a real LLM. We stub the Anthropic fetch at the
 * module edge by overriding node-fetch in require.cache before loading
 * aiToolbox, and we stub the adapter modules so tool handlers return
 * deterministic shapes.
 *
 * Coverage:
 *   - TOOLS catalog is well-formed (name, description, input_schema).
 *   - dispatchTool routes to the correct handler and swallows thrown errors.
 *   - dispatchTool caps oversized payloads.
 *   - runToolLoop walks a tool_use → tool_result → final-text round trip.
 *   - runToolLoop terminates after MAX_TOOL_ROUNDS even if the model keeps
 *     emitting tool_use forever.
 */

'use strict';

const assert = require('assert');
const path = require('path');

// Helper to fully reset require.cache for specific modules so test runs
// are hermetic despite shared state.
function uncache(absPath) { delete require.cache[absPath]; }

// ── Stubs ────────────────────────────────────────────────────────────
// Stub node-fetch: we'll install a scripted response sequence per test.
const fetchPath = require.resolve('node-fetch');
const originalFetch = require.cache[fetchPath];
let fetchScript = [];          // array of {status, body} responses
let fetchCalls = [];           // captured requests
function stubFetch(url, opts) {
  fetchCalls.push({ url, opts });
  const next = fetchScript.shift();
  if (!next) {
    return Promise.resolve({
      ok: false,
      status: 500,
      text: async () => 'no scripted response left',
      json: async () => { throw new Error('no scripted response'); },
    });
  }
  return Promise.resolve({
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    text: async () => JSON.stringify(next.body),
    json: async () => next.body,
    clone() { return this; },
  });
}
require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: stubFetch,
};

// Stub provider adapters so tool handlers don't hit the real data layer.
function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}
stubModule('providers/multiAssetProvider', {
  getInstrumentDetail: async ({ symbol }) => ({
    symbol, name: 'Stub Corp', price: 100, chgPct: 1.25, sector: 'Tech',
  }),
});
stubModule('providers/bondsProvider', {
  getYieldCurve: async (country) => ({ country, curve: [{ tenor: '10Y', yield: 4.25 }] }),
  getSovereignBonds: async (country) => ([{ isin: 'DE0001102580', maturity: '2032-05', yield: 2.1, country }]),
  getCorpBonds: async (opts) => ([{ isin: 'XS2000000000', name: 'Acme GmbH', rating: 'BB', maturity: '2026-04-30' }]),
});
stubModule('providers/macroProvider', {
  getSnapshot: async (country) => ({ country, policyRate: 4.25, cpiYoY: 3.1 }),
});
stubModule('services/earnings', {
  getEarningsCalendar: async (from, to) => ([{ symbol: 'AAPL', date: from }]),
  getEarningsForTicker: async (sym) => ([{ symbol: sym, date: '2026-05-01' }]),
});
stubModule('services/unusualWhales', {
  getOptionsFlow: async (sym) => ({ symbol: sym, netFlow: 1_000_000, sentiment: 'bullish' }),
});
stubModule('services/predictionAggregator', {
  getTopMarkets: async () => ({ markets: [{ title: 'Trump 2028', volume: 10 }] }),
});
stubModule('services/vault', {
  retrieve: async (userId, query) => ([{ documentId: 'd1', filename: 'thesis.pdf', content: 'excerpt about ' + query, similarity: 0.82 }]),
});
stubModule('services/wireGenerator', {
  getFromDB: async (limit) => (Array.from({ length: Math.min(limit, 2) }, (_, i) => ({ id: i, title: `wire ${i}` }))),
});

// Also stub aiCostLedger so ledger writes are no-ops.
stubModule('services/aiCostLedger', { recordUsage: () => {} });
// Stub logger so test output stays quiet.
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

// Now load the module under test.
const toolboxPath = require.resolve('../aiToolbox');
uncache(toolboxPath);
const toolbox = require('../aiToolbox');

// ── Setup ─────────────────────────────────────────────────────────────
process.env.ANTHROPIC_API_KEY = 'test-key';

// ── Tests ─────────────────────────────────────────────────────────────
(async () => {
  // 1. Tool catalog well-formed
  assert.ok(Array.isArray(toolbox.TOOLS) && toolbox.TOOLS.length > 0, 'TOOLS must be a non-empty array');
  const names = new Set();
  for (const t of toolbox.TOOLS) {
    assert.strictEqual(typeof t.name, 'string', 'tool name must be a string');
    assert.strictEqual(typeof t.description, 'string', 'tool description must be a string');
    assert.ok(t.description.length > 20, `tool ${t.name} description too short`);
    assert.ok(t.input_schema && t.input_schema.type === 'object', `tool ${t.name} missing input_schema`);
    assert.ok(!names.has(t.name), `duplicate tool name: ${t.name}`);
    names.add(t.name);
    assert.ok(toolbox.HANDLERS[t.name], `handler missing for tool: ${t.name}`);
  }

  // 2. dispatchTool routes correctly
  const q = await toolbox.dispatchTool('lookup_quote', { symbol: 'AAPL' });
  assert.strictEqual(q.symbol, 'AAPL');
  assert.strictEqual(q.price, 100);

  // 3. dispatchTool swallows errors from misbehaving adapters
  const bad = await toolbox.dispatchTool('this_tool_does_not_exist', {});
  assert.ok(bad.error, 'unknown tool should return { error }');

  // 4. Vault requires userId
  const vaultAnon = await toolbox.dispatchTool('search_vault', { query: 'hi' }, {});
  assert.ok(vaultAnon.error && /authenticated/i.test(vaultAnon.error),
    'search_vault must refuse without userId');

  const vaultAuthed = await toolbox.dispatchTool('search_vault', { query: 'macro' }, { userId: 42 });
  assert.strictEqual(vaultAuthed.count, 1);
  assert.ok(vaultAuthed.passages[0].excerpt.includes('macro'));

  // 5. Oversized tool payloads get truncated
  const originalHandler = toolbox.HANDLERS.get_recent_wire;
  toolbox.HANDLERS.get_recent_wire = async () => ({ payload: 'x'.repeat(toolbox.MAX_TOOL_PAYLOAD_BYTES + 500) });
  const big = await toolbox.dispatchTool('get_recent_wire', { limit: 10 });
  assert.strictEqual(big.truncated, true);
  assert.ok(big.originalBytes > toolbox.MAX_TOOL_PAYLOAD_BYTES);
  toolbox.HANDLERS.get_recent_wire = originalHandler;

  // 6. providerSupportsTools
  assert.strictEqual(toolbox.providerSupportsTools({ url: 'https://api.anthropic.com/v1/messages' }), true);
  assert.strictEqual(toolbox.providerSupportsTools({ url: 'https://api.perplexity.ai/chat/completions' }), false);
  assert.strictEqual(toolbox.providerSupportsTools(null), false);

  // 7. runToolLoop: happy path — model calls one tool, then answers.
  fetchScript = [
    {
      status: 200,
      body: {
        id: 'msg_1',
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Looking that up…' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_quote', input: { symbol: 'NVDA' } },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    },
    {
      status: 200,
      body: {
        id: 'msg_2',
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'NVDA is at $100, +1.25%.' }],
        usage: { input_tokens: 150, output_tokens: 25 },
      },
    },
  ];
  fetchCalls = [];
  const provider = { url: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514', keyEnv: 'ANTHROPIC_API_KEY' };
  const loopOut = await toolbox.runToolLoop(provider, [{ role: 'user', content: 'How is NVDA doing?' }], 'you are Particle', { userId: 1 });
  assert.strictEqual(loopOut.rounds, 2);
  assert.match(loopOut.finalText, /NVDA is at \$100/);
  assert.strictEqual(loopOut.usage.input, 250);
  assert.strictEqual(loopOut.usage.output, 45);
  // Round 2's request body should have included the tool_result.
  assert.strictEqual(fetchCalls.length, 2);
  const round2Body = JSON.parse(fetchCalls[1].opts.body);
  const lastMsg = round2Body.messages[round2Body.messages.length - 1];
  assert.strictEqual(lastMsg.role, 'user');
  assert.strictEqual(lastMsg.content[0].type, 'tool_result');

  // 8. runToolLoop: model never stops emitting tool_use — loop terminates
  //    at MAX_TOOL_ROUNDS, then runs a closing synthesis.
  fetchScript = [
    // Rounds 1..MAX — all tool_use, never end_turn
    ...Array.from({ length: toolbox.MAX_TOOL_ROUNDS }, (_, i) => ({
      status: 200,
      body: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'lookup_quote', input: { symbol: 'X' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })),
    // Closing synthesis
    {
      status: 200,
      body: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'best-effort answer' }],
        usage: { input_tokens: 20, output_tokens: 10 },
      },
    },
  ];
  fetchCalls = [];
  const runaway = await toolbox.runToolLoop(provider, [{ role: 'user', content: 'loop forever please' }], 'you are Particle', {});
  assert.strictEqual(runaway.rounds, toolbox.MAX_TOOL_ROUNDS,
    `runaway loop must terminate at MAX_TOOL_ROUNDS (${toolbox.MAX_TOOL_ROUNDS})`);
  assert.match(runaway.finalText, /best-effort answer/);

  // 9. runToolLoop: per-request token ceiling trips before MAX_TOOL_ROUNDS
  //    — one fat round burns the entire budget and we stop calling tools.
  fetchScript = [
    {
      status: 200,
      body: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_fat', name: 'lookup_quote', input: { symbol: 'FAT' } }],
        usage: {
          input_tokens:  Math.floor(toolbox.MAX_TOKENS_PER_REQUEST * 0.6),
          output_tokens: Math.floor(toolbox.MAX_TOKENS_PER_REQUEST * 0.5),
        },
      },
    },
    // Closing synthesis after cap hit
    {
      status: 200,
      body: {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'partial data: FAT quote retrieved' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      },
    },
  ];
  fetchCalls = [];
  const capped = await toolbox.runToolLoop(provider, [{ role: 'user', content: 'big query' }], 'you are Particle', { userId: 7 });
  assert.strictEqual(capped.tokenCapHit, true, 'tokenCapHit flag must be set when the request exceeds MAX_TOKENS_PER_REQUEST');
  assert.ok(capped.rounds < toolbox.MAX_TOOL_ROUNDS, 'token cap should trip before MAX_TOOL_ROUNDS');
  assert.match(capped.finalText, /partial data/);
  assert.strictEqual(fetchCalls.length, 2, 'expected 1 loop call + 1 closing synthesis');

  // 10. runToolLoop: model + closing synthesis BOTH return empty text.
  //     The hard safety net must produce a user-facing fallback so the
  //     client never shows "(No response)". This is the incident we just
  //     shipped a fix for.
  fetchScript = [
    // Round 1 — tool_use so we enter the closing synthesis path
    {
      status: 200,
      body: {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_empty', name: 'lookup_quote', input: { symbol: 'EMPTY' } }],
        usage: { input_tokens: 30, output_tokens: 10 },
      },
    },
    // Round 2 — model returns end_turn with zero text blocks (pathological)
    {
      status: 200,
      body: {
        stop_reason: 'end_turn',
        content: [],
        usage: { input_tokens: 20, output_tokens: 0 },
      },
    },
    // Closing synthesis — also empty
    {
      status: 200,
      body: {
        stop_reason: 'end_turn',
        content: [],
        usage: { input_tokens: 15, output_tokens: 0 },
      },
    },
  ];
  fetchCalls = [];
  const empty = await toolbox.runToolLoop(provider, [{ role: 'user', content: 'ask something that yields no answer' }], 'you are Particle', { userId: 9 });
  assert.ok(empty.finalText && empty.finalText.trim().length > 0,
    'safety net must populate finalText when model and synthesis both return empty');
  assert.ok(/couldn.t|rephras|specific/i.test(empty.finalText),
    'fallback should acknowledge the gap in plain language');

  // 11. #217 regression — when the token cap trips mid-thought and the
  //     closing synthesis returns empty, earlier-round text must NOT be
  //     silently discarded. Real world: multi-ticker comparables question
  //     where the model emits narrative in round 1, calls tools in
  //     rounds 2-3, then closing synthesis comes back empty because input
  //     tokens blew past the cap. Before the fix, the user saw a canned
  //     "narrow your question" message despite the model having already
  //     drafted most of the answer.
  fetchScript = [
    // Round 1 — model emits real narrative text AND a tool call
    {
      status: 200,
      body: {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Comparing Hertz, Avis, Localiza, and Movida on market cap and fleet size:' },
          { type: 'tool_use', id: 'toolu_htz', name: 'lookup_quote', input: { symbol: 'HTZ' } },
        ],
        // Burn past the cap in one shot so the loop exits
        usage: {
          input_tokens:  Math.floor(toolbox.MAX_TOKENS_PER_REQUEST * 0.6),
          output_tokens: Math.floor(toolbox.MAX_TOKENS_PER_REQUEST * 0.5),
        },
      },
    },
    // Closing synthesis — comes back empty (cap already tripped, model context
    // got crowded by tool_results, so nothing is emitted)
    {
      status: 200,
      body: {
        stop_reason: 'end_turn',
        content: [],
        usage: { input_tokens: 15, output_tokens: 0 },
      },
    },
  ];
  fetchCalls = [];
  const partial = await toolbox.runToolLoop(
    provider,
    [{ role: 'user', content: 'Hertz Avis Localiza Movida market cap vs fleet' }],
    'you are Particle',
    { userId: 11 },
  );
  assert.strictEqual(partial.tokenCapHit, true, 'setup: tokenCapHit expected');
  assert.ok(partial.finalText && partial.finalText.trim().length > 0,
    '#217: accumulated round-1 text must be surfaced when closing synthesis is empty');
  assert.match(partial.finalText, /Hertz.*Avis.*Localiza.*Movida/i,
    '#217: finalText should contain the model\'s round-1 narrative');
  assert.match(partial.finalText, /Partial answer|token budget/i,
    '#217: partial-answer prefix should be present so user knows it was cut off');

  console.log('aiToolbox.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.test.js FAILED:', err);
  // Restore fetch cache regardless of test outcome
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  process.exit(1);
});
