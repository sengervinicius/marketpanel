/**
 * routes/market/data.js — S4 Wave 3
 * Surfaces unused Eulerpool & Polygon endpoints:
 *
 *   Eulerpool:
 *     GET /market/earnings-calendar      → getEarningsCalendar
 *     GET /market/macro-calendar         → getMacroCalendar
 *     GET /market/macro-snapshot/:country → getMacroSnapshot
 *     GET /market/insider/:ticker        → getInsiderTransactions
 *     GET /market/fundamentals/batch     → getBatchFundamentals
 *     GET /market/crypto-extended/:name  → getCryptoExtended
 *     GET /market/forex-rates/:currency  → getForexRates
 *     GET /market/screener              → getScreener
 *
 *   Polygon:
 *     GET /market/snapshot/:ticker       → /v2/snapshot/locale/us/markets/stocks/tickers
 *     GET /market/financials/:ticker     → /vX/reference/financials
 *     GET /market/dividends/:ticker      → /v3/reference/dividends
 *     GET /market/splits/:ticker         → /v3/reference/stock_splits
 *     GET /market/options-ref/:ticker    → /v3/reference/options/contracts
 */

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { polyFetch, eulerpool, twelvedata, sendError, yahooQuote, yahooQuoteSummary } = require('./lib/providers');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════
//  EULERPOOL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/earnings-calendar?ticker=AAPL&from=2026-04-01&to=2026-04-30
 * Returns upcoming earnings dates. All params optional.
 */
// #UX-3 — shared date helpers for the calendar routes below.
const fmtDay = (d) => d.toISOString().slice(0, 10);
const defaultCalRange = () => {
  const now = new Date();
  // UTC-rollover guard (root-cause fix, suspect (a)): fmtDay() is UTC. By
  // evening in US markets the server's UTC date has already flipped to
  // "tomorrow", so a default window starting at fmtDay(now) silently
  // excludes companies reporting AMC *tonight* (their calendar date is the
  // UTC-yesterday). Start the default window one day back; the extra day
  // also surfaces last night's actuals, which the panel renders fine.
  return {
    from: fmtDay(new Date(now.getTime() - 86400000)),
    to: fmtDay(new Date(now.getTime() + 7 * 86400000)),
  };
};
const FINNHUB_TIMING = { bmo: 'BMO', amc: 'AMC', dmh: 'DMH' };

// ── Yahoo earnings fallback (calendar-defect fix) ────────────────────
// Free, keyless second source so the EARNINGS tab is never silently
// empty when Finnhub/Eulerpool are unconfigured or down. Universe =
// caller-supplied watchlist symbols (?symbols=) + the S&P 100 for the
// market-wide default view. Yahoo's batched v7 quote carries the next
// scheduled earnings timestamp per symbol; EPS estimates are enriched
// best-effort from quoteSummary (calendarEvents/earningsTrend modules)
// for the rows that land inside the window. Assembled rows cache 12h.
const SP100 = [
  'AAPL','ABBV','ABT','ACN','ADBE','AIG','AMD','AMGN','AMT','AMZN',
  'AVGO','AXP','BA','BAC','BK','BKNG','BLK','BMY','BRK-B','C',
  'CAT','CHTR','CL','CMCSA','COF','COP','COST','CRM','CSCO','CVS',
  'CVX','DE','DHR','DIS','DOW','DUK','EMR','FDX','GD','GE',
  'GILD','GM','GOOG','GOOGL','GS','HD','HON','IBM','INTC','INTU',
  'ISRG','JNJ','JPM','KHC','KO','LIN','LLY','LMT','LOW','MA',
  'MCD','MDLZ','MDT','MET','META','MMM','MO','MRK','MS','MSFT',
  'NEE','NFLX','NKE','NOW','NVDA','ORCL','PEP','PFE','PG','PLTR',
  'PM','PYPL','QCOM','RTX','SBUX','SCHW','SO','SPG','T','TGT',
  'TMO','TMUS','TSLA','TXN','UNH','UNP','UPS','USB','V','VZ',
  'WFC','WMT','XOM',
];
const YAHOO_EARNINGS_TTL = 12 * 60 * 60 * 1000; // 12h

function epochToDay(ts) {
  if (ts == null || !Number.isFinite(Number(ts))) return null;
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Best-effort BMO/AMC read off the UTC clock time of the earnings
// timestamp (ET is UTC-4/-5: <= 13:30 UTC is pre-open, >= 20:00 UTC is
// post-close year-round). Mid-session or midnight-anchored timestamps
// stay null → panel renders TBD.
function timingFromEpoch(ts) {
  if (ts == null || !Number.isFinite(Number(ts))) return null;
  const d = new Date(Number(ts) * 1000);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins === 0) return null;
  if (mins <= 13 * 60 + 30) return 'BMO';
  if (mins >= 20 * 60) return 'AMC';
  return null;
}

/**
 * @returns {Promise<{rows: Array, sampled: number}>}
 *   sampled — how many quotes Yahoo actually answered for; lets the
 *   route distinguish "fallback worked, week is quiet" (sampled > 0,
 *   rows empty) from "fallback is down too" (sampled 0).
 */
async function yahooEarningsFallback({ symbols = [], from, to }) {
  const universe = Array.from(new Set(
    [...symbols, ...SP100]
      .map(sym => String(sym || '').trim().toUpperCase())
      .filter(Boolean),
  )).slice(0, 250);

  const ck = `earnings-cal:yahoo:${from}:${to}:` +
    require('crypto').createHash('md5').update(universe.join(',')).digest('hex').slice(0, 12);
  const cached = cacheGet(ck);
  if (cached) return cached;

  const rows = [];
  const seen = new Set();
  let sampled = 0;
  // ?debug=1 instrumentation — why did sampled quotes NOT become rows.
  const dropReasons = { noTimestamp: 0, outOfWindow: 0 };
  let firstRawRow = null;
  const BATCH = 50;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    let quotes;
    try {
      quotes = await yahooQuote(batch.join(','));
    } catch (e) {
      logger.warn(`[earnings-calendar] yahoo fallback batch failed: ${e.message}`);
      continue;
    }
    if (!Array.isArray(quotes)) continue;
    for (const q of quotes) {
      if (!q || !q.symbol) continue;
      const sym = String(q.symbol).toUpperCase();
      if (seen.has(sym)) continue; // Yahoo can echo overlapping batches
      seen.add(sym);
      sampled += 1;
      const ts = q.earningsTimestamp ?? q.earningsTimestampStart ?? null;
      const day = epochToDay(ts);
      if (!firstRawRow) firstRawRow = { keys: Object.keys(q), symbol: sym, date: day };
      if (!day) { dropReasons.noTimestamp += 1; continue; }
      if (day < from || day > to) { dropReasons.outOfWindow += 1; continue; }
      rows.push({
        ticker: sym,
        symbol: sym,
        name: q.shortName || q.longName || null,
        date: day,
        timing: timingFromEpoch(ts),
        epsEstimate: null,
        epsActual: null,
        revenueEstimate: null,
        revenueActual: null,
      });
    }
  }

  // Best-effort EPS estimates for the (few) rows inside the window —
  // quoteSummary earningsTrend current-quarter consensus. Failures are
  // silently tolerated; the row still renders with date + timing.
  await Promise.all(rows.slice(0, 25).map(async (row) => {
    try {
      const qs = await yahooQuoteSummary(row.symbol);
      const est = qs?.earningsTrend?.currentQtr?.earningsEstimate?.avg;
      if (est != null && Number.isFinite(est)) row.epsEstimate = est;
    } catch { /* best-effort */ }
  }));

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol.localeCompare(b.symbol)));
  // meta rides inside the cached value so ?debug=1 stays truthful on
  // cache hits too.
  const result = { rows, sampled, meta: { rawCount: sampled, dropReasons, firstRawRow } };
  if (sampled > 0) cacheSet(ck, result, YAHOO_EARNINGS_TTL);
  return result;
}

