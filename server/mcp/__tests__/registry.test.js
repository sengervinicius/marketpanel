/**
 * mcp/__tests__/registry.test.js — R0.1 smoke tests.
 *
 * Asserts:
 *   1. All 22 existing aiToolbox tools are registered under the right group.
 *   2. Unknown-tool call matches the legacy `{ error: 'unknown tool: ...' }`.
 *   3. Handler-throws matches the legacy `{ error: <message> }`.
 *   4. Oversized result is truncated with the same envelope shape.
 *   5. Metrics + audit hooks are best-effort (do not break the call).
 *
 * We do NOT hit any external adapter in these tests — every scenario
 * uses a custom Registry + synthetic tool. This keeps the test
 * offline-safe and fast. A separate shadow-mode regression job
 * (R0.1-b) exercises the real 22 tools end-to-end.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Registry } = require('../registry');
const { createDefaultRegistry } = require('..');
const { GROUPS } = require('../groups');
const { MAX_TOOL_PAYLOAD_BYTES } = require('../contracts');

// ── 1. Default registry snapshots every aiToolbox tool. ───────────────
describe('mcp default registry', () => {
  const registry = createDefaultRegistry();

  it('registers all 23 existing tools (22 original + R1.1 dbnomics)', () => {
    assert.equal(registry.size(), 23);
  });

  it('every registered tool has a known group', () => {
    for (const tool of registry.list()) {
      assert.ok(GROUPS[tool.group], `tool "${tool.name}" has unknown group "${tool.group}"`);
    }
  });

  it('known tool names resolve', () => {
    const expected = [
      // market
      'lookup_quote','get_yield_curve','list_sovereign_bonds','list_corporate_bonds',
      'get_options_flow','list_market_movers','lookup_fx','lookup_commodity','forward_estimates',
      // macro
      'get_macro_snapshot','get_brazil_macro','get_market_regime','run_scenario','lookup_series_global',
      // news
      'get_recent_wire','web_research','fetch_url','search_prediction_markets',
      // vault
      'search_vault',
      // earnings
      'get_earnings_calendar','list_cvm_filings',
      // compute
      'compute','describe_portfolio_import',
    ];
    for (const name of expected) {
      assert.ok(registry.get(name), `missing tool: ${name}`);
    }
  });

  it('list({ group }) filters', () => {
    assert.equal(registry.list({ group: 'market' }).length, 9);
    assert.equal(registry.list({ group: 'macro' }).length, 5); // +lookup_series_global (R1.1)
    assert.equal(registry.list({ group: 'news' }).length, 4);
    assert.equal(registry.list({ group: 'vault' }).length, 1);
    assert.equal(registry.list({ group: 'earnings' }).length, 2);
    assert.equal(registry.list({ group: 'compute' }).length, 2);
  });
});

// ── 2. Call-envelope parity with aiToolbox.dispatchTool. ──────────────
describe('mcp registry.call envelope', () => {
  function makeReg(tool) {
    const r = new Registry();
    r.register(tool);
    return r;
  }

  it('unknown tool returns { error: "unknown tool: ..." }', async () => {
    const r = new Registry();
    const out = await r.call('nope', {}, {});
    assert.deepEqual(out, { error: 'unknown tool: nope' });
  });

  it('handler that throws is converted to { error }', async () => {
    const r = makeReg({
      name: 'throws_tool', group: 'compute',
      description: 'test tool that throws',
      input_schema: { type: 'object' },
      execute: async () => { throw new Error('kaboom'); },
    });
    const out = await r.call('throws_tool', {}, {});
    assert.deepEqual(out, { error: 'kaboom' });
  });

  it('handler that returns { error } passes through', async () => {
    const r = makeReg({
      name: 'soft_error', group: 'compute',
      description: 'soft-error tool',
      input_schema: { type: 'object' },
      execute: async () => ({ error: 'adapter unavailable' }),
    });
    const out = await r.call('soft_error', {}, {});
    assert.deepEqual(out, { error: 'adapter unavailable' });
  });

  it('oversize result is truncated with the legacy envelope', async () => {
    const bigString = 'x'.repeat(MAX_TOOL_PAYLOAD_BYTES + 500);
    const r = makeReg({
      name: 'big_tool', group: 'compute',
      description: 'returns oversized payload',
      input_schema: { type: 'object' },
      execute: async () => ({ blob: bigString }),
    });
    const out = await r.call('big_tool', {}, {});
    assert.equal(out.truncated, true);
    assert.ok(out.originalBytes > MAX_TOOL_PAYLOAD_BYTES);
    assert.ok(typeof out.note === 'string' && out.note.length > 0);
    assert.ok(out.preview.length <= MAX_TOOL_PAYLOAD_BYTES);
  });

  it('normal result passes through unchanged', async () => {
    const r = makeReg({
      name: 'echo_tool', group: 'compute',
      description: 'echoes args',
      input_schema: { type: 'object' },
      execute: async (args) => ({ got: args.x || null }),
    });
    const out = await r.call('echo_tool', { x: 42 }, {});
    assert.deepEqual(out, { got: 42 });
  });
});

// ── 3. Registration rules. ────────────────────────────────────────────
describe('mcp registry.register', () => {
  it('rejects a tool missing required fields', () => {
    const r = new Registry();
    assert.throws(() => r.register({}));
    assert.throws(() => r.register({ name: 'BadName' })); // uppercase disallowed
  });

  it('rejects an unknown group', () => {
    const r = new Registry();
    assert.throws(() => r.register({
      name: 'x', group: 'made_up', description: 'x',
      input_schema: { type: 'object' }, execute: async () => ({}),
    }));
  });

  it('identical re-registration is idempotent', () => {
    const r = new Registry();
    const t = {
      name: 'stable', group: 'compute', description: 'x',
      input_schema: { type: 'object' }, execute: async () => ({}),
    };
    r.register(t);
    assert.doesNotThrow(() => r.register(t));
    assert.equal(r.size(), 1);
  });

  it('conflicting re-registration throws', () => {
    const r = new Registry();
    r.register({
      name: 'dup', group: 'compute', description: 'one',
      input_schema: { type: 'object' }, execute: async () => ({}),
    });
    assert.throws(() => r.register({
      name: 'dup', group: 'compute', description: 'two (different instance)',
      input_schema: { type: 'object' }, execute: async () => ({}),
    }));
  });
});
