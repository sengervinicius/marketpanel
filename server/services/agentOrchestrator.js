/**
 * agentOrchestrator.js — Parallel agent orchestration for Wave 5A
 *
 * Runs all data-gathering tasks concurrently using Promise.allSettled
 * to speed up AI response synthesis. Each "agent" wraps an existing service call.
 *
 * Key features:
 * - Uses Promise.allSettled so one failure doesn't block others
 * - Configurable timeouts per agent (default 5s)
 * - Logs timing for each agent for performance monitoring
 * - mergeResults() combines all successful results into a single context object
 */

const fetch = require('node-fetch');
const vault = require('./vault');
const edgar = require('./edgar');
const earnings = require('./earnings');
const memoryManager = require('./memoryManager');
const computeEngine = require('./computeEngine');
const unusualWhales = require('./unusualWhales');

// ── Configuration ──────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 5000; // 5 seconds per agent
const AGENT_TIMEOUTS = {
  vault: 8000,      // Vault RAG retrieval (Phase 2: extended from 4s for better recall)
  edgar: 3000,      // SEC filings + insider data
  earnings: 3000,   // Earnings calendar
  memory: 2000,     // Session + persistent memory (fast, in-memory/DB)
  compute: 1000,    // Portfolio metrics (purely computational)
  news: 8000,       // Web search news (sonar-pro, needs time for international queries)
  unusualWhales: 4000, // Options flow, dark pool, Greeks, shorts, congress
};

// ── Helper: promisify with timeout ───────────────────────────────────
function withTimeout(promise, timeoutMs, agentName) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${agentName} timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

// ── Agent functions ─────────────────────────────────────────────────────

/**
 * vaultAgent: Retrieve relevant passages from user's private vault
 * and the central vault via semantic search
 */
async function vaultAgent(query, userId) {
  const passages = await vault.retrieve(userId, query);
  return {
    context: vault.formatForPrompt(passages),
    sources: passages && passages.length > 0
      ? passages.map(p => ({
          filename: p.filename || 'Unknown',
          source: p.doc_metadata?.bank || p.source || '',
          tickers: p.doc_metadata?.tickers || [],
          date: p.doc_metadata?.date || '',
          similarity: p.similarity != null ? parseFloat(p.similarity).toFixed(2) : null,
          isGlobal: p.is_global || false,
        }))
      : [],
  };
}

/**
 * edgarAgent: Fetch SEC EDGAR filings and insider transactions for a ticker
 * Extracts ticker from query and fetches recent filings + insider data
 */
