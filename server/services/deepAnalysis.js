/**
 * deepAnalysis.js — Deep Analysis Tools (Wave 11)
 *
 * Three analysis modes:
 *   11A. Portfolio Autopsy — concentration, sector, correlation analysis
 *   11B. Counter-Thesis — strongest opposing case for a conviction
 *   11C. Scenario Analysis — "what if X happens to Y"
 *
 * All modes generate structured AI responses with rich context from
 * live market data, prediction markets, and user portfolio.
 */

'use strict';

const logger = require('../utils/logger');
const predictionAggregator = require('./predictionAggregator');

// ── Late-bound deps ─────────────────────────────────────────────────────────
let _marketState  = null;
let _getPortfolio = null;
let _getUserById  = null;

function init({ marketState, getPortfolio, getUserById } = {}) {
  _marketState  = marketState;
  _getPortfolio = getPortfolio;
  _getUserById  = getUserById;
}

// ── Query Intent Detection ──────────────────────────────────────────────────

const PORTFOLIO_PATTERNS = [
  /analyz.*portfolio/i, /portfolio.*analys/i, /portfolio.*autopsy/i,
  /how.*portfolio.*look/i, /am i.*concentrat/i, /portfolio.*risk/i,
  /my.*exposure/i, /portfolio.*health/i, /review.*portfolio/i,
  /diversif.*enough/i, /sector.*exposure/i, /portfolio.*stress/i,
];

