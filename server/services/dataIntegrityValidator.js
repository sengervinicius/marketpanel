/**
 * services/dataIntegrityValidator.js
 *
 * Async, post-serve data integrity validation for ALL market data domains.
 *
 * Design principles:
 *   - NEVER blocks the data pipeline — all checks are fire-and-forget
 *   - NEVER uses hardcoded bounds — rates/prices change, economies shift
 *   - Uses cross-referencing (comparing data points against each other)
 *   - Uses AI (Claude Haiku) ONLY when heuristics flag critical suspicion
 *   - Stores verdicts in memory for frontend consumption
 *   - Graceful degradation — if AI is unavailable, heuristic results still surface
 *   - Throttled — won't call AI more than once per domain per cooldown period
 *
 * Domains covered:
 *   yield-curves   — sovereign yield curve cross-country validation
 *   equities       — stock/ETF/index snapshot validation
 *   forex          — FX pair structural checks
 *   crypto         — crypto price/volume structural checks
 *   rates          — policy rate cross-reference (SELIC vs Fed Funds vs ECB)
 *   macro          — macro indicator plausibility
 *
 * Cost: ~$0.001 per AI call (Haiku), triggered only on suspicious data
 * Latency: 0ms on data pipeline; AI check runs async in ~200ms
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── In-memory verdict store ──────────────────────────────────────────────────
const _verdicts = new Map();
const VERDICT_TTL_MS = 10 * 60 * 1000; // 10 min

function getVerdict(domain) {
  const v = _verdicts.get(domain);
  if (!v) return null;
  if (Date.now() > v.expiresAt) { _verdicts.delete(domain); return null; }
  return v;
}

function setVerdict(domain, verdict) {
  _verdicts.set(domain, {
    ...verdict,
    checkedAt: new Date().toISOString(),
    expiresAt: Date.now() + VERDICT_TTL_MS,
  });
}

// ── AI call throttle — max 1 call per domain per 5 min ───────────────────────
const _aiCooldowns = new Map();
const AI_COOLDOWN_MS = 5 * 60 * 1000;

function canCallAI(domain) {
  const last = _aiCooldowns.get(domain);
  if (!last || Date.now() - last > AI_COOLDOWN_MS) return true;
  return false;
}
function markAICalled(domain) {
  _aiCooldowns.set(domain, Date.now());
}


// ══════════════════════════════════════════════════════════════════════════════
//  YIELD CURVES DOMAIN
// ══════════════════════════════════════════════════════════════════════════════

function yieldCurveHeuristics(payload) {
  const issues = [];

  // 1. Cross-curve similarity: structurally different economies should have different rates
  const WIDE_SPREAD_PAIRS = [['BR', 'US'], ['BR', 'EU'], ['BR', 'UK']];
  for (const [a, b] of WIDE_SPREAD_PAIRS) {
    const curveA = payload[a]?.curve;
    const curveB = payload[b]?.curve;
    if (!curveA?.length || !curveB?.length) continue;
    const mapA = Object.fromEntries(curveA.map(p => [p.tenor, p.rate]));
    const mapB = Object.fromEntries(curveB.map(p => [p.tenor, p.rate]));
    const common = Object.keys(mapA).filter(t => mapB[t] != null);
    if (common.length < 2) continue;
    const spreads = common.map(t => Math.abs(mapA[t] - mapB[t]));
    const avgSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;
    if (avgSpread < 1.5) {
      issues.push({
        type: 'CROSS_CURVE_SIMILARITY', severity: 'critical', domain: 'yield-curves',
        detail: `${a} and ${b} curves differ by only ${avgSpread.toFixed(2)}pp avg across ${common.length} tenors`,
      });
    }
  }

  // 2. Source-country mismatch
  const SOURCE_MAP = {
    BR: ['tesouro', 'bcb', 'b3'], US: ['treasury', 'fred', 'yahoo'],
    UK: ['bank of england', 'boe'], EU: ['ecb'],
    CH: ['snb', 'swiss confederation'],
  };
  for (const [country, entry] of Object.entries(payload)) {
    if (country.startsWith('_') || !entry?.source || !SOURCE_MAP[country]) continue;
    const src = entry.source.toLowerCase();
    for (const [other, srcs] of Object.entries(SOURCE_MAP)) {
      if (other === country) continue;
      if (srcs.some(s => src.includes(s))) {
        issues.push({
          type: 'SOURCE_MISMATCH', severity: 'critical', domain: 'yield-curves',
          detail: `${country} curve source "${entry.source}" belongs to ${other}`,
        });
      }
    }
  }

  // 3. Structural checks: flat curves, all identical
  for (const [country, entry] of Object.entries(payload)) {
    if (country.startsWith('_')) continue;
    const rates = (entry?.curve || []).map(p => p.rate).filter(r => r != null);
    if (rates.length > 2 && rates.every(r => r === rates[0])) {
      issues.push({
        type: 'FLAT_CURVE', severity: 'warning', domain: 'yield-curves',
        detail: `${country} curve: all ${rates.length} points at ${rates[0]}%`,
      });
    }
  }

  return issues;
}

function yieldCurveSummary(payload) {
  return Object.entries(payload)
    .filter(([k]) => !k.startsWith('_'))
    .map(([c, v]) => {
      const pts = (v.curve || [])
        .filter(p => ['1Y', '2Y', '5Y', '10Y', 'DI'].includes(p.tenor))
        .slice(0, 5).map(p => `${p.tenor}=${p.rate}%`);
      return `${c} (${v.source}): ${pts.join(', ')}`;
    }).join('\n');
}


// ══════════════════════════════════════════════════════════════════════════════
//  EQUITIES DOMAIN (stocks, ETFs, indices)
// ══════════════════════════════════════════════════════════════════════════════

function equityHeuristics(payload) {
  const issues = [];
  const tickers = payload?.tickers || [];
  if (!tickers.length) return issues;

  // 1. Duplicate tickers (same symbol appearing twice with different prices)
  const seen = new Map();
  for (const t of tickers) {
    const sym = t.ticker;
    if (!sym) continue;
    if (seen.has(sym)) {
      const prev = seen.get(sym);
      if (prev.price !== t.day?.c) {
        issues.push({
          type: 'DUPLICATE_TICKER', severity: 'warning', domain: 'equities',
          detail: `${sym} appears twice with different prices: ${prev.price} vs ${t.day?.c}`,
        });
      }
    }
    seen.set(sym, { price: t.day?.c });
  }

  // 2. Zero/null prices on major tickers (they should always have a price)
  const zeroPrice = tickers.filter(t => {
    const price = t.day?.c ?? t.min?.c;
    return price == null || price === 0;
  });
  if (zeroPrice.length > tickers.length * 0.5 && tickers.length > 3) {
    issues.push({
      type: 'MASS_ZERO_PRICES', severity: 'critical', domain: 'equities',
      detail: `${zeroPrice.length}/${tickers.length} tickers have null/zero prices — data source may be down`,
    });
  }

  // 3. All tickers showing identical change% (Yahoo returning stale/cached data)
  const changes = tickers.map(t => t.todaysChangePerc).filter(c => c != null && c !== 0);
  if (changes.length > 5) {
    const allSame = changes.every(c => c === changes[0]);
    if (allSame) {
      issues.push({
        type: 'IDENTICAL_CHANGES', severity: 'warning', domain: 'equities',
        detail: `All ${changes.length} tickers show identical change of ${changes[0]}% — stale data?`,
      });
    }
  }

  // 4. OHLC sanity: high < low, or close outside [low, high]
  for (const t of tickers) {
    const d = t.day;
    if (!d || d.h == null || d.l == null || d.c == null) continue;
    if (d.h < d.l) {
      issues.push({
        type: 'OHLC_INVALID', severity: 'warning', domain: 'equities',
        detail: `${t.ticker}: high (${d.h}) < low (${d.l})`,
      });
    }
    // Close significantly outside day range (>5% beyond) suggests wrong data
    if (d.h > 0 && d.l > 0 && d.c > 0) {
      const range = d.h - d.l;
      if (range > 0 && (d.c > d.h + range * 0.5 || d.c < d.l - range * 0.5)) {
        issues.push({
          type: 'CLOSE_OUTSIDE_RANGE', severity: 'info', domain: 'equities',
          detail: `${t.ticker}: close ${d.c} far outside day range [${d.l}, ${d.h}]`,
        });
      }
    }
  }

  return issues;
}

function equitySummary(payload) {
  const t = payload?.tickers || [];
  const sample = t.slice(0, 5).map(s => `${s.ticker}=$${s.day?.c ?? '?'} (${s.todaysChangePerc?.toFixed(1) ?? '?'}%)`);
  return `${t.length} tickers: ${sample.join(', ')}`;
}


// ══════════════════════════════════════════════════════════════════════════════
//  FOREX DOMAIN
// ══════════════════════════════════════════════════════════════════════════════

function forexHeuristics(payload) {
  const issues = [];
  const tickers = payload?.tickers || [];
  if (!tickers.length) return issues;

  // 1. Inverse pair check: if USDBRL and BRLUSD both exist, they should be reciprocals
  const byPair = new Map();
  for (const t of tickers) {
    const pair = (t.ticker || '').replace(/^C:/, '');
    if (pair.length === 6) byPair.set(pair, t.day?.c);
  }
  for (const [pair, rate] of byPair) {
    const inverse = pair.slice(3) + pair.slice(0, 3);
    if (byPair.has(inverse) && rate > 0 && byPair.get(inverse) > 0) {
      const product = rate * byPair.get(inverse);
      if (Math.abs(product - 1) > 0.05) { // >5% deviation from reciprocal
        issues.push({
          type: 'INVERSE_MISMATCH', severity: 'warning', domain: 'forex',
          detail: `${pair}=${rate} × ${inverse}=${byPair.get(inverse)} = ${product.toFixed(4)} (should ≈ 1.0)`,
        });
      }
    }
  }

  // 2. Mass null/zero rates
  const nullRates = tickers.filter(t => !t.day?.c || t.day.c === 0);
  if (nullRates.length > tickers.length * 0.5 && tickers.length > 3) {
    issues.push({
      type: 'MASS_NULL_FX', severity: 'critical', domain: 'forex',
      detail: `${nullRates.length}/${tickers.length} FX pairs have null/zero rates`,
    });
  }

  return issues;
}

function forexSummary(payload) {
  const t = payload?.tickers || [];
  return t.slice(0, 5).map(s => `${(s.ticker || '').replace('C:', '')}=${s.day?.c ?? '?'}`).join(', ');
}


// ══════════════════════════════════════════════════════════════════════════════
//  CRYPTO DOMAIN
// ══════════════════════════════════════════════════════════════════════════════

function cryptoHeuristics(payload) {
  const issues = [];
  const tickers = payload?.tickers || [];
  if (!tickers.length) return issues;

  // 1. BTC sanity: if BTC price is below major altcoin, data is wrong
  const btc = tickers.find(t => (t.ticker || '').includes('BTC'));
  const eth = tickers.find(t => (t.ticker || '').includes('ETH'));
  if (btc?.day?.c > 0 && eth?.day?.c > 0 && eth.day.c > btc.day.c) {
    issues.push({
      type: 'BTC_BELOW_ETH', severity: 'critical', domain: 'crypto',
      detail: `BTC ($${btc.day.c}) priced below ETH ($${eth.day.c}) — data source confusion`,
    });
  }

  // 2. Mass zero prices
  const zeroPrice = tickers.filter(t => !t.day?.c || t.day.c === 0);
  if (zeroPrice.length > tickers.length * 0.5 && tickers.length > 2) {
    issues.push({
      type: 'MASS_ZERO_CRYPTO', severity: 'critical', domain: 'crypto',
      detail: `${zeroPrice.length}/${tickers.length} crypto assets have null/zero prices`,
    });
  }

  // 3. Identical prices across different assets
  const prices = tickers.map(t => t.day?.c).filter(p => p > 0);
  if (prices.length > 2 && prices.every(p => p === prices[0])) {
    issues.push({
      type: 'IDENTICAL_CRYPTO_PRICES', severity: 'critical', domain: 'crypto',
      detail: `All ${prices.length} crypto assets show same price $${prices[0]}`,
    });
  }

  return issues;
}

function cryptoSummary(payload) {
  const t = payload?.tickers || [];
  return t.slice(0, 4).map(s => `${(s.ticker || '').replace('X:', '')}=$${s.day?.c ?? '?'}`).join(', ');
}


// ══════════════════════════════════════════════════════════════════════════════
//  RATES / POLICY RATES DOMAIN
// ══════════════════════════════════════════════════════════════════════════════

function ratesHeuristics(payload) {
  const issues = [];
  const results = payload?.results || [];
  if (!results.length) return issues;

  // 1. Policy rate cross-reference: SELIC, Fed Funds, ECB should all be different
  const policy = results.filter(r => r.type === 'policy');
  if (policy.length >= 2) {
    const rates = policy.map(r => ({ name: r.name, rate: r.price })).filter(r => r.rate > 0);
    // Check if all policy rates are identical (data pipeline returning same value)
    if (rates.length >= 2 && rates.every(r => r.rate === rates[0].rate)) {
      issues.push({
        type: 'IDENTICAL_POLICY_RATES', severity: 'critical', domain: 'rates',
        detail: `All policy rates identical at ${rates[0].rate}%: ${rates.map(r => r.name).join(', ')}`,
      });
    }
  }

  // 2. Treasury yields: 3M > 30Y by large margin = possible label swap
  const treasury = results.filter(r => r.type === 'treasury');
  const t3m = treasury.find(r => r.symbol === '^IRX');
  const t30y = treasury.find(r => r.symbol === '^TYX');
  if (t3m?.price > 0 && t30y?.price > 0 && t3m.price > t30y.price * 2) {
    issues.push({
      type: 'YIELD_LABEL_SWAP', severity: 'warning', domain: 'rates',
      detail: `US 3M (${t3m.price}%) > 2× US 30Y (${t30y.price}%) — possible label swap`,
    });
  }

  // 3. Mass null rates
  const nullRates = results.filter(r => r.price == null || r.price === 0);
  if (nullRates.length > results.length * 0.5) {
    issues.push({
      type: 'MASS_NULL_RATES', severity: 'critical', domain: 'rates',
      detail: `${nullRates.length}/${results.length} rates are null/zero`,
    });
  }

  return issues;
}

function ratesSummary(payload) {
  return (payload?.results || []).map(r => `${r.name}=${r.price}%`).join(', ');
}


// ══════════════════════════════════════════════════════════════════════════════
//  GENERIC AI VALIDATION (shared by all domains)
// ══════════════════════════════════════════════════════════════════════════════

const DOMAIN_CONTEXT = {
  'yield-curves': 'sovereign yield curves from multiple countries',
  'equities': 'stock/ETF price snapshots',
  'forex': 'foreign exchange rate pairs',
  'crypto': 'cryptocurrency price data',
  'rates': 'interest rates and central bank policy rates',
};

async function aiValidate(domain, dataSummary, heuristicIssues) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!canCallAI(domain)) {
    logger.info(`[DataIntegrity] AI cooldown active for ${domain}, skipping`);
    return null;
  }

  markAICalled(domain);

  const flagSummary = heuristicIssues.map(i => `[${i.severity}] ${i.detail}`).join('\n');
  const domainDesc = DOMAIN_CONTEXT[domain] || domain;

  const systemPrompt = `You are a financial data integrity auditor for a professional trading terminal. You validate ${domainDesc}. Detect: wrong data for wrong instrument, data source confusion, corrupted values, stale/cached data artifacts. Do NOT reject data because values are high or low — markets move. Focus on structural impossibilities and cross-reference failures. Respond ONLY with valid JSON.`;

  const userMessage = `Data snapshot:\n${dataSummary}\n\nHeuristic flags:\n${flagSummary}\n\nRespond in JSON: { "valid": bool, "confidence": 0.0-1.0, "issues": [{"severity": "critical|warning|info", "problem": "..."}], "summary": "one-line" }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        max_tokens: 300,
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) { logger.warn(`[DataIntegrity] Haiku ${res.status} for ${domain}`); return null; }
    const json = await res.json();
    const text = json?.content?.[0]?.text;
    if (!text) return null;
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    clearTimeout(timeout);
    logger.warn(`[DataIntegrity] AI ${domain}: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════════════════
//  UNIFIED VALIDATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const DOMAIN_CONFIGS = {
  'yield-curves': { heuristics: yieldCurveHeuristics, summary: yieldCurveSummary },
  'equities':     { heuristics: equityHeuristics,     summary: equitySummary },
  'forex':        { heuristics: forexHeuristics,       summary: forexSummary },
  'crypto':       { heuristics: cryptoHeuristics,      summary: cryptoSummary },
  'rates':        { heuristics: ratesHeuristics,       summary: ratesSummary },
};

/**
 * Generic fire-and-forget validation for any data domain.
 *
 * Usage in ANY route handler:
 *   res.json(payload);
 *   validate('equities', payload);  // never blocks
 *
 * @param {string} domain - Domain key (yield-curves, equities, forex, crypto, rates)
 * @param {object} payload - The data payload to validate
 */
