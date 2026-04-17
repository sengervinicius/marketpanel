/**
 * services/dataIntegrityValidator.js
 *
 * Async, post-serve data integrity validation for market data.
 *
 * Design principles:
 *   - NEVER blocks the data pipeline — all checks are fire-and-forget
 *   - NEVER uses hardcoded bounds — rates change, economies shift
 *   - Uses cross-referencing (comparing curves against each other)
 *   - Uses AI (Claude Haiku) ONLY when heuristics flag suspicion
 *   - Stores verdicts in memory for frontend consumption
 *   - Graceful degradation — if AI is unavailable, heuristic results still surface
 *
 * Cost: ~$0.001 per AI call (Haiku), triggered only on suspicious data
 * Latency: 0ms on data pipeline; AI check runs async in ~200ms
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── In-memory verdict store ──────────────────────────────────────────────────
// Stores the most recent integrity verdict per data domain.
const _verdicts = new Map();
const VERDICT_TTL_MS = 10 * 60 * 1000; // 10 min — aligned with yield curve cache

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

// ── Heuristic checks (sync, <1ms, zero cost) ────────────────────────────────

/**
 * Cross-curve similarity: if two curves that should be very different
 * have nearly identical rate profiles, one is probably wrong data.
 *
 * Example: BR DI (~14%) vs US Treasury (~4%) should never be within 1pp average.
 */
function checkCrossCurveSimilarity(payload) {
  const issues = [];
  const EXPECTED_WIDE_SPREADS = [
    // [countryA, countryB, minExpectedSpreadPp] — these pairs should always differ meaningfully
    // We don't hardcode what the rates ARE, only that they should be DIFFERENT from each other
    ['BR', 'US'],  // EM vs DM — structurally different rate regimes
    ['BR', 'EU'],
    ['BR', 'UK'],
  ];

  for (const [a, b] of EXPECTED_WIDE_SPREADS) {
    const curveA = payload[a]?.curve;
    const curveB = payload[b]?.curve;
    if (!curveA?.length || !curveB?.length) continue;

    // Build tenor→rate maps
    const mapA = Object.fromEntries(curveA.map(p => [p.tenor, p.rate]));
    const mapB = Object.fromEntries(curveB.map(p => [p.tenor, p.rate]));
    const common = Object.keys(mapA).filter(t => mapB[t] != null);

    if (common.length < 2) continue;

    // Calculate average absolute spread between the two curves
    const spreads = common.map(t => Math.abs(mapA[t] - mapB[t]));
    const avgSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;

    // If two structurally different economies have <1.5pp average spread, flag it
    // This is a RELATIVE check (comparing curves to each other), not an absolute bound
    if (avgSpread < 1.5) {
      issues.push({
        type: 'CROSS_CURVE_SIMILARITY',
        severity: 'critical',
        countries: [a, b],
        detail: `${a} and ${b} curves differ by only ${avgSpread.toFixed(2)}pp avg across ${common.length} tenors — possible data source confusion`,
        data: { avgSpread, commonTenors: common.length, sampledSpreads: Object.fromEntries(common.slice(0, 3).map(t => [t, { [a]: mapA[t], [b]: mapB[t] }])) },
      });
    }
  }

  return issues;
}

/**
 * Source-country mismatch: certain data sources should NEVER feed certain countries.
 * FRED = US only. Tesouro Direto = BR only. ECB = EU only. BoE = UK only.
 */
function checkSourceMismatch(payload) {
  const issues = [];

  const VALID_SOURCES = {
    BR: ['tesouro direto', 'bcb', 'b3', 'tesouro'],
    US: ['us treasury', 'fred', 'treasury', 'yahoo'],
    UK: ['bank of england', 'boe'],
    EU: ['ecb'],
  };

  for (const [country, entry] of Object.entries(payload)) {
    if (!entry?.source || !VALID_SOURCES[country]) continue;
    const src = entry.source.toLowerCase();

    // Check if this source is associated with a DIFFERENT country
    for (const [otherCountry, validSources] of Object.entries(VALID_SOURCES)) {
      if (otherCountry === country) continue;
      if (validSources.some(vs => src.includes(vs))) {
        issues.push({
          type: 'SOURCE_MISMATCH',
          severity: 'critical',
          country,
          detail: `${country} curve source "${entry.source}" is associated with ${otherCountry} — likely data pipeline confusion`,
        });
      }
    }
  }

  return issues;
}

/**
 * Intra-curve sanity: check if a curve is monotonically insane
 * (e.g., all values identical, negative rates for a country with positive policy rate).
 * No hardcoded bounds — just structural checks.
 */
function checkIntraCurve(payload) {
  const issues = [];

  for (const [country, entry] of Object.entries(payload)) {
    const curve = entry?.curve;
    if (!curve || curve.length < 2) continue;

    const rates = curve.map(p => p.rate).filter(r => r != null);
    if (rates.length < 2) continue;

    // All rates identical (copy-paste error)
    const allSame = rates.every(r => r === rates[0]);
    if (allSame && rates.length > 2) {
      issues.push({
        type: 'FLAT_CURVE',
        severity: 'warning',
        country,
        detail: `${country} curve has all ${rates.length} points at ${rates[0]}% — likely data error`,
      });
    }

    // All rates negative (unusual for sovereign curves, worth flagging)
    if (rates.every(r => r < 0)) {
      issues.push({
        type: 'ALL_NEGATIVE',
        severity: 'info',
        country,
        detail: `${country} entire curve is negative (${rates[0]}% to ${rates[rates.length - 1]}%) — verify this is correct`,
      });
    }
  }

  return issues;
}

/**
 * Run all heuristic checks. Returns array of issues (empty = all clear).
 */
