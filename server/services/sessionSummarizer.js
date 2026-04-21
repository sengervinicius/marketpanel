/**
 * services/sessionSummarizer.js — P2.5 deeper session memory.
 *
 * What this does
 * --------------
 * The chat route used to ship the last 20 turns (≤ 3 000 chars each,
 * ≈ 12 K tokens worst case) straight to the model. That's long enough
 * for a morning check-in but falls off a cliff on the longer thematic
 * threads — the user restates "as I was saying, the Brazil thesis" and
 * the model has already forgotten the thesis.
 *
 * We now keep the same turn ceiling higher (40 turns × 4 500 chars)
 * but BEFORE we hit the model we run `prepareConversationHistory` to:
 *
 *   1. Keep the most recent `keepRecent` turns verbatim.
 *   2. If the total character budget is above `summariseThreshold`,
 *      take everything older than that tail, collapse it into a single
 *      synopsis turn using Haiku, and prepend it as a system-style
 *      message with a clear `[EARLIER IN THIS THREAD]` marker so the
 *      main model knows it's reading a summary not raw text.
 *
 * Graceful degradation
 * --------------------
 * Haiku can be down, slow, or rate-limited. If the summary call fails
 * or times out within `summaryTimeoutMs`, we fall back to a
 * deterministic truncation: the oldest turns are dropped and the tail
 * is returned. The model still gets something coherent, just shorter.
 *
 * The function is pure-ish: the caller supplies the Haiku fetcher
 * (`summariseFn`) so tests don't hit the network. In production the
 * caller points it at the real Anthropic messages endpoint.
 */

'use strict';

const DEFAULT_SUMMARY_TIMEOUT_MS = 2500;
const DEFAULT_KEEP_RECENT = 10;
const DEFAULT_SUMMARISE_CHARS = 40_000; // ~10K tokens of tail — we keep the recent turns verbatim
const DEFAULT_SYNOPSIS_MAX_CHARS = 1800;

