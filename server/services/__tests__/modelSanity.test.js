/**
 * modelSanity.test.js — guardrail against stale Claude model IDs.
 *
 * Background: on 2026-07 the Particle chat blanked ("(No response)") because
 * the primary model string `claude-sonnet-4-20250514` had been RETIRED on the
 * Anthropic API — the retired ID yields zero tokens / HTTP 404. This test
 * fails CI the moment any Claude model string in the routing/pricing layer
 * drifts outside the canonical allowlist, so a future silent rotation is
 * caught before it reaches prod.
 *
 * It checks two things:
 *   1. The live exports of modelRouter (MODELS + PROVIDERS) and aiCostLedger
 *      (MODEL_PRICING) — every `claude-*` value must be canonical.
 *   2. A static scan of the two source files for any `claude-<...>` literal
 *      (catches strings that never make it into an export, e.g. inline
 *      fetch bodies or comments referencing a stale ID).
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The ONLY Claude model strings allowed to appear anywhere in the routing /
// pricing layer. Keep in lockstep with modelRouter.MODELS.
const ALLOWLIST = new Set([
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-8',
]);

const modelRouter = require('../modelRouter');
const aiCostLedger = require('../aiCostLedger');

// Collect every claude-* string reachable through the live exports.
function claudeStringsFromValue(v, acc) {
  if (typeof v === 'string') {
    if (v.startsWith('claude-')) acc.add(v);
  } else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (typeof k === 'string' && k.startsWith('claude-')) acc.add(k); // object keys (pricing map)
      claudeStringsFromValue(v[k], acc);
    }
  }
  return acc;
}

describe('model sanity — no stale Claude model IDs', () => {
  it('modelRouter.MODELS contains only canonical strings', () => {
    for (const [name, id] of Object.entries(modelRouter.MODELS)) {
      assert.ok(ALLOWLIST.has(id), `modelRouter.MODELS.${name} = "${id}" is not in the canonical allowlist`);
    }
  });

  it('modelRouter.PROVIDERS Anthropic models are canonical', () => {
    for (const [key, p] of Object.entries(modelRouter.PROVIDERS)) {
      if (p && typeof p.url === 'string' && p.url.includes('anthropic')) {
        assert.ok(ALLOWLIST.has(p.model), `PROVIDERS.${key}.model = "${p.model}" is not canonical`);
      }
    }
  });

  it('aiCostLedger.MODEL_PRICING has only canonical claude-* keys', () => {
    const claudeKeys = Object.keys(aiCostLedger.MODEL_PRICING).filter(k => k.startsWith('claude-'));
    for (const k of claudeKeys) {
      assert.ok(ALLOWLIST.has(k), `MODEL_PRICING key "${k}" is not in the canonical allowlist`);
    }
  });

  it('live exports contain no non-canonical claude-* string', () => {
    const found = new Set();
    claudeStringsFromValue(modelRouter.MODELS, found);
    claudeStringsFromValue(modelRouter.PROVIDERS, found);
    claudeStringsFromValue(aiCostLedger.MODEL_PRICING, found);
    for (const s of found) {
      assert.ok(ALLOWLIST.has(s), `exported claude string "${s}" is not canonical`);
    }
  });

  it('static source scan: no stale claude-* literal in modelRouter/aiCostLedger', () => {
    const files = ['modelRouter.js', 'aiCostLedger.js'].map(f => path.join(__dirname, '..', f));
    const re = /claude-[a-z0-9.-]+/g;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const matches = src.match(re) || [];
      for (const m of matches) {
        assert.ok(ALLOWLIST.has(m), `${path.basename(file)} references stale/non-canonical model id "${m}"`);
      }
    }
  });
});
