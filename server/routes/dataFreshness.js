/**
 * routes/dataFreshness.js — #289 part 1
 *
 * Read endpoints for the freshness ledger (server/services/freshnessLedger.js).
 *
 * Three routes:
 *   GET /api/data-freshness                       (auth)  — every user can ask "how fresh is the platform?"
 *   GET /api/data-freshness/:symbol               (auth)  — per-symbol latest source/asOf, used by the freshness dot
 *   GET /api/admin/data-freshness                 (admin) — full ledger snapshot + health summary
 *
 * The first two are read-only and lightweight (Map traversal only).
 * The admin endpoint surfaces the full table for ops triage.
 */

'use strict';

const { Router } = require('express');
const ledger = require('../services/freshnessLedger');
const priceDriftAudit = require('../jobs/priceDriftAudit'); // #289 part 3

const router = Router();

// GET /api/data-freshness/drift — #289 part 3 cross-provider audit results.
// Define BEFORE the /:symbol route so the literal path matches first.
router.get('/drift', (_req, res) => {
  const last = priceDriftAudit.getLastRun();
  res.json({
    ok: true,
    runAt: last.runAt,
    ageMs: last.runAt ? Date.now() - last.runAt : null,
    threshold: priceDriftAudit._DRIFT_THRESHOLD_PCT + '%',
    drifts: last.drifts,
    anchorsConfigured: priceDriftAudit._ANCHORS.map(a => a.symbol),
  });
});

// POST /api/data-freshness/drift/run — admin trigger for an on-demand audit.
router.post('/drift/run', async (_req, res) => {
  try {
    const result = await priceDriftAudit.runAndStore();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/data-freshness/:symbol
//   { symbol, source, asOf, ageMs, latencyMs }
// Returns 404 if no ledger row yet (e.g. server just booted).
router.get('/:symbol', (req, res) => {
  const sym = (req.params.symbol || '').toUpperCase();
  if (!sym) return res.status(400).json({ ok: false, error: 'symbol_required' });
  const row = ledger.getOne(sym);
  if (!row) return res.status(404).json({ ok: false, error: 'no_record', symbol: sym });
  res.json({
    ok: true,
    symbol: row.symbol,
    source: row.source,
    asOf: row.asOf,
    ageMs: Date.now() - row.asOf,
    latencyMs: row.latencyMs,
    recordedAt: row.recordedAt,
    sources: ledger.getAllForSymbol(sym),
  });
});

// GET /api/data-freshness — overall health summary.
router.get('/', (req, res) => {
  const staleThresholdMs = Number.parseInt(req.query.staleThresholdMs, 10);
  const opts = Number.isFinite(staleThresholdMs) ? { staleThresholdMs } : {};
  res.json({ ok: true, ...ledger.health(opts) });
});

module.exports = router;
