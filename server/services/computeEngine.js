/**
 * computeEngine.js — Deterministic Financial Computation Layer
 *
 * LLMs cannot reliably perform math. This service provides pre-computed,
 * deterministic financial metrics that are injected into the AI prompt.
 *
 * Never use the LLM for:
 *   - P&L calculations
 *   - Portfolio allocation math
 *   - Return calculations
 *   - Position sizing
 *   - Ratio comparisons
 *
 * Instead: compute server-side, inject as "PRE-COMPUTED METRICS" in the system prompt,
 * and tell the LLM: "NEVER do math in your head. Use the PRE-COMPUTED values below."
 */

const logger = require('../utils/logger');

// Constants
const RISK_FREE_RATE = 0.0525; // 5.25% (approximate current Fed funds)
const TRADING_DAYS_YEAR = 252;

/**
 * Compute comprehensive portfolio metrics
 * @param {Array} positions - Array of { symbol, shares, avgCost, currentPrice }
 * @returns {Object} { totalValue, totalCost, totalPnL, totalPnLPct, dayPnL, dayPnLPct, positions: [...] }
 */
function computePortfolioMetrics(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return {
      totalValue: 0,
      totalCost: 0,
      totalPnL: 0,
      totalPnLPct: 0,
      dayPnL: 0,
      dayPnLPct: 0,
      positions: [],
    };
  }

  let totalValue = 0;
  let totalCost = 0;
  let totalDayPnL = 0;
  let totalDayPnLPct = 0;
  let dayPriceChg = 0; // Sum of daily changes (for weighted average daily pct)

  const computedPositions = positions.map((pos) => {
    const { symbol, shares, avgCost, currentPrice, dayPriceChange = 0 } = pos;

    const positionCost = shares * avgCost;
    const positionValue = shares * currentPrice;
    const positionPnL = positionValue - positionCost;
    const positionPnLPct = positionCost > 0 ? (positionPnL / positionCost) * 100 : 0;

    // Day P&L: dailyChange * shares (assumes dayPriceChange is per-share change)
    const posDayPnL = dayPriceChange * shares;
    totalDayPnL += posDayPnL;

    totalValue += positionValue;
    totalCost += positionCost;
    dayPriceChg += dayPriceChange * shares; // Track weighted price change

    return {
      symbol,
      shares: Math.round(shares * 100) / 100, // 2 decimals
      avgCost: Math.round(avgCost * 100) / 100,
      currentPrice: Math.round(currentPrice * 100) / 100,
      value: Math.round(positionValue * 100) / 100,
      cost: Math.round(positionCost * 100) / 100,
      pnl: Math.round(positionPnL * 100) / 100,
      pnlPct: Math.round(positionPnLPct * 100) / 100,
      weight: 0, // Set below after total is known
      dayPnL: Math.round(posDayPnL * 100) / 100,
    };
  });

  // Set position weights
  computedPositions.forEach((pos) => {
    pos.weight = totalValue > 0 ? Math.round((pos.value / totalValue) * 10000) / 100 : 0; // 2 decimals
  });

  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const dayPnLPct = totalValue > 0 ? (totalDayPnL / totalValue) * 100 : 0;

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    totalPnL: Math.round(totalPnL * 100) / 100,
    totalPnLPct: Math.round(totalPnLPct * 100) / 100,
    dayPnL: Math.round(totalDayPnL * 100) / 100,
    dayPnLPct: Math.round(dayPnLPct * 100) / 100,
    positions: computedPositions,
  };
}

/**
 * Compute return statistics from a time series of prices
 * @param {Array<number>} prices - Historical prices in chronological order
 * @returns {Object} { dailyReturn, weeklyReturn, monthlyReturn, ytdReturn, volatility30d, sharpeRatio, maxDrawdown }
 */