// Cap each message before handing it to the model. Used both by the
// chat route (pre-summariser) and by the summariser itself on its
// inputs so a pathological single message can't blow the budget.
function truncateContent(text, maxChars) {
  const s = typeof text === 'string' ? text : '';
  if (!maxChars || s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '… [truncated]';
}

// Total char budget across the history (cheap proxy for tokens; a
// proper tokenizer here would cost more than it's worth).
function totalChars(messages) {
  let n = 0;
  for (const m of messages || []) {
    if (m && typeof m.content === 'string') n += m.content.length;
  }
  return n;
}

// Format the older-history block into a single prompt the summariser
// can digest. We prefix each turn with its role to preserve the
// dialogue structure Haiku needs to produce a faithful synopsis.
function buildSummariserPrompt(older) {
  const lines = [];
  for (const m of older) {
    const role = m.role === 'assistant' ? 'Assistant' :
                 m.role === 'system'    ? 'System'    : 'User';
    const content = typeof m.content === 'string' ? m.content : '';
    lines.push(`${role}: ${content}`);
  }
  return (
    'You are compressing an earlier portion of a user\'s chat with a ' +
    'financial AI assistant into a short synopsis that will be ' +
    'prepended back to the same chat so the assistant can keep ' +
    'context. Preserve:\n' +
    '- The user\'s stated investment theses, positions, and constraints.\n' +
    '- Any concrete tickers, dates, prices, or figures that the ' +
    'recent turns may refer back to.\n' +
    '- Open questions the user asked that were not fully answered.\n' +
    '- Stated preferences about tone / language / output format.\n\n' +
    'Drop small talk and any duplicated numbers. Write tight prose in ' +
    'one paragraph, no bullets. ' +
    `Keep it under ${DEFAULT_SYNOPSIS_MAX_CHARS} characters.\n\n` +
    '=== EARLIER CONVERSATION ===\n' +
    lines.join('\n')
  );
}

// Deterministic fallback when Haiku is unavailable — drop the older
// block entirely and return just the tail. The caller's `keepRecent`
// window is preserved so the user never sees a hard context cutoff in
// the middle of their own sentence.
function fallbackTruncate(tail) {
  return tail;
}

/**
 * prepareConversationHistory
 *
 * @param {Array<{role,content}>} messages       Full chat history (oldest first).
 * @param {Object} opts
 * @param {Function} [opts.summariseFn]          Async (promptString) => string.
 *                                               When omitted, the function always
 *                                               falls back to truncation.
 * @param {number}   [opts.keepRecent]           Turns kept verbatim at the tail.
 * @param {number}   [opts.summariseThreshold]   Char budget at which we summarise.
 * @param {number}   [opts.summaryTimeoutMs]     Ms to wait on summariseFn.
 * @param {number}   [opts.maxMsgChars]          Per-message cap BEFORE summary.
 *
 * @returns {Promise<{ messages: Array, summarised: boolean, reason?: string }>}
 */
async function prepareConversationHistory(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const keepRecent          = Number.isInteger(opts.keepRecent)         ? opts.keepRecent         : DEFAULT_KEEP_RECENT;
  const summariseThreshold  = Number.isInteger(opts.summariseThreshold) ? opts.summariseThreshold : DEFAULT_SUMMARISE_CHARS;
  const summaryTimeoutMs    = Number.isInteger(opts.summaryTimeoutMs)   ? opts.summaryTimeoutMs   : DEFAULT_SUMMARY_TIMEOUT_MS;
  const maxMsgChars         = Number.isInteger(opts.maxMsgChars)        ? opts.maxMsgChars        : 4500;
  const summariseFn         = typeof opts.summariseFn === 'function' ? opts.summariseFn : null;

  // Normalise: drop null / empty / non-user/assistant rows and truncate
  // pathologically long messages before we even measure the budget.
  const cleaned = list
    .filter(m => m && m.role && typeof m.content === 'string' && m.content.trim().length > 0)
    .map(m => ({ ...m, content: truncateContent(m.content, maxMsgChars) }));

  if (cleaned.length <= keepRecent) {
    return { messages: cleaned, summarised: false };
  }

  const budget = totalChars(cleaned);
  if (budget <= summariseThreshold) {
    return { messages: cleaned, summarised: false };
  }

  // Split into (older, tail). The tail is ALWAYS kept verbatim.
  const tail  = cleaned.slice(-keepRecent);
  const older = cleaned.slice(0, -keepRecent);
  if (older.length === 0) {
    return { messages: tail, summarised: false };
  }

  if (!summariseFn) {
    return {
      messages: fallbackTruncate(tail),
      summarised: false,
      reason: 'no summariseFn supplied',
    };
  }

  // Race the summariser against a timeout. The timeout doesn't cancel
  // the upstream call — we just stop waiting and fall back. Any actual
  // errors (network, rate-limit, parse) are caught too.
  const prompt = buildSummariserPrompt(older);
  let synopsis = null;
  let failReason = null;

  try {
    synopsis = await Promise.race([
      Promise.resolve().then(() => summariseFn(prompt)),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('summary timeout')), summaryTimeoutMs),
      ),
    ]);
  } catch (e) {
    failReason = e && e.message ? e.message : 'summary failed';
  }

  if (!synopsis || typeof synopsis !== 'string' || synopsis.trim().length === 0) {
    return {
      messages: fallbackTruncate(tail),
      summarised: false,
      reason: failReason || 'empty synopsis',
    };
  }

  const synopsisText = truncateContent(synopsis.trim(), DEFAULT_SYNOPSIS_MAX_CHARS);
  const synopsisTurn = {
    role: 'user',
    content:
      '[EARLIER IN THIS THREAD — auto-summary, not a direct quote]\n' +
      synopsisText +
      '\n[END EARLIER IN THIS THREAD]',
  };

  return {
    messages: [synopsisTurn, ...tail],
    summarised: true,
    olderTurnsCompressed: older.length,
  };
}

/**
 * Build a Haiku-backed summariseFn suitable for passing into
 * prepareConversationHistory. The caller owns the Anthropic API key
 * via process.env and the fetch implementation.
 */
function buildHaikuSummariser({ fetch: _fetch, apiKey, model } = {}) {
  const fetchImpl = _fetch || (typeof fetch !== 'undefined' ? fetch : null);
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  const mdl = model || 'claude-haiku-4-5-20251001';

  if (!fetchImpl || !key) return null;

  return async function summariseWithHaiku(prompt) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_SUMMARY_TIMEOUT_MS);
    try {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: mdl,
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      const text = body && body.content && body.content[0] && body.content[0].text;
      return (typeof text === 'string') ? text.trim() : null;
    } finally {
      clearTimeout(t);
    }
  };
}

module.exports = {
  prepareConversationHistory,
  buildHaikuSummariser,
  // Exported for unit tests and route-level reuse.
  _internal: {
    truncateContent,
    totalChars,
    buildSummariserPrompt,
    DEFAULT_KEEP_RECENT,
    DEFAULT_SUMMARISE_CHARS,
    DEFAULT_SUMMARY_TIMEOUT_MS,
    DEFAULT_SYNOPSIS_MAX_CHARS,
  },
};
