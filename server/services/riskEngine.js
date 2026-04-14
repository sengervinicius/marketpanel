/**
 * riskEngine.js — Portfolio Risk Analytics Engine
 *
 * Pure mathematical functions for computing:
 * - Correlation matrices (Pearson)
 * - Value-at-Risk (VaR) — parametric 95% and 99%
 * - Maximum drawdown
 * - Sharpe and Sortino ratios
 * - Beta vs benchmark
 * - Sector concentration (HHI)
 * - Risk contribution per position
 *
 * All functions are stateless, deterministic, and unit-testable.
 * No external API calls or LLM involvement.
 */

const logger = require('../utils/logger');

// Constants
const TRADING_DAYS_YEAR = 252;
const RISK_FREE_RATE = 0.0525; // 5.25%

/**
 * Compute Pearson correlation matrix between assets
 * @param {Array<{symbol, returns: [number]}>} positionReturns - Position returns time series
 * @returns {Object} { symbols: [], matrix: [[...]] } - Lower triangular correlation matrix
 */
function computeCorrelationMatrix(positionReturns) {
  if (!Array.isArray(positionReturns) || positionReturns.length === 0) {
    return { symbols: [], matrix: [] };
  }

  const n = positionReturns.length;
  const symbols = positionReturns.map(p => p.symbol);

  // Validate all positions have returns
  const validPositions = positionReturns.filter(p => Array.isArray(p.returns) && p.returns.length > 0);
  if (validPositions.length === 0) {
    return { symbols, matrix: [] };
  }

  // Ensure all return series have same length (pad with NaN if needed)
  const maxLen = Math.max(...validPositions.map(p => p.returns.length));
  const paddedReturns = validPositions.map(p => {
    const padded = [...p.returns];
    while (padded.length < maxLen) padded.push(NaN);
    return padded;
  });

  // Compute means (ignoring NaN)
  const means = paddedReturns.map(ret => {
    const valid = ret.filter(r => !isNaN(r));
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  });

  // Compute standard deviations (ignoring NaN)
  const stdevs = paddedReturns.map((ret, i) => {
    const valid = ret.filter(r => !isNaN(r));
    if (valid.length < 2) return 0;
    const meanVal = means[i];
    const variance = valid.reduce((sum, r) => sum + Math.pow(r - meanVal, 2), 0) / (valid.length - 1);
    return Math.sqrt(variance);
  });

  // Compute correlation matrix: (n x n)
  const corrMatrix = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        corrMatrix[i][j] = 1.0;
      } else if (stdevs[i] === 0 || stdevs[j] === 0) {
        corrMatrix[i][j] = 0;
        corrMatrix[j][i] = 0;
      } else {
        // Covariance: sum of (x_i - mean_i)(x_j - mean_j) / (n-1)
        let covar = 0;
        let count = 0;
        for (let k = 0; k < maxLen; k++) {
          if (!isNaN(paddedReturns[i][k]) && !isNaN(paddedReturns[j][k])) {
            covar += (paddedReturns[i][k] - means[i]) * (paddedReturns[j][k] - means[j]);
            count++;
          }
        }
        const correlation = count > 1 ? covar / (count - 1) / (stdevs[i] * stdevs[j]) : 0;
        corrMatrix[i][j] = Math.round(correlation * 10000) / 10000;
        corrMatrix[j][i] = corrMatrix[i][j];
      }
    }
  }

  return {
    symbols,
    matrix: corrMatrix.map(row => row.map(val => Math.round(val * 10000) / 10000)),
  };
}

/**
 * Compute parametric Value-at-Risk
 * Assumes normal distribution of returns.
 * @param {Array<number>} returns - Daily returns (as decimals, e.g., 0.01 for +1%)
 * @param {number} confidence - 0.95 or 0.99 (confidence level)
 * @param {number} horizon - 1 or 10 (trading days)
 * @param {number} portfolioValue - Current portfolio value
 * @returns {number} VaR in dollars (positive number = amount at risk)
 */
