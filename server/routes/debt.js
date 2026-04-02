/**
 * routes/debt.js
 * Debt markets: sovereign yield curves + credit spread indexes + bond detail.
 *
 * Data sources (live, replacing all stubs):
 *   US Treasury curve  — FRED public API (free, no key needed)
 *   Credit spreads     — FRED ICE BofA index series (US IG/HY, Euro IG/HY, EM)
 *   Global gov yields  — Yahoo Finance (^TNX, ^DE10YT=RR, ^GB10YT=RR, etc.)
 *   ECB Euro area      — ECB Statistical Data Warehouse (free JSON API)
 *   Bond detail        — FRED/Yahoo for sovereign; stubs for corporate
 *
 * Mounted at /api/debt.  Requires auth + active subscription.
 */

const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();
const fred    = require('../providers/fred');
const logger  = require('../utils/logger');
const { sendApiError, ProviderError } = require('../utils/apiError');
const { isCountryCode, isTicker } = require('../utils/validate');
const debtProvider = require('../providers/debtProvider');

// ── Simple server-side cache ──────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttlMs) {
  _cache.set(k, { v, exp: Date.now() + ttlMs });
}

const TTL = {
  curve:   30 * 60 * 1000,
  spreads: 30 * 60 * 1000,
  yahoo:    5 * 60 * 1000,
  ecb:     60 * 60 * 1000,
  bond:    10 * 60 * 1000,
};

// ── Yahoo Finance bond yield tickers ─────────────────────────────────────────
const YAHOO_YIELD_TICKERS = {
  '^TNX':       { country: 'US', tenor: '10Y', name: 'US 10Y Treasury'     },
  '^TYX':       { country: 'US', tenor: '30Y', name: 'US 30Y Treasury'     },
  '^FVX':       { country: 'US', tenor: '5Y',  name: 'US 5Y Treasury'      },
  '^IRX':       { country: 'US', tenor: '3M',  name: 'US 3M T-Bill'        },
  '^DE10YT=RR': { country: 'DE', tenor: '10Y', name: 'Germany 10Y Bund'    },
  '^GB10YT=RR': { country: 'GB', tenor: '10Y', name: 'UK 10Y Gilt'         },
  '^FR10YT=RR': { country: 'FR', tenor: '10Y', name: 'France 10Y OAT'      },
  '^IT10YT=RR': { country: 'IT', tenor: '10Y', name: 'Italy 10Y BTP'       },
  '^ES10YT=RR': { country: 'ES', tenor: '10Y', name: 'Spain 10Y Bono'      },
  '^PT10YT=RR': { country: 'PT', tenor: '10Y', name: 'Portugal 10Y'        },
  '^NL10YT=RR': { country: 'NL', tenor: '10Y', name: 'Netherlands 10Y'     },
  '^JP10YT=RR': { country: 'JP', tenor: '10Y', name: 'Japan 10Y JGB'       },
  '^AU10YT=RR': { country: 'AU', tenor: '10Y', name: 'Australia 10Y'       },
  '^KR10YT=RR': { country: 'KR', tenor: '10Y', name: 'South Korea 10Y'     },
  '^MX10YT=RR': { country: 'MX', tenor: '10Y', name: 'Mexico 10Y'          },
  '^ZA10YT=RR': { country: 'ZA', tenor: '10Y', name: 'South Africa 10Y'    },
  '^IN10YT=RR': { country: 'IN', tenor: '10Y', name: 'India 10Y'           },
};

