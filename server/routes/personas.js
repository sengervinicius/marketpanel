/**
 * routes/personas.js — R0.3 persona-agent HTTP surface.
 *
 * Mounted at /api/personas. All routes require auth + active subscription.
 * Every handler is 404-gated behind PERSONA_AGENTS_V1 — if the flag is
 * off for the caller the route replies with a 404 so the client UI
 * simply doesn't show the persona picker. No information leak on
 * probes, and no code-level behaviour change for users who haven't
 * been flipped on.
 *
 *   GET  /               → list available personas (public summary)
 *   POST /:id/ask        → invoke the persona runtime
 *       body: { question: string }
 *       response: { persona, summary, rubric_score, dimension_scores,
 *                   citations, usage, error? }
 *
 * Cost guard: we route persona asks through the multi-LLM adapter at
 * server/llm/getAdapter. Provider defaults to 'anthropic'; users with
 * llm_provider_override='ollama' (once R0.2-b lands) will be routed
 * to their local tenant. Today every call uses Anthropic.
 */

'use strict';

const express = require('express');
const router = express.Router();

const personas = require('../agents/personas');
const runtime = require('../agents/runtime');
const mcp = require('../mcp');
const llm = require('../llm/adapter');
const flags = require('../services/featureFlags');
const logger = require('../utils/logger');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_PROVIDER = 'anthropic';

function userIdFromReq(req) {
  return req.user?.id || req.userId || null;
}

async function enabledFor(req) {
  try {
    return await flags.isOn('PERSONA_AGENTS_V1', {
      userId: userIdFromReq(req),
      tier: req.user?.tier,
      email: req.user?.email,
    });
  } catch (_) {
    return false; // fail closed
  }
}

// ── 404 gate ─────────────────────────────────────────────────────────────
router.use(async (req, res, next) => {
  const on = await enabledFor(req);
  if (!on) {
    return res.status(404).json({ ok: false, error: 'not_found' });
  }
  next();
});

// ── List personas ────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({ ok: true, personas: personas.list() });
});

// ── Ask a persona ────────────────────────────────────────────────────────
router.post('/:id/ask', async (req, res) => {
  const personaId = String(req.params.id || '').toLowerCase();
  const persona = personas.get(personaId);
  if (!persona) {
    return res.status(404).json({ ok: false, error: 'unknown_persona' });
  }
  const question = (req.body && typeof req.body.question === 'string') ? req.body.question.trim() : '';
  if (!question) {
    return res.status(400).json({ ok: false, error: 'question_required' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ ok: false, error: 'question_too_long', max: 2000 });
  }

  try {
    const adapter = llm.getAdapter(DEFAULT_PROVIDER);
    const out = await runtime.run({
      personaId,
      question,
      ctx: { userId: userIdFromReq(req) },
      llm: adapter,
      registry: mcp.registry,
      model: DEFAULT_MODEL,
      max_tokens: 2048,
    });
    if (out.error) {
      logger.warn('personas', 'run error', { personaId, error: out.error });
    }
    res.json({ ok: true, response: out });
  } catch (err) {
    logger.error('personas', 'ask failed', { personaId, error: err.message });
    res.status(500).json({ ok: false, error: 'persona_failed', message: err.message });
  }
});

module.exports = router;
