/**
 * agents/runtime.js — R0.3 persona-agent runtime.
 *
 * Invocation pattern:
 *
 *   const runtime = require('server/agents/runtime');
 *   const out = await runtime.run({
 *     personaId: 'buffett',
 *     question:  'Is PETR4 attractive today?',
 *     ctx:       { userId: 123 },
 *     llm:       require('server/llm').getAdapter('anthropic'),
 *     registry:  require('server/mcp').registry,
 *     model:     'claude-sonnet-4-20250514',
 *   });
 *
 * The llm + registry are passed in (dependency injection) so tests can
 * stub them without hitting the network or the real aiToolbox.
 *
 * Output shape:
 *   {
 *     persona:          { id, name, one_liner, method_doc_url },
 *     summary:          string   // narrative verdict
 *     rubric_score:     number   // composite 0–10 (weighted mean of dimension_scores)
 *     dimension_scores: [{ name, weight, score }]
 *     citations:        [{ source }]
 *     raw:              string   // full model text (unparsed)
 *     usage:            { input_tokens, output_tokens }
 *   }
 *
 * Parsing: the runtime asks the model for a rubric block in a
 * predictable fence. If the fence is missing we still return a valid
 * object with an empty dimension_scores array — callers must tolerate
 * that. This prevents a parsing failure from breaking the chat turn.
 */

'use strict';

const personas = require('./personas');

const RUBRIC_FENCE_OPEN  = '<rubric>';
const RUBRIC_FENCE_CLOSE = '</rubric>';

function _composeSystemPrompt(persona, registry) {
  // Expose the subset of MCP tools the persona is allowed to call —
  // by name + description — so the model picks from that menu rather
  // than the full 22-tool list.
  const toolLines = [];
  if (registry) {
    for (const name of persona.required_tools) {
      const tool = registry.get(name);
      if (!tool) continue;
      toolLines.push(`- ${tool.name} (${tool.group}): ${tool.description.split('\n')[0]}`);
    }
  }
  const rubricLines = persona.rubric.dimensions.map(
    d => `- ${d.name} (weight ${d.weight}): ${d.ask}`,
  );

  return [
    persona.system_prompt,
    '',
    'Tools available to you:',
    ...(toolLines.length ? toolLines : ['  (tool registry unavailable in this turn)']),
    '',
    'Your rubric (score each dimension 0\u201310, weighted composite):',
    ...rubricLines,
    '',
    'When you finish, append your rubric as a JSON block between the',
    `sentinels ${RUBRIC_FENCE_OPEN} and ${RUBRIC_FENCE_CLOSE}:`,
    `${RUBRIC_FENCE_OPEN}`,
    '{"dimension_scores":[{"name":"<dim>","score":<0-10>}, ...],',
    ' "citations":[{"source":"<tool_name>"}, ...]}',
    `${RUBRIC_FENCE_CLOSE}`,
    '',
    'The chat UI renders the narrative verdict above the rubric block.',
    'Do not include personally identifying information in your response.',
  ].join('\n');
}

function _parseResponse(rawText, persona) {
  const raw = String(rawText || '');
  const start = raw.indexOf(RUBRIC_FENCE_OPEN);
  const end   = raw.indexOf(RUBRIC_FENCE_CLOSE, start + 1);
  let narrative = raw.trim();
  let dimensionScores = [];
  let citations = [];
  let composite = null;

  if (start >= 0 && end > start) {
    narrative = raw.slice(0, start).trim();
    const jsonBlob = raw.slice(start + RUBRIC_FENCE_OPEN.length, end).trim();
    try {
      const parsed = JSON.parse(jsonBlob);
      if (Array.isArray(parsed.dimension_scores)) dimensionScores = parsed.dimension_scores;
      if (Array.isArray(parsed.citations))        citations       = parsed.citations;
    } catch (_) {
      // Bad JSON — swallow, keep dimension_scores empty.
    }
  }

  // Align dimension_scores to persona.rubric.dimensions order + weights.
  const byName = Object.fromEntries(
    dimensionScores
      .filter(d => d && typeof d.name === 'string')
      .map(d => [d.name, Number(d.score)]),
  );
  const aligned = persona.rubric.dimensions.map(dim => ({
    name: dim.name,
    weight: dim.weight,
    score: Number.isFinite(byName[dim.name]) ? Math.max(0, Math.min(10, byName[dim.name])) : null,
  }));

  // Composite — weighted mean of non-null scores; if any score is null,
  // omit the composite rather than falsely average.
  const allScored = aligned.every(d => d.score != null);
  if (allScored) {
    composite = aligned.reduce((a, d) => a + d.score * d.weight, 0);
    composite = Math.round(composite * 10) / 10;
  }

  return { narrative, dimensionScores: aligned, citations, composite };
}

async function run({ personaId, question, ctx = {}, llm, registry, model, max_tokens = 2048 }) {
  const persona = personas.get(personaId);
  if (!persona) {
    return {
      persona: null,
      summary: '',
      rubric_score: null,
      dimension_scores: [],
      citations: [],
      raw: '',
      usage: { input_tokens: 0, output_tokens: 0 },
      error: `unknown persona: ${personaId}`,
    };
  }
  if (!llm || typeof llm.chatJson !== 'function') {
    throw new Error('agents.runtime.run: `llm` must be an adapter with chatJson()');
  }

  const system = _composeSystemPrompt(persona, registry);
  const messages = [{ role: 'user', content: String(question || '').trim() || '(no question supplied)' }];

  const reply = await llm.chatJson({ model, system, messages, max_tokens });
  const rawText = Array.isArray(reply.content)
    ? reply.content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n')
    : '';

  const { narrative, dimensionScores, citations, composite } = _parseResponse(rawText, persona);

  return {
    persona: {
      id: persona.id,
      name: persona.name,
      one_liner: persona.one_liner,
      method_doc_url: persona.method_doc_url,
    },
    summary: narrative,
    rubric_score: composite,
    dimension_scores: dimensionScores,
    citations,
    raw: rawText,
    usage: reply.usage || { input_tokens: 0, output_tokens: 0 },
    error: reply.stop_reason === 'error' ? (reply.error || 'llm error') : null,
  };
}

module.exports = { run, _composeSystemPrompt, _parseResponse };