async function edgarAgent(query) {
  const tickerMatch = query.match(/\$?([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\b/);
  if (!tickerMatch) {
    return { context: '', ticker: null };
  }

  const ticker = tickerMatch[1];
  const context = await edgar.formatForContext(ticker).catch(() => '');
  return { context, ticker };
}

/**
 * earningsAgent: Fetch earnings calendar for mentioned tickers
 * Extracts all ticker symbols from query and fetches earnings data
 */
async function earningsAgent(query) {
  const tickerMatches = query.match(/\$?([A-Z]{1,5}(?:\.[A-Z]{1,2})?)/g);
  if (!tickerMatches || tickerMatches.length === 0) {
    return { context: '', tickers: [] };
  }

  const tickers = [...new Set(tickerMatches.map(t => t.replace(/^\$/, '').toUpperCase()))];
  const context = await earnings.formatForContext(tickers).catch(() => '');
  return { context, tickers };
}

/**
 * memoryAgent: Load session memory and persistent memories
 * Combines both in-memory working memory and cross-session persistent memories
 */
async function memoryAgent(userId, sessionId) {
  // Session memory is synchronous, persistent is async
  let sessionMemoryContext = '';
  let persistentMemoryContext = '';

  try {
    const session = memoryManager.getSessionMemory(userId);
    if (session) {
      sessionMemoryContext = memoryManager.formatSessionMemory(session);
    }
  } catch (err) {
    // Non-critical — proceed without session memory
    console.warn('[agentOrchestrator] Session memory load error:', err.message);
  }

  try {
    persistentMemoryContext = await memoryManager.getPersistedMemories(userId);
  } catch (err) {
    // Non-critical — proceed without persistent memory
    console.warn('[agentOrchestrator] Persistent memory load error:', err.message);
  }

  return {
    sessionMemory: sessionMemoryContext,
    persistentMemory: persistentMemoryContext,
  };
}

/**
 * computeAgent: Compute deterministic portfolio metrics
 * Takes portfolio data and returns formatted metrics context
 */
async function computeAgent(portfolioData) {
  if (!portfolioData || !Array.isArray(portfolioData) || portfolioData.length === 0) {
    return { context: '' };
  }

  try {
    const metrics = computeEngine.computePortfolioMetrics(portfolioData);
    const context = `PRE-COMPUTED PORTFOLIO METRICS:
- Total Value: $${metrics.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Total Cost Basis: $${metrics.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Total P&L: $${metrics.totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${metrics.totalPnLPct > 0 ? '+' : ''}${metrics.totalPnLPct.toFixed(2)}%)
- Today's P&L: $${metrics.dayPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${metrics.dayPnLPct > 0 ? '+' : ''}${metrics.dayPnLPct.toFixed(2)}%)
- Positions (${metrics.positions.length}):
${metrics.positions.map(pos => `  ${pos.symbol}: ${pos.shares} shares @ $${pos.currentPrice} = $${pos.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pos.pnlPct > 0 ? '+' : ''}${pos.pnlPct.toFixed(2)}%, weight ${pos.weight.toFixed(2)}%)`).join('\n')}

IMPORTANT: NEVER do math in your head. Use the PRE-COMPUTED values above.`;
    return { context, metrics };
  } catch (err) {
    console.warn('[agentOrchestrator] Portfolio compute error:', err.message);
    return { context: '' };
  }
}

/**
 * unusualWhalesAgent: Fetch options flow, dark pool, Greeks, shorts, congress data
 * Extracts tickers from query and fetches comprehensive UW data
 */
async function unusualWhalesAgent(query) {
  const tickerMatch = query.match(/\$?([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\b/);
  let tickerContext = '';
  let marketContext = '';

  // Ticker-specific data (options flow, dark pool, Greeks, shorts, institutional)
  if (tickerMatch) {
    const ticker = tickerMatch[1];
    try {
      tickerContext = await unusualWhales.formatForContext(ticker);
    } catch (err) {
      console.warn('[agentOrchestrator] UW ticker context error:', err.message);
    }
  }

  // Market-wide data (congress trades, institutional filings, news)
  try {
    marketContext = await unusualWhales.formatMarketContext();
  } catch (err) {
    console.warn('[agentOrchestrator] UW market context error:', err.message);
  }

  const combined = [tickerContext, marketContext].filter(Boolean).join('\n\n');
  return { context: combined, ticker: tickerMatch ? tickerMatch[1] : null };
}

/**
 * newsAgent: Fetch real-time news via Perplexity Sonar Pro.
 * Extracts tickers AND company names from query for better international coverage.
 * 6-second hard timeout via AbortController. Returns empty on any failure.
 */
async function newsAgent(query, tickers) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { context: '', sources: [] };

  // Extract tickers from query if not provided (supports US + international formats)
  const tickerList = tickers && tickers.length > 0
    ? tickers
    : [...new Set((query.match(/\$?([A-Z]{1,5}(?:\d)?(?:\.[A-Z]{1,4})?)/g) || []).map(t => t.replace(/^\$/, '')))];

  const tickerClause = tickerList.length > 0 ? `Focus on these tickers/companies: ${tickerList.join(', ')}.` : '';

  // Build an enriched search query that includes the original question
  // This helps Perplexity find news about companies by name, not just ticker
  const searchQuery = query.length > 200 ? query.slice(0, 200) : query;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: `You are a global financial news wire covering ALL markets worldwide — US, Europe, Asia, Latin America (B3/Bovespa), Middle East, Africa. Return a concise digest of the most important market news from the last 24-48 hours relevant to the user query. ${tickerClause} Cover M&A activity, deal announcements, deal collapses, regulatory actions, earnings surprises, and material corporate events. For Brazilian/LatAm stocks, search in both English AND Portuguese sources. Max 300 words. No preamble. Lead with the most market-moving headline.`,
          },
          { role: 'user', content: searchQuery },
        ],
        max_tokens: 600,
        temperature: 0.1,
        return_citations: true,
        search_recency_filter: 'week',
      }),
    });

    if (!response.ok) {
      console.warn(`[newsAgent] Perplexity returned ${response.status}`);
      return { context: '', sources: [] };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = (data.citations || []).map((url, i) => ({ title: `News ${i + 1}`, url }));

    return {
      context: content ? `RECENT NEWS:\n${content}` : '',
      sources: citations,
    };
  } catch (err) {
    // Timeout or network error — degrade gracefully
    console.warn(`[newsAgent] Failed: ${err.message}`);
    return { context: '', sources: [] };
  } finally {
    clearTimeout(timer);
  }
}

// ── Main orchestration function ──────────────────────────────────────

