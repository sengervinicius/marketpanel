/**
 * routes/adminCoverage.js — W5.6 /admin/coverage surface.
 *
 * Exposes the coverage_matrix + coverage_probes tables as JSON so the admin
 * UI (and on-call engineers via curl) can answer:
 *   - "which adapter cells are stale (> 48h since last probe)?"
 *   - "what broke in last night's harness run?"
 *   - "is Finnhub/KRX/equity/quote healthy enough to promote to high?"
 *
 * Endpoints (all require admin + get audited):
 *   GET /api/admin/coverage                        → matrix snapshot
 *   GET /api/admin/coverage?adapter=finnhub        → filter by adapter
 *   GET /api/admin/coverage?stale=1                → only cells verified ≥48h ago
 *   GET /api/admin/coverage/probes                 → last 50 probe runs (all adapters)
 *   GET /api/admin/coverage/probes?adapter=polygon → last 50 for one adapter
 *
 * Why a route + not just a DB query in the admin UI:
 *   - Same redaction/audit/admin-only guards as every other admin surface.
 *   - One place to tune SQL so we never slow-query the UI if the tables grow.
 */

'use strict';

const express = require('express');
const router = express.Router();

const pg = require('../db/postgres');
const { adminAuditLog } = require('../middleware/adminAuditLog');
const coverage = require('../services/coverageMatrix');

function requireAdmin(req, res, next) {
  const u = req.user;
  if (!u || !(u.isAdmin || u.role === 'admin')) {
    return res.status(403).json({ error: 'admin_required' });
  }
  next();
}

router.use(requireAdmin);
router.use(adminAuditLog);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.adapter)    filter.adapter    = String(req.query.adapter);
    if (req.query.market)     filter.market     = String(req.query.market);
    if (req.query.assetClass) filter.assetClass = String(req.query.assetClass);
    if (req.query.capability) filter.capability = String(req.query.capability);

    let rows = await coverage.queryCoverage({ pg, filter });
    if (req.query.stale === '1' || req.query.stale === 'true') {
      rows = rows.filter(r => r.stale);
    }

    const summary = rows.reduce((acc, r) => {
      acc.total += 1;
      if (r.stale)                            acc.stale += 1;
      if (r.confidence === 'high')            acc.high += 1;
      if (r.confidence === 'medium')          acc.medium += 1;
      if (r.confidence === 'low')             acc.low += 1;
      if (r.confidence === 'unverified')      acc.unverified += 1;
      if (r.consecutive_reds >= 3)            acc.degraded += 1;
      return acc;
    }, { total: 0, stale: 0, high: 0, medium: 0, low: 0, unverified: 0, degraded: 0 });

    res.json({ generatedAt: new Date().toISOString(), summary, rows });
  } catch (e) {
    res.status(500).json({ error: 'coverage_query_failed', message: e.message });
  }
});

router.get('/probes', async (req, res) => {
  try {
    const adapter = req.query.adapter ? String(req.query.adapter) : undefined;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const rows = await coverage.queryRecentProbes({ pg, adapter, limit });
    res.json({ generatedAt: new Date().toISOString(), count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: 'probe_query_failed', message: e.message });
  }
});

module.exports = router;