function computeReturns(prices) {
  if (!Array.isArray(prices) || prices.length < 2) {
    return {
      dailyReturn: 0,
      weeklyReturn: 0,
      monthlyReturn: 0,
      ytdReturn: 0,
      volatility30d: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
    };
  }

  const n = prices.length;
  const dailyReturns = [];

  // Calculate daily log returns: ln(P_t / P_t-1)
  for (let i = 1; i < n; i++) {
    const ret = Math.log(prices[i] / prices[i - 1]);
    dailyReturns.push(ret);
  }

  // 1. Daily Return (last return)
  const dailyReturn = dailyReturns.length > 0 ? dailyReturns[dailyReturns.length - 1] : 0;

  // 2. Weekly Return (5 days back, or less if not available)
  const weeklyReturn = dailyReturns.length >= 5
    ? dailyReturns.slice(-5).reduce((a, b) => a + b, 0)
    : dailyReturns.reduce((a, b) => a + b, 0);

  // 3. Monthly Return (21 days back)
  const monthlyReturn = dailyReturns.length >= 21
    ? dailyReturns.slice(-21).reduce((a, b) => a + b, 0)
    : dailyReturns.reduce((a, b) => a + b, 0);

  // 4. YTD Return (252 days back ~ 1 year)
  const ytdReturn = dailyReturns.length >= 252
    ? dailyReturns.slice(-252).reduce((a, b) => a + b, 0)
    : dailyReturns.reduce((a, b) => a + b, 0);

  // 5. 30-day Volatility (standard deviation of last 30 daily returns)
  const volatilityWindow = Math.min(30, dailyReturns.length);
  const recentReturns = dailyReturns.slice(-volatilityWindow);
  const meanReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  const variance = recentReturns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / recentReturns.length;
  const volatility30d = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_YEAR); // Annualize

  // 6. Sharpe Ratio (return / volatility, adjusted for risk-free rate)
  const annualizedReturn = ytdReturn * TRADING_DAYS_YEAR;
  const sharpeRatio = volatility30d > 0 ? (annualizedReturn - RISK_FREE_RATE) / volatility30d : 0;

  // 7. Max Drawdown (largest peak-to-trough decline)
  let maxDD = 0;
  let peak = prices[0];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > peak) {
      peak = prices[i];
    }
    const dd = (peak - prices[i]) / peak;
    if (dd > maxDD) {
      maxDD = dd;
    }
  }

  return {
    dailyReturn: Math.round(dailyReturn * 10000) / 100, // Convert to % (2 decimals)
    weeklyReturn: Math.round(weeklyReturn * 10000) / 100,
    monthlyReturn: Math.round(monthlyReturn * 10000) / 100,
    ytdReturn: Math.round(ytdReturn * 10000) / 100,
    volatility30d: Math.round(volatility30d * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDD * 10000) / 100,
  };
}

/**
 * Compute position sizing for risk management
 * @param {Object} params - { portfolioValue, riskPct, entryPrice, stopLoss }
 * @returns {Object} { shares, dollarRisk, positionValue, positionPct }
 */
function computePositionSize({ portfolioValue, riskPct, entryPrice, stopLoss }) {
  if (!portfolioValue || !riskPct || !entryPrice || !stopLoss) {
    return {
      shares: 0,
      dollarRisk: 0,
      positionValue: 0,
      positionPct: 0,
    };
  }

  // Dollar risk = portfolio * risk percentage
  const dollarRisk = portfolioValue * (riskPct / 100);

  // Price risk per share = entry - stop
  const priceRisk = Math.abs(entryPrice - stopLoss);

  // Shares = dollar risk / price risk
  const shares = priceRisk > 0 ? dollarRisk / priceRisk : 0;

  // Position value = shares * entry price
  const positionValue = shares * entryPrice;

  // Position % of portfolio
  const positionPct = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;

  return {
    shares: Math.round(shares * 100) / 100,
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    positionValue: Math.round(positionValue * 100) / 100,
    positionPct: Math.round(positionPct * 100) / 100,
  };
}

/**
 * Compute relative valuation metrics vs sector
 * @param {Object} params - { pe, sectorPe, forwardPe, sectorForwardPe, pbv, sectorPbv }
 * @returns {Object} { peDiscount, forwardPeDiscount, pbvDiscount, verdict }
 */
function computeRelativeValue({ pe, sectorPe, forwardPe, sectorForwardPe, pbv, sectorPbv }) {
  const results = {
    peDiscount: null,
    forwardPeDiscount: null,
    pbvDiscount: null,
    verdict: 'fair',
  };

  // P/E discount: (stock PE - sector PE) / sector PE * 100
  if (pe && sectorPe && sectorPe > 0) {
    results.peDiscount = Math.round(((pe - sectorPe) / sectorPe) * 10000) / 100;
  }

  // Forward P/E discount
  if (forwardPe && sectorForwardPe && sectorForwardPe > 0) {
    results.forwardPeDiscount = Math.round(((forwardPe - sectorForwardPe) / sectorForwardPe) * 10000) / 100;
  }

  // P/B discount
  if (pbv && sectorPbv && sectorPbv > 0) {
    results.pbvDiscount = Math.round(((pbv - sectorPbv) / sectorPbv) * 10000) / 100;
  }

  // Verdict: average the discounts (negative = cheap)
  const discounts = [results.peDiscount, results.forwardPeDiscount, results.pbvDiscount].filter(d => d !== null);
  if (discounts.length > 0) {
    const avgDiscount = discounts.reduce((a, b) => a + b, 0) / discounts.length;
    if (avgDiscount < -15) {
      results.verdict = 'cheap';
    } else if (avgDiscount > 15) {
      results.verdict = 'rich';
    } else {
      results.verdict = 'fair';
    }
  }

  return results;
}

module.exports = {
  computePortfolioMetrics,
  computeReturns,
  computePositionSize,
  computeRelativeValue,
};