/**
 * gatherContext: Run all data sources in parallel
 *
 * @param {object} params
 * @param {string} params.query - User's natural language query
 * @param {string} params.userId - User ID for vault and memory retrieval
 * @param {array} params.portfolioData - Optional portfolio positions for metrics
 * @param {string} params.sessionId - Optional session ID
 * @returns {object} Merged context object with all successful data sources
 */
async function gatherContext({
  query = '',
  userId = null,
  portfolioData = null,
  sessionId = null,
} = {}) {
  const startTime = Date.now();
  const timings = {};

  // Prepare portfolio data if needed
  let positionsForCompute = [];
  if (portfolioData && Array.isArray(portfolioData)) {
    positionsForCompute = portfolioData;
  }

  // ── Run all agents in parallel with individual timeouts ──────────────────
  const [vaultResult, edgarResult, earningsResult, memoryResult, computeResult, newsResult, uwResult] =
    await Promise.allSettled([
      // Vault RAG retrieval
      withTimeout(
        vaultAgent(query, userId),
        AGENT_TIMEOUTS.vault,
        'vault'
      ).catch(err => {
        console.warn('[agentOrchestrator] Vault agent failed:', err.message);
        return { context: '', sources: [] };
      }),

      // SEC EDGAR data
      withTimeout(
        edgarAgent(query),
        AGENT_TIMEOUTS.edgar,
        'edgar'
      ).catch(err => {
        console.warn('[agentOrchestrator] EDGAR agent failed:', err.message);
        return { context: '', ticker: null };
      }),

      // Earnings calendar
      withTimeout(
        earningsAgent(query),
        AGENT_TIMEOUTS.earnings,
        'earnings'
      ).catch(err => {
        console.warn('[agentOrchestrator] Earnings agent failed:', err.message);
        return { context: '', tickers: [] };
      }),

      // Memory (session + persistent)
      withTimeout(
        memoryAgent(userId, sessionId),
        AGENT_TIMEOUTS.memory,
        'memory'
      ).catch(err => {
        console.warn('[agentOrchestrator] Memory agent failed:', err.message);
        return { sessionMemory: '', persistentMemory: '' };
      }),

      // Portfolio metrics
      withTimeout(
        computeAgent(positionsForCompute),
        AGENT_TIMEOUTS.compute,
        'compute'
      ).catch(err => {
        console.warn('[agentOrchestrator] Compute agent failed:', err.message);
        return { context: '' };
      }),

      // News search
      withTimeout(
        newsAgent(query, null),
        AGENT_TIMEOUTS.news,
        'news'
      ).catch(err => {
        console.warn('[agentOrchestrator] News agent failed:', err.message);
        return { context: '', sources: [] };
      }),

      // Unusual Whales: options flow, dark pool, Greeks, shorts, congress
      withTimeout(
        unusualWhalesAgent(query),
        AGENT_TIMEOUTS.unusualWhales,
        'unusualWhales'
      ).catch(err => {
        console.warn('[agentOrchestrator] Unusual Whales agent failed:', err.message);
        return { context: '', ticker: null };
      }),
    ]);

  // ── Extract results and record timings ────────────────────────────────────
  const results = {
    vault: { context: '', sources: [] },
    edgar: { context: '', ticker: null },
    earnings: { context: '', tickers: [] },
    memory: { sessionMemory: '', persistentMemory: '' },
    compute: { context: '' },
    news: { context: '', sources: [] },
    unusualWhales: { context: '', ticker: null },
  };

  // Process vault result
  if (vaultResult.status === 'fulfilled') {
    results.vault = vaultResult.value;
    timings.vault = Date.now() - startTime;
    const vCtx = results.vault?.context || '';
    const vSrc = results.vault?.sources?.length || 0;
    console.log(`[agentOrchestrator] Vault: ${vSrc} sources, context ${vCtx.length} chars, ${timings.vault}ms`);
  } else {
    timings.vault = Date.now() - startTime;
    console.warn('[agentOrchestrator] Vault REJECTED:', vaultResult.reason?.message);
  }

  // Process EDGAR result
  if (edgarResult.status === 'fulfilled') {
    results.edgar = edgarResult.value;
    timings.edgar = Date.now() - startTime;
  } else {
    timings.edgar = Date.now() - startTime;
    console.warn('[agentOrchestrator] EDGAR rejected:', edgarResult.reason?.message);
  }

  // Process earnings result
  if (earningsResult.status === 'fulfilled') {
    results.earnings = earningsResult.value;
    timings.earnings = Date.now() - startTime;
  } else {
    timings.earnings = Date.now() - startTime;
    console.warn('[agentOrchestrator] Earnings rejected:', earningsResult.reason?.message);
  }

  // Process memory result
  if (memoryResult.status === 'fulfilled') {
    results.memory = memoryResult.value;
    timings.memory = Date.now() - startTime;
  } else {
    timings.memory = Date.now() - startTime;
    console.warn('[agentOrchestrator] Memory rejected:', memoryResult.reason?.message);
  }

  // Process compute result
  if (computeResult.status === 'fulfilled') {
    results.compute = computeResult.value;
    timings.compute = Date.now() - startTime;
  } else {
    timings.compute = Date.now() - startTime;
    console.warn('[agentOrchestrator] Compute rejected:', computeResult.reason?.message);
  }

  // Process news result
  if (newsResult.status === 'fulfilled') {
    results.news = newsResult.value;
    timings.news = Date.now() - startTime;
  } else {
    timings.news = Date.now() - startTime;
    console.warn('[agentOrchestrator] News rejected:', newsResult.reason?.message);
  }

  // Process Unusual Whales result
  if (uwResult.status === 'fulfilled') {
    results.unusualWhales = uwResult.value;
    timings.unusualWhales = Date.now() - startTime;
  } else {
    timings.unusualWhales = Date.now() - startTime;
    console.warn('[agentOrchestrator] UW rejected:', uwResult.reason?.message);
  }

  const totalTime = Date.now() - startTime;

  // ── Log timing summary ───────────────────────────────────────────────────
  console.log(
    `[orchestrator] context gathered in ${totalTime}ms: vault=${timings.vault}ms, edgar=${timings.edgar}ms, earnings=${timings.earnings}ms, memory=${timings.memory}ms, compute=${timings.compute}ms, news=${timings.news}ms, uw=${timings.unusualWhales}ms`
  );

  const merged = mergeResults(results, { query, hasPortfolio: positionsForCompute.length > 0 });

  // ── Log completeness breakdown for diagnostics ───────────────────────────
  const c = merged.completeness;
  console.log(
    `[orchestrator] completeness=${c.score}/100 | active: [${c.available.join(', ')}] | failed: [${c.failed.join(', ')}] | skipped (not relevant): [${c.skipped.join(', ')}]`
  );

  return merged;
}