function computeVaR(returns, confidence, horizon, portfolioValue) {
  if (!Array.isArray(returns) || returns.length < 30 || !portfolioValue) {
    return 0;
  }

  // Filter valid returns
  const validReturns = returns.filter(r => typeof r === 'number' && !isNaN(r));
  if (validReturns.length < 30) {
    return 0;
  }

  // Compute mean and std dev
  const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
  const variance = validReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / validReturns.length;
  const stdDev = Math.sqrt(variance);

  // Z-score for confidence level
  const zScore = confidence === 0.99 ? 2.326 : 1.645; // 99% vs 95%

  // Daily VaR
  const dailyVaR = (mean + zScore * stdDev) * portfolioValue;

  // Scale to horizon (sqrt of days rule)
  const horizonVaR = dailyVaR * Math.sqrt(horizon);

  // Return as positive number (amount at risk)
  return Math.round(Math.abs(horizonVaR) * 100) / 100;
}

/**
 * Compute maximum drawdown from historical returns
 * @param {Array<number>} prices - Historical prices in chronological order
 * @returns {number} Maximum drawdown as percentage (0-100)
 */
function computeMaxDrawdown(prices) {
  if (!Array.isArray(prices) || prices.length < 2) {
    return 0;
  }

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

  return Math.round(maxDD * 10000) / 100; // Convert to percentage, 2 decimals
}

/**
 * Compute Sharpe ratio (annualized)
 * @param {Array<number>} returns - Daily returns (as decimals)
 * @param {number} riskFreeRate - Annual risk-free rate (e.g., 0.0525 for 5.25%)
 * @returns {number} Sharpe ratio
 */
function computeSharpeRatio(returns, riskFreeRate = RISK_FREE_RATE) {
  if (!Array.isArray(returns) || returns.length < 2) {
    return 0;
  }

  const validReturns = returns.filter(r => typeof r === 'number' && !isNaN(r));
  if (validReturns.length < 2) {
    return 0;
  }

  const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;
  const variance = validReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / validReturns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize
  const annualizedReturn = mean * TRADING_DAYS_YEAR;
  const annualizedStdDev = stdDev * Math.sqrt(TRADING_DAYS_YEAR);

  if (annualizedStdDev === 0) {
    return 0;
  }

  const sharpe = (annualizedReturn - riskFreeRate) / annualizedStdDev;
  return Math.round(sharpe * 100) / 100;
}

/**
 * Compute Sortino ratio (downside deviation only)
 * @param {Array<number>} returns - Daily returns (as decimals)
 * @param {number} riskFreeRate - Annual risk-free rate
 * @returns {number} Sortino ratio
 */
function computeSortinoRatio(returns, riskFreeRate = RISK_FREE_RATE) {
  if (!Array.isArray(returns) || returns.length < 2) {
    return 0;
  }

  const validReturns = returns.filter(r => typeof r === 'number' && !isNaN(r));
  if (validReturns.length < 2) {
    return 0;
  }

  const mean = validReturns.reduce((a, b) => a + b, 0) / validReturns.length;

  // Downside deviation: only count returns below the risk-free rate
  const dailyRiskFree = riskFreeRate / TRADING_DAYS_YEAR;
  const downsideVariance = validReturns.reduce((sum, r) => {
    const excess = r - dailyRiskFree;
    return sum + (excess < 0 ? excess * excess : 0);
  }, 0) / validReturns.length;
  const downsideStdDev = Math.sqrt(downsideVariance);

  if (downsideStdDev === 0) {
    return 0;
  }

  // Annualize
  const annualizedReturn = mean * TRADING_DAYS_YEAR;
  const annualizedDownsideStdDev = downsideStdDev * Math.sqrt(TRADING_DAYS_YEAR);

  const sortino = (annualizedReturn - riskFreeRate) / annualizedDownsideStdDev;
  return Math.round(sortino * 100) / 100;
}

/**
 * Compute portfolio beta vs benchmark
 * @param {Array<number>} portfolioReturns - Portfolio daily returns
 * @param {Array<number>} benchmarkReturns - Benchmark daily returns (typically SPY)
 * @returns {number} Beta (sensitivity to benchmark)
 */
