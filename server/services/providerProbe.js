/**
 * providerProbe.js — #292 Wave 1: the provider truth matrix.
 *
 * One row per external data source the product depends on. Each row hits
 * the provider ONCE with a canonical instrument and reports four facts
 * that the old selftest could not tell apart:
 *
 *   configured  — is the key/URL present
 *   reached     — did the call return without throwing / error envelope
 *   hasValue    — did it carry a finite, positive number
 *   asOfMs      — the provider's OWN timestamp (null when it doesn't say)
 *   ageMin      — now − asOf, when known
 *
 * Why the distinction matters: most provider modules swallow errors into
 * null / [] / {error}, and three of them used to stamp `new Date()` on old
 * data. A probe that only checks "got a number" reads a cached Friday
 * close as a live Monday feed. This probe reads timestamps from the raw
 * payload wherever the module exposes one, and says UNKNOWN otherwise —
 * it never substitutes the clock.
 *
 * Budget-aware: results are cached for MATRIX_TTL so polling /selftest
 * doesn't itself burn Yahoo crumbs or FRED/TD credits. Alpha Vantage
 * (25 req/day) and billable AI/search providers are reported as
 * configured-only, never called.
 */

const MATRIX_TTL = 60_000;
const PROBE_TIMEOUT = 9_000;

let _cache = null; // { at, rows }

function fin(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }
function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t; // seconds vs ms
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

function withTimeout(p, ms) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Each probe returns { value, asOf, source?, note? } or throws.
 * `asOf` may be seconds, ms or ISO; `toMs` normalises. Return asOf: null
 * when the provider genuinely does not say.
 */
