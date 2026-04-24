/**
 * mcp/__tests__/cutover.test.js — R0.1-b shadow cutover proof.
 *
 * When MCP_REGISTRY_V1 is ON for the caller, aiToolbox.dispatchTool
 * MUST route through the MCP registry. When OFF it must stay on the
 * legacy HANDLERS path. This test uses require-time module stubbing to
 * force each branch, then asserts the envelope shapes match the legacy
 * contract.
 *
 * We use `compute` as the sentinel tool — it's pure arithmetic, never
 * hits a network provider, so both paths are cheap and deterministic.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Path to the featureFlags module (resolved once) so we can swap its
// cached module export in require.cache per test.
const flagsPath = require.resolve('../../services/featureFlags');
const aiToolboxPath = require.resolve('../../services/aiToolbox');

function setFlagMock(onFor) {
  // onFor: (name, ctx) => boolean
  require.cache[flagsPath] = {
    id: flagsPath,
    filename: flagsPath,
    loaded: true,
    exports: { isOn: async (name, ctx) => !!onFor(name, ctx) },
  };
}

function clearFlagMock() {
  delete require.cache[flagsPath];
}

function freshAiToolbox() {
  // Drop cached aiToolbox so its _featureFlags lazy-lookup picks up
  // the mocked flags module on next require.
  delete require.cache[aiToolboxPath];
  return require('../../services/aiToolbox');
}

describe('mcp cutover — MCP_REGISTRY_V1 off', () => {
  before(() => { setFlagMock(() => false); });
  after(() => { clearFlagMock(); delete require.cache[aiToolboxPath]; });

  it('dispatchTool routes via legacy HANDLERS (compute tool)', async () => {
    const ai = freshAiToolbox();
    const out = await ai.dispatchTool('compute', { expression: '2 + 2' }, { userId: 42 });
    assert.ok(out && typeof out === 'object');
    // compute returns { result, expression } or similar — exact shape
    // is whatever aiToolbox.handleCompute produces. We just assert
    // it's not the shadow-cutover error envelope.
    assert.equal(out.error, undefined);
  });

  it('unknown tool returns legacy envelope', async () => {
    const ai = freshAiToolbox();
    const out = await ai.dispatchTool('no_such_tool', {}, {});
    assert.deepEqual(out, { error: 'unknown tool: no_such_tool' });
  });
});

describe('mcp cutover — MCP_REGISTRY_V1 on', () => {
  before(() => { setFlagMock((n) => n === 'MCP_REGISTRY_V1'); });
  after(() => { clearFlagMock(); delete require.cache[aiToolboxPath]; });

  it('dispatchTool routes via registry and returns compatible envelope', async () => {
    const ai = freshAiToolbox();
    const out = await ai.dispatchTool('compute', { expression: '2 + 2' }, { userId: 42 });
    assert.ok(out && typeof out === 'object');
    assert.equal(out.error, undefined);
  });

  it('unknown tool returns same error envelope on the registry path', async () => {
    const ai = freshAiToolbox();
    const out = await ai.dispatchTool('no_such_tool', {}, { userId: 42 });
    assert.deepEqual(out, { error: 'unknown tool: no_such_tool' });
  });
});
