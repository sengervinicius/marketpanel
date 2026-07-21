/**
 * search.helpers.js — #253 P3.1 extract of pure, stateless helpers from
 * the monster server/routes/search.js.
 *
 * These functions have no side-effects and no closure-captured state. Kept
 * separate so new AI-powered search routes can reuse them without having to
 * require the router file itself.
 */

'use strict';

// -- Perplexity upstream config ------------------------------------------------
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL          = 'sonar-pro';
const TIMEOUT_MS     = 15000;

/**
 * Sanitize user queries to strip prompt-injection delimiters.
 * Removes common LLM instruction markers that could trick the model
 * into treating user input as system/assistant instructions.
 */
function sanitizeQuery(q) {
  if (!q || typeof q !== 'string') return q;
  return q
    // Strip XML-style instruction tags
    .replace(/<\|?(system|assistant|user|instruction|endoftext|im_start|im_end)\|?>/gi, '')
    // Strip markdown-style section delimiters used in prompts
    .replace(/^###\s*(System|Assistant|Instruction|User)\s*:?\s*/gim, '')
    // Strip [INST] [/INST] <<SYS>> <</SYS>> markers
    .replace(/\[\/?(INST|SYS)\]|<<\/?SYS>>/gi, '')
    // Collapse excess whitespace left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Estimate token count for a string (rough: ~4 chars per token).
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Apply token budget to context sections.
 * Truncates lowest-priority sections first until total fits within budget.
 * Returns an object with the (possibly truncated) sections and truncation log.
 */
const TOKEN_BUDGET = 6000;
function applyTokenBudget(sections) {
  // Priority order: lowest priority first (removed first when over budget)
  const priorityOrder = [
    'behaviorContext',
    'sessionMemoryContext',
    'persistentMemoryContext',
    'unusualWhalesContext',
    'earningsContext',
    'edgarContext',
    'portfolioMetricsContext',
    'conversationMemoryContext',
    'newsContext',
    'vaultContext',
    'marketContext', // NEVER truncate
  ];

  const result = { ...sections };
  const truncated = [];
  let total = 0;
  for (const key of Object.keys(result)) {
    total += estimateTokens(result[key]);
  }

  if (total <= TOKEN_BUDGET) return { sections: result, truncated, totalTokens: total };

  // Truncate from lowest priority
  for (const key of priorityOrder) {
    if (total <= TOKEN_BUDGET) break;
    if (key === 'marketContext') break; // NEVER truncate market data
    const tokens = estimateTokens(result[key]);
    if (tokens > 0) {
      total -= tokens;
      result[key] = '';
      truncated.push({ section: key, tokensSaved: tokens });
    }
  }

  return { sections: result, truncated, totalTokens: total };
}

/**
 * Format big numbers for financial context: $1.2T / $45.6B / $789M / plain.
 */
function fmtBig(n) {
  if (n == null) return null;
  if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T';
  if (Math.abs(n) >= 1e9)  return '$' + (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString();
}

/**
 * buildFundamentalsFallback — fix/bug-wave3 BUG 3.
 *
 * When the LLM leg of POST /search/fundamentals fails but the data-gathering
 * leg produced real fundamentals/quote data, the card should show that data
 * (clearly marked non-AI) instead of "AI insight unavailable". Pure function
 * so it's unit-testable with mocked provider payloads.
 *
 * Returns null when there is nothing worth showing (caller then falls back
 * to the error status — the only case where "unavailable" is honest).
 */
function buildFundamentalsFallback(sym, fundamentals, quote, newsItems = []) {
  const f = fundamentals || {};
  const hasFunds = [f.marketCap, f.peRatio, f.eps, f.totalRevenue, f.sector]
    .some(v => v != null);
  const hasQuote = quote && quote.price != null;
  if (!hasFunds && !hasQuote) return null;

  const summaryParts = [];
  if (f.sector || f.industry) {
    summaryParts.push(`${sym} operates in ${[f.sector, f.industry].filter(Boolean).join(' / ')}.`);
  }
  if (f.marketCap != null) summaryParts.push(`Market cap ${fmtBig(f.marketCap)}.`);
  if (hasQuote) {
    const chg = quote.changePct != null
      ? ` (${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}% today)` : '';
    summaryParts.push(`Last price $${quote.price}${chg}.`);
  }

  const highlights = [];
  if (f.totalRevenue != null)   highlights.push(`Revenue (TTM): ${fmtBig(f.totalRevenue)}`);
  if (f.ebitda != null)         highlights.push(`EBITDA: ${fmtBig(f.ebitda)}`);
  if (f.profitMargins != null)  highlights.push(`Net margin: ${(f.profitMargins * 100).toFixed(1)}%`);
  if (f.returnOnEquity != null) highlights.push(`ROE: ${(f.returnOnEquity * 100).toFixed(1)}%`);
  if (f.revenueGrowth != null)  highlights.push(`Revenue growth: ${(f.revenueGrowth * 100).toFixed(1)}%`);

  const valuation = [];
  if (f.peRatio != null)       valuation.push(`P/E (TTM): ${f.peRatio.toFixed(1)}x`);
  if (f.forwardPE != null)     valuation.push(`P/E (FWD): ${f.forwardPE.toFixed(1)}x`);
  if (f.priceToBook != null)   valuation.push(`P/B: ${f.priceToBook.toFixed(2)}x`);
  if (f.eps != null)           valuation.push(`EPS (TTM): $${f.eps.toFixed(2)}`);
  if (f.dividendYield != null) valuation.push(`Dividend yield: ${(f.dividendYield * 100).toFixed(2)}%`);

  return {
    symbol: sym,
    generatedAt: new Date().toISOString(),
    livePrice: hasQuote ? quote.price : null,
    summary: summaryParts.join(' ')
      || `Live metrics for ${sym} (AI narrative temporarily unavailable).`,
    businessModel: '',
    segments: [],
    financialHighlights: highlights,
    valuationSnapshot: valuation,
    riskFactors: [],
    aiDegraded: true, // client may badge this "DATA ONLY"
    dataSource: f.source || (hasFunds ? 'unknown' : 'quote'),
    headlines: (newsItems || []).slice(0, 3),
  };
}

module.exports = {
  PERPLEXITY_URL,
  MODEL,
  TIMEOUT_MS,
  TOKEN_BUDGET,
  sanitizeQuery,
  estimateTokens,
  applyTokenBudget,
  fmtBig,
  buildFundamentalsFallback,
};
