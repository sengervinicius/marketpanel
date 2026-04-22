/**
 * aiToolbox.compute.test.js — wiring + contract for the `compute` tool.
 *
 * Unit-level coverage of safeMath lives in safeMath.test.js. This file
 * pins the toolbox-level contract:
 *   1. `compute` is registered in TOOLS and HANDLERS.
 *   2. dispatchTool('compute', ...) returns the same shape safeMath does,
 *      wrapped with the echoed expression + variables.
 *   3. Bad input returns { error } (never throws) — dispatchTool must stay
 *      loop-safe.
 *   4. The tool schema advertises the fields the model will actually
 *      need to emit (expression required, variables optional object).
 */

'use strict';

const assert = require('assert');
const path = require('path');

function uncache(abs) { delete require.cache[abs]; }
function stubModule(rel, exports) {
  const abs = require.resolve(path.join('..', '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// Quiet logger + disable cost ledger — standard test-isolation stubs.
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

uncache(require.resolve('../aiToolbox'));
const toolbox = require('../aiToolbox');

(async () => {
  // ── 1. Registration ─────────────────────────────────────────────────
  const schema = toolbox.TOOLS.find(t => t.name === 'compute');
  assert.ok(schema, 'compute must be registered in TOOLS');
  assert.ok(schema.description, 'compute must have a description');
  assert.ok(
    /ratio|arithmetic|math|compute/i.test(schema.description),
    'description must explain when to reach for compute'
  );
  assert.ok(schema.input_schema, 'compute must have input_schema');
  assert.deepStrictEqual(schema.input_schema.required, ['expression']);
  assert.ok(schema.input_schema.properties.expression, 'expression property required');
  assert.ok(schema.input_schema.properties.variables, 'variables property must be declared');
  assert.strictEqual(schema.input_schema.properties.variables.type, 'object');

  assert.ok(toolbox.HANDLERS.compute, 'compute must be in HANDLERS');

  // ── 2. Happy path: basic arithmetic ─────────────────────────────────
  const out1 = await toolbox.dispatchTool('compute', {
    expression: '1 + 1',
  });
  assert.ok(!out1.error, `simple compute must not error: ${out1.error}`);
  assert.strictEqual(out1.result, 2);
  assert.strictEqual(out1.expression, '1 + 1');

  // ── 3. With variables — the canonical ratio path ────────────────────
  const out2 = await toolbox.dispatchTool('compute', {
    expression: 'mc / fleet',
    variables: { mc: 5.5e9, fleet: 500000 },
  });
  assert.ok(!out2.error, `ratio compute must not error: ${out2.error}`);
  assert.strictEqual(out2.result, 11000);
  assert.strictEqual(out2.expression, 'mc / fleet');
  assert.deepStrictEqual(out2.variables, { mc: 5.5e9, fleet: 500000 });

  // ── 4. Percentage change — another common pattern ──────────────────
  const out3 = await toolbox.dispatchTool('compute', {
    expression: '(new_px - old_px) / old_px * 100',
    variables: { new_px: 110, old_px: 100 },
  });
  assert.ok(!out3.error);
  assert.ok(Math.abs(out3.result - 10) < 1e-9, `% change should be 10, got ${out3.result}`);

  // ── 5. Function call ────────────────────────────────────────────────
  const out4 = await toolbox.dispatchTool('compute', {
    expression: 'round(a / b, 2)',
    variables: { a: 1.23456, b: 1 },
  });
  assert.ok(!out4.error);
  assert.strictEqual(out4.result, 1.23);

  // ── 6. Error paths — dispatcher must return, not throw ─────────────
  const out5 = await toolbox.dispatchTool('compute', { expression: '1 / 0' });
  assert.ok(out5.error, 'division by zero must return error');
  assert.match(out5.error, /division by zero/i);
  // echoes the bad expression so the model can see what it tried
  assert.strictEqual(out5.expression, '1 / 0');

  const out6 = await toolbox.dispatchTool('compute', { expression: 'foo + 1' });
  assert.ok(out6.error, 'unknown identifier must return error');

  const out7 = await toolbox.dispatchTool('compute', {});
  assert.ok(out7.error, 'missing expression must return error');

  const out8 = await toolbox.dispatchTool('compute', { expression: '' });
  assert.ok(out8.error, 'empty expression must return error');

  // ── 7. Injection defence — nothing that looks like JS runs ─────────
  const inj = await toolbox.dispatchTool('compute', {
    expression: 'constructor("return process")()',
  });
  assert.ok(inj.error, 'injection attempt must error');

  const inj2 = await toolbox.dispatchTool('compute', {
    expression: 'require("fs")',
  });
  assert.ok(inj2.error, 'require-like syntax must error');

  // ── 8. Large numbers survive round-trip (the original incident) ────
  const big = await toolbox.dispatchTool('compute', {
    expression: 'htz / rent3',
    variables: { htz: 5.5e9, rent3: 1.2e10 },
  });
  assert.ok(!big.error);
  assert.ok(Math.abs(big.result - (5.5e9 / 1.2e10)) < 1e-12);

  console.log('aiToolbox.compute.test.js OK');
})().catch(err => {
  console.error('aiToolbox.compute.test FAILED:', err);
  process.exit(1);
});