async function yahooQuoteDebt(symbols) {
  const HOSTS = ['query1', 'query2'];
  const FIELDS = 'symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent';
  async function tryCrumb(host) {
    const r = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36', 'Accept': '*/*', 'Accept-Language': 'en-US' },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    return { crumb: (await r.text()).trim(), cookie: r.headers.get('set-cookie') || '' };
  }
  let auth = null;
  for (const h of HOSTS) { auth = await tryCrumb(h); if (auth && auth.crumb) break; }
  if (!auth || !auth.crumb) throw new Error('Yahoo Finance: could not obtain crumb');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(auth.crumb)}&fields=${FIELDS}&lang=en-US`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36',
      'Accept': 'application/json', 'Accept-Language': 'en-US',
      'Cookie': auth.cookie, 'Referer': 'https://finance.yahoo.com/',
    },
  });
  if (!res.ok) throw new Error(`Yahoo: HTTP ${res.status}`);
  const json = await res.json();
  return json?.quoteResponse?.result ?? [];
}

// ── ECB Data Warehouse ────────────────────────────────────────────────────────
const ECB_SERIES = {
  '3M': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M',  '6M': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_6M',
  '1Y': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_1Y',  '2Y': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y',
  '5Y': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_5Y',  '7Y': 'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_7Y',
  '10Y':'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y', '20Y':'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_20Y',
  '30Y':'B.U2.EUR.4F.G_N_A.SV_C_YM.SR_30Y',
};

async function fetchEcbYield(seriesKey) {
  const url = `https://data-api.ecb.europa.eu/service/data/YC/${seriesKey}?lastNObservations=1&format=jsondata`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const ds   = json?.dataSets?.[0]?.series;
    if (!ds) return null;
    const key0 = Object.keys(ds)[0];
    const obs  = ds[key0]?.observations;
    if (!obs) return null;
    const lastIdx = Object.keys(obs).sort((a, b) => +b - +a)[0];
    const val = obs[lastIdx]?.[0];
    return val != null ? +val : null;
  } catch (e) {
    logger.warn(`[ECB] ${seriesKey}: ${e.message}`);
    return null;
  } finally { clearTimeout(timer); }
}

async function getEcbEuroCurve() {
  const ck = 'ecb:euro_curve';
  const c  = cacheGet(ck);
  if (c) return c;
  const entries = Object.entries(ECB_SERIES);
  const values  = await Promise.all(entries.map(([, k]) => fetchEcbYield(k)));
  const points  = entries.map(([t], i) => ({ tenor: t, yield: values[i] })).filter(p => p.yield !== null);
  if (points.length > 0) cacheSet(ck, points, TTL.ecb);
  return points;
}

// ── Country metadata & regions from debtProvider ──────────────────────────────
const COUNTRY_META = debtProvider.COUNTRY_META;
const REGIONS = debtProvider.REGIONS;

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/debt/sovereign/US  — full curve from FRED
router.get('/sovereign/US', async (req, res) => {
  try {
    const ck = 'debt:sovereign:US';
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    let points = await fred.getUSTreasuryCurve();
    let source = 'fred';

    if (points.length === 0) {
      logger.warn('[debt] FRED unavailable, falling back to Yahoo for US curve');
      try {
        const yq = await yahooQuoteDebt('^IRX,^FVX,^TNX,^TYX');
        points = yq.filter(q => q?.regularMarketPrice != null).map(q => {
          const m = YAHOO_YIELD_TICKERS[q.symbol];
          return m ? { tenor: m.tenor, yield: q.regularMarketPrice } : null;
        }).filter(Boolean);
        source = 'yahoo_fallback';
      } catch (_) {}
    }

    const resp = { country: 'US', ...COUNTRY_META.US, points, asOf: Date.now(), source };
    if (points.length > 0) cacheSet(ck, resp, TTL.curve);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, '/sovereign/US');
  }
});

// GET /api/debt/sovereign/EU  — Euro area curve from ECB
router.get('/sovereign/EU', async (req, res) => {
  try {
    const ck = 'debt:sovereign:EU';
    const c  = cacheGet(ck);
    if (c) return res.json(c);
    const points = await getEcbEuroCurve();
    const resp   = { country: 'EU', ...COUNTRY_META.EU, points, asOf: Date.now(), source: 'ecb' };
    if (points.length > 0) cacheSet(ck, resp, TTL.ecb);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, '/sovereign/EU');
  }
});

// GET /api/debt/sovereign/region  — must be before /:countryCode
router.get('/sovereign/region', async (req, res) => {
  try {
    const region = (req.query.region || 'g10').toLowerCase();
    const tenor  = (req.query.tenor  || '10Y').toUpperCase();

    // Phase 1: Validate region query
    const validRegions = Object.keys(REGIONS);
    if (!validRegions.includes(region)) {
      return res.status(400).json({ error: `Invalid region: ${region}. Must be one of: ${validRegions.join(', ')}` });
    }

    // Phase 1: Validate tenor query
    const validTenors = ['3M', '6M', '1Y', '2Y', '5Y', '7Y', '10Y', '20Y', '30Y'];
    if (!validTenors.includes(tenor)) {
      return res.status(400).json({ error: `Invalid tenor: ${tenor}. Must be one of: ${validTenors.join(', ')}` });
    }

    const codes  = REGIONS[region] || REGIONS.g10;

    const ck = `debt:region:${region}:${tenor}`;
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    const tickers = Object.entries(YAHOO_YIELD_TICKERS)
      .filter(([, m]) => codes.includes(m.country) && m.tenor === tenor)
      .map(([t]) => t);

    let snapshot = [];
    if (tickers.length > 0) {
      try {
        const quotes = await yahooQuoteDebt(tickers.join(','));
        snapshot = quotes.filter(q => q?.regularMarketPrice != null).map(q => {
          const m = YAHOO_YIELD_TICKERS[q.symbol];
          const meta = COUNTRY_META[m.country] || {};
          return { country: m.country, name: meta.name, currency: meta.currency || 'USD', color: meta.color || '#888', tenor, yield: q.regularMarketPrice, change: q.regularMarketChange ?? null, changeBps: Math.round((q.regularMarketChange ?? 0) * 100) };
        }).sort((a, b) => b.yield - a.yield);
      } catch (e) { logger.warn('[debt] region Yahoo fetch failed:', e.message); }
    }

    // Brazil fallback for regional: no Yahoo ticker for BR, so use BCB SELIC estimate
    if (codes.includes('BR') && !snapshot.find(s => s.country === 'BR')) {
      try {
        const selicRes = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {
          headers: { 'Accept': 'application/json' },
        }).then(r => r.json());
        const selic = Array.isArray(selicRes) && selicRes[0]?.valor ? parseFloat(selicRes[0].valor) : 14.75;
        // Rough estimate: 10Y is about 1-2% below SELIC in normal conditions
        const yieldEst = tenor === '10Y' ? selic - 1.5 : tenor === '5Y' ? selic - 2.5 : tenor === '2Y' ? selic - 1.0 : selic;
        snapshot.push({ country: 'BR', ...COUNTRY_META.BR, tenor, yield: parseFloat(yieldEst.toFixed(2)), change: null, changeBps: null, source: 'bcb_est' });
        snapshot.sort((a, b) => b.yield - a.yield);
      } catch (_) {
        snapshot.push({ country: 'BR', ...COUNTRY_META.BR, tenor, yield: 13.25, change: null, changeBps: null, source: 'stub' });
        snapshot.sort((a, b) => b.yield - a.yield);
      }
    }

    if (tenor === '10Y' && codes.includes('US') && !snapshot.find(s => s.country === 'US')) {
      try {
        const usCurve = await fred.getUSTreasuryCurve();
        const us10y = usCurve.find(p => p.tenor === '10Y');
        if (us10y) {
          snapshot.push({ country: 'US', ...COUNTRY_META.US, tenor, yield: us10y.yield, change: null, changeBps: null });
          snapshot.sort((a, b) => b.yield - a.yield);
        }
      } catch (_) {}
    }

    const resp = { region, tenor, snapshot, available: Object.keys(COUNTRY_META), asOf: Date.now(), source: 'yahoo+fred' };
    if (snapshot.length > 0) cacheSet(ck, resp, TTL.yahoo);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, '/sovereign/region');
  }
});

// GET /api/debt/sovereign/:countryCode  — single country (Yahoo 10Y)
router.get('/sovereign/:countryCode', async (req, res) => {
  try {
    const cc = req.params.countryCode.toUpperCase();

    // Phase 1: Validate countryCode (must be 2-letter uppercase alpha)
    if (!isCountryCode(cc) || !COUNTRY_META[cc]) {
      return res.status(400).json({ error: `Invalid country code: ${cc}. Must be 2-letter uppercase alpha.`, available: Object.keys(COUNTRY_META) });
    }

    const ck = `debt:sovereign:${cc}`;
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    const tickers = Object.entries(YAHOO_YIELD_TICKERS).filter(([, m]) => m.country === cc).map(([t]) => t);

    // Brazil fallback: no Yahoo yield tickers exist for BR, so fetch from
    // Tesouro Direto / BCB SELIC (same logic as /api/yield-curves BR block)
    // or return a stub DI curve.
    if (!tickers.length && cc === 'BR') {
      let points = [];
      let source = 'stub';
      try {
        const [selicRes, tdRes] = await Promise.allSettled([
          fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {
            headers: { 'Accept': 'application/json' },
          }).then(r => r.json()),
          fetch('https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json', {
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36', 'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.tesourodireto.com.br/' },
          }).then(r => { if (!r.ok) throw new Error(`TD ${r.status}`); return r.json(); }),
        ]);
        let diRate = 14.75;
        if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
          diRate = parseFloat(selicRes.value[0].valor);
        }
        points.push({ tenor: 'DI', yield: parseFloat(diRate.toFixed(2)) });
        if (tdRes.status === 'fulfilled') {
          const now = new Date();
          const bonds = tdRes.value?.response?.TrsrBdTradgList || [];
          const prefixados = bonds
            .filter(b => { const nm = (b.TrsrBd?.nm || '').toLowerCase(); return nm.includes('prefixado') && !nm.includes('juros') && b.TrsrBd?.anulInvstmtRate; })
            .map(b => {
              const matDate = new Date(b.TrsrBd.mtrtyDt);
              const months = Math.round((matDate - now) / (30.44 * 86400000));
              const rawRate = parseFloat(b.TrsrBd.anulInvstmtRate);
              const rate = rawRate < 1 ? parseFloat((rawRate * 100).toFixed(2)) : parseFloat(rawRate.toFixed(2));
              let tenor;
              if (months < 4) tenor = '3M'; else if (months < 8) tenor = '6M';
              else if (months < 18) tenor = '1Y'; else if (months < 30) tenor = '2Y';
              else if (months < 42) tenor = '3Y'; else if (months < 54) tenor = '4Y';
              else if (months < 66) tenor = '5Y'; else if (months < 90) tenor = '7Y';
              else tenor = Math.round(months / 12) + 'Y';
              return { tenor, months, yield: rate };
            })
            .filter(b => b.months > 0 && b.yield > 0)
            .sort((a, b_) => a.months - b_.months);
          if (prefixados.length > 0) {
            points.push(...prefixados);
            source = 'tesouro';
          }
        }
        // If Tesouro failed, build stub from SELIC
        if (points.length < 3) {
          const base = points[0]?.yield || 14.75;
          points = [
            { tenor: 'DI', yield: base },
            { tenor: '3M', yield: parseFloat((base + 0.15).toFixed(2)) },
            { tenor: '6M', yield: parseFloat((base + 0.10).toFixed(2)) },
            { tenor: '1Y', yield: parseFloat((base - 0.50).toFixed(2)) },
            { tenor: '2Y', yield: parseFloat((base - 1.50).toFixed(2)) },
            { tenor: '5Y', yield: parseFloat((base - 3.00).toFixed(2)) },
          ];
          source = 'bcb_stub';
        }
      } catch (e) {
        logger.warn(`[debt] BR fallback fetch failed: ${e.message}`);
        points = [
          { tenor: 'DI', yield: 14.75 }, { tenor: '1Y', yield: 14.25 },
          { tenor: '2Y', yield: 13.25 }, { tenor: '5Y', yield: 11.75 },
        ];
        source = 'stub';
      }
      const resp = { country: 'BR', ...COUNTRY_META.BR, points, asOf: Date.now(), source };
      if (points.length > 0) cacheSet(ck, resp, TTL.curve);
      return res.json(resp);
    }

    if (!tickers.length) {
      return res.status(404).json({ error: `No tickers for: ${cc}`, available: Object.keys(COUNTRY_META) });
    }

    const quotes = await yahooQuoteDebt(tickers.join(','));
    const points = quotes.filter(q => q?.regularMarketPrice != null).map(q => {
      const m = YAHOO_YIELD_TICKERS[q.symbol];
      return { tenor: m.tenor, yield: q.regularMarketPrice, change: q.regularMarketChange ?? null };
    });
    const resp = { country: cc, ...COUNTRY_META[cc], points, asOf: Date.now(), source: 'yahoo' };
    if (points.length > 0) cacheSet(ck, resp, TTL.yahoo);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, `/sovereign/${req.params.countryCode}`);
  }
});

// GET /api/debt/countries
router.get('/countries', (req, res) => {
  try {
    return res.json({
      countries: Object.entries(COUNTRY_META).map(([code, d]) => ({
        code, ...d,
        hasFullCurve: code === 'US' || code === 'EU',
      })),
      regions: REGIONS,
    });
  } catch (err) {
    return sendApiError(res, err, '/countries');
  }
});

// GET /api/debt/yields/global  — all 10Y benchmarks
router.get('/yields/global', async (req, res) => {
  try {
    const ck = 'debt:yields:global';
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    const tickers = Object.entries(YAHOO_YIELD_TICKERS).filter(([, m]) => m.tenor === '10Y').map(([t]) => t);
    const quotes  = await yahooQuoteDebt(tickers.join(','));

    // Phase 3: Guard against empty quotes or missing regularMarketPrice
    const yields  = quotes
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => {
        const m = YAHOO_YIELD_TICKERS[q.symbol];
        const meta = COUNTRY_META[m.country] || {};
        return { symbol: q.symbol, country: m.country, name: meta.name || m.name, currency: meta.currency || 'USD', color: meta.color || '#888', tenor: '10Y', yield: q.regularMarketPrice, change: q.regularMarketChange ?? null, changeBps: Math.round((q.regularMarketChange ?? 0) * 100) };
      })
      .sort((a, b) => b.yield - a.yield);

    // Phase 3: Always return well-formed response
    const resp = { ok: true, yields, count: yields.length, asOf: Date.now(), source: 'yahoo' };
    if (yields.length > 0) cacheSet(ck, resp, TTL.yahoo);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, '/yields/global');
  }
});

// GET /api/debt/credit/indexes  — FRED ICE BofA credit spreads
router.get('/credit/indexes', async (req, res) => {
  try {
    const ck = 'debt:credit:indexes';
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    let spreads = [];
    let source = 'fred';

    try {
      spreads = await fred.getCreditSpreads();
    } catch (e) {
      logger.warn('[debt] FRED credit spreads unavailable, using fallback:', e.message);
      // Phase 3: Use fallback if FRED fails
      spreads = [];
    }

    // Phase 3: Fallback with source: 'stub'
    const FALLBACK = [
      { id: 'US_IG', name: 'US IG OAS', spread: 102, spreadBps: true, currency: 'USD', source: 'stub' },
      { id: 'US_HY', name: 'US HY OAS', spread: 385, spreadBps: true, currency: 'USD', source: 'stub' },
      { id: 'EU_IG', name: 'Euro IG OAS', spread: 118, spreadBps: true, currency: 'EUR', source: 'stub' },
      { id: 'EU_HY', name: 'Euro HY OAS', spread: 420, spreadBps: true, currency: 'EUR', source: 'stub' },
      { id: 'EM',    name: 'EM Corp+ OAS', spread: 345, spreadBps: true, currency: 'USD', source: 'stub' },
      { id: 'US_10S2', name: 'US 10Y-2Y Spread', spread: -14, spreadBps: true, currency: 'USD', source: 'stub' },
    ];

    const result = spreads.length > 0 ? spreads : FALLBACK;
    source = spreads.length > 0 ? 'fred' : 'stub';

    // Phase 3: Ensure asOf always present
    const resp   = { indexes: result, source, asOf: Date.now() };
    if (spreads.length > 0) cacheSet(ck, resp, TTL.spreads);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, '/credit/indexes');
  }
});

// GET /api/debt/bond/:id  — bond detail with live yield
const BOND_STUBS = {
  'US2Y':  { issuer: 'US Treasury',       bondType: 'sovereign', couponPct: 4.75, couponFrequency: 'semi-annual', maturityDate: '2026-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', spreadBps: 0,    ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 1.82, convexity: 0.036, dv01: 182,  fredSeries: 'DGS2'        },
  'US5Y':  { issuer: 'US Treasury',       bondType: 'sovereign', couponPct: 4.25, couponFrequency: 'semi-annual', maturityDate: '2029-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', spreadBps: 0,    ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 4.41, convexity: 0.21,  dv01: 441,  fredSeries: 'DGS5'        },
  'US10Y': { issuer: 'US Treasury',       bondType: 'sovereign', couponPct: 4.00, couponFrequency: 'semi-annual', maturityDate: '2034-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', spreadBps: 0,    ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 8.27, convexity: 0.78,  dv01: 827,  fredSeries: 'DGS10'       },
  'US30Y': { issuer: 'US Treasury',       bondType: 'sovereign', couponPct: 4.25, couponFrequency: 'semi-annual', maturityDate: '2054-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', spreadBps: 0,    ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 17.9, convexity: 4.10,  dv01: 1790, fredSeries: 'DGS30'       },
  'DE10Y': { issuer: 'German Republic',   bondType: 'sovereign', couponPct: 2.50, couponFrequency: 'annual',     maturityDate: '2034-02-15', dayCount: 'ACT/ACT', currency: 'EUR', country: 'DE', spreadBps: -170, ratingMoodys: 'Aaa', ratingSP: 'AAA', ratingFitch: 'AAA', duration: 8.1,  convexity: 0.72,  dv01: 810,  yahooTicker: '^DE10YT=RR' },
  'GB10Y': { issuer: 'HM Treasury',       bondType: 'sovereign', couponPct: 4.13, couponFrequency: 'semi-annual', maturityDate: '2034-01-22', dayCount: 'ACT/ACT', currency: 'GBP', country: 'GB', spreadBps: -8,   ratingMoodys: 'Aa3', ratingSP: 'AA',  ratingFitch: 'AA-', duration: 7.9,  convexity: 0.70,  dv01: 790,  yahooTicker: '^GB10YT=RR' },
  'FR10Y': { issuer: 'French Republic',   bondType: 'sovereign', couponPct: 3.00, couponFrequency: 'annual',     maturityDate: '2034-05-25', dayCount: 'ACT/ACT', currency: 'EUR', country: 'FR', spreadBps: 60,   ratingMoodys: 'Aa2', ratingSP: 'AA-', ratingFitch: 'AA-', duration: 7.8,  convexity: 0.68,  dv01: 780,  yahooTicker: '^FR10YT=RR' },
  'IT10Y': { issuer: 'Republic of Italy', bondType: 'sovereign', couponPct: 4.35, couponFrequency: 'annual',     maturityDate: '2034-02-01', dayCount: 'ACT/ACT', currency: 'EUR', country: 'IT', spreadBps: 160,  ratingMoodys: 'Baa3',ratingSP: 'BBB+',ratingFitch: 'BBB', duration: 7.5,  convexity: 0.63,  dv01: 750,  yahooTicker: '^IT10YT=RR' },
  'JP10Y': { issuer: 'Bank of Japan',     bondType: 'sovereign', couponPct: 0.50, couponFrequency: 'semi-annual', maturityDate: '2034-03-20', dayCount: 'ACT/365', currency: 'JPY', country: 'JP', spreadBps: -380, ratingMoodys: 'A1',  ratingSP: 'A+',  ratingFitch: 'A',   duration: 9.2,  convexity: 0.95,  dv01: 920,  yahooTicker: '^JP10YT=RR' },
  'BR10Y': { issuer: 'Tesouro Nacional',  bondType: 'sovereign', couponPct: 11.0, couponFrequency: 'semi-annual', maturityDate: '2033-01-01', dayCount: 'BUS/252', currency: 'BRL', country: 'BR', spreadBps: 685,  ratingMoodys: 'Ba1', ratingSP: 'BB-', ratingFitch: 'BB',  duration: 5.8,  convexity: 0.38,  dv01: 580  },
  'AAPL24':{ issuer: 'Apple Inc.',        bondType: 'corporate', couponPct: 3.85, couponFrequency: 'semi-annual', maturityDate: '2046-08-04', dayCount: 'ACT/360', currency: 'USD', country: 'US', spreadBps: 65,   ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'N/A', duration: 18.2, convexity: 4.2,   dv01: 1820 },
  'MSFT25':{ issuer: 'Microsoft Corp.',   bondType: 'corporate', couponPct: 3.30, couponFrequency: 'semi-annual', maturityDate: '2027-02-06', dayCount: 'ACT/360', currency: 'USD', country: 'US', spreadBps: 55,   ratingMoodys: 'Aaa', ratingSP: 'AAA', ratingFitch: 'N/A', duration: 2.9,  convexity: 0.09,  dv01: 290  },
};

router.get('/bond/:id', async (req, res) => {
  try {
    const id   = req.params.id.toUpperCase();

    // Phase 1: Validate bond ID (alphanumeric, max 20 chars)
    if (!/^[A-Z0-9]{1,20}$/.test(id)) {
      return res.status(400).json({ error: `Invalid bond ID: ${id}. Must be alphanumeric, max 20 chars.` });
    }

    const bond = BOND_STUBS[id];
    if (!bond) {
      return res.status(404).json({ error: `Bond not found: ${id}`, available: Object.keys(BOND_STUBS) });
    }

    const ck = `debt:bond:${id}`;
    const c  = cacheGet(ck);
    if (c) return res.json(c);

    let liveYield = null;
    let liveSource = null;
    if (bond.fredSeries) {
      try { liveYield = await fred.getValue(bond.fredSeries); liveSource = 'fred'; } catch (_) {}
    }
    if (!liveYield && bond.yahooTicker) {
      try {
        const yq = await yahooQuoteDebt(bond.yahooTicker);
        liveYield = yq?.[0]?.regularMarketPrice ?? null;
        liveSource = 'yahoo';
      } catch (_) {}
    }
    if (!liveYield) liveYield = bond.couponPct / 100;

    const today = new Date(); const maturity = new Date(bond.maturityDate);
    const cashFlows = [];
    if (bond.couponPct) {
      const ppy   = bond.couponFrequency === 'annual' ? 1 : bond.couponFrequency === 'quarterly' ? 4 : 2;
      const cpn   = (bond.couponPct / 100) / ppy * 1000;
      const step  = 12 / ppy;
      let d = new Date(maturity); const flows = [];
      while (d > today) {
        flows.unshift({ date: d.toISOString().slice(0, 10), type: 'coupon', amount: +cpn.toFixed(4) });
        d = new Date(d); d.setMonth(d.getMonth() - step);
      }
      cashFlows.push(...flows.slice(0, 20));
      if (cashFlows.length > 0) {
        const l = cashFlows[cashFlows.length - 1];
        cashFlows[cashFlows.length - 1] = { ...l, type: 'principal+coupon', amount: +(l.amount + 1000).toFixed(4) };
      }
    }

    const resp = { ...bond, id, yieldToMaturity: liveYield, yieldToWorst: liveYield, cashFlows, faceValue: 1000, asOf: new Date().toISOString(), source: liveSource || 'stub', stub: bond.bondType === 'corporate' };
    delete resp.fredSeries; delete resp.yahooTicker;
    cacheSet(ck, resp, TTL.bond);
    return res.json(resp);
  } catch (err) {
    return sendApiError(res, err, `/bond/${req.params.id}`);
  }
});

module.exports = router;