const PROVIDERS = [
  {
    name: 'yahoo', role: 'home grid, Brazil, rates, charts (unlicensed v7/v8)',
    symbol: 'AAPL',
    configured: () => true,
    probe: async () => {
      const P = require('../routes/market/lib/providers');
      const { crumb, cookie } = await P.getYahooCrumb();
      const now = Math.floor(Date.now() / 1000);
      // v8 chart is uncached in-process and carries meta.regularMarketTime.
      const r = await P._yahooChartRaw('AAPL', now - 7 * 86400, now, '1d', crumb, cookie);
      const meta = r?.meta || {};
      return { value: meta.regularMarketPrice, asOf: meta.regularMarketTime, note: `circuit=${P.getYahooCircuitState?.()?.state ?? '?'}` };
    },
  },
  {
    name: 'yahoo_brazil', role: 'B3 equities via Yahoo .SA',
    symbol: 'PETR4.SA',
    configured: () => true,
    probe: async () => {
      const P = require('../routes/market/lib/providers');
      const rows = await P.yahooQuote('PETR4.SA');
      const q = (Array.isArray(rows) ? rows : rows?.quoteResponse?.result || [])[0] || {};
      return { value: q.regularMarketPrice, asOf: q.regularMarketTime, note: q.marketState ? `marketState=${q.marketState}` : undefined };
    },
  },
  {
    name: 'brapi', role: 'B3 second source',
    symbol: 'PETR4',
    configured: () => true, // key optional
    probe: async () => {
      const b = require('../providers/brapi');
      const q = await b.getQuote('PETR4');
      if (!q) throw new Error('null (404 or empty)');
      if (q.error) throw new Error(q.error);
      return { value: q.price, asOf: q.asOf, note: process.env.BRAPI_API_KEY ? 'keyed' : 'anonymous (rate-limited)' };
    },
  },
  {
    name: 'twelvedata', role: 'FX / intl equities REST',
    symbol: 'EUR/USD',
    configured: () => !!require('../providers/twelvedata').isConfigured?.(),
    probe: async () => {
      const td = require('../providers/twelvedata');
      const q = await td.getQuote('EUR/USD');
      return { value: q?.price, asOf: q?.datetime || q?.timestamp || null };
    },
  },
  {
    name: 'finnhub', role: 'US quote fallback, news',
    symbol: 'AAPL',
    configured: () => !!process.env.FINNHUB_API_KEY,
    probe: async () => {
      const a = require('../adapters/finnhubAdapter');
      const r = await a.quote('AAPL');
      if (!r?.ok) throw new Error(r?.error?.code || 'adapter error');
      // adapter substitutes Date.now() when body.t is 0 — treat a timestamp
      // within 2s of now as "unknown" rather than "live".
      const ts = toMs(r.data?.timestamp);
      const suspicious = ts != null && Math.abs(Date.now() - ts) < 2000;
      return { value: r.data?.last, asOf: suspicious ? null : ts, note: suspicious ? 'adapter stamped now()' : undefined };
    },
  },
  {
    name: 'polygon', role: 'US last trade REST (WS not entitled)',
    symbol: 'AAPL',
    configured: () => !!process.env.POLYGON_API_KEY,
    probe: async () => {
      const a = require('../adapters/polygonAdapter');
      const r = await a.quote('AAPL', { includeNbbo: false });
      if (!r?.ok) throw new Error(r?.error?.code || 'adapter error');
      const ts = toMs(r.data?.timestamp);
      const suspicious = ts != null && Math.abs(Date.now() - ts) < 2000;
      return { value: r.data?.last, asOf: suspicious ? null : ts, note: suspicious ? 'adapter stamped now()' : undefined };
    },
  },
  {
    name: 'fred', role: 'US rates, macro',
    symbol: 'DGS10',
    configured: () => true, // key optional (CSV fallback)
    probe: async () => {
      const f = require('../providers/fred');
      const r = await f.fetchLatestPair('DGS10');
      if (!r) throw new Error('null');
      return { value: r.value, asOf: r.date ? `${r.date}T20:00:00Z` : null, note: process.env.FRED_API_KEY ? 'keyed' : 'csv (no key)' };
    },
  },
  {
    name: 'bcb_sgs', role: 'Brazil macro (Selic, IPCA, PTAX)',
    symbol: 'selic_meta',
    configured: () => true,
    probe: async () => {
      const m = require('../providers/macroBrProvider');
      const r = await m.getBrazilMacro({ series: 'selic_meta', months: 1 });
      if (r?.error) throw new Error(r.error);
      const d = r?.latest?.date; // dd/mm/yyyy or ISO
      let asOf = null;
      if (d) {
        const m2 = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
        asOf = m2 ? `${m2[3]}-${m2[2]}-${m2[1]}T12:00:00Z` : d;
      }
      return { value: r?.latest?.value, asOf };
    },
  },
  {
    name: 'ptax', role: 'BCB PTAX USD/BRL',
    symbol: 'USDBRL',
    configured: () => true,
    probe: async () => {
      const fx = require('../providers/fxProvider');
      const r = await fx.getFxQuote('USDBRL');
      if (r?.error && !r?.ptax) throw new Error(r.error);
      if (!r?.ptax) throw new Error('no ptax block');
      return { value: r.ptax.mid, asOf: r.ptax.asOf, note: r.live ? `live via ${r.live.source}` : 'no live leg' };
    },
  },
  {
    name: 'coingecko', role: 'crypto',
    symbol: 'bitcoin',
    configured: () => true,
    probe: async () => {
      const c = require('../providers/coingeckoProvider');
      const d = await c.getCoinDetail('bitcoin');
      if (!d) throw new Error('null (429 or non-2xx)');
      return { value: d?.marketData?.price, asOf: d?.marketData?.lastUpdated || d?.lastUpdated || null };
    },
  },
  {
    name: 'commodities', role: 'futures via Yahoo =F',
    symbol: 'gold',
    configured: () => true,
    probe: async () => {
      const c = require('../providers/commoditiesProvider');
      const r = await c.getCommodityQuote('gold');
      if (r?.error) throw new Error(r.error);
      return { value: r?.price, asOf: r?.asOf, note: r?.source };
    },
  },
  {
    name: 'us_treasury_curve', role: 'US curve (FRED 11 series)',
    symbol: 'curve',
    configured: () => true,
    probe: async () => {
      const t = require('../providers/usTreasuryCurve');
      const pts = await t.getUsTreasuryCurve();
      const ten = pts.find(p => p.tenor === '10Y') || pts[0];
      return { value: pts.length >= 3 ? ten?.yield : null, asOf: pts.fetchedAt || null, note: `${pts.length} pts${pts.stale ? ' STALE' : ''}` };
    },
  },
  {
    name: 'eulerpool', role: 'EU equities, bonds, options',
    symbol: 'SAP.DE',
    configured: () => !!require('../providers/eulerpool').isConfigured?.(),
    probe: async () => {
      const e = require('../providers/eulerpool');
      const q = await e.getQuote('SAP.DE');
      if (!q) throw new Error('null (auth or unknown symbol — module swallows both)');
      return { value: q.price, asOf: null };
    },
  },
  {
    name: 'unusual_whales', role: 'options flow',
    symbol: 'market tide',
    configured: () => !!process.env.UNUSUAL_WHALES_API_KEY,
    probe: async () => {
      const u = require('../services/unusualWhales');
      const t = await u.getMarketTide();
      if (!t) throw new Error('null (key, non-2xx or empty — module swallows all)');
      return { value: t.callVolume, asOf: t.asOf };
    },
  },
  {
    name: 'akshare', role: 'China A-shares worker',
    symbol: '600519',
    configured: () => !!require('../providers/akshare')._baseUrl?.(),
    probe: async () => {
      const a = require('../providers/akshare');
      const r = await a.quote({ symbol: '600519' });
      if (r?.error) throw new Error(r.error);
      return { value: r?.price ?? r?.last ?? r?.close, asOf: r?.time || r?.asOf || null };
    },
  },
  // Configured-only (billable or hard-capped): never called from here.
  { name: 'alpha_vantage', role: 'US fallback (25/day)', symbol: '—', configured: () => !!process.env.ALPHA_VANTAGE_KEY, probe: null },
  { name: 'anthropic',     role: 'Particle AI',          symbol: '—', configured: () => !!process.env.ANTHROPIC_API_KEY, probe: null },
  { name: 'perplexity',    role: 'AI web research',      symbol: '—', configured: () => !!process.env.PERPLEXITY_API_KEY, probe: null },
  { name: 'tavily',        role: 'AI web search',        symbol: '—', configured: () => !!process.env.TAVILY_API_KEY, probe: null },
  { name: 'anbima',        role: 'BR DI/prefixado curve', symbol: '—', configured: () => !!(process.env.ANBIMA_CLIENT_ID && process.env.ANBIMA_CLIENT_SECRET), probe: null },
];

