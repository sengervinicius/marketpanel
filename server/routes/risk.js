/**
 * routes/risk.js — Portfolio Risk Analytics API
 *
 * Endpoints:
 *   GET /api/risk/portfolio/:portfolioId    — Full risk report (all metrics)
 *   GET /api/risk/correlation/:portfolioId  — Correlation matrix only
 *   GET /api/risk/var/:portfolioId          — VaR breakdown (95% and 99%)
 *   GET /api/risk/contribution/:portfolioId — Risk contribution per position
 *
 * All endpoints:
 *   - Require authentication (requireAuth middleware)
 *   - Rate limited: 20 req/min per user
 *   - Fetch historical prices from Polygon.io (90-day window)
 *   - Compute and return risk metrics as JSON
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getPortfolio } = require('../portfolioStore');
const {
  computeCorrelationMatrix,
  computeVaR,
  computeMaxDrawdown,
  computeSharpeRatio,
  computeSortinoRatio,
  computeBeta,
  computeSectorConcentration,
  computeRiskContribution,
} = require('../services/riskEngine');

const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const POLYGON_BASE_URL = 'https://api.polygon.io/v2/aggs/ticker';

/**
 * Fetch historical daily prices from Polygon.io
 * @param {string} ticker - Stock symbol
 * @param {string} from - Start date (YYYY-MM-DD)
 * @param {string} to - End date (YYYY-MM-DD)
 * @returns {Promise<Array<{date, close}>>} Prices in chronological order
 */
const PER_FETCH_TIMEOUT_MS = 5000; // 5s per-ticker timeout to prevent hung requests