function validate(domain, payload) {
  const config = DOMAIN_CONFIGS[domain];
  if (!config) {
    logger.warn(`[DataIntegrity] Unknown domain: ${domain}`);
    return;
  }

  try {
    // Sync heuristics (<1ms)
    const issues = config.heuristics(payload);
    const hasCritical = issues.some(i => i.severity === 'critical');

    if (issues.length === 0) {
      setVerdict(domain, { valid: true, source: 'heuristic', issues: [], summary: `${domain}: all checks passed` });
      return;
    }

    // Store heuristic verdict immediately
    setVerdict(domain, {
      valid: !hasCritical,
      source: 'heuristic',
      issues,
      summary: `${domain}: ${issues.length} issue(s)`,
    });

    // Escalate to AI only for critical issues
    if (hasCritical) {
      logger.warn(`[DataIntegrity] ${domain}: ${issues.length} issue(s) — AI escalation`);
      issues.forEach(i => logger.warn(`  [${i.severity}] ${i.detail}`));

      const summary = config.summary(payload);
      aiValidate(domain, summary, issues)
        .then(verdict => {
          if (verdict) {
            setVerdict(domain, {
              valid: verdict.valid,
              source: 'ai',
              confidence: verdict.confidence,
              issues: [...issues, ...(verdict.issues || []).map(i => ({ ...i, source: 'ai' }))],
              summary: verdict.summary || `AI: ${verdict.valid ? 'passed' : 'FAILED'}`,
            });
            if (!verdict.valid) {
              logger.error(`[DataIntegrity] AI CONFIRMED ${domain} issue: ${verdict.summary}`);
            }
          }
        })
        .catch(err => logger.warn(`[DataIntegrity] AI error for ${domain}: ${err.message}`));
    }
  } catch (err) {
    // Validation itself should NEVER crash the server
    logger.error(`[DataIntegrity] Validation crash for ${domain}: ${err.message}`);
  }
}

// Convenience aliases
function validateYieldCurves(payload) { validate('yield-curves', payload); }
function validateEquities(payload)    { validate('equities', payload); }
function validateForex(payload)       { validate('forex', payload); }
function validateCrypto(payload)      { validate('crypto', payload); }
function validateRates(payload)       { validate('rates', payload); }

/**
 * Get the current integrity verdict for a data domain.
 * @param {string} domain - e.g., 'yield-curves', 'equities', 'forex', 'crypto', 'rates'
 * @returns {object|null}
 */
function getIntegrityStatus(domain) {
  return getVerdict(domain);
}

/**
 * Get all verdicts across all domains (for health/status endpoint).
 * @returns {object}
 */
function getAllIntegrityStatus() {
  const result = {};
  for (const domain of Object.keys(DOMAIN_CONFIGS)) {
    result[domain] = getVerdict(domain) || { valid: true, source: 'none', summary: 'No validation run yet' };
  }
  return result;
}

module.exports = {
  validate,
  validateYieldCurves,
  validateEquities,
  validateForex,
  validateCrypto,
  validateRates,
  getIntegrityStatus,
  getAllIntegrityStatus,
};
