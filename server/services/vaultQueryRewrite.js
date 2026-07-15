/**
 * vaultQueryRewrite.js — LLM query rewriting for vault retrieval (v2).
 *
 * Problem: raw conversational queries ("what is BofA's outlook for oil
 * prices") go straight into the embedding model and the keyword arm.
 * Filler words drag the vector toward chit-chat, and the keyword arm's
 * AND-semantics zero out on words like "what's". One cheap Haiku call
 * fixes both: it produces a cleaned query, up to 2 paraphrases (for
 * multi-vector recall), plus tickers/entities that feed the exact-match
 * keyword OR and the metadata arm.
 *
 * Contract (all fail-open — retrieval NEVER breaks because of this module):
 *   rewriteQuery(query) -> {
 *     cleaned:     string,          // query stripped of conversational filler
 *     paraphrases: string[],        // up to 2 alternative phrasings
 *     tickers:     string[],        // uppercase symbols (AAPL, PETR4, VALE3)
 *     entities:    string[],        // org names (Bank of America, Petrobras)
 *   } | null                        // null => caller uses the raw query
 *
 * - Hard timeout REWRITE_TIMEOUT_MS (2500ms): on timeout return null.
 * - Any parse failure / API error / missing key: return null.
 * - VAULT_QUERY_REWRITE=0 disables entirely (returns null, no LLM call).
 * - Successful rewrites are cached in vaultQueryCache keyed by the
 *   normalised query, so repeat questions skip the LLM.
 *
 * detectTickers(query) is a pure regex fallback used even when the LLM is
 * unavailable, so the keyword arm's exact ticker OR still works offline.
 */
'use strict';

const logger = require('../utils/logger');
const modelRouter = require('./modelRouter');
const vaultQueryCache = require('./vaultQueryCache');

const REWRITE_TIMEOUT_MS = 2500;
const MAX_PARAPHRASES = 2;
const MAX_TICKERS = 8;
const MAX_ENTITIES = 5;
const MAX_CLEANED_LEN = 400;

// Uppercase tokens that look like tickers but are almost always plain
// words/acronyms in finance queries (EN + PT-BR).
const TICKER_STOPWORDS = new Set([
  'A', 'I', 'THE', 'AND', 'OR', 'FOR', 'NOT', 'OF', 'TO', 'IN', 'ON', 'AT',
  'IS', 'ARE', 'WAS', 'BE', 'DO', 'MY', 'ME', 'VS', 'PER', 'NEW', 'NOW',
  'WHAT', 'WHY', 'HOW', 'WHO', 'WHEN', 'WILL', 'CAN',
  'US', 'USA', 'USD', 'BRL', 'EUR', 'GBP', 'JPY', 'CNY', 'FX',
  'CEO', 'CFO', 'COO', 'CTO', 'IR', 'PR',
  'GDP', 'CPI', 'PCE', 'PMI', 'FED', 'FOMC', 'ECB', 'BCB', 'COPOM', 'SELIC',
  'IPCA', 'CDI', 'NTN', 'LFT', 'IBOV',
  'ETF', 'IPO', 'M&A', 'EPS', 'PE', 'EV', 'DCF', 'ROE', 'ROIC', 'CAPEX',
  'EBITDA', 'YOY', 'QOQ', 'YTD', 'ATH', 'AI', 'IT', 'PDF', 'OK', 'FAQ',
  'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY',
  'DE', 'DA', 'DO', 'EM', 'UM', 'UMA', 'OS', 'AS', 'SE', 'COM', 'POR',
  'QUE', 'QUAL', 'PARA', 'SOBRE', 'NO', 'NA',
]);

function _isEnabled() {
  return process.env.VAULT_QUERY_REWRITE !== '0';
}

/**
 * Pure regex ticker detection — 1-6 char uppercase tokens (digits allowed,
 * covering B3 symbols like PETR4/VALE3/BBDC4 and US symbols like AAPL),
 * plus anything $-prefixed. Case-sensitive on the ORIGINAL text so
 * lowercase conversational words never false-positive.
 *
 * @param {string} query
 * @returns {string[]} uppercase symbols, deduped
 */
function detectTickers(query) {
  if (!query || typeof query !== 'string') return [];
  const out = new Set();
  // $-prefixed: always a ticker regardless of stopword list.
  for (const m of query.matchAll(/\$([A-Za-z]{1,6}\d{0,2})\b/g)) {
    out.add(m[1].toUpperCase());
  }
  // Shouting guard: if most of the query is uppercase (SOMEONE TYPING IN
  // CAPS), bare uppercase words are noise — only $-prefixed and
  // digit-bearing (B3-style) tokens are trustworthy.
  const words = query.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  const upperWords = words.filter(w => /[A-Z]/.test(w) && !/[a-z]/.test(w));
  const shouting = words.length >= 4 && upperWords.length / words.length > 0.6;
  // Bare uppercase tokens: letters (2-6) optionally ending in 1-2 digits.
  for (const m of query.matchAll(/(^|[^A-Za-z0-9$])([A-Z]{2,6}\d{0,2})(?![A-Za-z0-9])/g)) {
    const tok = m[2];
    const hasDigit = /\d/.test(tok);
    // B3-style LLLL9 / LLLL11 tokens are tickers even in shouting text;
    // pure-letter tokens must clear the stopword list and the shouting guard.
    if (hasDigit || (!shouting && !TICKER_STOPWORDS.has(tok))) out.add(tok);
  }
  return [...out].slice(0, MAX_TICKERS);
}

