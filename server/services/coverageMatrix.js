/**
 * services/coverageMatrix.js — W5.6 DB-backed coverage matrix.
 *
 * Sits between the in-memory adapter registry and the `coverage_matrix`
 * Postgres table declared in server/db/migrations/20260419_coverage_matrix.sql.
 *
 * Responsibilities:
 *   1. syncDeclarations  — at boot, upsert every adapter's CoverageDeclaration
 *                          into coverage_matrix so the DB mirrors what the
 *                          runtime registry says.
 *   2. recordProbeRun    — consume the structured report from
 *                          adapterQualityHarness.runProbes() and write:
 *                            - one coverage_probes row per passed/failed/skipped probe
 *                            - a matching update to coverage_matrix
 *                              (last_verified_at, last_result, latency,
 *                               consecutive_greens/reds, promoted confidence)
 *   3. queryCoverage     — read helpers for /admin/coverage and the router
 *                          (returns rows joined with their most recent probe).
 *
 * Design notes:
 *   - Dependency-injected pg + logger for testability.
 *   - Probe-to-cell attribution: a single probe like `quote(AAPL)` exercises
 *     ONE adapter code path, not every declared (market, asset_class) row.
 *     So by default we attribute the result only to the US/equity cell for
 *     that adapter+capability. Regional probes pass probedMarket and
 *     probedAssetClass overrides so we don't lie about unverified cells.
 *     (Non-US cells keep declared_confidence but no last_verified_at until
 *     a regional probe is authored — see W5.7 backlog item.)
 *   - Confidence promotion rule (matches coverage playbook):
 *         consecutive_greens ≥ 14 → promote one level (low→medium, medium→high)
 *         consecutive_reds   ≥  3 → demote to 'low'
 *     We never re-promote above declared_confidence automatically; operators
 *     bump declared_confidence manually when they've gained trust in a cell.
 *   - skipped probes (missing key, dev machine) record an audit row but do
 *     NOT touch counters. Missing-key noise must not demote production
 *     confidence just because the dev box is empty.
 *   - unsupported probes (capability not probed or not implemented) do not
 *     write to the DB at all.
 *
 * W5.6 tasks this closes:
 *   - /admin/coverage showed stale or hand-maintained JSON before
 *   - last_verified_at was always NULL
 *   - CI had no way to measure quality drift over time
 */

'use strict';

const _logger = require('../utils/logger');

// Legal confidence values from coverage_confidence ENUM in migration.
const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
const GREEN_PROMOTION_THRESHOLD = 14;
const RED_DEMOTION_THRESHOLD = 3;

// Map harness errorCode → coverage_probe_result ENUM ('ok','error','timeout','sla_miss','schema_mismatch').
function toProbeResult(status, errorCode) {
  if (status === 'passed') return 'ok';
  if (errorCode === 'SCHEMA_MISMATCH') return 'schema_mismatch';
  if (errorCode === 'TIMEOUT' || errorCode === 'THROW') return 'timeout';
  if (errorCode === 'STALE_DATA') return 'sla_miss';
  return 'error';
}

// Decide the new confidence given current counters, current confidence, and
// declared ceiling.
//
//   - consecutive_reds   ≥ 3  → 'low' (hard demotion)
//   - consecutive_greens ≥ 14 → promote to declared confidence
//   - otherwise preserve `current` so an adapter that has been verified many
//     times doesn't oscillate between medium/high on every green/red. A
//     single failure should not erase weeks of earned confidence — it should
//     bump the red counter instead, and only if that counter crosses 3 do
//     we drop to low.
//
// If `current` is missing (fresh row), fall back to min(declared, 'medium')
// so unverified cells don't claim declared until probed.
function computeConfidence({ declared, current, consecutiveGreens, consecutiveReds }) {
  if (consecutiveReds >= RED_DEMOTION_THRESHOLD) return 'low';

  const declaredIdx = CONFIDENCE_LEVELS.indexOf(declared);
  if (consecutiveGreens >= GREEN_PROMOTION_THRESHOLD) {
    return declaredIdx >= 0 ? CONFIDENCE_LEVELS[declaredIdx] : (current || declared || 'medium');
  }

  // Steady-state: preserve current, but never let current exceed declared
  // (an operator who lowered declared_confidence expects that to take effect).
  const currentIdx = CONFIDENCE_LEVELS.indexOf(current);
  if (declaredIdx >= 0 && currentIdx > declaredIdx) return declared;
  if (current) return current;
  // No prior value — cap fresh rows at medium until earned.
  return declaredIdx >= 0 ? CONFIDENCE_LEVELS[Math.min(declaredIdx, 1)] : 'medium';
}

// ── syncDeclarations ─────────────────────────────────────────────────────

