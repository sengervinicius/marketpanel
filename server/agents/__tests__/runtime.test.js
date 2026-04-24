/**
 * agents/__tests__/runtime.test.js — R0.3 persona runtime tests.
 *
 * Covered:
 *   - All six personas load, validate, and expose publicSummary().
 *   - Every rubric weights to 1.0 (±0.01).
 *   - Every required_tool exists in the default MCP registry (so a
 *     persona can't reference a phantom tool).
 *   - runtime.run() composes a system prompt that includes the
 *     persona's system_prompt + the matching tool lines.
 *   - runtime.run() parses the <rubric> fence into aligned scores.
 *   - Missing / malformed fence falls through gracefully.
 *   - Every method_doc_url is a public reference.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const personas = require('../personas');
const runtime  = require('../runtime');
const mcp      = require('../../mcp');

const ALL_IDS = ['buffett', 'graham', 'lynch', 'munger', 'klarman', 'marks'];

describe('personas catalogue', () => {
  it('exposes the six R0.3 personas', () => {
    const ids = personas.ALL.map(p => p.id);
    for (const expected of ALL_IDS) {
      assert.ok(ids.includes(expected), `missing persona: ${expected}`);
    }
    assert.equal(personas.ALL.length, 6);
  });

  it('every persona\u2019s rubric weights sum to 1.0', () => {
    for (const p of personas.ALL) {
      const sum = p.rubric.dimensions.reduce((a, d) => a + Number(d.weight), 0);
      assert.ok(Math.abs(sum - 1) < 0.01, `${p.id} weights sum to ${sum}`);
    }
  });

  it('every required_tool resolves in the default MCP registry', () => {
    const registry = mcp.registry;
    for (const p of personas.ALL) {
      for (const name of p.required_tools) {
        assert.ok(registry.get(name), `${p.id} references phantom tool: ${name}`);
      }
    }
  });

  it('every persona has a public method_doc_url', () => {
    for (const p of personas.ALL) {
      assert.match(p.method_doc_url, /^https?:\/\//, `${p.id} has non-URL method_doc_url`);
    }
  });

  it('publicSummary hides system_prompt', () => {
    const summary = personas.list()[0];
    assert.equal(summary.system_prompt, undefined);
    assert.ok(summary.one_liner && summary.one_liner.length > 0);
  });
});

describe('runtime._composeSystemPrompt', () => {
  it('includes the persona system prompt + matching tool lines', () => {
    const buffett = personas.get('buffett');
    const prompt = runtime._composeSystemPrompt(buffett, mcp.registry);
    assert.ok(prompt.includes(buffett.system_prompt.slice(0, 80)));
    assert.ok(prompt.includes('lookup_quote'));
    assert.ok(prompt.includes('<rubric>'));
  });

  it('handles missing registry gracefully', () => {
    const buffett = personas.get('buffett');
    const prompt = runtime._composeSystemPrompt(buffett, null);
    assert.ok(prompt.includes('tool registry unavailable'));
  });
});

describe('runtime._parseResponse', () => {
  it('parses the rubric fence and aligns scores to weights', () => {
    const persona = personas.get('graham');
    const scores = persona.rubric.dimensions.map(d => ({ name: d.name, score: 7 }));
    const raw = [
      'Verdict: moderate margin of safety, passes six of seven defensive criteria.',
      '<rubric>',
      JSON.stringify({ dimension_scores: scores, citations: [{ source: 'lookup_quote' }] }),
      '</rubric>',
    ].join('\n');
    const out = runtime._parseResponse(raw, persona);
    assert.equal(out.dimensionScores.length, persona.rubric.dimensions.length);
    for (const d of out.dimensionScores) assert.equal(d.score, 7);
    assert.equal(out.composite, 7);
    assert.equal(out.citations[0].source, 'lookup_quote');
  });

  it('swallows malformed JSON and returns empty rubric', () => {
    const persona = personas.get('lynch');
    const raw = 'Verdict: stalwart.\n<rubric>NOT JSON</rubric>';
    const out = runtime._parseResponse(raw, persona);
    assert.equal(out.composite, null);
    for (const d of out.dimensionScores) assert.equal(d.score, null);
  });

  it('no fence at all → narrative is the full text; rubric empty', () => {
    const persona = personas.get('marks');
    const raw = 'Plain text with no fence. Still readable.';
    const out = runtime._parseResponse(raw, persona);
    assert.ok(out.narrative.startsWith('Plain text'));
    assert.equal(out.composite, null);
  });
});

describe('runtime.run with stub LLM', () => {
  function makeStubLlm(text) {
    return {
      name: 'stub',
      chatJson: async () => ({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 100, output_tokens: 50 },
        stop_reason: 'end_turn',
        provider: 'stub',
        model: 'stub-model',
      }),
    };
  }

  it('wires persona + rubric end-to-end', async () => {
    const persona = personas.get('munger');
    const scores = persona.rubric.dimensions.map(d => ({ name: d.name, score: 6 }));
    const fakeReply = [
      'Psychological traps: recency bias, authority bias.',
      'Verdict: patience.',
      '<rubric>' + JSON.stringify({ dimension_scores: scores, citations: [] }) + '</rubric>',
    ].join('\n');
    const out = await runtime.run({
      personaId: 'munger',
      question: 'Is the AI bubble a compelling short?',
      llm: makeStubLlm(fakeReply),
      registry: mcp.registry,
      model: 'stub',
    });
    assert.equal(out.persona.id, 'munger');
    assert.ok(out.summary.includes('recency bias'));
    assert.equal(out.rubric_score, 6);
    assert.equal(out.error, null);
  });

  it('unknown persona id returns error envelope, no throw', async () => {
    const out = await runtime.run({
      personaId: 'soros',
      question: 'x?',
      llm: makeStubLlm('...'),
      registry: mcp.registry,
      model: 'stub',
    });
    assert.equal(out.persona, null);
    assert.match(out.error, /unknown persona/);
  });

  it('propagates llm error as a non-throwing envelope', async () => {
    const errLlm = {
      name: 'err',
      chatJson: async () => ({
        content: [{ type: 'text', text: '' }],
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: 'error',
        provider: 'err', model: 'x',
        error: 'upstream 500',
      }),
    };
    const out = await runtime.run({
      personaId: 'klarman',
      question: 'anything?',
      llm: errLlm,
      registry: mcp.registry,
      model: 'x',
    });
    assert.match(out.error, /upstream 500/);
  });
});
