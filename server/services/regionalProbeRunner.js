/**
 * services/regionalProbeRunner.js — W6.1 cell-level adapter verification.
 *
 * Why this exists separately from adapterQualityHarness.js:
 *   - adapterQualityHarness runs ONE probe per capability per adapter
 *     (e.g. quote(AAPL)) to prove the adapter's code path works. That's
 *     enough for US/equity, but it tells us nothing about whether
 *     finnhub's KRX branch can actually resolve 005930.KS.
 *   - This runner iterates coverage_matrix rows and calls the adapter
 *     with a ticker that's CANONICAL for that exchange (e.g. D05.SI for
 *     SGX, 7203.T for TSE). That's the only way to earn a green streak
 *     on non-US cells and eventually promote them past 'medium'.
 *
 * Design mirrors adapterQualityHarness for consistency:
 *   - Each cell → Promise.race(method.apply(adapter, args), timeout)
 *   - Results are passed to coverageMatrix.recordProbeRun so confidence
 *     promotion / demotion rules are applied in one place.
 *
 * Probe ticker catalog is intentionally tiny and blue-chip — a failure
 * against Samsung/Toyota/Tencent is a real signal, not a symbol bug.
 */

'use strict';

const _logger = require('../utils/logger');
const { runProbes } = require('./adapterQualityHarness');
const coverageMatrix = require('./coverageMatrix');

// ── Canonical blue-chip tickers by market ────────────────────────────────
// Chosen because:
//   - They're index-heavyweight (if Finnhub loses them, something is
//     seriously wrong upstream).
//   - They're in every vendor's coverage so a failure isn't a bookkeeping
//     issue about "which symbol does Finnhub accept".
//   - They span sectors, so a sector outage at upstream doesn't look like
//     an adapter outage.
const REGIONAL_PROBES = Object.freeze({
  KRX:  { symbol: '005930.KS', name: 'Samsung Electronics' },
  TSE:  { symbol: '7203.T',    name: 'Toyota Motor' },
  HKEX: { symbol: '0700.HK',   name: 'Tencent Holdings' },
  SGX:  { symbol: 'D05.SI',    name: 'DBS Group' },
  B3:   { symbol: 'PETR4.SA',  name: 'Petrobras' },
  EU:   { symbol: 'SAP.DE',    name: 'SAP SE' },
  US:   { symbol: 'AAPL',      name: 'Apple' },
});

// Capability → default args builder for a regional ticker. Keeps this
// module's surface area small — when new capabilities come online
// (fundamentals, options, etc.) we add a case here.
function argsForCapability(capability, symbol) {
  switch (capability) {
    case 'quote':        return [symbol];
    case 'candles':      return [symbol, { interval: '1d', limit: 5 }];
    case 'news':         return [symbol];
    case 'fundamentals': return [symbol, 'annual', 'income_statement'];
    default:             return null; // capability doesn't take a symbol
  }
}

/**
 * Given a coverage_matrix row, build an adapterQualityHarness-style
 * probes config that targets THIS cell. Returns null if we don't have a
 * canonical ticker for the row's market or the capability isn't
 * symbol-shaped.
 */
function probesForCell(row) {
  const probe = REGIONAL_PROBES[row.market];
  if (!probe) return null;
  const args = argsForCapability(row.capability, probe.symbol);
  if (!args) return null;
  return {
    probes: {
      [row.capability]: {
        args,
        timeoutMs: 8000,
        // Hints used by coverageMatrix.recordProbeRun to attribute the
        // result to the correct (market, asset_class) cell.
        probedMarket: row.market,
        probedAssetClass: row.asset_class,
        probeSymbol: probe.symbol,
        metadata: { blueChip: probe.name },
      },
    },
  };
}

/**
 * Run one probe per coverage_matrix cell that has a canonical regional
 * ticker. Writes results into coverage_probes and updates
 * consecutive_greens/reds/confidence on coverage_matrix.
 *
 * @param {{ pg, registry, logger? }} deps
 * @returns {Promise<{ cells: number, greens: number, reds: number, skipped: number }>}
 */
async function runRegionalProbes({ pg, registry, logger = _logger } = {}) {
  if (!pg || !registry) throw new Error('runRegionalProbes: pg + registry required');

  // Read every cell we've declared. We filter to cells whose market has a
  // canonical probe ticker — the rest are left for region-specific probes
  // authored later (e.g. ASX, NSE).
  const rows = await coverageMatrix.queryCoverage({ pg });
  let cells = 0, greens = 0, reds = 0, skipped = 0;

  for (const row of rows) {
    const probes = probesForCell(row);
    if (!probes) { skipped += 1; continue; }

    const adapter = registry.get ? registry.get(row.adapter) : null;
    if (!adapter) { skipped += 1; continue; }

    // Reuse the hardened runProbes infrastructure by creating a fake
    // single-adapter registry. This gives us timeout handling + error
    // classification for free.
    const fakeRegistry = { all: () => [adapter] };
    const report = await runProbes({
      registry: fakeRegistry,
      probes: probes.probes,
      logger,
    });
    cells += 1;

    const result = await coverageMatrix.recordProbeRun({
      report, pg, probes: probes.probes, logger,
    });

    // Roll up the green/red signal into the runner's tally.
    const perAdapter = report.perAdapter[row.adapter];
    const probe = perAdapter?.probes?.find(p => p.capability === row.capability);
    if (probe?.status === 'passed') greens += 1;
    if (probe?.status === 'failed') reds += 1;
    if (probe?.status === 'skipped' || probe?.status === 'unsupported') skipped += 1;
    void result; // used for logging by recordProbeRun
  }

  logger.info('regionalProbes', 'run complete', { cells, greens, reds, skipped });
  return { cells, greens, reds, skipped };
}

module.exports = {
  runRegionalProbes,
  REGIONAL_PROBES,
  // Exposed for tests.
  _internal: { probesForCell, argsForCapability },
};