/**
 * At boot, ensure every declared coverage cell exists in coverage_matrix.
 * Upserts keyed on (adapter, market, asset_class, capability).
 *
 * @param {{ registry, pg, logger? }} deps
 * @returns {Promise<{ inserted: number, updated: number, skipped: number }>}
 */
async function syncDeclarations({ registry, pg, logger = _logger } = {}) {
  if (!registry || !pg || !pg.query) {
    throw new Error('syncDeclarations: registry and pg are required');
  }
  let inserted = 0, updated = 0, skipped = 0;

  const declarations = registry.declarations ? registry.declarations() : [];
  for (const decl of declarations) {
    if (!decl || !decl.name || !Array.isArray(decl.coverageCells)) { skipped += 1; continue; }
    for (const cell of decl.coverageCells) {
      try {
        const r = await pg.query(
          `INSERT INTO coverage_matrix
             (adapter, adapter_version, market, asset_class, capability,
              declared_confidence, confidence,
              latency_p95_target_ms, freshness_sla_sec, requires_env_vars)
           VALUES ($1, $2, $3, $4, $5, $6::coverage_confidence, $6::coverage_confidence, $7, $8, $9)
           ON CONFLICT (adapter, market, asset_class, capability) DO UPDATE
             SET adapter_version       = EXCLUDED.adapter_version,
                 declared_confidence   = EXCLUDED.declared_confidence,
                 latency_p95_target_ms = EXCLUDED.latency_p95_target_ms,
                 freshness_sla_sec     = EXCLUDED.freshness_sla_sec,
                 requires_env_vars     = EXCLUDED.requires_env_vars
           RETURNING (xmax = 0) AS inserted`,
          [
            decl.name,
            decl.version || '0.0.0',
            cell.market,
            cell.assetClass,
            cell.capability,
            cell.confidence || 'unverified',
            decl.latencyP95TargetMs || 2000,
            decl.freshnessSlaSec || 3600,
            decl.requiredEnvVars || [],
          ],
        );
        if (r.rows?.[0]?.inserted) inserted += 1; else updated += 1;
      } catch (e) {
        logger.warn('coverageMatrix', 'syncDeclarations: upsert failed', {
          adapter: decl.name, cell, error: e.message,
        });
      }
    }
  }
  logger.info('coverageMatrix', 'syncDeclarations done', { inserted, updated, skipped });
  return { inserted, updated, skipped };
}

// ── recordProbeRun ───────────────────────────────────────────────────────

/**
 * Resolve which coverage_matrix rows a probe result should update.
 *
 * Defaults to US/equity because every DEFAULT_PROBES entry uses AAPL; if
 * callers author regional probes they MUST pass probedMarket/probedAssetClass
 * so we attribute results honestly.
 */
async function findTargetCells({ pg, adapter, capability, probedMarket, probedAssetClass }) {
  const market = probedMarket || 'US';
  const assetClass = probedAssetClass || 'equity';
  const r = await pg.query(
    `SELECT id, declared_confidence, confidence, consecutive_greens, consecutive_reds
       FROM coverage_matrix
      WHERE adapter = $1 AND market = $2 AND asset_class = $3 AND capability = $4`,
    [adapter, market, assetClass, capability],
  );
  return r.rows || [];
}

/**
 * @param {{ report, pg, probes?, logger?, ciRunId?, ciCommitSha? }} deps
 * @returns {Promise<{probesRecorded:number, matrixUpdated:number, errors:number}>}
 */
