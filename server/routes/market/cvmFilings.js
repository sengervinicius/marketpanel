/**
 * routes/market/cvmFilings.js — GET /market/cvm-filings?symbols=PETR4,VALE3
 *
 * Phase S overlays: the Brazil deep view's "CVM FILINGS · YOUR NAMES"
 * cell and FILINGS tab. Wraps the existing cvmFilingsProvider (CVM IPE
 * open-data CSV, keyed by CNPJ) for a watchlist of B3 tickers at once:
 * one provider call per ticker, merged and sorted Data_Entrega desc.
 *
 * - symbols: comma-separated B3 tickers ('.SA' suffix tolerated),
 *   de-duped, capped at 12 (the provider's year CSV is already cached
 *   12h in-process, so per-ticker fan-out is an in-memory filter after
 *   the first hit).
 * - limit: filings kept per ticker (default 5, max 20).
 * - Response cached 1h per (symbols, limit) — filings are not a
 *   realtime feed.
 * - Degrades to { ok:false, error } — the overlay cell renders an
 *   honest placeholder, never a 5xx toast.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { getCvmFilings } = require('../../providers/cvmFilingsProvider');
const logger = require('../../utils/logger');

const TTL_1H = 60 * 60 * 1000;
const MAX_SYMBOLS = 12;

router.get('/market/cvm-filings', async (req, res) => {
  try {
    const raw = String(req.query.symbols || '')
      .split(',')
      .map(s => s.trim().toUpperCase().replace(/\.SA$/, ''))
      .filter(Boolean);
    const symbols = [...new Set(raw)].slice(0, MAX_SYMBOLS);
    if (!symbols.length) {
      return res.status(400).json({ ok: false, error: 'symbols query param required (comma-separated B3 tickers)' });
    }
    const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 5));

    const ck = `market:cvm-filings:${symbols.join(',')}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json(cached);

    const settled = await Promise.allSettled(
      symbols.map(t => getCvmFilings({ ticker: t, limit }))
    );

    const filings = [];
    const unresolved = [];
    let note = null;
    settled.forEach((r, i) => {
      const v = r.status === 'fulfilled' ? r.value : null;
      if (v && Array.isArray(v.filings) && !v.error) {
        if (v.note && !note) note = v.note; // prior-year fallback caveat
        for (const f of v.filings) {
          filings.push({
            ticker: symbols[i],
            company: v.company?.name || null,
            date: f.date,
            category: f.category,
            type: f.type,
            subject: f.subject,
            link: f.link,
          });
        }
      } else {
        unresolved.push(symbols[i]);
      }
    });

    // Newest first across the whole watchlist (dates are ISO strings).
    filings.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const payload = {
      ok: true,
      symbols,
      count: filings.length,
      filings,
      ...(unresolved.length ? { unresolved } : {}),
      ...(note ? { note } : {}),
      source: 'CVM IPE',
      asOf: new Date().toISOString(),
    };
    // Don't pin a transient CVM outage for an hour: only cache when at
    // least one ticker actually resolved.
    if (unresolved.length < symbols.length) cacheSet(ck, payload, TTL_1H);
    return res.json(payload);
  } catch (e) {
    logger.warn('cvmFilings', `GET /market/cvm-filings degraded: ${e.message}`);
    return res.json({ ok: false, error: e.message });
  }
});

module.exports = router;