async function fetchHistoricalPrices(ticker, from, to) {
  if (!POLYGON_API_KEY) {
    throw new Error('POLYGON_API_KEY not configured');
  }

  const url = `${POLYGON_BASE_URL}/${ticker}/range/1/day/${from}/${to}?apiKey=${POLYGON_API_KEY}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      logger.warn(`Polygon API error for ${ticker}: ${res.status}`);
      return [];
    }

    const data = await res.json();
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    // Sort by date ascending, extract close prices
    return data.results
      .sort((a, b) => a.t - b.t)
      .map(r => ({
        date: new Date(r.t).toISOString().split('T')[0],
        close: r.c,
      }));
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn(`Fetch timeout for ${ticker} after ${PER_FETCH_TIMEOUT_MS}ms`);
    } else {
      logger.error(`Failed to fetch prices for ${ticker}:`, err.message);
    }
    return [];
  }
}

/**
 * Convert prices to returns (log returns)
 * @param {Array<number>} prices - Historical prices
 * @returns {Array<number>} Daily log returns
 */
function priceToReturns(prices) {
  if (!Array.isArray(prices) || prices.length < 2) {
    return [];
  }

  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

/**
 * Fetch SPY (benchmark) prices for beta calculation
 */
async function fetchBenchmarkPrices(from, to) {
  return fetchHistoricalPrices('SPY', from, to);
}

/**
 * Helper: Format date for Polygon API (90 days back from today)
 */
function get90DaysAgo() {
  const today = new Date();
  const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fromDate = ninetyDaysAgo.toISOString().split('T')[0];
  const toDate = today.toISOString().split('T')[0];
  return { from: fromDate, to: toDate };
}

/**
 * GET /api/risk/portfolio/:portfolioId — Full risk report
 */
router.get('/portfolio/:portfolioId', async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const doc = getPortfolio(req.user.id);

    if (!doc) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    // Find the requested portfolio
    const portfolio = doc.portfolios.find(p => p.id === portfolioId);
    if (!portfolio) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    // Get positions for this portfolio
    const positions = doc.positions.filter(pos => pos.portfolioId === portfolioId);
    if (positions.length === 0) {
      return res.json({
        portfolioId,
        metrics: {
          correlation: { symbols: [], matrix: [] },
          varAnalysis: { var95_1day: 0, var99_1day: 0, var95_10day: 0, var99_10day: 0 },
          maxDrawdown: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          beta: 0,
          sectorConcentration: { hhi: 0, concentration: 'low', bySector: [] },
          riskContribution: [],
        },
      });
    }

    // Fetch historical prices for all positions + SPY benchmark in parallel (90-day window)
    const { from, to } = get90DaysAgo();

    const priceMap = new Map();
    const requests = positions.map(async (pos) => {
      try {
        const prices = await fetchHistoricalPrices(pos.symbol, from, to);
        priceMap.set(pos.symbol, prices);
      } catch (err) {
        logger.warn(`Risk analysis: Failed to fetch ${pos.symbol}:`, err.message);
      }
    });

    // Include SPY in the parallel batch (used later for beta calculation)
    let benchmarkPrices = [];
    requests.push(
      fetchBenchmarkPrices(from, to)
        .then(prices => { benchmarkPrices = prices; })
        .catch(err => { logger.warn('Risk analysis: Failed to fetch SPY for beta:', err.message); })
    );

    await Promise.all(requests);

    // Calculate portfolio value for VaR
    let portfolioValue = 0;
    positions.forEach(pos => {
      const value = (pos.shares || 0) * (pos.currentPrice || 0);
      portfolioValue += value;
    });

    // Build position returns
    const positionReturns = [];
    let portfolioReturns = [];
    const covarianceMatrix = [];

    for (const pos of positions) {
      const prices = priceMap.get(pos.symbol);
      if (!prices || prices.length < 10) {
        continue;
      }

      const closes = prices.map(p => p.close);
      const returns = priceToReturns(closes);

      if (returns.length > 0) {
        positionReturns.push({
          symbol: pos.symbol,
          returns,
        });

        // Accumulate portfolio returns (weighted by position value)
        const posValue = (pos.shares || 0) * (pos.currentPrice || 0);
        const weight = portfolioValue > 0 ? posValue / portfolioValue : 0;

        if (portfolioReturns.length === 0) {
          portfolioReturns = returns.map(r => r * weight);
        } else {
          // Only sync on matching length
          const minLen = Math.min(portfolioReturns.length, returns.length);
          portfolioReturns = portfolioReturns.slice(0, minLen);
          for (let i = 0; i < minLen; i++) {
            portfolioReturns[i] += returns[i] * weight;
          }
        }
      }
    }

    // If not enough data, return zeros
    if (positionReturns.length === 0) {
      return res.json({
        portfolioId,
        metrics: {
          correlation: { symbols: [], matrix: [] },
          varAnalysis: { var95_1day: 0, var99_1day: 0, var95_10day: 0, var99_10day: 0 },
          maxDrawdown: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          beta: 0,
          sectorConcentration: { hhi: 0, concentration: 'low', bySector: [] },
          riskContribution: [],
        },
      });
    }

    // Compute correlation
    const correlation = computeCorrelationMatrix(positionReturns);

    // Compute VaR (95% and 99%, 1-day and 10-day)
    const var95_1day = computeVaR(portfolioReturns, 0.95, 1, portfolioValue);
    const var99_1day = computeVaR(portfolioReturns, 0.99, 1, portfolioValue);
    const var95_10day = computeVaR(portfolioReturns, 0.95, 10, portfolioValue);
    const var99_10day = computeVaR(portfolioReturns, 0.99, 10, portfolioValue);

    // Compute max drawdown from prices
    let maxDrawdown = 0;
    for (const pos of positions) {
      const prices = priceMap.get(pos.symbol);
      if (prices && prices.length > 1) {
        const closes = prices.map(p => p.close);
        const dd = computeMaxDrawdown(closes);
        maxDrawdown = Math.max(maxDrawdown, dd);
      }
    }

    // Compute Sharpe and Sortino
    const sharpeRatio = computeSharpeRatio(portfolioReturns);
    const sortinoRatio = computeSortinoRatio(portfolioReturns);

    // Compute beta vs SPY (benchmarkPrices fetched in parallel above)
    let beta = 0;
    if (benchmarkPrices.length > 10) {
      const benchmarkCloses = benchmarkPrices.map(p => p.close);
      const benchmarkReturns = priceToReturns(benchmarkCloses);
      beta = computeBeta(portfolioReturns, benchmarkReturns);
    }

    // Compute sector concentration
    const positionsWithSector = positions.map(p => ({
      symbol: p.symbol,
      sector: p.sector || 'Unknown',
      weight: portfolioValue > 0 ? (((p.shares || 0) * (p.currentPrice || 0)) / portfolioValue) * 100 : 0,
    }));
    const sectorConcentration = computeSectorConcentration(positionsWithSector);

    // Compute risk contribution (simplified: equal contribution if no covariance data)
    const riskContribution = positionReturns.map(pr => ({
      symbol: pr.symbol,
      riskContribution: (100 / positionReturns.length),
    }));

    return res.json({
      portfolioId,
      metrics: {
        correlation,
        varAnalysis: {
          var95_1day,
          var99_1day,
          var95_10day,
          var99_10day,
        },
        maxDrawdown,
        sharpeRatio,
        sortinoRatio,
        beta,
        sectorConcentration,
        riskContribution,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('GET /risk/portfolio/:portfolioId error:', err.message);
    sendApiError(res, 500, 'Failed to compute risk metrics');
  }
});

/**
 * GET /api/risk/correlation/:portfolioId — Correlation matrix only
 */
router.get('/correlation/:portfolioId', async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const doc = getPortfolio(req.user.id);

    if (!doc) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const portfolio = doc.portfolios.find(p => p.id === portfolioId);
    if (!portfolio) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const positions = doc.positions.filter(pos => pos.portfolioId === portfolioId);
    if (positions.length === 0) {
      return res.json({ portfolioId, correlation: { symbols: [], matrix: [] } });
    }

    const { from, to } = get90DaysAgo();
    const priceMap = new Map();

    const requests = positions.map(async (pos) => {
      try {
        const prices = await fetchHistoricalPrices(pos.symbol, from, to);
        priceMap.set(pos.symbol, prices);
      } catch (err) {
        logger.warn(`Correlation: Failed to fetch ${pos.symbol}:`, err.message);
      }
    });

    await Promise.all(requests);

    const positionReturns = [];
    for (const pos of positions) {
      const prices = priceMap.get(pos.symbol);
      if (!prices || prices.length < 10) {
        continue;
      }

      const closes = prices.map(p => p.close);
      const returns = priceToReturns(closes);

      if (returns.length > 0) {
        positionReturns.push({
          symbol: pos.symbol,
          returns,
        });
      }
    }

    const correlation = computeCorrelationMatrix(positionReturns);
    return res.json({ portfolioId, correlation });
  } catch (err) {
    logger.error('GET /risk/correlation/:portfolioId error:', err.message);
    sendApiError(res, 500, 'Failed to compute correlation');
  }
});

/**
 * GET /api/risk/var/:portfolioId — VaR breakdown
 */
router.get('/var/:portfolioId', async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const doc = getPortfolio(req.user.id);

    if (!doc) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const portfolio = doc.portfolios.find(p => p.id === portfolioId);
    if (!portfolio) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const positions = doc.positions.filter(pos => pos.portfolioId === portfolioId);
    if (positions.length === 0) {
      return res.json({
        portfolioId,
        varAnalysis: { var95_1day: 0, var99_1day: 0, var95_10day: 0, var99_10day: 0 },
      });
    }

    const { from, to } = get90DaysAgo();
    const priceMap = new Map();

    const requests = positions.map(async (pos) => {
      try {
        const prices = await fetchHistoricalPrices(pos.symbol, from, to);
        priceMap.set(pos.symbol, prices);
      } catch (err) {
        logger.warn(`VaR: Failed to fetch ${pos.symbol}:`, err.message);
      }
    });

    await Promise.all(requests);

    // Calculate portfolio value and returns
    let portfolioValue = 0;
    positions.forEach(pos => {
      portfolioValue += (pos.shares || 0) * (pos.currentPrice || 0);
    });

    let portfolioReturns = [];
    for (const pos of positions) {
      const prices = priceMap.get(pos.symbol);
      if (!prices || prices.length < 10) {
        continue;
      }

      const closes = prices.map(p => p.close);
      const returns = priceToReturns(closes);

      if (returns.length > 0) {
        const posValue = (pos.shares || 0) * (pos.currentPrice || 0);
        const weight = portfolioValue > 0 ? posValue / portfolioValue : 0;

        if (portfolioReturns.length === 0) {
          portfolioReturns = returns.map(r => r * weight);
        } else {
          const minLen = Math.min(portfolioReturns.length, returns.length);
          portfolioReturns = portfolioReturns.slice(0, minLen);
          for (let i = 0; i < minLen; i++) {
            portfolioReturns[i] += returns[i] * weight;
          }
        }
      }
    }

    const var95_1day = computeVaR(portfolioReturns, 0.95, 1, portfolioValue);
    const var99_1day = computeVaR(portfolioReturns, 0.99, 1, portfolioValue);
    const var95_10day = computeVaR(portfolioReturns, 0.95, 10, portfolioValue);
    const var99_10day = computeVaR(portfolioReturns, 0.99, 10, portfolioValue);

    return res.json({
      portfolioId,
      varAnalysis: {
        var95_1day,
        var99_1day,
        var95_10day,
        var99_10day,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('GET /risk/var/:portfolioId error:', err.message);
    sendApiError(res, 500, 'Failed to compute VaR');
  }
});

/**
 * GET /api/risk/contribution/:portfolioId — Risk contribution per position
 */
router.get('/contribution/:portfolioId', async (req, res) => {
  try {
    const { portfolioId } = req.params;
    const doc = getPortfolio(req.user.id);

    if (!doc) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const portfolio = doc.portfolios.find(p => p.id === portfolioId);
    if (!portfolio) {
      return sendApiError(res, 404, 'Portfolio not found');
    }

    const positions = doc.positions.filter(pos => pos.portfolioId === portfolioId);
    if (positions.length === 0) {
      return res.json({ portfolioId, riskContribution: [] });
    }

    // Simplified: equal contribution for now (full analysis would use covariance matrix)
    const riskContribution = positions.map(p => ({
      symbol: p.symbol,
      shares: p.shares,
      currentPrice: p.currentPrice,
      positionValue: (p.shares || 0) * (p.currentPrice || 0),
      riskContribution: (100 / positions.length),
    }));

    return res.json({
      portfolioId,
      riskContribution,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('GET /risk/contribution/:portfolioId error:', err.message);
    sendApiError(res, 500, 'Failed to compute risk contribution');
  }
});

module.exports = router;
