/**
 * routes/screener.js — Fundamental screener over curated instrument universes
 *
 * POST /api/screener/run
 */

const express = require('express');
const router  = express.Router();
const { getUniverse, listUniverses } = require('../screenerUniverse');
const { BY_KEY, REGISTRY } = require('./instruments');
const { sendApiError } = require('../utils/apiError');
const { clampInt } = require('../utils/validate');
const logger = require('../utils/logger');

// Derive country from instrument metadata
function deriveCountry(inst) {
  if (!inst) return 'Unknown';
  if (inst.currency === 'BRL' || inst.group?.includes('Brazil')) return 'BR';
  if (inst.exchange === 'NYSE' || inst.exchange === 'NASDAQ') return 'US';
  if (inst.currency === 'GBP') return 'GB';
  if (inst.currency === 'EUR') return 'EU';
  if (inst.currency === 'JPY') return 'JP';
  if (inst.currency === 'AUD') return 'AU';
  if (inst.currency === 'CAD') return 'CA';
  return 'US'; // default
}

// Derive sector from group metadata
function deriveSector(inst) {
  if (!inst) return 'Unknown';
  const g = inst.group || '';
  if (/Tech/i.test(g)) return 'Technology';
  if (/Financial/i.test(g)) return 'Financial';
  if (/Energy/i.test(g)) return 'Energy';
  if (/Industrial/i.test(g)) return 'Industrial';
  if (/Consumer/i.test(g)) return 'Consumer';
  if (/Healthcare/i.test(g)) return 'Healthcare';
  if (/Auto/i.test(g)) return 'Auto';
  if (/Mining|Metal/i.test(g)) return 'Materials';
  if (/Agri/i.test(g)) return 'Agriculture';
  if (/Yield|Bond/i.test(g)) return 'Fixed Income';
  if (/Indices|Index/i.test(g)) return 'Index';
  if (g.includes('Brazil')) return 'Diversified';
  return 'Diversified';
}

// Simple Yahoo Finance batch quote fetcher (reuses the same API pattern as market routes)
const fetch = require('node-fetch');

async function batchQuotes(symbols) {
  // Use Yahoo Finance v7 quote endpoint for batch data
  const results = {};
  if (!symbols.length) return results;

  // Split into chunks of 20 to avoid URL length issues
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 20) {
    chunks.push(symbols.slice(i, i + 20));
  }

  for (const chunk of chunks) {
    // Normalize symbols for Yahoo: .SA stays, but crypto needs X: → -USD, forex needs C: stripped
    const yahooSymbols = chunk.map(s => {
      if (s.endsWith('.SA')) return s;
      // For the screener universe, all symbols are plain equity/etf tickers
      return s;
    });

    try {
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSymbols.join(',')}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 MarketPanel/1.0' },
        timeout: 10000,
      });
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.quoteResponse?.result || [];
      for (const q of quotes) {
        const sym = q.symbol;
        results[sym.toUpperCase()] = {
          price: q.regularMarketPrice ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          volume: q.regularMarketVolume ?? null,
          marketCap: q.marketCap ?? null,
        };
      }
    } catch (err) {
      logger.warn('screener', 'Yahoo batch quote error', { error: err.message, chunkSize: chunk.length });
    }
  }
  return results;
}

/**
 * POST /api/screener/run
 */
router.post('/run', async (req, res) => {
  try {
    const { universe: universeId = 'GLOBAL_CORE', filters = {}, limit: rawLimit } = req.body || {};
    const limit = clampInt(rawLimit, 1, 500, 200);

    // Validate universe
    const symbols = getUniverse(universeId);
    if (!symbols) {
      return sendApiError(res,
        { message: `Unknown universe: ${universeId}. Available: ${listUniverses().join(', ')}`, code: 'bad_request' },
        'POST /api/screener/run'
      );
    }

    // Validate filters
    if (filters && typeof filters !== 'object') {
      return sendApiError(res,
        { message: 'invalid_filters: filters must be an object', code: 'bad_request' },
        'POST /api/screener/run'
      );
    }

    // Resolve symbols → instrument metadata
    const instruments = symbols
      .map(sym => {
        const inst = BY_KEY[sym.toUpperCase()];
        if (!inst) return null;
        return {
          symbol: inst.symbolKey,
          name: inst.name,
          assetClass: inst.assetClass,
          country: deriveCountry(inst),
          sector: deriveSector(inst),
          exchange: inst.exchange || '',
          currency: inst.currency || 'USD',
        };
      })
      .filter(Boolean);

    // Fetch quotes in batch
    const quoteStart = Date.now();
    const quoteSymbols = instruments.map(i => i.symbol);
    const quotes = await batchQuotes(quoteSymbols);
    const quoteDurationMs = Date.now() - quoteStart;

    // Merge quotes into instruments
    let results = instruments.map(inst => {
      const q = quotes[inst.symbol.toUpperCase()] || {};
      return {
        ...inst,
        price: q.price ?? null,
        changePct: q.changePct != null ? parseFloat(q.changePct.toFixed(2)) : null,
        volume: q.volume ?? null,
        marketCap: q.marketCap ?? null,
      };
    });

    // Apply filters
    const {
      assetClass, country, sector,
      minPrice, maxPrice,
      minMarketCap, maxMarketCap,
      minVolume, maxVolume,
    } = filters;

    if (assetClass) {
      const classes = Array.isArray(assetClass) ? assetClass : [assetClass];
      results = results.filter(r => classes.includes(r.assetClass));
    }
    if (country) {
      const countries = Array.isArray(country) ? country : [country];
      results = results.filter(r => countries.includes(r.country));
    }
    if (sector) {
      const sectors = Array.isArray(sector) ? sector : [sector];
      results = results.filter(r => sectors.includes(r.sector));
    }
    if (minPrice != null && typeof minPrice === 'number') {
      results = results.filter(r => r.price != null && r.price >= minPrice);
    }
    if (maxPrice != null && typeof maxPrice === 'number') {
      results = results.filter(r => r.price != null && r.price <= maxPrice);
    }
    if (minMarketCap != null && typeof minMarketCap === 'number') {
      results = results.filter(r => r.marketCap != null && r.marketCap >= minMarketCap);
    }
    if (maxMarketCap != null && typeof maxMarketCap === 'number') {
      results = results.filter(r => r.marketCap != null && r.marketCap <= maxMarketCap);
    }
    if (minVolume != null && typeof minVolume === 'number') {
      results = results.filter(r => r.volume != null && r.volume >= minVolume);
    }
    if (maxVolume != null && typeof maxVolume === 'number') {
      results = results.filter(r => r.volume != null && r.volume <= maxVolume);
    }

    // Sort by volume descending (liquidity first)
    results.sort((a, b) => (b.volume || 0) - (a.volume || 0));

    // Cap to limit
    results = results.slice(0, limit);

    logger.info('screener', 'Run completed', {
      universe: universeId,
      symbolCount: quoteSymbols.length,
      quoteDurationMs,
      filterCount: Object.keys(filters).length,
      resultCount: results.length,
      reqId: req.reqId,
    });

    res.json({
      ok: true,
      universe: universeId,
      count: results.length,
      results,
    });
  } catch (err) {
    logger.error('screener', 'Run failed', { error: err.message, reqId: req.reqId });
    sendApiError(res, err, 'POST /api/screener/run');
  }
});

module.exports = router;