function runHeuristics(payload) {
  return [
    ...checkCrossCurveSimilarity(payload),
    ...checkSourceMismatch(payload),
    ...checkIntraCurve(payload),
  ];
}

// ── AI deep validation (async, only when heuristics flag) ────────────────────

/**
 * Call Claude Haiku to validate suspicious data.
 * Only called when heuristic checks found potential issues.
 * Returns structured verdict or null on failure.
 */
async function aiValidate(payload, heuristicIssues) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[DataIntegrity] ANTHROPIC_API_KEY not set — skipping AI validation');
    return null;
  }

  // Build compact curve summary (~200 tokens)
  const curveSummary = Object.entries(payload)
    .filter(([, v]) => v?.curve?.length > 0)
    .map(([country, v]) => {
      const pts = v.curve
        .filter(p => ['1Y', '2Y', '5Y', '7Y', '10Y', '30Y', 'DI'].includes(p.tenor))
        .slice(0, 6)
        .map(p => `${p.tenor}=${p.rate}%`);
      return `${country} (source: ${v.source}): ${pts.join(', ')}`;
    })
    .join('\n');

  const flagSummary = heuristicIssues.map(i => `[${i.severity}] ${i.detail}`).join('\n');

  const systemPrompt = `You are a financial data integrity auditor for a professional trading terminal. Your job is to verify that sovereign yield curve data is correct and hasn't been mixed up between countries. You understand that:
- Different economies have structurally different rate levels (e.g., emerging markets like Brazil typically have higher rates than developed markets like the US or EU, though this isn't always the case)
- Data source mismatches (e.g., FRED data appearing for Brazil) indicate pipeline bugs
- Rate levels change over time — do NOT reject data just because rates are high or low
- Focus on detecting: wrong data for the wrong country, data source confusion, corrupted/nonsensical values
Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

  const userMessage = `Current yield curves from our data pipeline:
${curveSummary}

Heuristic flags:
${flagSummary}

Validate this data. For each country, assess whether the rates look plausible for that specific country given current global macro conditions. Focus especially on the flagged issues.

Respond in JSON:
{
  "valid": true/false,
  "confidence": 0.0-1.0,
  "issues": [
    {"country": "XX", "severity": "critical|warning|info", "problem": "brief description"}
  ],
  "summary": "one-line overall assessment"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s hard limit

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

    if (!res.ok) {
      logger.warn(`[DataIntegrity] Haiku returned ${res.status}`);
      return null;
    }

    const json = await res.json();
    const text = json?.content?.[0]?.text;
    if (!text) return null;

    // Parse JSON response (strip markdown fences if present)
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      logger.warn('[DataIntegrity] Haiku validation timed out (5s)');
    } else {
      logger.warn(`[DataIntegrity] AI validation failed: ${err.message}`);
    }
    return null;
  }
}

// ── Main validation entry point ──────────────────────────────────────────────

/**
 * Validate yield curve data asynchronously.
 * Call this AFTER serving the response — it never blocks the pipeline.
 *
 * Usage in route handler:
 *   res.json(payload);
 *   validateYieldCurves(payload); // fire-and-forget
 *
 * @param {object} payload - The yield curves payload { BR: {...}, US: {...}, ... }
 */
function validateYieldCurves(payload) {
  // Run sync heuristics immediately
  const heuristicIssues = runHeuristics(payload);
  const hasCritical = heuristicIssues.some(i => i.severity === 'critical');

  if (heuristicIssues.length === 0) {
    // All clear — store clean verdict
    setVerdict('yield-curves', {
      valid: true,
      source: 'heuristic',
      issues: [],
      summary: 'All curves passed cross-reference checks',
    });
    return;
  }

  // Store heuristic verdict immediately (AI may override later)
  setVerdict('yield-curves', {
    valid: !hasCritical,
    source: 'heuristic',
    issues: heuristicIssues,
    summary: `${heuristicIssues.length} issue(s) detected by heuristic checks`,
  });

  // If critical issues found, escalate to AI for confirmation (async)
  if (hasCritical) {
    logger.warn(`[DataIntegrity] ${heuristicIssues.length} heuristic issue(s) — escalating to AI`);
    heuristicIssues.forEach(i => logger.warn(`  [${i.severity}] ${i.detail}`));

    aiValidate(payload, heuristicIssues)
      .then(aiVerdict => {
        if (aiVerdict) {
          setVerdict('yield-curves', {
            valid: aiVerdict.valid,
            source: 'ai',
            confidence: aiVerdict.confidence,
            issues: [
              ...heuristicIssues,
              ...(aiVerdict.issues || []).map(i => ({ ...i, source: 'ai' })),
            ],
            summary: aiVerdict.summary || `AI validation: ${aiVerdict.valid ? 'passed' : 'FAILED'}`,
          });
          if (!aiVerdict.valid) {
            logger.error(`[DataIntegrity] AI CONFIRMED data integrity issue: ${aiVerdict.summary}`);
          }
        }
      })
      .catch(err => {
        logger.warn(`[DataIntegrity] AI validation error: ${err.message}`);
        // Heuristic verdict remains in place
      });
  }
}

/**
 * Get the current integrity verdict for a data domain.
 * Used by API endpoints to include integrity status in responses.
 *
 * @param {string} domain - e.g., 'yield-curves'
 * @returns {object|null} verdict with { valid, source, issues, summary, checkedAt }
 */
function getIntegrityStatus(domain) {
  return getVerdict(domain);
}

module.exports = {
  validateYieldCurves,
  getIntegrityStatus,
  // Exported for testing
  runHeuristics,
  checkCrossCurveSimilarity,
  checkSourceMismatch,
  checkIntraCurve,
};