// ── Merge results into a single context object ───────────────────────

/**
 * mergeResults: Combines all successful data sources into a cohesive context
 * object with organized sections for the LLM prompt
 *
 * @param {object} results - Raw results from all agents
 * @param {object} meta - Query metadata for completeness scoring
 * @returns {object} Merged context object with:
 *   - vaultContext + vaultSources
 *   - edgarContext
 *   - earningsContext
 *   - sessionMemoryContext + persistentMemoryContext
 *   - portfolioMetricsContext
 *   - Additional metadata for caller
 */
function mergeResults(results, meta = {}) {
  return {
    // Vault RAG retrieval
    vault: {
      context: results.vault?.context || '',
      sources: results.vault?.sources || [],
      available: !!(results.vault?.context),
    },

    // SEC EDGAR data
    edgar: {
      context: results.edgar?.context || '',
      ticker: results.edgar?.ticker || null,
      available: !!(results.edgar?.context),
    },

    // Earnings calendar
    earnings: {
      context: results.earnings?.context || '',
      tickers: results.earnings?.tickers || [],
      available: !!(results.earnings?.context),
    },

    // Session memory (in-memory working memory)
    memory: {
      sessionContext: results.memory?.sessionMemory || '',
      persistentContext: results.memory?.persistentMemory || '',
      available: !!(results.memory?.sessionMemory || results.memory?.persistentMemory),
    },

    // Portfolio metrics
    compute: {
      context: results.compute?.context || '',
      metrics: results.compute?.metrics || null,
      available: !!(results.compute?.context),
    },

    // News/web search (optional enhancement)
    news: {
      context: results.news?.context || '',
      sources: results.news?.sources || [],
      available: !!(results.news?.context),
    },

    // Unusual Whales: options flow, dark pool, Greeks, shorts, congress
    unusualWhales: {
      context: results.unusualWhales?.context || '',
      ticker: results.unusualWhales?.ticker || null,
      available: !!(results.unusualWhales?.context),
    },

    // Summary flags for conditional rendering in prompt
    summary: {
      hasVault: !!(results.vault?.context),
      hasEDGAR: !!(results.edgar?.context),
      hasEarnings: !!(results.earnings?.context),
      hasMemory: !!(results.memory?.sessionMemory || results.memory?.persistentMemory),
      hasCompute: !!(results.compute?.context),
      hasNews: !!(results.news?.context),
      hasUnusualWhales: !!(results.unusualWhales?.context),
    },

    // Phase 2: Context completeness score (0-100) — query-aware
    // Only penalizes agents that are relevant to the current query
    completeness: computeCompletenessScore(results, meta),
  };
}

