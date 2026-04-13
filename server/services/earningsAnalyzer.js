/**
 * earningsAnalyzer.js — Auto-triggered earnings analysis for Particle.
 *
 * After an earnings call ends (detected via schedule), fetches the
 * transcript and generates a structured 4-bullet analysis:
 * 1. GUIDANCE — forward-looking statements and outlook changes
 * 2. TONE — management confidence, language analysis
 * 3. VS ESTIMATES — beats/misses on key metrics
 * 4. KEY RISK — most significant risk factor mentioned
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// Late-bound dependencies
let _marketState = null;
let _getUserById = null;
let _getPortfolio = null;

// In-memory store: symbol → { symbol, date, guidance, tone, vsEstimates, keyRisk, timestamp }
const _analyses = new Map();

// Track which tickers we've already analyzed today (symbol → timestamp)
const _analyzedToday = new Map();

const ANALYSIS_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
const ANALYSIS_WAIT_TIME = 20 * 60 * 1000; // 20 minutes after scheduled time
const RETENTION_DAYS = 7;

/**
 * Initialize the earnings analyzer with required dependencies.
 * @param {object} deps - { marketState, getUserById, getPortfolio }
 */
function init(deps = {}) {
  _marketState = deps.marketState;
  _getUserById = deps.getUserById;
  _getPortfolio = deps.getPortfolio;

  logger.info('[EarningsAnalyzer] Initialized');

  // Start periodic check for earnings
  startPeriodicCheck();
}

/**
 * Start the periodic earnings check (every 30 minutes during market hours).
 */
function startPeriodicCheck() {
  setInterval(() => {
    checkEarnings().catch((err) => {
      logger.error('[EarningsAnalyzer] checkEarnings failed:', err.message);
    });
  }, ANALYSIS_CHECK_INTERVAL);

  // Also run immediately on start
  setImmediate(() => {
    checkEarnings().catch((err) => {
      logger.error('[EarningsAnalyzer] Initial checkEarnings failed:', err.message);
    });
  });
}

/**
 * Check for earnings that completed and need analysis.
 * Called periodically during market hours.
 */
async function checkEarnings() {
  if (!_marketState?.stocks) {
    return;
  }

  const now = Date.now();
  const stocks = _marketState.stocks;
  let analyzed = 0;

  for (const [symbol, stockData] of Object.entries(stocks)) {
    try {
      // Check if stock has earnings scheduled for today
      if (!stockData.earningsSchedule) continue;

      const earningsTime = new Date(stockData.earningsSchedule).getTime();
      if (isNaN(earningsTime)) continue;

      // Has 20+ minutes passed since earnings?
      const timeSinceEarnings = now - earningsTime;
      if (timeSinceEarnings < ANALYSIS_WAIT_TIME) {
        continue;
      }

      // Have we already analyzed this today?
      const lastAnalyzed = _analyzedToday.get(symbol);
      if (lastAnalyzed && now - lastAnalyzed < 24 * 60 * 60 * 1000) {
        continue;
      }

      // Trigger analysis
      await analyzeEarnings(symbol, stockData);
      _analyzedToday.set(symbol, now);
      analyzed++;
    } catch (err) {
      logger.error(`[EarningsAnalyzer] Failed to analyze ${symbol}:`, err.message);
    }
  }

  if (analyzed > 0) {
    logger.info(`[EarningsAnalyzer] Analyzed ${analyzed} earnings events`);
  }
}

/**
 * Generate a 4-bullet earnings analysis.
 * @param {string} symbol - ticker symbol
 * @param {object} data - stock data from marketState
 */