function computeBeta(portfolioReturns, benchmarkReturns) {
  if (!Array.isArray(portfolioReturns) || !Array.isArray(benchmarkReturns)) {
    return 0;
  }

  // Trim to same length
  const len = Math.min(portfolioReturns.length, benchmarkReturns.length);
  if (len < 30) {
    return 0;
  }

  const pRet = portfolioReturns.slice(0, len).filter(r => !isNaN(r));
  const bRet = benchmarkReturns.slice(0, len).filter(r => !isNaN(r));

  if (pRet.length < 30 || bRet.length < 30) {
    return 0;
  }

  // Compute covariance(portfolio, benchmark) / variance(benchmark)
  const pMean = pRet.reduce((a, b) => a + b, 0) / pRet.length;
  const bMean = bRet.reduce((a, b) => a + b, 0) / bRet.length;

  let covariance = 0;
  let bVariance = 0;
  for (let i = 0; i < Math.min(pRet.length, bRet.length); i++) {
    covariance += (pRet[i] - pMean) * (bRet[i] - bMean);
    bVariance += Math.pow(bRet[i] - bMean, 2);
  }

  const n = Math.min(pRet.length, bRet.length);
  covariance /= n;
  bVariance /= n;

  if (bVariance === 0) {
    return 0;
  }

  const beta = covariance / bVariance;
  return Math.round(beta * 10000) / 10000;
}

/**
 * Compute sector concentration (Herfindahl-Hirschman Index)
 * @param {Array<{symbol, sector, weight}>} positions - Portfolio positions with weights
 * @returns {Object} { hhi: number, concentration: 'low'|'moderate'|'high' }
 */
function computeSectorConcentration(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { hhi: 0, concentration: 'low' };
  }

  const validPositions = positions.filter(p => p.sector && typeof p.weight === 'number');
  if (validPositions.length === 0) {
    return { hhi: 0, concentration: 'low' };
  }

  // Group weights by sector
  const sectorWeights = {};
  validPositions.forEach(p => {
    sectorWeights[p.sector] = (sectorWeights[p.sector] || 0) + p.weight;
  });

  // Compute HHI: sum of squared weights
  const hhi = Object.values(sectorWeights).reduce((sum, w) => sum + Math.pow(w, 2), 0);

  // HHI interpretation:
  // < 1500: unconcentrated, 1500-2500: moderate, > 2500: highly concentrated
  let concentration = 'low';
  if (hhi > 2500) {
    concentration = 'high';
  } else if (hhi > 1500) {
    concentration = 'moderate';
  }

  return {
    hhi: Math.round(hhi * 100) / 100,
    concentration,
    bySektor: Object.entries(sectorWeights).map(([sector, weight]) => ({
      sector,
      weight: Math.round(weight * 100) / 100,
    })),
  };
}

/**
 * Compute marginal risk contribution per position
 * Uses variance contribution: (weight * variance of asset / portfolio variance)
 * @param {Array<{symbol, weight}>} positions - Positions with portfolio weights
 * @param {Array<number>} covarianceMatrix - Full covariance matrix (n x n)
 * @param {number} portfolioVariance - Total portfolio variance
 * @returns {Array<{symbol, riskContribution}>}
 */
function computeRiskContribution(positions, covarianceMatrix, portfolioVariance) {
  if (!Array.isArray(positions) || !Array.isArray(covarianceMatrix) || !portfolioVariance) {
    return [];
  }

  if (covarianceMatrix.length === 0 || portfolioVariance === 0) {
    return positions.map(p => ({ symbol: p.symbol, riskContribution: 0 }));
  }

  const n = positions.length;
  const weights = positions.map(p => (p.weight || 0) / 100); // Convert from percentage

  const contributions = [];

  for (let i = 0; i < n; i++) {
    // Marginal contribution: sum(weight_j * covariance_ij) / portfolio_variance
    let marginality = 0;
    for (let j = 0; j < n; j++) {
      if (covarianceMatrix[i] && typeof covarianceMatrix[i][j] === 'number') {
        marginality += weights[j] * covarianceMatrix[i][j];
      }
    }

    const riskContribution = portfolioVariance > 0 ? (weights[i] * marginality) / portfolioVariance : 0;
    contributions.push({
      symbol: positions[i].symbol,
      riskContribution: Math.round(riskContribution * 10000) / 100, // As percentage
    });
  }

  return contributions;
}

module.exports = {
  computeCorrelationMatrix,
  computeVaR,
  computeMaxDrawdown,
  computeSharpeRatio,
  computeSortinoRatio,
  computeBeta,
  computeSectorConcentration,
  computeRiskContribution,
};