/**
 * Phase 2: Compute a context completeness score (0-100).
 * Query-aware: only counts agents that are RELEVANT to the query.
 * An agent that correctly returns nothing (e.g., EDGAR when no ticker)
 * doesn't penalize the score.
 *
 * @param {object} results - Raw results from all agents
 * @param {object} meta - Optional query metadata
 * @param {string} meta.query - The user's query (for relevance detection)
 * @param {boolean} meta.hasPortfolio - Whether portfolio data was passed
 * @returns {object} { score: number, available: string[], failed: string[], skipped: string[] }
 */
function computeCompletenessScore(results, meta = {}) {
  const query = (meta.query || '').toUpperCase();
  const hasPortfolio = !!meta.hasPortfolio;

  // Detect if query contains a ticker symbol
  const hasTicker = /\$?[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/.test(query);

  // Detect if query is about portfolio/positions
  const isPortfolioQuery = /\b(portfolio|positions?|holdings?|p&l|pnl|allocation|my stock)/i.test(meta.query || '');

  // Base weights — these are the maximum each agent CAN contribute
  const weights = {
    vault: 15,
    edgar: 10,
    earnings: 10,
    memory: 10,
    compute: 15,
    news: 20,
    unusualWhales: 20,
  };

  // Determine which agents are relevant to this query
  const relevant = {
    vault: true,              // Always relevant — user's private research
    news: true,               // Always relevant — real-time news
    unusualWhales: true,      // Always relevant — market-wide data + ticker-specific
    memory: true,             // Always relevant — session context
    edgar: hasTicker,         // Only relevant if query mentions a ticker
    earnings: hasTicker,      // Only relevant if query mentions a ticker
    compute: hasPortfolio && isPortfolioQuery, // Only relevant if portfolio exists AND query is about it
  };

  let totalRelevantWeight = 0;
  let earnedWeight = 0;
  const available = [];
  const failed = [];
  const skipped = [];

  // Vault
  if (!relevant.vault) { skipped.push('vault'); }
  else { totalRelevantWeight += weights.vault; if (results.vault?.context) { earnedWeight += weights.vault; available.push('vault'); } else { failed.push('vault'); } }

  // EDGAR
  if (!relevant.edgar) { skipped.push('edgar'); }
  else { totalRelevantWeight += weights.edgar; if (results.edgar?.context) { earnedWeight += weights.edgar; available.push('edgar'); } else { failed.push('edgar'); } }

  // Earnings
  if (!relevant.earnings) { skipped.push('earnings'); }
  else { totalRelevantWeight += weights.earnings; if (results.earnings?.context) { earnedWeight += weights.earnings; available.push('earnings'); } else { failed.push('earnings'); } }

  // Memory
  if (!relevant.memory) { skipped.push('memory'); }
  else { totalRelevantWeight += weights.memory; if (results.memory?.sessionMemory || results.memory?.persistentMemory) { earnedWeight += weights.memory; available.push('memory'); } else { failed.push('memory'); } }

  // Compute
  if (!relevant.compute) { skipped.push('compute'); }
  else { totalRelevantWeight += weights.compute; if (results.compute?.context) { earnedWeight += weights.compute; available.push('compute'); } else { failed.push('compute'); } }

  // News
  if (!relevant.news) { skipped.push('news'); }
  else { totalRelevantWeight += weights.news; if (results.news?.context) { earnedWeight += weights.news; available.push('news'); } else { failed.push('news'); } }

  // Unusual Whales
  if (!relevant.unusualWhales) { skipped.push('unusualWhales'); }
  else { totalRelevantWeight += weights.unusualWhales; if (results.unusualWhales?.context) { earnedWeight += weights.unusualWhales; available.push('unusualWhales'); } else { failed.push('unusualWhales'); } }

  // Normalize to 0-100 based on relevant agents only
  const score = totalRelevantWeight > 0 ? Math.round((earnedWeight / totalRelevantWeight) * 100) : 0;

  return { score, available, failed, skipped };
}

// ── Exports ──────────────────────────────────────────────────────────

module.exports = {
  gatherContext,
  mergeResults,
  computeCompletenessScore,
  // For testing/diagnostics: expose agent functions
  vaultAgent,
  edgarAgent,
  earningsAgent,
  memoryAgent,
  computeAgent,
  newsAgent,
  unusualWhalesAgent,
};