function _sanitizeStringArray(arr, max, upper = false) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    let s = v.trim();
    if (!s || s.length > 120) continue;
    if (upper) s = s.toUpperCase();
    if (!out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Parse + validate the LLM response text into the rewrite shape, or null. */
function _parseRewriteResponse(text, originalQuery) {
  if (!text || typeof text !== 'string') return null;
  // Strip markdown fences, then grab the outermost JSON object.
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  let cleaned = typeof parsed.cleaned === 'string' ? parsed.cleaned.trim() : '';
  if (!cleaned) return null;
  if (cleaned.length > MAX_CLEANED_LEN) cleaned = cleaned.slice(0, MAX_CLEANED_LEN);

  const paraphrases = _sanitizeStringArray(parsed.paraphrases, MAX_PARAPHRASES)
    .filter(p => p.toLowerCase() !== cleaned.toLowerCase());

  // Union LLM tickers with regex-detected ones so an LLM omission never
  // loses a symbol the regex would have caught.
  const llmTickers = _sanitizeStringArray(parsed.tickers, MAX_TICKERS, true)
    .filter(t => /^[A-Z][A-Z0-9.]{0,9}$/.test(t));
  const regexTickers = detectTickers(originalQuery);
  const tickers = [...new Set([...llmTickers, ...regexTickers])].slice(0, MAX_TICKERS);

  const entities = _sanitizeStringArray(parsed.entities, MAX_ENTITIES);

  return { cleaned, paraphrases, tickers, entities };
}

function _buildPrompt(query) {
  return `You normalize search queries for a financial research document retrieval system (sell-side reports, transcripts, macro notes; English and Brazilian Portuguese).

User query: "${String(query).replace(/"/g, '\\"').slice(0, 400)}"

Respond with ONLY a JSON object, no markdown, no explanation:
{"cleaned": "...", "paraphrases": ["...", "..."], "tickers": ["..."], "entities": ["..."]}

Rules:
- cleaned: the query stripped of conversational filler, keeping ALL financial meaning and named entities. Keep the query's language.
- paraphrases: up to 2 alternative phrasings using different vocabulary a research report might use (empty array if none add value).
- tickers: stock/exchange symbols explicitly or implicitly referenced, UPPERCASE (e.g. "PETR4", "AAPL"). Empty array if none.
- entities: organizations referenced (banks, companies, institutions), full names (e.g. "Bank of America"). Empty array if none.
- Be conservative: do not invent tickers or entities not implied by the query.`;
}

/**
 * Rewrite a user query via one Haiku call. Returns the rewrite object or
 * null (caller then proceeds with the raw query). Never throws.
 *
 * @param {string} query - raw user query
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs] - override for tests
 * @returns {Promise<Object|null>}
 */
async function rewriteQuery(query, opts = {}) {
  try {
    if (!_isEnabled()) return null;
    if (!query || typeof query !== 'string' || query.trim().length < 3) return null;

    // Cache hit — repeat questions skip the LLM entirely.
    const cached = vaultQueryCache.getRewrite({ query });
    if (cached) return cached;

    const provider = modelRouter.getProvider('claude_haiku');
    if (!provider || !process.env[provider.keyEnv]) return null; // no key — fail open silently

    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : REWRITE_TIMEOUT_MS;

    // Hard timeout via Promise.race — the underlying fetch may still
    // resolve later, but retrieval has already moved on with the raw query.
    let timer = null;
    let response;
    try {
      response = await Promise.race([
        // callProviderImpl = single attempt, no retry loop — a retry chain
        // could never fit inside the 2500ms budget anyway.
        modelRouter.callProviderImpl(provider, [
          { role: 'user', content: _buildPrompt(query) },
        ], 'You are a precise query normalizer. Output only JSON.', { maxTokens: 300 }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('rewrite timeout')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || '';
    const rewrite = _parseRewriteResponse(text, query);
    if (!rewrite) {
      logger.warn('vault', 'Query rewrite returned unparseable response — using raw query');
      return null;
    }

    vaultQueryCache.setRewrite({ query, rewrite });
    return rewrite;
  } catch (err) {
    // Timeout, network, HTTP error, JSON body error — all fail open.
    logger.warn('vault', 'Query rewrite failed — using raw query', { error: err?.message || String(err) });
    return null;
  }
}

module.exports = {
  rewriteQuery,
  detectTickers,
  REWRITE_TIMEOUT_MS,
  // exported for tests
  _parseRewriteResponse,
};