async function runOne(p) {
  const t0 = Date.now();
  let configured = false;
  try { configured = !!p.configured(); } catch { configured = false; }
  const row = { provider: p.name, role: p.role, symbol: p.symbol, configured, reached: null, hasValue: null, asOfMs: null, ageMin: null, ms: 0, note: undefined, error: undefined };
  if (!p.probe) { row.reached = null; row.note = configured ? 'configured (not probed: billable/capped)' : 'not configured'; return row; }
  if (!configured) { row.reached = false; row.hasValue = false; row.note = 'not configured'; return row; }
  try {
    const r = await withTimeout(p.probe(), PROBE_TIMEOUT);
    row.reached = true;
    row.hasValue = fin(r?.value);
    row.asOfMs = toMs(r?.asOf);
    row.ageMin = row.asOfMs != null ? Math.round((Date.now() - row.asOfMs) / 60000) : null;
    row.note = r?.note;
  } catch (e) {
    row.reached = false;
    row.hasValue = false;
    row.error = String(e?.message || e).slice(0, 160);
  }
  row.ms = Date.now() - t0;
  return row;
}

/** Runs all probes (bounded parallel), cached MATRIX_TTL. */
async function providerMatrix({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.at < MATRIX_TTL) return { ..._cache, cached: true };
  const rows = await Promise.all(PROVIDERS.map(runOne));
  const summary = {
    probed: rows.filter(r => r.reached != null).length,
    reached: rows.filter(r => r.reached === true).length,
    withValue: rows.filter(r => r.hasValue === true).length,
    withTimestamp: rows.filter(r => r.asOfMs != null).length,
    notConfigured: rows.filter(r => !r.configured).map(r => r.provider),
    failed: rows.filter(r => r.configured && r.reached === false).map(r => r.provider),
  };
  _cache = { at: Date.now(), rows, summary };
  return { ..._cache, cached: false };
}

module.exports = { providerMatrix, PROVIDERS, _toMs: toMs };