async function recordProbeRun({ report, pg, probes = {}, logger = _logger, ciRunId, ciCommitSha } = {}) {
  if (!report || !pg || !pg.query) {
    throw new Error('recordProbeRun: report and pg are required');
  }
  let probesRecorded = 0, matrixUpdated = 0, errors = 0;

  for (const adapterName of Object.keys(report.perAdapter || {})) {
    const adapterReport = report.perAdapter[adapterName];
    for (const probe of adapterReport.probes || []) {
      // unsupported → no-op: operator must author a probe before we can judge.
      if (probe.status === 'unsupported') continue;

      const probeOverride = probes[probe.capability] || {};
      const probedMarket = probeOverride.probedMarket || 'US';
      const probedAssetClass = probeOverride.probedAssetClass || 'equity';
      const targets = await findTargetCells({
        pg, adapter: adapterName, capability: probe.capability,
        probedMarket, probedAssetClass,
      }).catch(e => {
        logger.warn('coverageMatrix', 'findTargetCells failed', { error: e.message });
        return [];
      });

      if (targets.length === 0) {
        // No DB cell matches → nothing to update. Still write a probe row
        // under a synthetic matrix_id? No — FK requires a real row. Skip.
        continue;
      }

      const probeResult = toProbeResult(probe.status, probe.errorCode);
      for (const target of targets) {
        try {
          // Insert probe audit row.
          await pg.query(
            `INSERT INTO coverage_probes
               (matrix_id, result, latency_ms, error_code, error_message,
                probe_symbol, probe_metadata, ci_run_id, ci_commit_sha)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              target.id,
              probeResult,
              Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
              probe.errorCode || null,
              probe.errorMessage ? String(probe.errorMessage).slice(0, 500) : null,
              probeOverride.probeSymbol || 'AAPL',
              probeOverride.metadata ? JSON.stringify(probeOverride.metadata) : null,
              ciRunId || null,
              ciCommitSha || null,
            ],
          );
          probesRecorded += 1;

          // skipped status: audit row only, no counter update (missing-key
          // on a dev box must not demote production confidence).
          if (probe.status === 'skipped') continue;

          const nowGreens = probe.status === 'passed' ? target.consecutive_greens + 1 : 0;
          const nowReds   = probe.status === 'failed' ? target.consecutive_reds   + 1 : 0;
          const nextConfidence = computeConfidence({
            declared: target.declared_confidence,
            current: target.confidence,
            consecutiveGreens: nowGreens,
            consecutiveReds: nowReds,
          });

          await pg.query(
            `UPDATE coverage_matrix
                SET last_verified_at = NOW(),
                    last_result = $1::coverage_probe_result,
                    latency_p95_observed_ms = COALESCE($2, latency_p95_observed_ms),
                    consecutive_greens = $3,
                    consecutive_reds = $4,
                    confidence = $5::coverage_confidence
              WHERE id = $6`,
            [
              probeResult,
              Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
              nowGreens,
              nowReds,
              nextConfidence,
              target.id,
            ],
          );
          matrixUpdated += 1;
        } catch (e) {
          errors += 1;
          logger.warn('coverageMatrix', 'probe record failed', {
            adapter: adapterName, capability: probe.capability, error: e.message,
          });
        }
      }
    }
  }

  logger.info('coverageMatrix', 'recordProbeRun done', { probesRecorded, matrixUpdated, errors });
  return { probesRecorded, matrixUpdated, errors };
}

// ── queryCoverage ────────────────────────────────────────────────────────

/**
 * Matrix snapshot for /admin/coverage. Returns rows with derived booleans
 * (stale = last_verified_at NULL or > 48h).
 */
async function queryCoverage({ pg, filter = {} } = {}) {
  if (!pg || !pg.query) throw new Error('queryCoverage: pg required');
  const conditions = [];
  const params = [];
  if (filter.adapter)     { params.push(filter.adapter);     conditions.push(`adapter = $${params.length}`); }
  if (filter.market)      { params.push(filter.market);      conditions.push(`market = $${params.length}`); }
  if (filter.assetClass)  { params.push(filter.assetClass);  conditions.push(`asset_class = $${params.length}`); }
  if (filter.capability)  { params.push(filter.capability);  conditions.push(`capability = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, adapter, adapter_version, market, asset_class, capability,
           declared_confidence, confidence, enabled,
           latency_p95_target_ms, latency_p95_observed_ms, freshness_sla_sec,
           last_verified_at, last_result, consecutive_greens, consecutive_reds,
           notes,
           (last_verified_at IS NULL OR last_verified_at < NOW() - INTERVAL '48 hours') AS stale
      FROM coverage_matrix
      ${where}
     ORDER BY adapter, market, asset_class, capability
  `;
  const r = await pg.query(sql, params);
  return r.rows || [];
}

async function queryRecentProbes({ pg, adapter, limit = 50 } = {}) {
  if (!pg || !pg.query) throw new Error('queryRecentProbes: pg required');
  const r = await pg.query(
    `SELECT p.id, p.matrix_id, p.ran_at, p.result, p.latency_ms,
            p.error_code, p.error_message, p.probe_symbol,
            m.adapter, m.market, m.asset_class, m.capability
       FROM coverage_probes p
       JOIN coverage_matrix m ON m.id = p.matrix_id
      ${adapter ? 'WHERE m.adapter = $1' : ''}
      ORDER BY p.ran_at DESC
      LIMIT ${Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50}`,
    adapter ? [adapter] : [],
  );
  return r.rows || [];
}

module.exports = {
  syncDeclarations,
  recordProbeRun,
  queryCoverage,
  queryRecentProbes,
  // Exposed for tests / backlog regional probes.
  _internal: {
    toProbeResult,
    computeConfidence,
    findTargetCells,
    CONFIDENCE_LEVELS,
    GREEN_PROMOTION_THRESHOLD,
    RED_DEMOTION_THRESHOLD,
  },
};