const COUNTER_THESIS_PATTERNS = [
  /i('m| am).*bullish/i, /i('m| am).*bearish/i, /bull.*case/i, /bear.*case/i,
  /counter.*thesis/i, /stress.*test.*thesis/i, /devil.*advocate/i,
  /opposite.*view/i, /what('s|s| is) the risk/i, /why.*wrong/i,
  /convince.*otherwise/i, /argue.*against/i, /other.*side/i,
];

const SCENARIO_PATTERNS = [
  /what.*if.*fed/i, /what.*if.*rate/i, /what.*if.*recession/i,
  /what.*if.*oil/i, /what.*if.*war/i, /what.*if.*crash/i,
  /what.*happen.*to.*if/i, /scenario.*analys/i, /if.*happens/i,
  /impact.*on.*portfolio/i, /how.*affect/i,
];

/**
 * Detect deep analysis intent from a user query.
 * @returns {string|null} 'portfolio' | 'counter_thesis' | 'scenario' | null
 */
function detectAnalysisIntent(query) {
  if (!query) return null;
  for (const p of PORTFOLIO_PATTERNS)      { if (p.test(query)) return 'portfolio'; }
  for (const p of COUNTER_THESIS_PATTERNS) { if (p.test(query)) return 'counter_thesis'; }
  for (const p of SCENARIO_PATTERNS)       { if (p.test(query)) return 'scenario'; }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11A. PORTFOLIO AUTOPSY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute portfolio metrics from positions + live prices.
 */
function computePortfolioMetrics(portfolioDoc) {
  if (!portfolioDoc?.positions?.length) return null;

  const positions = portfolioDoc.positions.filter(p => p.ticker && p.shares);
  if (!positions.length) return null;

  const stocks = _marketState?.stocks || {};

  // Compute market values
  let totalValue = 0;
  const holdings = [];
  for (const pos of positions) {
    const live = stocks[pos.ticker];
    const price = live?.price || pos.avgPrice || 0;
    const mktValue = Math.abs(pos.shares) * price;
    const changePct = live?.changePct ?? live?.changePercent ?? 0;

    holdings.push({
      ticker: pos.ticker,
      shares: pos.shares,
      avgPrice: pos.avgPrice || 0,
      currentPrice: price,
      marketValue: mktValue,
      changePct,
      gainPct: pos.avgPrice ? ((price - pos.avgPrice) / pos.avgPrice * 100) : 0,
      sector: guessSector(pos.ticker),
    });
    totalValue += mktValue;
  }

  if (totalValue === 0) return null;

  // Weights
  for (const h of holdings) {
    h.weight = (h.marketValue / totalValue * 100);
  }

  // Sort by weight desc
  holdings.sort((a, b) => b.weight - a.weight);

  // Sector breakdown
  const sectorMap = {};
  for (const h of holdings) {
    const s = h.sector || 'Other';
    sectorMap[s] = (sectorMap[s] || 0) + h.weight;
  }

  // Concentration metrics
  const top3Weight = holdings.slice(0, 3).reduce((s, h) => s + h.weight, 0);
  const top5Weight = holdings.slice(0, 5).reduce((s, h) => s + h.weight, 0);
  const hhi = holdings.reduce((s, h) => s + (h.weight / 100) ** 2, 0); // Herfindahl index

  return {
    totalValue,
    positionCount: holdings.length,
    holdings: holdings.slice(0, 15), // top 15 for AI
    sectorBreakdown: sectorMap,
    concentration: {
      top3Weight: Math.round(top3Weight * 10) / 10,
      top5Weight: Math.round(top5Weight * 10) / 10,
      hhi: Math.round(hhi * 1000) / 1000,
      isConcentrated: top3Weight > 50 || hhi > 0.15,
    },
    todayPnl: holdings.reduce((s, h) => s + h.marketValue * h.changePct / 100, 0),
  };
}

function guessSector(ticker) {
  const map = {
    AAPL: 'Tech', MSFT: 'Tech', NVDA: 'Tech', GOOGL: 'Tech', META: 'Tech', AMZN: 'Tech', TSLA: 'Tech',
    AMD: 'Tech', INTC: 'Tech', CRM: 'Tech', AVGO: 'Tech', ADBE: 'Tech',
    JPM: 'Finance', GS: 'Finance', MS: 'Finance', BAC: 'Finance', WFC: 'Finance', C: 'Finance',
    XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
    LLY: 'Healthcare', UNH: 'Healthcare', JNJ: 'Healthcare', PFE: 'Healthcare', ABBV: 'Healthcare',
    WMT: 'Consumer', COST: 'Consumer', NKE: 'Consumer', MCD: 'Consumer',
    CAT: 'Industrial', BA: 'Industrial', HON: 'Industrial', LMT: 'Defense',
    'VALE3.SA': 'Brazil', 'PETR4.SA': 'Brazil', 'ITUB4.SA': 'Brazil',
    VALE: 'Brazil', PBR: 'Brazil', EWZ: 'Brazil',
    SPY: 'Index ETF', QQQ: 'Index ETF', DIA: 'Index ETF', IWM: 'Index ETF',
    GLD: 'Commodities', SLV: 'Commodities', USO: 'Commodities',
  };
  return map[ticker] || 'Other';
}

/**
 * Build the portfolio autopsy system prompt.
 */
function buildPortfolioAutopsyPrompt(metrics) {
  const holdingsList = metrics.holdings
    .map(h => `${h.ticker}: ${h.weight.toFixed(1)}% ($${h.marketValue.toFixed(0)}) | today ${h.changePct > 0 ? '+' : ''}${h.changePct.toFixed(2)}% | gain ${h.gainPct > 0 ? '+' : ''}${h.gainPct.toFixed(1)}%`)
    .join('\n');

  const sectorList = Object.entries(metrics.sectorBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([s, w]) => `${s}: ${w.toFixed(1)}%`)
    .join(', ');

  let predContext = '';
  try {
    const preds = predictionAggregator.getTopMarkets?.(5) || [];
    if (preds.length) {
      predContext = preds.map(p => `${p.title}: ${(p.probability * 100).toFixed(0)}%`).join(' | ');
    }
  } catch (e) {}

  return `You are performing a Portfolio Autopsy — a thorough, structured analysis of the user's investment portfolio.

Portfolio Overview:
- Total value: $${metrics.totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
- Positions: ${metrics.positionCount}
- Today's P&L: ${metrics.todayPnl > 0 ? '+' : ''}$${metrics.todayPnl.toFixed(0)}
- Top 3 concentration: ${metrics.concentration.top3Weight}%
- Top 5 concentration: ${metrics.concentration.top5Weight}%
- HHI: ${metrics.concentration.hhi} (${metrics.concentration.isConcentrated ? 'CONCENTRATED' : 'diversified'})

Holdings:
${holdingsList}

Sector Breakdown: ${sectorList}

${predContext ? `Prediction Markets: ${predContext}` : ''}

Provide analysis in these EXACT sections using markdown headers:

### Overview
Brief 2-sentence portfolio summary (size, posture, today's performance).

### Concentration Risk
Is the portfolio too concentrated? Which positions dominate? What's the single-stock risk?

### Sector Exposure
Which sectors are overweight/underweight? Any blind spots? Geographic concentration?

### What's Working / What's Not
Top performers vs. laggards. Any positions that need attention?

### Risk Factors
Key risks given current market conditions and prediction market data. What scenarios would hurt this portfolio most?

### Actionable Ideas
2-3 specific, practical suggestions (hedging, rebalancing, or positions to watch). Not investment advice — framed as considerations.

Keep total response under 400 words. Be specific with numbers. Sound like a portfolio strategist, not a textbook.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11B. COUNTER-THESIS GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract thesis components from user query.
 * Returns: { ticker, direction, reasoning }
 */
function extractThesis(query) {
  const result = { ticker: null, direction: null, reasoning: '' };

  // Direction
  if (/bullish|bull.*case|long|buy|upside/i.test(query)) result.direction = 'bullish';
  else if (/bearish|bear.*case|short|sell|downside/i.test(query)) result.direction = 'bearish';

  // Ticker extraction
  const tickerMatch = query.match(/\$([A-Z]{1,5}(?:\.[A-Z]{1,2})?)/);
  if (tickerMatch) {
    result.ticker = tickerMatch[1];
  } else {
    // Try bare ticker mentions
    const bare = query.match(/\b([A-Z]{2,5})\b/g);
    if (bare) {
      // Pick the most likely ticker (not common English words)
      const stopWords = new Set(['THE', 'AND', 'FOR', 'NOT', 'BUT', 'WHAT', 'HOW', 'WHY', 'AM', 'ON', 'IF', 'MY']);
      result.ticker = bare.find(w => !stopWords.has(w)) || null;
    }
  }

  return result;
}

function buildCounterThesisPrompt(thesis, query) {
  const dir = thesis.direction === 'bullish' ? 'bearish' : 'bullish';
  const counterDir = thesis.direction === 'bullish' ? 'bear' : 'bull';

  let tickerContext = '';
  if (thesis.ticker && _marketState?.stocks?.[thesis.ticker]) {
    const d = _marketState.stocks[thesis.ticker];
    tickerContext = `\nCurrent data for $${thesis.ticker}: Price $${d.price || 'N/A'}, Today ${d.changePct > 0 ? '+' : ''}${(d.changePct || 0).toFixed(2)}%`;
  }

  let predContext = '';
  try {
    const preds = predictionAggregator.getForQuery?.(thesis.ticker || query) || [];
    if (preds.length) {
      predContext = '\nRelevant prediction markets: ' +
        preds.slice(0, 3).map(p => `${p.title}: ${(p.probability * 100).toFixed(0)}%`).join(' | ');
    }
  } catch (e) {}

  return `You are the Counter-Thesis Generator. The user has a ${thesis.direction || 'bullish'} conviction${thesis.ticker ? ` on $${thesis.ticker}` : ''}. Your job is to construct the STRONGEST possible ${counterDir} case — the best argument the opposing side would make.

User's stated thesis: "${query}"
${tickerContext}${predContext}

Respond with these EXACT sections using markdown headers:

### The Counter-Thesis
1-2 sentence summary of the strongest opposing argument.

### Key Risks
3-4 specific risks that could invalidate the user's thesis. Be concrete with data points.

### Valuation Concerns
Is current pricing justified? What metrics suggest over/under-valuation?

### Catalysts Against
What upcoming events, data releases, or market dynamics could move against this thesis?

### What Prediction Markets Say
Reference any relevant prediction market probabilities that bear on this thesis.

### What Would Change My Mind
Under what conditions would the counter-thesis weaken? What would the user need to see?

Rules:
- Be the strongest possible devil's advocate
- Use specific numbers, dates, and data when available
- Don't hedge or equivocate — argue the opposing case forcefully
- Keep under 350 words
- End with acknowledgment that this is the opposing view, not investment advice`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 11C. SCENARIO ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

function buildScenarioPrompt(query, userId) {
  let portfolioContext = '';
  if (_getPortfolio && userId) {
    const doc = _getPortfolio(userId);
    if (doc?.positions?.length) {
      const tickers = doc.positions.slice(0, 10).map(p => `$${p.ticker}`).join(', ');
      portfolioContext = `\nUser's portfolio includes: ${tickers}`;
    }
  }

  let predContext = '';
  try {
    const preds = predictionAggregator.getTopMarkets?.(6) || [];
    if (preds.length) {
      predContext = '\nCurrent prediction market probabilities:\n' +
        preds.map(p => `- ${p.title}: ${(p.probability * 100).toFixed(0)}%`).join('\n');
    }
  } catch (e) {}

  return `You are a Scenario Analyst. The user wants to explore a hypothetical market scenario and understand its implications.

User's scenario question: "${query}"
${portfolioContext}${predContext}

Respond with these EXACT sections using markdown headers:

### Scenario Summary
Restate the scenario clearly in 1 sentence.

### Market Impact
How would this scenario affect major indices, sectors, and asset classes? Be specific about direction and magnitude.

### Portfolio Implications
How would the user's holdings be affected? Winners and losers under this scenario.${portfolioContext ? '' : ' (No portfolio data available — discuss in general terms.)'}

### Probability Assessment
How likely is this scenario? Reference prediction market data where available.

### Historical Precedent
Has something similar happened before? What was the market impact?

### Positioning Ideas
How might an investor position for this scenario? What hedges make sense?

Keep under 350 words. Use specific tickers and numbers. Frame as analysis, not advice.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED SYSTEM PROMPT — injected when deep analysis is detected
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get an enhanced system prompt for deep analysis queries.
 * Returns null if the query isn't a deep analysis intent.
 */
function getAnalysisPrompt(query, userId) {
  const intent = detectAnalysisIntent(query);
  if (!intent) return null;

  switch (intent) {
    case 'portfolio': {
      const doc = _getPortfolio?.(userId);
      const metrics = computePortfolioMetrics(doc);
      if (!metrics) {
        return {
          intent,
          prompt: 'The user wants a portfolio analysis but has no portfolio positions yet. Kindly let them know they need to add positions to their portfolio first, then offer to help with general market analysis instead.',
        };
      }
      return { intent, prompt: buildPortfolioAutopsyPrompt(metrics), metrics };
    }

    case 'counter_thesis': {
      const thesis = extractThesis(query);
      return { intent, prompt: buildCounterThesisPrompt(thesis, query), thesis };
    }

    case 'scenario': {
      return { intent, prompt: buildScenarioPrompt(query, userId) };
    }

    default:
      return null;
  }
}

module.exports = {
  init,
  detectAnalysisIntent,
  getAnalysisPrompt,
  computePortfolioMetrics,
  extractThesis,
};