router.get('/market/earnings-calendar', async (req, res) => {
  try {
    const { ticker, from, to } = req.query;
    // Calendar-defect fix: the client passes its watchlist so the Yahoo
    // fallback can cover user names beyond the S&P 100 market view.
    const watchSymbols = String(req.query.symbols || '')
      .split(',').map(sym => sym.trim()).filter(Boolean).slice(0, 100);
    const def = defaultCalRange();
    const range = { from: from || def.from, to: to || def.to };

    // ?debug=1 — additive live-verification instrumentation (root-cause
    // fix). Auth: this router is mounted behind requireAuth +
    // requireActiveSubscription at the /api prefix (server/index.js), so
    // the debug surface is never public. The business envelope is left
    // byte-identical; a `debug` object is appended describing the window
    // and what every provider attempted / returned / dropped.
    const wantDebug = String(req.query.debug || '') === '1';
    const dbg = wantDebug ? {
      window: { from: range.from, to: range.to, defaulted: !from && !to },
      providers: {
        eulerpool: { attempted: false },
        finnhub: { attempted: false },
        yahoo: { attempted: false },
      },
    } : null;
    const send = (payload) => res.json(dbg ? { ...payload, debug: dbg } : payload);

    // Preferred: Eulerpool when configured (original data source).
    //
    // Empty-cascade fix (P2 item 1): Eulerpool being CONFIGURED is not the
    // same as Eulerpool HAVING DATA. The live defect was
    // {source:'eulerpool', data:[]} — the key is set, the API answers, but
    // returns 0 rows, and the P0 fallback only fired on FAILURE. A provider
    // that answers with 0 rows now cascades to the next source
    // (eulerpool → finnhub → yahoo); 'no-data' is only reported when ALL
    // sources returned empty.
    let eulerpoolState = 'unconfigured'; // 'unconfigured' | 'empty' | 'error'
    if (eulerpool.isConfigured()) {
      const opts = {};
      if (ticker) opts.ticker = ticker.toUpperCase();
      if (from)   opts.from = from;
      if (to)     opts.to = to;

      const ck = `earnings-cal:${JSON.stringify(opts)}`;
      const cached = cacheGet(ck);
      if (cached) {
        if (dbg) dbg.providers.eulerpool = { attempted: true, cache: 'hit', normalizedCount: cached.length };
        return send({ ok: true, data: cached, source: 'eulerpool' });
      }

      try {
        const data = await eulerpool.getEarningsCalendar(opts);
        const result = Array.isArray(data) ? data : (data?.earnings ?? []);
        if (dbg) {
          const first = result[0] || null;
          dbg.providers.eulerpool = {
            attempted: true,
            rawCount: result.length,
            normalizedCount: result.length,
            firstRawRow: first ? { keys: Object.keys(first), symbol: first.symbol ?? first.ticker ?? null, date: first.date ?? null } : null,
          };
        }
        if (result.length > 0) {
          cacheSet(ck, result, 600_000); // 10 min
          return send({ ok: true, data: result, source: 'eulerpool' });
        }
        eulerpoolState = 'empty';
        logger.warn('[earnings-calendar] eulerpool returned 0 rows — cascading to finnhub/yahoo');
      } catch (e) {
        eulerpoolState = 'error';
        if (dbg) dbg.providers.eulerpool = { attempted: true, error: e.message };
        logger.warn(`[earnings-calendar] eulerpool degraded (${e.message}) — cascading to finnhub/yahoo`);
      }
    }

    // #UX-3 — Finnhub via services/earnings, normalized to the shape
    // CalendarPanel's EarningsRow reads (ticker/date/timing/estimates).
    //
    // Calendar-defect fix: the service used to swallow provider failures
    // into `[]`, so the route answered ok:true/source:finnhub with empty
    // data and the panel showed "No earnings this week" forever. We now
    // track WHY there are no rows and fall through to the keyless Yahoo
    // fallback instead of returning a silently-empty envelope.
    const earningsSvc = require('../../services/earnings');
    let finnhubState = 'unconfigured'; // 'unconfigured' | 'empty' | 'error'
    let finnhubError = null;
    if (earningsSvc.isConfigured()) {
      const ck = `earnings-cal:finnhub:${range.from}:${range.to}:${ticker || ''}`;
      const cached = cacheGet(ck);
      if (cached) {
        if (dbg) dbg.providers.finnhub = { attempted: true, cache: 'hit', normalizedCount: cached.length };
        return send({ ok: true, data: cached, source: 'finnhub' });
      }

      const detailed = typeof earningsSvc.getEarningsCalendarDetailed === 'function'
        ? await earningsSvc.getEarningsCalendarDetailed(range.from, range.to)
        : { ok: true, rows: await earningsSvc.getEarningsCalendar(range.from, range.to) };

      if (detailed.ok) {
        let rows = Array.isArray(detailed.rows) ? detailed.rows : [];
        const rawCount = rows.length;
        const firstRaw = rows[0] || null;
        if (ticker) {
          const want = String(ticker).toUpperCase();
          rows = rows.filter(r => String(r.symbol || '').toUpperCase() === want);
        }
        const data = rows.map(r => ({
          ticker: r.symbol,
          symbol: r.symbol,
          date: r.date,
          timing: FINNHUB_TIMING[String(r.hour || '').toLowerCase()] || null,
          epsEstimate: r.epsEstimate ?? null,
          epsActual: r.epsActual ?? null,
          revenueEstimate: r.revenueEstimate ?? null,
          revenueActual: r.revenueActual ?? null,
        }));
        if (dbg) {
          dbg.providers.finnhub = {
            attempted: true,
            rawCount,
            normalizedCount: data.length,
            firstRawRow: firstRaw ? { keys: Object.keys(firstRaw), symbol: firstRaw.symbol ?? null, date: firstRaw.date ?? null } : null,
            dropReasons: { tickerFilter: rawCount - data.length },
          };
        }

        if (data.length > 0) {
          cacheSet(ck, data, 600_000); // 10 min
          return send({ ok: true, data, source: 'finnhub' });
        }
        finnhubState = 'empty';
      } else {
        finnhubState = 'error';
        finnhubError = detailed.error || 'unknown error';
        if (dbg) dbg.providers.finnhub = { attempted: true, error: finnhubError };
        logger.warn(`[earnings-calendar] finnhub degraded: ${finnhubError}`);
      }
    }

    // Keyless Yahoo fallback — watchlist + S&P 100 universe (12h cache).
    let fallback = { rows: [], sampled: 0, meta: null };
    let yahooError = null;
    try {
      fallback = await yahooEarningsFallback({ symbols: watchSymbols, from: range.from, to: range.to });
    } catch (e) {
      yahooError = e.message;
      logger.warn(`[earnings-calendar] yahoo fallback failed: ${e.message}`);
    }
    let yahooRows = fallback.rows;
    if (ticker) {
      const want = String(ticker).toUpperCase();
      yahooRows = yahooRows.filter(r => String(r.symbol || '').toUpperCase() === want);
    }
    if (dbg) {
      dbg.providers.yahoo = yahooError
        ? { attempted: true, error: yahooError }
        : {
            attempted: true,
            rawCount: fallback.sampled,
            normalizedCount: yahooRows.length,
            dropReasons: fallback.meta?.dropReasons ?? {},
            firstRawRow: fallback.meta?.firstRawRow ?? null,
          };
    }
    if (yahooRows.length > 0) {
      return send({
        ok: true,
        data: yahooRows,
        source: 'yahoo',
        note: finnhubState === 'error'
          ? `Finnhub degraded (${finnhubError}) — showing Yahoo fallback (watchlist + S&P 100).`
          : 'Yahoo fallback universe: watchlist + S&P 100.',
      });
    }

    // No rows anywhere — say WHY, so the panel never goes silently empty.
    // empty:'no-data'     → a provider answered; the window is genuinely quiet.
    // empty:'no-provider' → every provider is unconfigured or down.
    if (eulerpoolState === 'empty' || finnhubState === 'empty' || fallback.sampled > 0) {
      return send({
        ok: true,
        data: [],
        source: finnhubState === 'empty' ? 'finnhub'
          : fallback.sampled > 0 ? 'yahoo'
          : 'eulerpool',
        empty: 'no-data',
        message: `All providers are live — no earnings scheduled between ${range.from} and ${range.to}.`,
      });
    }
    return send({
      ok: true,
      data: [],
      source: 'unavailable',
      empty: 'no-provider',
      missingEnv: 'FINNHUB_API_KEY',
      message: finnhubState === 'error'
        ? `Earnings feed degraded — Finnhub error (${finnhubError}) and the Yahoo fallback returned nothing.`
        : 'Earnings calendar offline — set FINNHUB_API_KEY (or EULERPOOL_API_KEY); the Yahoo fallback returned nothing.',
    });
  } catch (e) {
    logger.error('GET /market/earnings-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/macro-calendar
 * Returns upcoming macro events (FOMC, CPI, NFP, ECB, COPOM, etc.)
 */
router.get('/market/macro-calendar', async (req, res) => {
  try {
    // Empty-cascade fix (P2 item 1) — same principle as earnings-calendar:
    // an empty (or throwing) Eulerpool response cascades to Finnhub instead
    // of short-circuiting into {source:'eulerpool', data:[]}.
    let eulerpoolState = 'unconfigured'; // 'unconfigured' | 'empty' | 'error'
    if (eulerpool.isConfigured()) {
      const ck = 'macro-calendar';
      const cached = cacheGet(ck);
      if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

      try {
        const data = await eulerpool.getMacroCalendar();
        const result = Array.isArray(data) ? data : (data?.events ?? []);
        if (result.length > 0) {
          cacheSet(ck, result, 300_000); // 5 min
          return res.json({ ok: true, data: result, source: 'eulerpool' });
        }
        eulerpoolState = 'empty';
        logger.warn('[macro-calendar] eulerpool returned 0 events — cascading to finnhub');
      } catch (e) {
        eulerpoolState = 'error';
        logger.warn(`[macro-calendar] eulerpool degraded (${e.message}) — cascading to finnhub`);
      }
    }

    // #UX-3 — Finnhub /calendar/economic fallback (finnhubAdapter).
    // NOTE: this endpoint is premium-gated on free Finnhub keys; when
    // the adapter errors or returns an empty set we fall through to the
    // honest 'unavailable' envelope (naming the missing env var) so the
    // panel can say so instead of silently rendering nothing.
    if (process.env.FINNHUB_API_KEY) {
      const ck = 'macro-calendar:finnhub';
      const cached = cacheGet(ck);
      if (cached) return res.json({ ok: true, data: cached, source: 'finnhub' });

      const finnhub = require('../../adapters/finnhubAdapter');
      const result = await finnhub.calendar({}, { kind: 'economic' });
      if (result.ok && Array.isArray(result.data) && result.data.length > 0) {
        const events = result.data.map((row, i) => ({
          id: `fh-eco-${i}`,
          name: row.country ? `${row.country} · ${row.event}` : (row.event || '—'),
          date: row.time ? String(row.time).slice(0, 10) : '',
          time: row.time ? String(row.time).slice(11, 16) : '',
          importance: row.impact || 'medium',
          previous: row.prev ?? null,
          forecast: row.estimate ?? null,
          actual: row.actual ?? null,
        }));
        cacheSet(ck, events, 300_000); // 5 min
        return res.json({ ok: true, data: events, source: 'finnhub' });
      }
    }

    // Eulerpool answered (just quietly) and Finnhub had nothing to add —
    // that is a genuine no-data window, NOT a configuration problem.
    if (eulerpoolState === 'empty') {
      return res.json({
        ok: true,
        data: [],
        source: 'eulerpool',
        empty: 'no-data',
        message: 'All providers are live — no macro events in the current window.',
      });
    }
    return res.json({
      ok: true,
      data: [],
      source: 'unavailable',
      missingEnv: process.env.FINNHUB_API_KEY ? 'EULERPOOL_API_KEY' : 'FINNHUB_API_KEY',
      message: process.env.FINNHUB_API_KEY
        ? 'Live macro calendar offline — Finnhub economic calendar is premium-gated; set EULERPOOL_API_KEY.'
        : 'Live macro calendar offline — set FINNHUB_API_KEY or EULERPOOL_API_KEY.',
    });
  } catch (e) {
    logger.error('GET /market/macro-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/calendar?kind=economic|earnings|ipo&from=YYYY-MM-DD&to=YYYY-MM-DD&country=US&impact=high
 * W6.3: Typed calendar dispatch through the AdapterRegistry.
 *
 * Unlike /market/macro-calendar (Eulerpool-only, loose shape) this route
 * consults coverage_matrix via registry.route(), walks the adapter chain
 * for GLOBAL/calendar/calendar, and normalizes every vendor row through
 * calendarParser.js into typed CalendarEvent records. The envelope
 * includes a provenance block so the UI can render "source: finnhub,
 * fetched 2m ago" instead of guessing.
 *
 * Filters:
 *   kind      — 'economic' (default) | 'earnings' | 'ipo'
 *   from/to   — YYYY-MM-DD; defaults to today..today+7d
 *   country   — optional ISO country filter applied after parsing
 *   impact    — optional 'high'|'medium'|'low' filter (post-parse)
 *   limit     — cap result count (default 200, max 500)
 */
router.get('/market/calendar', async (req, res) => {
  try {
    const { getRegistry } = require('../../adapters/registry');
    const { executeChain } = require('../../adapters/contract');
    const { parseCalendarRows } = require('../../parsers/calendarParser');

    const kind = String(req.query.kind || 'economic').toLowerCase();
    if (!['economic', 'earnings', 'ipo'].includes(kind)) {
      return res.status(400).json({ error: 'invalid_kind', message: `kind must be economic|earnings|ipo, got '${kind}'` });
    }
    const from = req.query.from || undefined;
    const to   = req.query.to   || undefined;
    const country = req.query.country ? String(req.query.country).toUpperCase() : null;
    const impactFilter = req.query.impact ? String(req.query.impact).toLowerCase() : null;
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));

    const registry = getRegistry();
    const chain = registry.route('GLOBAL', 'calendar', 'calendar');
    if (!chain || chain.length === 0) {
      return res.status(404).json({
        error: 'calendar_not_in_coverage',
        message: 'No adapter declares GLOBAL/calendar coverage.',
      });
    }

    const result = await executeChain(chain, 'calendar', [{ from, to, kind }, { kind }]);
    if (!result.ok) {
      return res.status(502).json({
        error: result.error.code || 'chain_failed',
        message: result.error.message || 'Calendar adapters exhausted',
        adapterChain: result.provenance?.adapterChain || [],
      });
    }

    let events = parseCalendarRows(result.data);
    if (country)       events = events.filter(e => e.country === country);
    if (impactFilter)  events = events.filter(e => e.impact === impactFilter);
    if (events.length > limit) events = events.slice(0, limit);

    return res.json({
      kind,
      from: from || null,
      to: to || null,
      count: events.length,
      events,
      provenance: {
        source: result.provenance.source,
        fetchedAt: result.provenance.fetchedAt,
        freshnessMs: result.provenance.freshnessMs,
        confidence: result.provenance.confidence,
        adapterChain: result.provenance.adapterChain,
        warnings: result.provenance.warnings,
        latencyMs: result.provenance.latencyMs,
      },
    });
  } catch (e) {
    logger.error('GET /market/calendar error:', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

/**
 * GET /market/macro-snapshot/:country
 * Returns GDP, CPI, unemployment, rates, trade balance for a country.
 */
router.get('/market/macro-snapshot/:country', async (req, res) => {
  try {
    const country = req.params.country.toUpperCase();

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable' });
    }

    const ck = `macro-snap:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getMacroSnapshot(country);

    if (data) cacheSet(ck, data, 300_000);
    res.json({ ok: true, data: data || null, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/macro-snapshot/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/insider/:ticker?limit=20
 * Returns insider transactions for a ticker.
 */
router.get('/market/insider/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }

    const ck = `insider:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getInsiderTransactions(ticker, limit);
    const result = Array.isArray(data) ? data : [];

    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, ticker, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/insider/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/fundamentals/batch?tickers=AAPL,MSFT,NVDA
 * Returns fundamentals (PE, EPS, marketCap, revenue, etc.) for multiple tickers.
 */
router.get('/market/fundamentals/batch', async (req, res) => {
  try {
    const tickerStr = req.query.tickers || '';
    const tickers = tickerStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);

    if (!tickers.length) return res.status(400).json({ ok: false, error: 'tickers param required' });

    const ck = `funds-batch:${tickers.sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'cache' });

    // Separate .SA tickers (Brazilian) from regular tickers
    const saTickers = tickers.filter(t => t.endsWith('.SA'));
    const regularTickers = tickers.filter(t => !t.endsWith('.SA'));

    let data = {};

    // Fetch regular tickers from Eulerpool
    if (regularTickers.length > 0 && eulerpool.isConfigured()) {
      try {
        const eulerData = await eulerpool.getBatchFundamentals(regularTickers);
        if (eulerData) Object.assign(data, eulerData);
      } catch (e) {
        console.warn('[fundamentals/batch] Eulerpool failed:', e.message);
      }
    }

    // Fetch .SA tickers from Yahoo Finance (Eulerpool doesn't cover B3)
    if (saTickers.length > 0) {
      try {
        const quotes = await yahooQuote(saTickers.join(','));
        for (const q of (quotes || [])) {
          const sym = (q.symbol || '').toUpperCase();
          if (!sym) continue;
          data[sym] = {
            ticker: sym,
            pe: q.trailingPE ?? q.forwardPE ?? null,
            eps: q.epsTrailingTwelveMonths ?? null,
            marketCap: q.marketCap ?? null,
            revenue: null, ebitda: null, grossMargins: null,
            operatingMargins: null, profitMargins: null,
            totalCash: null, totalDebt: null, returnOnEquity: null,
            beta: null,
            sharesOutstanding: q.sharesOutstanding ?? null,
            dividendYield: q.trailingAnnualDividendYield ?? null,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
          };
        }
        // Enrich .SA tickers with quoteSummary data (revenue, margins, etc.)
        const saEnrich = saTickers.slice(0, 8).map(async (t) => {
          try {
            const qs = await yahooQuoteSummary(t);
            if (qs && data[t.toUpperCase()]) Object.assign(data[t.toUpperCase()], { ...qs, ...Object.fromEntries(Object.entries(data[t.toUpperCase()]).filter(([, v]) => v != null)) });
          } catch (e) { console.warn(`[fundamentals] quoteSummary ${t}:`, e.message); }
        });
        await Promise.allSettled(saEnrich);
      } catch (e) {
        console.warn('[fundamentals/batch] Yahoo .SA fallback failed:', e.message);
      }
    }

    // Also try Yahoo fallback for any regular tickers Eulerpool missed
    const missing = regularTickers.filter(t => !data[t]);
    if (missing.length > 0) {
      try {
        const quotes = await yahooQuote(missing.join(','));
        for (const q of (quotes || [])) {
          const sym = (q.symbol || '').toUpperCase();
          if (!sym || data[sym]) continue;
          data[sym] = {
            ticker: sym,
            pe: q.trailingPE ?? q.forwardPE ?? null,
            eps: q.epsTrailingTwelveMonths ?? null,
            marketCap: q.marketCap ?? null,
            revenue: null, ebitda: null, grossMargins: null,
            operatingMargins: null, profitMargins: null,
            totalCash: null, totalDebt: null, returnOnEquity: null,
            beta: null,
            sharesOutstanding: q.sharesOutstanding ?? null,
            dividendYield: q.trailingAnnualDividendYield ?? null,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
          };
        }
        // Enrich missing tickers with quoteSummary data (revenue, margins, etc.)
        const enrichTickers = missing.slice(0, 10);
        const enrichJobs = enrichTickers.map(async (t) => {
          try {
            const qs = await yahooQuoteSummary(t);
            const sym = t.toUpperCase();
            if (qs && data[sym]) {
              // quoteSummary fills nulls, existing non-null values preserved
              for (const [k, v] of Object.entries(qs)) {
                if (data[sym][k] == null && v != null) data[sym][k] = v;
              }
            }
          } catch (e) { console.warn(`[fundamentals] quoteSummary ${t}:`, e.message); }
        });
        await Promise.allSettled(enrichJobs);
      } catch (e) {
        console.warn('[fundamentals/batch] Yahoo fallback failed:', e.message);
      }
    }

    // Normalize margin fields: convert 0-1 ratios to 0-100 percentages
    // Eulerpool & Yahoo return margins as decimals (e.g. 0.46 = 46%)
    const RATIO_FIELDS = ['grossMargins', 'operatingMargins', 'profitMargins', 'returnOnEquity', 'dividendYield'];
    for (const sym of Object.keys(data)) {
      const row = data[sym];
      if (!row) continue;
      for (const field of RATIO_FIELDS) {
        const v = parseFloat(row[field]);
        if (!isNaN(v) && Math.abs(v) <= 1 && v !== 0) {
          row[field] = v * 100;
        }
      }
    }

    if (data && Object.keys(data).length > 0) cacheSet(ck, data, 300_000);
    res.json({ ok: true, data: data || {}, source: 'mixed' });
  } catch (e) {
    logger.error('GET /market/fundamentals/batch error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/crypto-extended/:name
 * Returns on-chain, DeFi, volume breakdown for a crypto asset.
 */
router.get('/market/crypto-extended/:name', async (req, res) => {
  try {
    const name = req.params.name.toLowerCase();

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable' });
    }

    const ck = `crypto-ext:${name}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getCryptoExtended(name);

    if (data) cacheSet(ck, data, 120_000);
    res.json({ ok: true, data: data || null, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/crypto-extended/${req.params.name} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* forex-rates and screener routes defined below (after sentiment) */

/**
 * GET /market/yield-curve/:country
 * Sovereign yield curve data from Eulerpool.
 */
router.get('/market/yield-curve/:country', async (req, res) => {
  try {
    const country = (req.params.country || 'US').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', country });
    }
    const ck = `yield-curve:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', country });

    const data = await eulerpool.getYieldCurve(country);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', country });
  } catch (e) {
    logger.error(`GET /market/yield-curve/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/bonds/corporate?rating=&sector=&currency=&limit=50
 * Corporate bonds from Eulerpool.
 */
router.get('/market/bonds/corporate', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const { rating, sector, currency, limit } = req.query;
    const opts = {};
    if (rating) opts.rating = rating;
    if (sector) opts.sector = sector;
    if (currency) opts.currency = currency;
    if (limit) opts.limit = parseInt(limit, 10);

    const ck = `corp-bonds:${JSON.stringify(opts)}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getCorpBonds(opts);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/bonds/corporate error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/bonds/sovereign/:country
 * Sovereign bonds from Eulerpool.
 */
router.get('/market/bonds/sovereign/:country', async (req, res) => {
  try {
    const country = (req.params.country || 'US').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable', country });
    }
    const ck = `sov-bonds:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', country });

    const data = await eulerpool.getSovereignBonds(country);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', country });
  } catch (e) {
    logger.error(`GET /market/bonds/sovereign/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/sentiment/:ticker
 * Sentiment data (news sentiment, analyst consensus) from Eulerpool.
 */
router.get('/market/sentiment/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', ticker });
    }
    const ck = `sentiment:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', ticker });

    const data = await eulerpool.getSentiment(ticker);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', ticker });
  } catch (e) {
    logger.error(`GET /market/sentiment/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/forex-rates/:currency
 * Forex rates from Eulerpool.
 */
router.get('/market/forex-rates/:currency', async (req, res) => {
  try {
    const currency = (req.params.currency || 'USD').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', currency });
    }
    const ck = `forex-rates:${currency}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', currency });

    const data = await eulerpool.getForexRates(currency);
    cacheSet(ck, data, 60_000);
    res.json({ ok: true, data, source: 'eulerpool', currency });
  } catch (e) {
    logger.error(`GET /market/forex-rates/${req.params.currency} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/screener?sector=Technology&country=US&limit=50
 * Stock screener from Eulerpool.
 */
router.get('/market/screener', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const filters = { ...req.query };
    const limit = parseInt(filters.limit, 10) || 50;
    delete filters.limit;

    const ck = `screener:${JSON.stringify(filters)}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getScreener(filters, limit);
    cacheSet(ck, data, 180_000);
    res.json({ ok: true, data, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/screener error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  POLYGON.IO ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/snapshot/:ticker
 * Returns real-time snapshot (OHLCV, prev day, min agg, last trade) from Polygon.
 */
router.get('/market/snapshot/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();

    const ck = `poly-snap:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`,
      { priority: 10, label: 'snapshot' }  // High priority for snapshots
    );

    const snapshot = data?.ticker ?? data;
    if (snapshot) cacheSet(ck, snapshot, 60_000); // Increased to 60s cache

    res.json({ ok: true, data: snapshot || null, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/snapshot/${req.params.ticker} error:`, e.message);
    res.status(e.code === 'not_found' ? 404 : 500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/financials/:ticker?limit=4&timeframe=annual
 * Returns company financials (income, balance sheet, cash flow) from Polygon.
 */
router.get('/market/financials/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 4, 10);
    const timeframe = req.query.timeframe === 'quarterly' ? 'quarterly' : 'annual';

    const ck = `poly-fin:${ticker}:${timeframe}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&limit=${limit}&timeframe=${timeframe}&order=desc&sort=filing_date`,
      { priority: 2, label: 'financials' }  // Lower priority, bulk data
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, timeframe, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/financials/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/dividends/:ticker?limit=12
 * Returns dividend history from Polygon.
 */
router.get('/market/dividends/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);

    const ck = `poly-div:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v3/reference/dividends?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&sort=ex_dividend_date`,
      { priority: 2, label: 'dividends' }  // Lower priority
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/dividends/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/splits/:ticker?limit=10
 * Returns stock split history from Polygon.
 */
router.get('/market/splits/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const ck = `poly-splits:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v3/reference/stock_splits?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&sort=execution_date`,
      { priority: 2, label: 'splits' }  // Lower priority
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/splits/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/options-ref/:ticker?limit=20&expiration_date.gte=2026-04-01
 * Returns options contract reference data from Polygon.
 */
router.get('/market/options-ref/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let path = `/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=asc&sort=expiration_date`;

    // Passthrough date filters
    if (req.query['expiration_date.gte']) path += `&expiration_date.gte=${req.query['expiration_date.gte']}`;
    if (req.query['expiration_date.lte']) path += `&expiration_date.lte=${req.query['expiration_date.lte']}`;
    if (req.query.contract_type) path += `&contract_type=${req.query.contract_type}`;

    const ck = `poly-optref:${ticker}:${path}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(path, { priority: 2, label: 'options-ref' }); // Lower priority

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/options-ref/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/movers/:direction
 * Top gainers or losers from Polygon snapshot.
 * :direction = "gainers" or "losers"
 */
router.get('/market/movers/:direction', async (req, res) => {
  try {
    const direction = req.params.direction === 'losers' ? 'losers' : 'gainers';
    const ck = `movers:${direction}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon', direction });

    const raw = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/${direction}`,
      { priority: 8, label: `polygon:movers:${direction}` }
    );
    const tickers = (raw?.tickers || []).slice(0, 20).map(t => ({
      ticker: t.ticker,
      price: t.day?.c || t.lastTrade?.p || null,
      change: t.todaysChange || null,
      changePct: t.todaysChangePerc || null,
      volume: t.day?.v || null,
    }));
    cacheSet(ck, tickers, 60_000);
    res.json({ ok: true, data: tickers, source: 'polygon', direction });
  } catch (e) {
    logger.error(`GET /market/movers/${req.params.direction} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  TWELVE DATA ENDPOINTS (S4.6)
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/td/profile/:ticker
 * Returns company profile from Twelve Data (sector, industry, description, CEO, etc.)
 */
router.get('/market/td/profile/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-profile:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getProfile(ticker);
    if (data) cacheSet(ck, data, 3600_000);
    res.json({ ok: true, data: data || null, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/profile/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/statistics/:ticker
 * Returns PE, EPS, beta, market cap, 52-week range from Twelve Data.
 */
router.get('/market/td/statistics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const ck = `td-stats:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'cache' });

    // Try TwelveData first, fall back to Yahoo quoteSummary
    let data = null;
    let source = 'unavailable';

    if (twelvedata.isConfigured()) {
      try {
        data = await twelvedata.getStatistics(ticker);
        source = 'twelvedata';
      } catch (e) { console.warn(`[td/statistics] TwelveData failed for ${ticker}:`, e.message); }
    }

    if (!data) {
      // Yahoo quoteSummary fallback — provides revenue, margins, ROE, beta, etc.
      try {
        const qs = await yahooQuoteSummary(ticker);
        const qt = (await yahooQuote(ticker))?.[0];
        if (qs || qt) {
          data = {
            statistics: {
              valuations_metrics: {
                market_capitalization: qt?.marketCap ?? null,
                trailing_pe: qt?.trailingPE ?? null,
                forward_pe: qt?.forwardPE ?? null,
                price_to_book: qs?.priceToBook ?? null,
                enterprise_value: qs?.enterpriseValue ?? null,
                peg_ratio: qs?.pegRatio ?? null,
              },
              financials: {
                revenue: qs?.revenue ?? null,
                ebitda: qs?.ebitda ?? null,
                gross_margin: qs?.grossMargins != null ? (qs.grossMargins * 100) : null,
                operating_margin: qs?.operatingMargins != null ? (qs.operatingMargins * 100) : null,
                profit_margin: qs?.profitMargins != null ? (qs.profitMargins * 100) : null,
                return_on_equity: qs?.returnOnEquity != null ? (qs.returnOnEquity * 100) : null,
                return_on_assets: null,
                revenue_per_share: null,
                diluted_eps: qt?.epsTrailingTwelveMonths ?? null,
                revenue_growth: qs?.revenueGrowth != null ? (qs.revenueGrowth * 100) : null,
                earnings_growth: qs?.earningsGrowth != null ? (qs.earningsGrowth * 100) : null,
                operating_cashflow: qs?.operatingCashflow ?? null,
                free_cashflow: qs?.freeCashflow ?? null,
              },
              stock_price: {
                beta: qs?.beta ?? null,
                '52_week_low': qt?.fiftyTwoWeekLow ?? null,
                '52_week_high': qt?.fiftyTwoWeekHigh ?? null,
              },
              dividends_and_splits: {
                forward_annual_dividend_yield: qt?.trailingAnnualDividendYield != null ? (qt.trailingAnnualDividendYield * 100) : null,
                trailing_annual_dividend_yield: qt?.trailingAnnualDividendYield != null ? (qt.trailingAnnualDividendYield * 100) : null,
              },
              stock_statistics: {
                shares_outstanding: qt?.sharesOutstanding ?? null,
                short_percent_of_float: qs?.shortPercentOfFloat != null ? (qs.shortPercentOfFloat * 100) : null,
              },
            },
          };
          source = 'yahoo';
        }
      } catch (e) { console.warn(`[td/statistics] Yahoo fallback failed for ${ticker}:`, e.message); }
    }

    // Normalize nested statistics into flat keys the client expects
    let flat = null;
    if (data) {
      const s = data.statistics || data;
      const vm = s.valuations_metrics || {};
      const fi = s.financials || {};
      const sp = s.stock_price || {};
      const ds = s.dividends_and_splits || {};
      const ss = s.stock_statistics || {};
      flat = {
        market_capitalization: vm.market_capitalization ?? null,
        pe_ratio:              vm.trailing_pe ?? null,
        forward_pe:            vm.forward_pe ?? null,
        price_to_book:         vm.price_to_book ?? null,
        enterprise_value:      vm.enterprise_value ?? null,
        peg_ratio:             vm.peg_ratio ?? null,
        eps:                   fi.diluted_eps ?? null,
        revenue:               fi.revenue ?? null,
        ebitda:                fi.ebitda ?? null,
        gross_margin:          fi.gross_margin ?? null,
        operating_margin:      fi.operating_margin ?? null,
        profit_margin:         fi.profit_margin ?? null,
        return_on_equity:      fi.return_on_equity ?? null,
        revenue_growth:        fi.revenue_growth ?? null,
        earnings_growth:       fi.earnings_growth ?? null,
        beta:                  sp.beta ?? null,
        '52_week_low':         sp['52_week_low'] ?? null,
        '52_week_high':        sp['52_week_high'] ?? null,
        dividend_yield:        ds.forward_annual_dividend_yield != null ? ds.forward_annual_dividend_yield / 100 : ds.trailing_annual_dividend_yield != null ? ds.trailing_annual_dividend_yield / 100 : null,
        shares_outstanding:    ss.shares_outstanding ?? null,
        // Preserve raw nested data for any consumers that need it
        _raw: data,
      };
      cacheSet(ck, flat, 300_000);
    }
    res.json({ ok: true, data: flat, source });
  } catch (e) {
    logger.warn(`GET /market/td/statistics/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/earnings/:ticker
 * Returns earnings history from Twelve Data.
 */
router.get('/market/td/earnings/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-earn:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getEarnings(ticker);
    if (data) cacheSet(ck, data, 600_000);
    res.json({ ok: true, data: data || null, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/earnings/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/financials/:ticker?period=annual
 * Returns income statement, balance sheet, cash flow.
 * Primary: TwelveData. Fallback: Yahoo Finance quoteSummary for missing statements.
 */
router.get('/market/td/financials/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const period = req.query.period === 'quarterly' ? 'quarterly' : 'annual';

    const ck = `td-financials:${ticker}:${period}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'cached' });

    // ── 1. Try TwelveData for all three statements ────────────────────
    let incomeData = null, balanceData = null, cashflowData = null;
    let source = 'twelvedata';

    if (twelvedata.isConfigured()) {
      const [income, balance, cashflow] = await Promise.allSettled([
        twelvedata.getIncomeStatement(ticker, period),
        twelvedata.getBalanceSheet(ticker, period),
        twelvedata.getCashFlow(ticker, period),
      ]);
      incomeData   = income.status === 'fulfilled' ? income.value : null;
      balanceData  = balance.status === 'fulfilled' ? balance.value : null;
      cashflowData = cashflow.status === 'fulfilled' ? cashflow.value : null;
    }

    // ── 2. Yahoo Finance fallback for missing statements ──────────────
    // Financial data MUST be a non-empty array of statement periods.
    // TwelveData can return: null (error), [] (no data), or a non-array object
    // (e.g. {meta:{}, status:"ok"} when the key is missing from response).
    // All of these should trigger the Yahoo fallback.
    const isUsableArray = (d) => Array.isArray(d) && d.length > 0;
    const bsEmpty  = !isUsableArray(balanceData);
    const cfEmpty  = !isUsableArray(cashflowData);
    const incEmpty = !isUsableArray(incomeData);

    if (bsEmpty) logger.warn(`[financials] TwelveData balance_sheet empty/invalid for ${ticker} (type: ${typeof balanceData}, isArray: ${Array.isArray(balanceData)})`);
    if (cfEmpty) logger.warn(`[financials] TwelveData cash_flow empty/invalid for ${ticker} (type: ${typeof cashflowData}, isArray: ${Array.isArray(cashflowData)})`);

    if (bsEmpty || cfEmpty || incEmpty) {
      try {
        const { getYahooCrumb, YF_UA } = require('./lib/providers');
        const fetch = require('node-fetch');
        const { crumb, cookie } = await getYahooCrumb();
        const modules = [
          incEmpty ? 'incomeStatementHistory' : null,
          bsEmpty ? 'balanceSheetHistory' : null,
          cfEmpty ? 'cashflowStatementHistory' : null,
        ].filter(Boolean).join(',');

        if (modules) {
          const yfPeriod = period === 'quarterly' ? 'Quarterly' : '';
          const yfModules = modules.replace(/History/g, `History${yfPeriod}`);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 10000);
          try {
            const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${yfModules}&crumb=${encodeURIComponent(crumb)}&lang=en-US`;
            const r = await fetch(url, {
              headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/' },
              signal: ctrl.signal,
            });
            if (r.ok) {
              const json = await r.json();
              const result = json?.quoteSummary?.result?.[0];
              if (result) {
                const raw = (v) => (v && typeof v === 'object' && 'raw' in v) ? v.raw : (v ?? null);

                // Parse Yahoo balance sheet
                if (bsEmpty) {
                  const bsKey = period === 'quarterly' ? 'balanceSheetHistoryQuarterly' : 'balanceSheetHistory';
                  const bsStatements = result[bsKey]?.balanceSheetStatements || [];
                  if (bsStatements.length > 0) {
                    balanceData = bsStatements.map(s => ({
                      fiscal_date: s.endDate?.fmt || null,
                      total_assets: raw(s.totalAssets),
                      total_liabilities: raw(s.totalLiab),
                      total_shareholder_equity: raw(s.totalStockholderEquity),
                      cash_and_short_term_investments: raw(s.cash) || raw(s.shortTermInvestments),
                      total_debt: raw(s.longTermDebt) != null && raw(s.shortLongTermDebt) != null
                        ? (raw(s.longTermDebt) + raw(s.shortLongTermDebt)) : raw(s.longTermDebt),
                      net_debt: raw(s.netDebt),
                      current_assets: raw(s.totalCurrentAssets),
                      current_liabilities: raw(s.totalCurrentLiabilities),
                      retained_earnings: raw(s.retainedEarnings),
                      common_stock_shares_outstanding: raw(s.commonStockSharesOutstanding),
                    }));
                    source = 'yahoo+twelvedata';
                  }
                }

                // Parse Yahoo cash flow
                if (cfEmpty) {
                  const cfKey = period === 'quarterly' ? 'cashflowStatementHistoryQuarterly' : 'cashflowStatementHistory';
                  const cfStatements = result[cfKey]?.cashflowStatements || [];
                  if (cfStatements.length > 0) {
                    cashflowData = cfStatements.map(s => ({
                      fiscal_date: s.endDate?.fmt || null,
                      operating_cashflow: raw(s.totalCashFromOperatingActivities),
                      investing_cashflow: raw(s.totalCashflowsFromInvestingActivities),
                      financing_cashflow: raw(s.totalCashFromFinancingActivities),
                      free_cashflow: raw(s.totalCashFromOperatingActivities) != null && raw(s.capitalExpenditures) != null
                        ? raw(s.totalCashFromOperatingActivities) + raw(s.capitalExpenditures) : null,
                      capital_expenditure: raw(s.capitalExpenditures),
                      net_income: raw(s.netIncome),
                      depreciation: raw(s.depreciation),
                      change_in_working_capital: raw(s.changeInWorkingCapital) || raw(s.changeToOperatingActivities),
                    }));
                    source = 'yahoo+twelvedata';
                  }
                }

                // Parse Yahoo income statement (if TwelveData also failed)
                if (incEmpty) {
                  const incKey = period === 'quarterly' ? 'incomeStatementHistoryQuarterly' : 'incomeStatementHistory';
                  const incStatements = result[incKey]?.incomeStatementHistory || [];
                  if (incStatements.length > 0) {
                    incomeData = incStatements.map(s => ({
                      fiscal_date: s.endDate?.fmt || null,
                      total_revenue: raw(s.totalRevenue),
                      gross_profit: raw(s.grossProfit),
                      operating_income: raw(s.operatingIncome),
                      net_income: raw(s.netIncome),
                      ebitda: raw(s.ebitda),
                      cost_of_revenue: raw(s.costOfRevenue),
                      research_and_development: raw(s.researchDevelopment),
                      selling_general_and_administrative: raw(s.sellingGeneralAdministrative),
                    }));
                    source = 'yahoo+twelvedata';
                  }
                }
              }
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch (yfe) {
        logger.warn(`[financials] Yahoo fallback for ${ticker}:`, yfe.message);
      }
    }

    // Log final state for debugging
    logger.info(`[financials] ${ticker} final → income: ${Array.isArray(incomeData) ? incomeData.length : 'null'}, balance: ${Array.isArray(balanceData) ? balanceData.length : 'null'}, cashflow: ${Array.isArray(cashflowData) ? cashflowData.length : 'null'} (source: ${source})`);

    const data = {
      income_statement: incomeData,
      balance_sheet:    balanceData,
      cash_flow:        cashflowData,
    };

    cacheSet(ck, data, 600_000);
    res.json({ ok: true, data, ticker, period, source });
  } catch (e) {
    logger.warn(`GET /market/td/financials/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/insider/:ticker
 * Returns insider transactions from Twelve Data.
 */
router.get('/market/td/insider/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: [], source: 'unavailable' });

    const ck = `td-insider:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getInsiderTransactions(ticker);
    const result = Array.isArray(data) ? data : [];

    if (result.length > 0) cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/insider/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/holders/:ticker
 * Returns institutional + fund holders from Twelve Data.
 */
router.get('/market/td/holders/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-holders:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const [institutional, fund] = await Promise.allSettled([
      twelvedata.getInstitutionalHolders(ticker),
      twelvedata.getFundHolders(ticker),
    ]);

    const data = {
      institutional: institutional.status === 'fulfilled' ? institutional.value : [],
      fund:          fund.status === 'fulfilled' ? fund.value : [],
    };

    cacheSet(ck, data, 600_000);
    res.json({ ok: true, data, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/holders/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/logo/:ticker
 * Returns company logo URL from Twelve Data.
 */
router.get('/market/td/logo/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, url: null, source: 'unavailable' });

    const ck = `td-logo:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, url: cached, source: 'twelvedata' });

    const url = await twelvedata.getLogo(ticker);
    if (url) cacheSet(ck, url, 86400_000);
    res.json({ ok: true, url: url || null, source: 'twelvedata' });
  } catch (e) {
    res.json({ ok: true, url: null, source: 'twelvedata' });
  }
});

/**
 * GET /market/td/executives/:ticker
 * Returns key executives from Twelve Data.
 */
router.get('/market/td/executives/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: [], source: 'unavailable' });

    const ck = `td-execs:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getKeyExecutives(ticker);
    const result = Array.isArray(data) ? data : [];

    if (result.length > 0) cacheSet(ck, result, 3600_000);
    res.json({ ok: true, data: result, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/executives/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  TWELVEDATA — PREVIOUSLY UNEXPOSED ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/td/earnings-calendar?symbol=AAPL
 * Upcoming and past earnings dates from TwelveData.
 */
router.get('/market/td/earnings-calendar', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const { symbol } = req.query;
    const ck = `td-ecal:${symbol || 'all'}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getEarningsCalendar(symbol ? { symbol } : {});
    const result = Array.isArray(data) ? data : (data?.earnings || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata' });
  } catch (e) {
    logger.error('GET /market/td/earnings-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/dividends/:ticker?range=5y
 * Dividend history from TwelveData.
 */
router.get('/market/td/dividends/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const range = req.query.range || '5y';
    const ck = `td-div:${ticker}:${range}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    const data = await twelvedata.getDividends(ticker);
    const result = Array.isArray(data) ? data : (data?.dividends || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/dividends/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/splits/:ticker
 * Stock split history from TwelveData.
 */
router.get('/market/td/splits/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const ck = `td-splits:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    const data = await twelvedata.getSplits(ticker);
    const result = Array.isArray(data) ? data : (data?.splits || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/splits/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/technicals/:ticker?indicators=RSI,MACD,BBANDS&interval=1day
 * Technical indicators from TwelveData. Returns multiple indicators in parallel.
 */
router.get('/market/td/technicals/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: {}, source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const indicatorList = (req.query.indicators || 'RSI,MACD,BBANDS').split(',').map(s => s.trim().toUpperCase());
    const interval = req.query.interval || '1day';

    const ck = `td-tech:${ticker}:${indicatorList.join(',')}:${interval}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    // Fetch all indicators in parallel (capped at 5)
    const capped = indicatorList.slice(0, 5);
    const results = await Promise.allSettled(
      capped.map(ind => twelvedata.getTechnicalIndicator(ticker, ind, interval))
    );

    const data = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        data[capped[i]] = r.value;
      }
    });

    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/technicals/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* /market/td/diag diagnostic endpoint removed for production security */

// ═══════════════════════════════════════════════════════════════════════
//  UNIFIED ENRICHED TICKER ENDPOINT
//  Combines Yahoo deep fundamentals, TwelveData technicals, Eulerpool
//  sentiment into a single call for sector screen deep-dives.
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/enriched/:ticker
 * Returns comprehensive data for a single ticker from all available providers.
 * Includes: fundamentals, earnings history, analyst actions, insider holdings,
 * institutional ownership, technical indicators, sentiment.
 */
router.get('/market/enriched/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const ck = `enriched:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'multi', ticker });

    // Fire ALL data sources in parallel — never wait for one to finish before starting another
    const [
      yahooDeep,
      technicals,
      sentiment,
      tdEarnings,
      tdDividends,
    ] = await Promise.allSettled([
      // 1. Yahoo quoteSummary — now returns 50+ fields from 11 modules
      yahooQuoteSummary(ticker).catch(() => null),
      // 2. TwelveData technical indicators (RSI, MACD, BBANDS)
      twelvedata.isConfigured()
        ? Promise.allSettled([
            twelvedata.getTechnicalIndicator(ticker, 'RSI', '1day', { time_period: '14' }),
            twelvedata.getTechnicalIndicator(ticker, 'MACD', '1day'),
            twelvedata.getTechnicalIndicator(ticker, 'BBANDS', '1day'),
            twelvedata.getTechnicalIndicator(ticker, 'ADX', '1day'),
          ]).then(results => {
            const out = {};
            const names = ['RSI', 'MACD', 'BBANDS', 'ADX'];
            results.forEach((r, i) => {
              if (r.status === 'fulfilled' && r.value) out[names[i]] = r.value;
            });
            return out;
          })
        : Promise.resolve(null),
      // 3. Eulerpool sentiment
      eulerpool.isConfigured()
        ? eulerpool.getSentiment(ticker).catch(() => null)
        : Promise.resolve(null),
      // 4. TwelveData earnings
      twelvedata.isConfigured()
        ? twelvedata.getEarnings(ticker).catch(() => null)
        : Promise.resolve(null),
      // 5. TwelveData dividends
      twelvedata.isConfigured()
        ? twelvedata.getDividends(ticker).catch(() => null)
        : Promise.resolve(null),
    ]);

    const result = {
      ticker,
      // Yahoo deep fundamentals (margins, growth, valuation, ownership, etc.)
      fundamentals: yahooDeep.status === 'fulfilled' ? yahooDeep.value : null,
      // Technical indicators
      technicals: technicals.status === 'fulfilled' ? technicals.value : null,
      // Sentiment (news, social, analyst consensus)
      sentiment: sentiment.status === 'fulfilled' ? sentiment.value : null,
      // Earnings history
      earnings: tdEarnings.status === 'fulfilled' ? tdEarnings.value : null,
      // Dividends
      dividends: tdDividends.status === 'fulfilled' ? tdDividends.value : null,
      // Metadata
      providers: {
        yahoo: yahooDeep.status === 'fulfilled' && yahooDeep.value ? true : false,
        twelvedata: twelvedata.isConfigured(),
        eulerpool: eulerpool.isConfigured(),
      },
      fetchedAt: new Date().toISOString(),
    };

    cacheSet(ck, result, 180_000); // 3 min cache
    res.json({ ok: true, data: result, source: 'multi', ticker });
  } catch (e) {
    logger.error(`GET /market/enriched/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/enriched-batch?tickers=AAPL,MSFT,NVDA
 * Batch enriched data for sector screens — fetches up to 8 tickers in parallel.
 * Returns a lighter version (fundamentals + key technicals only, no full histories).
 */
router.get('/market/enriched-batch', async (req, res) => {
  try {
    const tickerStr = req.query.tickers || '';
    const tickers = tickerStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    if (!tickers.length) return res.status(400).json({ ok: false, error: 'tickers param required' });

    const ck = `enriched-batch:${tickers.sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'multi' });

    // Fetch Yahoo quoteSummary for all tickers in parallel
    const results = await Promise.allSettled(
      tickers.map(t => yahooQuoteSummary(t).catch(() => null))
    );

    const data = {};
    results.forEach((r, i) => {
      data[tickers[i]] = r.status === 'fulfilled' ? r.value : null;
    });

    cacheSet(ck, data, 180_000);
    res.json({ ok: true, data, source: 'multi' });
  } catch (e) {
    logger.error('GET /market/enriched-batch error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/live-tv?channel=bloomberg
 * GET /market/bloomberg-tv                (legacy alias)
 *
 * Resolves a news channel's CURRENT live YouTube video id so we can embed the
 * live stream directly.
 *
 * Why this is more than a one-liner: YouTube retired
 * /embed/live_stream?channel=<id> (it now renders "video unavailable"), which is
 * what the original panel used and why it stopped working. The replacement has
 * to discover the live video id, and YouTube gives datacenter IPs (Render) a
 * consent/bot interstitial instead of the real watch page, so a single scrape is
 * not dependable. We therefore try several independent strategies in order of
 * reliability and take the first that can PROVE it found a live video on the
 * right channel.
 *
 *   1. YouTube Data API  — exact and stable. Used only if YOUTUBE_API_KEY is set.
 *   2. Channel RSS feed  — /feeds/videos.xml is a static XML endpoint with no
 *                          consent gate, so it answers datacenter IPs.
 *   3. /live page scrape — works when YouTube serves us real markup.
 *
 * Add ?debug=1 to see what each strategy actually observed from the server's own
 * IP. That matters because the only environment whose behaviour counts here is
 * Render's, not a browser's.
 */
const LIVE_TV_CHANNELS = {
  bloomberg: { id: 'UCIALMKvObZNtJ6AmdCLP7Lg', label: 'Bloomberg Television', match: /bloomberg/i },
  yahoo:     { id: 'UCEAZeUIeJs0IjQiqTCdVSIg', label: 'Yahoo Finance',        match: /yahoo/i },
  reuters:   { id: 'UChqUTb7kYRX8-EiaN3XFrSQ', label: 'Reuters',              match: /reuters/i },
  cnbc:      { id: 'UCvJJ_dzjViJCoLf5uKUTwoA', label: 'CNBC',                 match: /cnbc/i },
};
const BLOOMBERG_TV_CHANNEL = LIVE_TV_CHANNELS.bloomberg.id;

const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function ytFetch(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': YT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        // hl/gl pin the locale; CONSENT/SOCS skip the EU consent gate. Neither is
        // sufficient on its own from a datacenter IP, but they cost nothing.
        'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
      },
    });
    const body = await r.text();
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts the balanced JSON object that follows a marker in a page, e.g.
 * ytInitialData. Regex cannot do this correctly (the payload contains nested
 * braces inside strings), so we brace-match while tracking string/escape state.
 */
function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const start = html.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

/** Reads a YouTube "title" node, which is either simpleText or runs[]. */
function ytTitleText(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.simpleText) return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r && r.text).filter(Boolean).join('');
  return '';
}

/**
 * Walks ytInitialData for video entries that are CURRENTLY live, pairing the id
 * with its own LIVE badge inside the same renderer node. The pairing is the
 * whole point: an earlier version of this resolver read the id and the live
 * signal from separate places in the document, so a random channel upload could
 * inherit a live badge from elsewhere -- which is how the panel ended up playing
 * unrelated videos.
 */
function findLiveVideosInYtData(data) {
  const out = [];
  const seen = new Set();
  (function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    if (typeof node.videoId === 'string' && node.videoId.length === 11 && !seen.has(node.videoId)) {
      // Only look for the badge within THIS node's own overlays/badges.
      const scope = JSON.stringify({
        o: node.thumbnailOverlays || null,
        b: node.badges || null,
        v: node.viewCountText || null,
      });
      const isLive = /"style":"LIVE"/.test(scope)
        || /"BADGE_STYLE_TYPE_LIVE_NOW"/.test(scope)
        || /"iconType":"LIVE"/.test(scope);
      if (isLive) {
        seen.add(node.videoId);
        out.push({ videoId: node.videoId, title: ytTitleText(node.title) });
      }
    }
    for (const k in node) walk(node[k], depth + 1);
  })(data, 0);
  return out;
}

/**
 * Strategy: the channel's /streams tab.
 *
 * This is the one that actually finds a 24/7 stream. RSS cannot: a rolling live
 * stream is published once and then runs for weeks, so it falls off the feed's
 * 15 most-recent entries while still being live -- verified against Bloomberg,
 * whose live stream was absent from RSS while the channel was on air. The
 * /streams tab lists live streams first and carries an explicit LIVE badge.
 */
async function resolveViaStreamsTab(chan, dbg) {
  try {
    const { status, body: html } = await ytFetch(
      `https://www.youtube.com/channel/${chan.id}/streams?hl=en&gl=US`, 10000);
    if (status !== 200) { dbg.streams = `HTTP ${status}`; return null; }

    const data = extractJsonAfter(html, 'ytInitialData');
    let candidates = data ? findLiveVideosInYtData(data) : [];

    // Fallback if the JSON shape moves: scoped regex over each id's own window.
    // Still a pairing -- the badge must appear near that specific id.
    if (!candidates.length) {
      const re = /"videoId":"([\w-]{11})"/g;
      let m;
      const seen = new Set();
      while ((m = re.exec(html)) !== null) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const w = html.slice(m.index, m.index + 1500);
        if (/"style":"LIVE"|BADGE_STYLE_TYPE_LIVE_NOW/.test(w)) {
          const tm = w.match(/"title":\{"runs":\[\{"text":"([^"]{0,120})"/);
          candidates.push({ videoId: id, title: tm ? tm[1] : '' });
        }
      }
      if (candidates.length) dbg.streamsVia = 'regex-fallback';
    } else {
      dbg.streamsVia = 'ytInitialData';
    }

    dbg.streams = {
      bytes: html.length,
      parsedJson: !!data,
      liveCandidates: candidates.slice(0, 5).map((c) => `${c.videoId} — ${(c.title || '').slice(0, 60)}`),
    };
    if (!candidates.length) return null;

    // Prefer a candidate whose title identifies the channel; otherwise, since we
    // already fetched this channel's own page, the first live entry is still its
    // own stream.
    const pick = candidates.find((c) => chan.match.test(c.title || '')) || candidates[0];
    return { videoId: pick.videoId, title: pick.title || null, via: 'streams' };
  } catch (e) { dbg.streams = `error: ${e.message}`; return null; }
}

/** Strategy 1: official API. Exact, but needs a key. */
async function resolveViaDataApi(chan, dbg) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) { dbg.dataApi = 'no YOUTUBE_API_KEY'; return null; }
  try {
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${chan.id}`
            + `&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(key)}`;
    const { status, body } = await ytFetch(u, 8000);
    if (status !== 200) { dbg.dataApi = `HTTP ${status}`; return null; }
    const j = JSON.parse(body);
    const item = (j.items || [])[0];
    if (!item) { dbg.dataApi = 'no live item'; return null; }
    const videoId = item.id && item.id.videoId;
    const title = item.snippet && item.snippet.title;
    if (!videoId) { dbg.dataApi = 'item without videoId'; return null; }
    dbg.dataApi = `ok ${videoId}`;
    return { videoId, title: title || null, via: 'dataApi' };
  } catch (e) { dbg.dataApi = `error: ${e.message}`; return null; }
}

/**
 * Strategy 2: channel RSS. Static XML, no bot gate. It lists recent entries but
 * carries no "is live" flag, so we only accept an entry whose title matches the
 * channel AND looks like a rolling live stream, and we let the client's player be
 * the final arbiter (it reports an error and falls back if the embed is not
 * playable). Being wrong here shows an offline state, never a random video.
 */
async function resolveViaRss(chan, dbg) {
  try {
    const { status, body } = await ytFetch(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${chan.id}`, 8000);
    if (status !== 200) { dbg.rss = `HTTP ${status}`; return null; }
    const entries = [];
    const re = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = re.exec(body)) !== null && entries.length < 15) {
      const block = m[1];
      const id = (block.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1];
      if (id) entries.push({ id, title: (title || '').trim(), published: published || null });
    }
    dbg.rss = { count: entries.length, titles: entries.slice(0, 5).map((e) => e.title.slice(0, 70)) };
    if (!entries.length) return null;

    // A 24/7 stream is titled like "Bloomberg Business News Live" / "... LIVE".
    const liveish = entries.find((e) => chan.match.test(e.title) && /\blive\b/i.test(e.title));
    if (!liveish) { dbg.rssPick = 'no live-titled entry'; return null; }
    dbg.rssPick = `${liveish.id} — ${liveish.title.slice(0, 70)}`;
    return { videoId: liveish.id, title: liveish.title, via: 'rss' };
  } catch (e) { dbg.rss = `error: ${e.message}`; return null; }
}

/**
 * Strategy 3: scrape /live.
 *
 * STRICT. Three independent conditions must hold and must describe the SAME
 * video. An earlier version extracted the id and the "is live" signal
 * independently, so a random channel upload could be paired with a live badge
 * from elsewhere on the page — which is exactly how the panel ended up playing
 * unrelated YouTube videos. The id therefore comes ONLY from the canonical watch
 * URL (on /live YouTube redirects to the real live watch page); there is
 * deliberately no "first videoId on the page" fallback.
 */
async function resolveViaScrape(chan, dbg) {
  try {
    const { status, body: html } = await ytFetch(
      `https://www.youtube.com/channel/${chan.id}/live?hl=en&gl=US`, 9000);
    if (status !== 200) { dbg.scrape = `HTTP ${status}`; return null; }

    let videoId = null;
    const canon = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
    if (canon) videoId = canon[1];

    // Liveness must be asserted near this video's own player payload, not
    // anywhere in the document.
    let isLive = false;
    if (videoId) {
      const idx = html.indexOf(`"videoId":"${videoId}"`);
      if (idx !== -1) isLive = /"isLive"\s*:\s*true/.test(html.slice(idx, idx + 4000));
      if (!isLive) {
        const vd = html.match(/"videoDetails"\s*:\s*\{[\s\S]{0,4000}?\}/);
        if (vd && vd[0].includes(videoId)) isLive = /"isLive"\s*:\s*true/.test(vd[0]);
      }
    }

    let title = null;
    const tm = html.match(/<meta name="title" content="([^"]{0,200})"/) || html.match(/<title>([^<]{0,200})<\/title>/);
    if (tm) title = tm[1];

    dbg.scrape = {
      bytes: html.length,
      hasCanonical: !!videoId,
      isLive,
      title: title ? title.slice(0, 80) : null,
      // Tells us whether we are looking at a consent wall rather than a watch page.
      looksLikeConsent: /consent\.youtube\.com|Before you continue|CONSENT_/i.test(html.slice(0, 20000)),
      looksLikeBotCheck: /Sign in to confirm|unusual traffic/i.test(html.slice(0, 20000)),
    };

    if (videoId && isLive && (!title || chan.match.test(title))) {
      return { videoId, title: title || null, via: 'scrape' };
    }
    return null;
  } catch (e) { dbg.scrape = `error: ${e.message}`; return null; }
}

/** Confirms the id is a real, embeddable video. oEmbed answers datacenter IPs. */
async function verifyEmbeddable(videoId, dbg) {
  try {
    const { status, body } = await ytFetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}`, 6000);
    if (status !== 200) { dbg.oembed = `HTTP ${status}`; return { ok: false, title: null }; }
    const j = JSON.parse(body);
    dbg.oembed = `ok — ${(j.title || '').slice(0, 70)}`;
    return { ok: true, title: j.title || null };
  } catch (e) { dbg.oembed = `error: ${e.message}`; return { ok: false, title: null }; }
}

async function handleLiveTv(req, res) {
  const wantDebug = req.query.debug === '1';
  const key = String(req.query.channel || 'bloomberg').toLowerCase();
  const chan = LIVE_TV_CHANNELS[key];
  if (!chan) {
    return res.status(400).json({
      ok: false, error: `unknown channel "${key}"`, channels: Object.keys(LIVE_TV_CHANNELS),
    });
  }
  const channelUrl = `https://www.youtube.com/channel/${chan.id}/live`;
  const ck = `live-tv:${key}`;
  const dbg = {};

  try {
    if (!wantDebug) {
      const cached = cacheGet(ck);
      if (cached) {
        return res.json({
          ok: true, channel: key, label: chan.label, channelUrl,
          videoId: cached.videoId, live: !!cached.videoId,
          title: cached.title || null, source: 'cache',
        });
      }
    }

    // Order matters: the /streams tab is the only strategy that reliably sees a
    // long-running 24/7 stream, so it goes first among the keyless options.
    let found = await resolveViaDataApi(chan, dbg);
    if (!found) found = await resolveViaStreamsTab(chan, dbg);
    if (!found) found = await resolveViaRss(chan, dbg);
    if (!found) found = await resolveViaScrape(chan, dbg);

    if (found) {
      const v = await verifyEmbeddable(found.videoId, dbg);
      if (!v.ok) found = null;
      // oEmbed's title is authoritative; re-check it belongs to this channel.
      else if (v.title && !chan.match.test(v.title) && !chan.match.test(found.title || '')) {
        dbg.rejected = `oembed title "${v.title.slice(0, 60)}" does not match ${key}`;
        found = null;
      } else if (v.title) {
        found.title = v.title;
      }
    }

    const payload = {
      ok: true, channel: key, label: chan.label, channelUrl,
      videoId: found ? found.videoId : null,
      live: !!found,
      title: found ? found.title : null,
      source: found ? found.via : 'none',
    };
    if (wantDebug) payload.debug = dbg;
    else if (found) cacheSet(ck, { videoId: found.videoId, title: found.title }, 600_000);
    else cacheSet(ck, { videoId: null }, 120_000);

    if (!found) logger.info('live-tv', `no live stream resolved for ${key}`, dbg);
    return res.json(payload);
  } catch (e) {
    logger.warn(`GET /market/live-tv (${key}) error:`, e.message);
    return res.json({
      ok: false, channel: key, label: chan.label, channelUrl,
      videoId: null, live: false, error: e.message,
      ...(wantDebug ? { debug: dbg } : {}),
    });
  }
}

router.get('/market/live-tv', handleLiveTv);
router.get('/market/live-tv/channels', (_req, res) => {
  res.json({
    ok: true,
    channels: Object.entries(LIVE_TV_CHANNELS).map(([k, v]) => ({ key: k, label: v.label })),
  });
});
// Legacy path kept so an old cached client bundle keeps working.
router.get('/market/bloomberg-tv', (req, res) => {
  req.query.channel = 'bloomberg';
  return handleLiveTv(req, res);
});


module.exports = router;