async function analyzeEarnings(symbol, data) {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      logger.warn('[EarningsAnalyzer] PERPLEXITY_API_KEY not configured');
      return;
    }

    // Build context about the stock
    const price = data.price || 'N/A';
    const change = data.change || 0;
    const volume = data.volume || 0;
    const marketCap = data.marketCap || 'N/A';

    const prompt = `You are analyzing earnings for ${symbol} (current price: $${price}, ${change > 0 ? '+' : ''}${change}%, volume: ${volume}).

Find the latest earnings results and transcript for ${symbol}. Provide a structured 4-bullet analysis:

1. GUIDANCE — Any forward-looking guidance, outlook changes, or management expectations for coming quarters. Note if they raised/lowered guidance.

2. TONE — Assessment of management confidence and sentiment. Look for language patterns, hedging, enthusiasm. Are they confident or cautious?

3. VS ESTIMATES — How did actual results compare to Street expectations? Note beats/misses on EPS, revenue, and key metrics.

4. KEY RISK — The most significant risk factor management mentioned. Could be macro, competitive, supply-chain, or regulatory.

Format as JSON: { guidance, tone, vsEstimates, keyRisk }. Be concise (1-2 sentences per bullet).`;

    const body = {
      model: 'sonar-pro',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `[EarningsAnalyzer] Perplexity API error for ${symbol}:`,
        response.status,
        errorText
      );
      return;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    // Try to parse JSON from response
    let analysis = {
      guidance: '',
      tone: '',
      vsEstimates: '',
      keyRisk: '',
    };

    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                       content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        analysis = {
          guidance: parsed.guidance || '',
          tone: parsed.tone || '',
          vsEstimates: parsed.vsEstimates || '',
          keyRisk: parsed.keyRisk || '',
        };
      }
    } catch (parseErr) {
      // If JSON parsing fails, use the raw content
      logger.debug(
        `[EarningsAnalyzer] Could not parse JSON for ${symbol}, using raw content`
      );
      analysis = {
        guidance: content,
        tone: '',
        vsEstimates: '',
        keyRisk: '',
      };
    }

    // Store the analysis
    const now = Date.now();
    _analyses.set(symbol, {
      symbol,
      date: new Date().toISOString().split('T')[0],
      guidance: analysis.guidance,
      tone: analysis.tone,
      vsEstimates: analysis.vsEstimates,
      keyRisk: analysis.keyRisk,
      timestamp: now,
    });

    logger.info(
      `[EarningsAnalyzer] Analyzed ${symbol}: guidance="${analysis.guidance?.substring(0, 50)}..."`
    );

    // TODO: Push notification to users with this ticker in their watchlist
  } catch (err) {
    logger.error(`[EarningsAnalyzer] analyzeEarnings failed for ${symbol}:`, err.message);
  }
}

/**
 * Get recent earnings analyses for a user's watchlist.
 * @param {string} userId
 * @returns {array} array of analyses from last 7 days
 */
function getRecentAnalyses(userId) {
  if (!_getUserById || !_getPortfolio) {
    return [];
  }

  try {
    const user = _getUserById(userId);
    if (!user) return [];

    const watchlist = user.settings?.watchlist || [];
    const now = Date.now();
    const retention = RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const recent = [];
    for (const symbol of watchlist) {
      const analysis = _analyses.get(symbol);
      if (analysis && now - analysis.timestamp < retention) {
        recent.push(analysis);
      }
    }

    // Sort by date descending
    return recent.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    logger.error('[EarningsAnalyzer] getRecentAnalyses failed:', err.message);
    return [];
  }
}

/**
 * Get all stored analyses (for debugging/admin).
 * @returns {array}
 */
function getAllAnalyses() {
  return Array.from(_analyses.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear old analyses (run periodically).
 */
function cleanupOldAnalyses() {
  const now = Date.now();
  const retention = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const [symbol, analysis] of _analyses) {
    if (now - analysis.timestamp > retention) {
      _analyses.delete(symbol);
      removed++;
    }
  }

  if (removed > 0) {
    logger.info(`[EarningsAnalyzer] Cleaned up ${removed} old analyses`);
  }
}

// Run cleanup once per day
setInterval(cleanupOldAnalyses, 24 * 60 * 60 * 1000);
cleanupOldAnalyses(); // Run immediately on startup

module.exports = {
  init,
  checkEarnings,
  analyzeEarnings,
  getRecentAnalyses,
  getAllAnalyses,
  cleanupOldAnalyses,
};
