/**
 * routes/market/debt.js — Fixed-income endpoints: bond detail, rates, DI curve, yield curves
 *
 * Includes direct FRED CSV fallback for US yield curve (Task 3 of Phase 2).
 * FRED series: DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS3, DGS5, DGS7, DGS10, DGS30
 */

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { yahooQuote, sendError, fetch, YF_UA } = require('./lib/providers');
const { validateYieldCurves, validateRates, getIntegrityStatus, getAllIntegrityStatus } = require('../../services/dataIntegrityValidator');
const { swallow } = require('../../utils/swallow');

// ── Timeout helper for external API calls ────────────────────────────
function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timeout));
}

// ── Bond metadata map ───────────────────────────────────────────────
const BOND_YAHOO_MAP = {
  'US2Y':  { yahoo: '^TYA', tenor: '2Y',  maturityYears: 2,  couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 2-Year Treasury Note' },
  'US5Y':  { yahoo: '^FVX', tenor: '5Y',  maturityYears: 5,  couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 5-Year Treasury Note' },
  'US10Y': { yahoo: '^TNX', tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 10-Year Treasury Note' },
  'US30Y': { yahoo: '^TYX', tenor: '30Y', maturityYears: 30, couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 30-Year Treasury Bond' },
  'DE10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 1, faceValue: 1000, country: 'DE', currency: 'EUR', name: 'German 10-Year Bund' },
  'GB10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'GB', currency: 'GBP', name: 'UK 10-Year Gilt' },
  'JP10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'JP', currency: 'JPY', name: 'Japan 10-Year JGB' },
  'BR10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 0, faceValue: 1000, country: 'BR', currency: 'BRL', name: 'Brazil 10-Year DI Rate' },
};

// ── Bond calculation helpers ────────────────────────────────────────

function calcBondPrice(faceValue, couponRate, yieldPct, maturityYears, couponFreq) {
  if (couponFreq === 0) {
    // Zero-coupon (e.g. Brazil prefixados) — discount to face
    return faceValue / Math.pow(1 + yieldPct / 100, maturityYears);
  }
  const n = maturityYears * couponFreq;
  const r = (yieldPct / 100) / couponFreq;
  const c = (couponRate / 100) * faceValue / couponFreq;
  if (r === 0) return faceValue + c * n;
  const pvCoupons = c * (1 - Math.pow(1 + r, -n)) / r;
  const pvFace = faceValue / Math.pow(1 + r, n);
  return pvCoupons + pvFace;
}

function calcModifiedDuration(yieldPct, maturityYears, couponFreq) {
  if (couponFreq === 0) {
    return maturityYears / (1 + yieldPct / 100);
  }
  const modDur = maturityYears / (1 + (yieldPct / 100) / couponFreq);
  return modDur;
}

function calcDV01(price, modifiedDuration) {
  return (price * modifiedDuration * 0.0001);
}

// ── /bond-detail/:symbol ────────────────────────────────────────────
router.get('/bond-detail/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const meta = BOND_YAHOO_MAP[sym];

    if (!meta) {
      return res.status(404).json({ error: `Bond not found: ${sym}. Available: ${Object.keys(BOND_YAHOO_MAP).join(', ')}` });
    }

    let yieldValue = null;
    let yieldChange = null;
    let yieldChangePct = null;
    let prevYield = null;
    let dayHigh = null;
    let dayLow = null;
    let dayOpen = null;

    // —— Try Yahoo Finance for US treasuries ——
    if (meta.yahoo) {
      try {
        const quotes = await yahooQuote(meta.yahoo);
        const q = quotes?.[0];
        if (q && q.regularMarketPrice != null) {
          yieldValue = q.regularMarketPrice;
          yieldChange = q.regularMarketChange ?? null;
          yieldChangePct = q.regularMarketChangePercent ?? null;
          prevYield = q.regularMarketPreviousClose ?? null;
          dayHigh = q.regularMarketDayHigh ?? null;
          dayLow = q.regularMarketDayLow ?? null;
          dayOpen = q.regularMarketOpen ?? null;
        }
      } catch (e) {
        console.warn(`[BondDetail] Yahoo failed for ${meta.yahoo}:`, e.message);
      }
    }

    // —— Fallback: try to get from yield curves endpoint data ——
    if (yieldValue == null) {
      try {
        const cached = cacheGet('yield-curves-data');
        if (cached) {
          const countryMap = { US: 'US', DE: 'EU', GB: 'UK', JP: 'JP', BR: 'BR' };
          const curveKey = countryMap[meta.country];
          if (curveKey && cached[curveKey]?.curve) {
            const point = cached[curveKey].curve.find(p =>
              p.tenor === meta.tenor || p.tenor === meta.maturityYears + 'Y'
            );
            if (point) {
              yieldValue = point.rate;
            }
          }
        }
      } catch (e) { swallow(e, 'market.debt.cached_curve_lookup'); }
    }

    // —— #242 / P1.4 — FRED sovereign 10Y fallback for DE/GB/JP ——
    // The yield-curves cache is only warm once the client has hit
    // /yield-curves this session; a direct deep-link into
    // /bond-detail/DE10Y (or GB/JP) on a cold server would otherwise
    // leave yieldValue null forever. FRED's OECD monthly long-term
    // rates are a reliable, key-free backstop. BR uses Tesouro Direto
    // directly in the branch below (richer data than FRED offers for
    // Brazilian sovereigns).
    if (yieldValue == null && meta.tenor === '10Y' && FRED_SOVEREIGN_10Y[meta.country]) {
      const fredRate = await fetchFredSovereign10Y(meta.country);
      if (fredRate != null) yieldValue = fredRate;
    }

    // —— For Brazil, try Tesouro Direto for richer bond data ——
    let brBondData = null;
    if (meta.country === 'BR') {
      try {
        const tdRes = await fetch(
          'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json',
          {
            headers: {
              'User-Agent': YF_UA, 'Accept': 'application/json',
              'Accept-Language': 'pt-BR,pt;q=0.9',
              'Referer': 'https://www.tesourodireto.com.br/',
            },
          }
        );
        if (tdRes.ok) {
          const tdJson = await tdRes.json();
          const allBonds = tdJson?.response?.TrsrBdTradgList || [];
          const now = new Date();
          const candidates = allBonds
            .filter(b => b.TrsrBd?.anulInvstmtRate && b.TrsrBd?.mtrtyDt)
            .map(b => {
              const mat = new Date(b.TrsrBd.mtrtyDt);
              const yearsToMat = (mat - now) / (365.25 * 86400000);
              return { ...b, yearsToMat, matDate: mat };
            })
            .filter(b => b.yearsToMat > 0)
            .sort((a, b) => Math.abs(a.yearsToMat - 10) - Math.abs(b.yearsToMat - 10));

          if (candidates.length > 0) {
            const best = candidates[0];
            const bd = best.TrsrBd;
            const rawRate = parseFloat(bd.anulInvstmtRate);
            const rate = rawRate < 1 ? rawRate * 100 : rawRate;
            brBondData = {
              name: bd.nm,
              maturityDate: (bd.mtrtyDt || '').split('T')[0],
              yearsToMaturity: parseFloat(best.yearsToMat.toFixed(2)),
              yield: parseFloat(rate.toFixed(2)),
              unitPrice: bd.untrInvstmtVal ? parseFloat(bd.untrInvstmtVal) : null,
              redemptionPrice: bd.untrRedVal ? parseFloat(bd.untrRedVal) : null,
              minInvestment: bd.minInvstmtAmt ? parseFloat(bd.minInvstmtAmt) : null,
              isBuyable: bd.anulInvstmtRate > 0,
            };
            if (!yieldValue) yieldValue = brBondData.yield;
          }
        }
      } catch (e) {
        console.warn('[BondDetail] Tesouro Direto fetch failed:', e.message);
      }
    }

    // —— Calculate derived metrics ——
    const estimatedCoupon = yieldValue ? Math.round(yieldValue * 4) / 4 : null;
    const bondPrice = yieldValue != null
      ? parseFloat(calcBondPrice(meta.faceValue, estimatedCoupon || yieldValue, yieldValue, meta.maturityYears, meta.couponFreq).toFixed(4))
      : null;
    const discountPremium = bondPrice != null
      ? parseFloat(((bondPrice - meta.faceValue) / meta.faceValue * 100).toFixed(2))
      : null;
    const modDuration = yieldValue != null
      ? parseFloat(calcModifiedDuration(yieldValue, meta.maturityYears, meta.couponFreq).toFixed(2))
      : null;
    const dv01 = bondPrice != null && modDuration != null
      ? parseFloat(calcDV01(bondPrice, modDuration).toFixed(4))
      : null;
    const currentYield = bondPrice != null && estimatedCoupon != null && bondPrice > 0
      ? parseFloat(((estimatedCoupon / 100 * meta.faceValue) / bondPrice * 100).toFixed(3))
      : null;

    const maturityDate = brBondData?.maturityDate || null;

    // Yield spread (vs US 10Y as benchmark for non-US)
    let spreadBps = null;
    if (meta.country !== 'US' && yieldValue != null) {
      try {
        const usQuotes = await yahooQuote('^TNX');
        const us10y = usQuotes?.[0]?.regularMarketPrice;
        if (us10y != null) {
          spreadBps = Math.round((yieldValue - us10y) * 100);
        }
      } catch (e) { swallow(e, 'market.debt.us10y_spread'); }
    }

    res.json({
      symbol: sym,
      name: meta.name,
      country: meta.country,
      currency: meta.currency,
      tenor: meta.tenor,
      maturityYears: meta.maturityYears,
      maturityDate,
      faceValue: meta.faceValue,
      couponFreq: meta.couponFreq === 2 ? 'Semi-Annual' : meta.couponFreq === 1 ? 'Annual' : 'Zero-Coupon',

      yield: yieldValue,
      yieldChange,
      yieldChangePct,
      prevYield,
      dayHigh,
      dayLow,
      dayOpen,
      yieldChangeBps: yieldChange != null ? parseFloat((yieldChange * 100).toFixed(1)) : null,

      estimatedCoupon,
      price: bondPrice,
      discountPremium,
      currentYield,
      yieldToMaturity: yieldValue,
      yieldToWorst: yieldValue,
      modifiedDuration: modDuration,
      dv01,
      spreadToUS10Y: spreadBps,

      ...(brBondData ? { brBond: brBondData } : {}),

      assetClass: 'fixed_income',
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[API] /bond-detail error:', e.message);
    sendError(res, e);
  }
});

// ── /snapshot/rates ─────────────────────────────────────────────────
router.get('/snapshot/rates', async (req, res) => {
  // Cache TTL: 60 seconds for rates endpoint
  const cacheKey = 'snapshot:rates';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [usResult, selicResult] = await Promise.allSettled([
      yahooQuote('^IRX,^FVX,^TNX,^TYX'),
      // BCB series 4189 = Selic meta (annual target rate)
      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4189/dados/ultimos/1?formato=json', {
        headers: { 'Accept': 'application/json' }
      }).then(r => r.json()),
    ]);

    const results = [];
    const labelMap = { '^IRX': 'US 3M', '^FVX': 'US 5Y', '^TNX': 'US 10Y', '^TYX': 'US 30Y' };

    if (usResult.status === 'fulfilled') {
      usResult.value
        .filter(q => q && q.regularMarketPrice != null)
        .forEach(q => results.push({
          symbol: q.symbol,
          name: labelMap[q.symbol] || q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          type: 'treasury',
        }));
    } else {
      console.error('[API] US Treasury fetch failed:', usResult.reason?.message);
    }

    let selicRate = 14.75;
    if (selicResult.status === 'fulfilled' && Array.isArray(selicResult.value) && selicResult.value[0]?.valor) {
      selicRate = parseFloat(selicResult.value[0].valor);
    }

    results.push({ symbol: 'SELIC', name: 'SELIC', price: selicRate, change: null, changePct: null, note: 'BCB TARGET RATE', type: 'policy' });

    let fedFundsRate = 4.33;
    let ecbRate = 3.50;
    try {
      const fredController = new AbortController();
      const fredTimeout = setTimeout(() => fredController.abort(), 5000);
      try {
        // FRED API Key: DEMO_KEY (limited rate; use API_KEY env var in production)
        const [dffRes, ecbRes] = await Promise.all([
          fetch(
            'https://api.stlouisfed.org/fred/series/observations?series_id=DFF&sort_order=desc&limit=1&file_type=json&api_key=DEMO_KEY',
            { signal: fredController.signal, headers: { 'Accept': 'application/json' } }
          ),
          fetch(
            'https://api.stlouisfed.org/fred/series/observations?series_id=ECBDFR&sort_order=desc&limit=1&file_type=json&api_key=DEMO_KEY',
            { signal: fredController.signal, headers: { 'Accept': 'application/json' } }
          ),
        ]);

        if (dffRes.ok) {
          const fredData = await dffRes.json();
          const lastObs = fredData?.observations?.[0];
          if (lastObs?.value && lastObs.value !== '.') fedFundsRate = parseFloat(lastObs.value);
        }

        if (ecbRes.ok) {
          const ecbData = await ecbRes.json();
          const lastObs = ecbData?.observations?.[0];
          if (lastObs?.value && lastObs.value !== '.') ecbRate = parseFloat(lastObs.value);
        }
      } finally {
        clearTimeout(fredTimeout);
      }
    } catch (e) {
      console.warn('[API] FRED rates fetch failed, using fallback:', e.message);
    }
    results.push({ symbol: 'FEDFUNDS', name: 'FED FUNDS', price: fedFundsRate, change: null, changePct: null, note: 'TARGET RATE', type: 'policy' });
    results.push({ symbol: 'ECBRATE', name: 'ECB RATE', price: ecbRate, change: null, changePct: null, note: 'MAIN REFINANCING RATE', type: 'policy' });

    const payload = { results };
    cacheSet(cacheKey, payload, 60_000); // Cache for 60 seconds
    res.json(payload);
    validateRates(payload);
  } catch (err) {
    console.error('[API] /snapshot/rates error:', err.message);
    sendError(res, err);
  }
});

// ── /di-curve — Brazilian DI pre-fixed yield curve ──────────────────
router.get('/di-curve', async (req, res) => {
  try {
    const [tdRes, selicRes] = await Promise.allSettled([
      fetch(
        'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json',
        {
          headers: {
            'User-Agent': YF_UA,
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': 'https://www.tesourodireto.com.br/',
          }
        }
      ).then(r => { if (!r.ok) throw new Error(`TD HTTP ${r.status}`); return r.json(); }),
      // BCB series 4189 = Selic meta (annual target rate)
      fetch(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4189/dados/ultimos/1?formato=json',
        { headers: { 'Accept': 'application/json' } }
      ).then(r => r.json()),
    ]);

    const today = new Date();
    const curve = [];

    let diRate = 14.75;
    if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
      diRate = parseFloat(selicRes.value[0].valor);
    }
    curve.push({ tenor: 'DI', months: 0.5, rate: parseFloat(diRate.toFixed(2)) });

    if (tdRes.status === 'fulfilled') {
      const bonds = tdRes.value?.response?.TrsrBdTradgList || [];
      const prefixados = bonds
        .filter(b => {
          const nm = (b.TrsrBd?.nm || '').toLowerCase();
          return nm.includes('prefixado') && !nm.includes('juros') && b.TrsrBd?.anulInvstmtRate;
        })
        .map(b => {
          const matDate = new Date(b.TrsrBd.mtrtyDt);
          const daysToMat = Math.round((matDate - today) / 86400000);
          const months = Math.round(daysToMat / 30.44);
          const rawRate = parseFloat(b.TrsrBd.anulInvstmtRate);
          const rate = rawRate < 1 ? parseFloat((rawRate * 100).toFixed(2)) : parseFloat(rawRate.toFixed(2));
          let tenor;
          if (months < 4)       tenor = '3M';
          else if (months < 8)  tenor = '6M';
          else if (months < 18) tenor = '1Y';
          else if (months < 30) tenor = '2Y';
          else if (months < 42) tenor = '3Y';
          else if (months < 54) tenor = '4Y';
          else if (months < 66) tenor = '5Y';
          else if (months < 90) tenor = '7Y';
          else                   tenor = Math.round(months / 12) + 'Y';
          return {
            tenor,
            months,
            rate,
            maturity: (b.TrsrBd.mtrtyDt || '').split('T')[0],
          };
        })
        .filter(b => b.months > 0 && b.rate > 0)
        .sort((a, b) => a.months - b.months);

      curve.push(...prefixados);
    } else {
      console.warn('[DI-Curve] Tesouro Direto failed:', tdRes.reason?.message);
    }

    if (curve.length < 3) {
      const base = diRate;
      const synth = [
        { tenor: '3M',  months: 3,  rate: parseFloat((base + 0.15).toFixed(2)) },
        { tenor: '6M',  months: 6,  rate: parseFloat((base + 0.10).toFixed(2)) },
        { tenor: '1Y',  months: 12, rate: parseFloat((base - 0.50).toFixed(2)) },
        { tenor: '2Y',  months: 24, rate: parseFloat((base - 1.50).toFixed(2)) },
        { tenor: '3Y',  months: 36, rate: parseFloat((base - 2.50).toFixed(2)) },
        { tenor: '5Y',  months: 60, rate: parseFloat((base - 3.50).toFixed(2)) },
      ];
      curve.push(...synth.filter(s => s.rate > 0));
    }

    res.json({
      curve,
      source: tdRes.status === 'fulfilled' ? 'Tesouro Direto' : 'BCB+synthetic',
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] /di-curve error:', err.message);
    sendError(res, err);
  }
});


// ── Yield curve helpers ─────────────────────────────────────────────

const US_CURVE_FIELDS = [
  { tenor: '1M',  field: 'BC_1MONTH',  months: 1   },
  { tenor: '3M',  field: 'BC_3MONTH',  months: 3   },
  { tenor: '6M',  field: 'BC_6MONTH',  months: 6   },
  { tenor: '1Y',  field: 'BC_1YEAR',   months: 12  },
  { tenor: '2Y',  field: 'BC_2YEAR',   months: 24  },
  { tenor: '3Y',  field: 'BC_3YEAR',   months: 36  },
  { tenor: '5Y',  field: 'BC_5YEAR',   months: 60  },
  { tenor: '7Y',  field: 'BC_7YEAR',   months: 84  },
  { tenor: '10Y', field: 'BC_10YEAR',  months: 120 },
  { tenor: '20Y', field: 'BC_20YEAR',  months: 240 },
  { tenor: '30Y', field: 'BC_30YEAR',  months: 360 },
];

const UK_BOE_META = {
  IUMVZC:  { tenor: '1Y',  months: 12  },
  IUM2ZC:  { tenor: '2Y',  months: 24  },
  IUM5ZC:  { tenor: '5Y',  months: 60  },
  IUM10ZC: { tenor: '10Y', months: 120 },
  IUM20ZC: { tenor: '20Y', months: 240 },
};

function parseUsTreasury(xml) {
  const entries = xml.split('<entry>');
  const lastEntry = entries[entries.length - 1];
  const curve = [];
  for (const { tenor, field, months } of US_CURVE_FIELDS) {
    // Use exact field name match: require field name to be followed by a space
    // (for attributes like m:type=) or '>' (end of opening tag), NOT another letter.
    // This prevents BC_10YEAR from matching BC_10YEARDISPLAY etc.
    const m = new RegExp(`<d:${field}(?:\\s[^>]*)?>([\\d.]+)<`).exec(lastEntry);
    if (m) curve.push({ tenor, months, rate: parseFloat(m[1]) });
  }

  // ── Sanity check: US Treasury yields should be in a reasonable range ──
  // If parsed rates look unreasonable, reject them so FRED fallback takes over.
  // Historical context: US 10Y has been 0.5%-5.0% in 2020-2026, peak ~5% in Oct 2023.
  // Thresholds are generous but catch clear misparses (e.g., ~2x actual rates).
  if (curve.length > 0) {
    const avgRate = curve.reduce((s, p) => s + p.rate, 0) / curve.length;
    if (avgRate > 8 || avgRate < 0) {
      console.warn(`[Yield] US Treasury parsed avg rate ${avgRate.toFixed(2)}% is out of range — rejecting (likely wrong XML field matched)`);
      return [];
    }
    // Additional check: 10Y should be below 7% (well above any recent peak)
    const tenY = curve.find(p => p.tenor === '10Y');
    if (tenY && tenY.rate > 7) {
      console.warn(`[Yield] US 10Y parsed as ${tenY.rate}% — unreasonable, rejecting Treasury XML parse`);
      return [];
    }
  }

  return curve;
}

function parseBoeCsv(csv) {
  const lines = csv.trim().split('\n');
  const headerIdx = lines.findIndex(l => l.includes('IUMVZC'));
  if (headerIdx < 0) return [];
  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));
  let lastLine = null;
  for (let i = lines.length - 1; i > headerIdx; i--) {
    const parts = lines[i].split(',');
    if (parts.slice(1).some(v => v.trim() && v.trim() !== '.' && !isNaN(v.trim()))) {
      lastLine = parts;
      break;
    }
  }
  if (!lastLine) return [];
  const result = [];
  headers.forEach((h, i) => {
    if (UK_BOE_META[h] && lastLine[i]) {
      const val = lastLine[i].trim().replace(/"/g, '');
      if (val && val !== '.' && !isNaN(val)) {
        result.push({ ...UK_BOE_META[h], rate: parseFloat(parseFloat(val).toFixed(2)) });
      }
    }
  });
  return result.sort((a, b) => a.months - b.months);
}

function ukSynthetic(boeRate = 4.50) {
  return [
    { tenor: '3M',  months: 3,   rate: parseFloat((boeRate - 0.15).toFixed(2)) },
    { tenor: '6M',  months: 6,   rate: parseFloat((boeRate - 0.05).toFixed(2)) },
    { tenor: '1Y',  months: 12,  rate: parseFloat((boeRate + 0.05).toFixed(2)) },
    { tenor: '2Y',  months: 24,  rate: parseFloat((boeRate + 0.20).toFixed(2)) },
    { tenor: '5Y',  months: 60,  rate: parseFloat((boeRate + 0.55).toFixed(2)) },
    { tenor: '10Y', months: 120, rate: parseFloat((boeRate + 0.85).toFixed(2)) },
    { tenor: '20Y', months: 240, rate: parseFloat((boeRate + 1.10).toFixed(2)) },
    { tenor: '30Y', months: 360, rate: parseFloat((boeRate + 1.00).toFixed(2)) },
  ].filter(p => p.rate > 0);
}

// —— ECB Euro Area yield curve ——

const ECB_MAT_MAP = {
  'SR_3M':  { tenor: '3M',  months: 3   },
  'SR_6M':  { tenor: '6M',  months: 6   },
  'SR_1Y':  { tenor: '1Y',  months: 12  },
  'SR_2Y':  { tenor: '2Y',  months: 24  },
  'SR_3Y':  { tenor: '3Y',  months: 36  },
  'SR_5Y':  { tenor: '5Y',  months: 60  },
  'SR_7Y':  { tenor: '7Y',  months: 84  },
  'SR_10Y': { tenor: '10Y', months: 120 },
  'SR_20Y': { tenor: '20Y', months: 240 },
  'SR_30Y': { tenor: '30Y', months: 360 },
};

function parseEcbYieldCurve(json) {
  try {
    const dataSet = json.dataSets?.[0];
    if (!dataSet?.series) return [];
    const seriesDims = json.structure?.dimensions?.series || [];
    const lastDim   = seriesDims[seriesDims.length - 1];
    if (!lastDim?.values) return [];
    const results = [];
    for (const [key, series] of Object.entries(dataSet.series)) {
      const parts  = key.split(':');
      const matIdx = parseInt(parts[parts.length - 1]);
      const matId  = lastDim.values[matIdx]?.id;
      const meta   = ECB_MAT_MAP[matId];
      if (!meta) continue;
      const obsVals = Object.values(series.observations || {});
      if (!obsVals.length) continue;
      const rate = obsVals[obsVals.length - 1]?.[0];
      if (rate == null || isNaN(rate)) continue;
      results.push({ tenor: meta.tenor, months: meta.months, rate: parseFloat(rate.toFixed(2)) });
    }
    return results.sort((a, b) => a.months - b.months);
  } catch (e) {
    console.warn('[ECB] parse error:', e.message);
    return [];
  }
}

function euSynthetic(ecbRate) {
  const r = ecbRate || 2.50;
  return [
    { tenor: '3M',  months: 3,   rate: parseFloat((r - 0.30).toFixed(2)) },
    { tenor: '6M',  months: 6,   rate: parseFloat((r - 0.10).toFixed(2)) },
    { tenor: '1Y',  months: 12,  rate: parseFloat((r + 0.15).toFixed(2)) },
    { tenor: '2Y',  months: 24,  rate: parseFloat((r + 0.50).toFixed(2)) },
    { tenor: '3Y',  months: 36,  rate: parseFloat((r + 0.70).toFixed(2)) },
    { tenor: '5Y',  months: 60,  rate: parseFloat((r + 1.00).toFixed(2)) },
    { tenor: '7Y',  months: 84,  rate: parseFloat((r + 1.20).toFixed(2)) },
    { tenor: '10Y', months: 120, rate: parseFloat((r + 1.40).toFixed(2)) },
    { tenor: '20Y', months: 240, rate: parseFloat((r + 1.60).toFixed(2)) },
    { tenor: '30Y', months: 360, rate: parseFloat((r + 1.50).toFixed(2)) },
  ].filter(p => p.rate > 0);
}

// —— CH Swiss Confederation yield curve (SNB rendoblim CSV) ——————
//
// Source: SNB data portal, cube `rendoblim`
//   https://data.snb.ch/api/cube/rendoblim/data/csv/en?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
//
// CSV shape (after a metadata block):
//   "Date";"D0";"Value"
//   "2026-04-22";"1J";"0.12"
//   "2026-04-22";"2J";"0.22"
//   ...
//
// D0 is the maturity dimension ("J" = Jahre). The en-language export
// uses semicolons; the de-language uses commas — the parser tolerates
// both. Many dates appear (whole requested window); we take the latest.
const SNB_MAT_MAP = {
  '1J':  { tenor: '1Y',  months: 12  },
  '2J':  { tenor: '2Y',  months: 24  },
  '3J':  { tenor: '3Y',  months: 36  },
  '4J':  { tenor: '4Y',  months: 48  },
  '5J':  { tenor: '5Y',  months: 60  },
  '6J':  { tenor: '6Y',  months: 72  },
  '7J':  { tenor: '7Y',  months: 84  },
  '8J':  { tenor: '8Y',  months: 96  },
  '9J':  { tenor: '9Y',  months: 108 },
  '10J': { tenor: '10Y', months: 120 },
  '15J': { tenor: '15Y', months: 180 },
  '20J': { tenor: '20Y', months: 240 },
  '30J': { tenor: '30Y', months: 360 },
};

function parseSnbCsv(csv) {
  if (!csv || typeof csv !== 'string') return [];
  const lines = csv.split(/\r?\n/);

  // Find the data header row — it starts with "Date" and has D0 / Value.
  // Be tolerant of quoting and of either `;` or `,` as the delimiter.
  const hdrRe = /^"?Date"?\s*[;,]\s*"?D0"?\s*[;,]\s*"?Value"?/i;
  const hdrIdx = lines.findIndex(l => hdrRe.test(l));
  if (hdrIdx < 0) return [];
  const delim = lines[hdrIdx].includes(';') ? ';' : ',';

  const byDate = new Map();
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const parts = raw
      .split(delim)
      .map(s => s.trim().replace(/^"|"$/g, ''));
    if (parts.length < 3) continue;
    const [date, matCode, valueStr] = parts;
    if (!date || !matCode) continue;
    if (!SNB_MAT_MAP[matCode]) continue;
    // SNB uses "." as decimal in the en export but can use "," in de.
    const val = parseFloat(String(valueStr).replace(',', '.'));
    if (!Number.isFinite(val)) continue;
    if (!byDate.has(date)) byDate.set(date, new Map());
    byDate.get(date).set(matCode, val);
  }

  if (!byDate.size) return [];
  // Latest-date wins (ISO dates sort lexicographically).
  const dates = [...byDate.keys()].sort();
  const latest = byDate.get(dates[dates.length - 1]);

  const result = [];
  for (const [matCode, meta] of Object.entries(SNB_MAT_MAP)) {
    if (!latest.has(matCode)) continue;
    result.push({
      tenor: meta.tenor,
      months: meta.months,
      rate: parseFloat(latest.get(matCode).toFixed(2)),
    });
  }
  return result.sort((a, b) => a.months - b.months);
}

function chSynthetic(snbPolicyRate = 0.50) {
  // Historically CH carries the lowest risk-free curve in G10; in some
  // regimes even the belly is below 1%. This synthetic is a last-resort
  // fallback when both the SNB feed and any secondary have failed. It's
  // anchored to the SNB policy target (default 0.50%, a mid-2026 mark)
  // with a gentle positive term premium.
  const r = snbPolicyRate;
  return [
    { tenor: '3M',  months: 3,   rate: parseFloat((r - 0.10).toFixed(2)) },
    { tenor: '6M',  months: 6,   rate: parseFloat((r - 0.05).toFixed(2)) },
    { tenor: '1Y',  months: 12,  rate: parseFloat((r + 0.00).toFixed(2)) },
    { tenor: '2Y',  months: 24,  rate: parseFloat((r + 0.10).toFixed(2)) },
    { tenor: '3Y',  months: 36,  rate: parseFloat((r + 0.18).toFixed(2)) },
    { tenor: '5Y',  months: 60,  rate: parseFloat((r + 0.30).toFixed(2)) },
    { tenor: '7Y',  months: 84,  rate: parseFloat((r + 0.40).toFixed(2)) },
    { tenor: '10Y', months: 120, rate: parseFloat((r + 0.55).toFixed(2)) },
    { tenor: '20Y', months: 240, rate: parseFloat((r + 0.75).toFixed(2)) },
    { tenor: '30Y', months: 360, rate: parseFloat((r + 0.80).toFixed(2)) },
  ].filter(p => p.rate > -5);  // allow slightly negative — CH has been there
}

/**
 * forwardsFromSpot(spotCurve)
 *
 * Derive the 1-year-ahead implied forward curve from a sorted spot
 * zero-coupon yield curve. At each tenor T ≥ 1Y, compute the 1Y forward
 * rate starting at T using the standard no-arbitrage identity on
 * compounded rates:
 *
 *     (1 + y(T))^T = (1 + y(T-1))^(T-1) · (1 + f(T-1, T))
 *  =>  f(T-1, T) = (1 + y(T))^T / (1 + y(T-1))^(T-1) - 1
 *
 * The result is returned with the same tenor labels as the spot curve
 * (each forward is the 1Y forward starting at T-1, labeled at T).
 *
 * Swiss yields can be near zero or even slightly negative, so we work
 * on `(1 + r/100)` throughout and never assume positivity. Returns an
 * empty array if the spot curve is too sparse to compute forwards.
 */
function forwardsFromSpot(spotCurve) {
  if (!Array.isArray(spotCurve) || spotCurve.length < 2) return [];
  const sorted = [...spotCurve].sort((a, b) => a.months - b.months);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const tPrev = prev.months / 12;
    const tCurr = curr.months / 12;
    if (tPrev <= 0 || tCurr <= tPrev) continue;
    const base = Math.pow(1 + curr.rate / 100, tCurr)
               / Math.pow(1 + prev.rate / 100, tPrev);
    const dt = tCurr - tPrev;
    const f = (Math.pow(base, 1 / dt) - 1) * 100;
    if (!Number.isFinite(f)) continue;
    out.push({
      tenor: curr.tenor,
      months: curr.months,
      rate: parseFloat(f.toFixed(2)),
      startMonths: prev.months,
    });
  }
  return out;
}

// ── FRED CSV fallback for US yield curve (Task 3) ───────────────────
// 10 FRED series: DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS3, DGS5, DGS7, DGS10, DGS30
// Free endpoint, no API key required — returns CSV directly.

const FRED_SERIES = [
  { id: 'DGS1MO', tenor: '1M',  months: 1   },
  { id: 'DGS3MO', tenor: '3M',  months: 3   },
  { id: 'DGS6MO', tenor: '6M',  months: 6   },
  { id: 'DGS1',   tenor: '1Y',  months: 12  },
  { id: 'DGS2',   tenor: '2Y',  months: 24  },
  { id: 'DGS3',   tenor: '3Y',  months: 36  },
  { id: 'DGS5',   tenor: '5Y',  months: 60  },
  { id: 'DGS7',   tenor: '7Y',  months: 84  },
  { id: 'DGS10',  tenor: '10Y', months: 120 },
  { id: 'DGS30',  tenor: '30Y', months: 360 },
];

/**
 * Fetch a single FRED series' latest observation via the free CSV endpoint.
 * URL: https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=YYYY-MM-DD
 * Returns the numeric rate or null on failure.
 */
async function fetchFredRate(seriesId) {
  // Request last 7 days to account for weekends/holidays
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const cosd = d.toISOString().split('T')[0];
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${cosd}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/csv,*/*' },
    });
    if (!res.ok) return null;
    const csv = await res.text();
    // CSV format: DATE,VALUE\n2024-01-02,4.20\n...
    const lines = csv.trim().split('\n');
    // Walk from the end to find last non-"." value
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(',');
      const val = parts[1]?.trim();
      if (val && val !== '.' && !isNaN(val)) {
        return parseFloat(val);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * #242 / P1.4 — FRED monthly long-term (10Y) sovereign rate fallback.
 *
 * Series (all CSV, no API key):
 *   IRLTLT01DEM156N  — Germany 10Y long-term rate (monthly, OECD MEI)
 *   IRLTLT01GBM156N  — UK 10Y long-term rate (monthly, OECD MEI)
 *   IRLTLT01JPM156N  — Japan 10Y long-term rate (monthly, OECD MEI)
 *
 * Used as the cold-start fallback inside /bond-detail/:symbol for DE10Y /
 * GB10Y / JP10Y when the aggregate /yield-curves cache has not yet been
 * warmed. Monthly observations are cached for 1h — they only change once
 * a month so a short TTL is wasteful. BR10Y uses Tesouro Direto directly
 * (richer bond data) and does not need FRED.
 */
const FRED_SOVEREIGN_10Y = {
  DE: 'IRLTLT01DEM156N',
  GB: 'IRLTLT01GBM156N',
  JP: 'IRLTLT01JPM156N',
};

async function fetchFredSovereign10Y(country) {
  const seriesId = FRED_SOVEREIGN_10Y[country];
  if (!seriesId) return null;

  const cacheKey = `fred:sov-10y:${country}`;
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;

  // Monthly series — request last 120 days so we always have ≥2 observations
  // even if this month's print is late.
  const d = new Date();
  d.setDate(d.getDate() - 120);
  const cosd = d.toISOString().split('T')[0];
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${cosd}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/csv,*/*' },
    });
    if (!res.ok) return null;
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    for (let i = lines.length - 1; i >= 1; i--) {
      const parts = lines[i].split(',');
      const val = parts[1]?.trim();
      if (val && val !== '.' && !isNaN(val)) {
        const rate = parseFloat(val);
        if (Number.isFinite(rate)) {
          // Monthly data → 1 hour cache; OECD MEI updates ~monthly.
          cacheSet(cacheKey, rate, 3_600_000);
          return rate;
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the full US yield curve from FRED CSV endpoints in parallel.
 * Returns array of { tenor, months, rate } sorted by months.
 */
async function fetchFredYieldCurve() {
  const cached = cacheGet('fred:us-yield-curve');
  if (cached) return cached;

  const results = await Promise.allSettled(
    FRED_SERIES.map(s => fetchFredRate(s.id).then(rate => ({ ...s, rate })))
  );

  const curve = results
    .filter(r => r.status === 'fulfilled' && r.value.rate != null)
    .map(r => ({ tenor: r.value.tenor, months: r.value.months, rate: r.value.rate }))
    .sort((a, b) => a.months - b.months);

  if (curve.length >= 3) {
    cacheSet('fred:us-yield-curve', curve, TTL.fred);
  }

  return curve;
}

// ── /curve/:issuer — Typed single-issuer curve (W6.2) ──────────────
// Registry-backed: consults coverage_matrix via AdapterRegistry.route()
// and returns the first adapter that can serve the issuer. Provenance
// envelope is surfaced to the client so the UI can show the actual
// source + freshness (vs /yield-curves which aggregates heterogeneous
// sources and flattens the provenance).
//
// Current coverage:
//   - EU (or EA): AAA euro-area zero-coupon curve via ecbSdmxAdapter
// Callers asking for an uncovered issuer get 404 with the list of
// known issuers, not a silent pass-through to Yahoo.
router.get('/curve/:issuer', async (req, res) => {
  try {
    const issuer = String(req.params.issuer || '').toUpperCase();
    const { getRegistry } = require('../../adapters/registry');
    const { executeChain } = require('../../adapters/contract');
    const { annotate: annotateCurve } = require('../../services/curveAnalytics');

    const registry = getRegistry();
    // Normalize aliases: EA → EU for the euro area.
    const market = issuer === 'EA' ? 'EU' : issuer;
    const chain = registry.route(market, 'curve', 'curve');
    if (!chain || chain.length === 0) {
      return res.status(404).json({
        error: 'curve_not_in_coverage',
        issuer,
        message: `No adapter declares a curve for issuer '${issuer}'. Known issuers: EU, EA.`,
      });
    }

    const result = await executeChain(chain, 'curve', [market]);
    if (!result.ok) {
      return res.status(502).json({
        error: result.error.code || 'chain_failed',
        issuer,
        message: result.error.message || 'All adapters in chain failed',
        adapterChain: result.provenance?.adapterChain || [],
      });
    }

    // W7.1: annotate with per-point duration/DV01/convexity + slope metrics.
    // Optional ?benchmark=EU appends per-tenor spread in bps — self-spread
    // is a no-op so we only invoke it for distinct benchmark issuers.
    const benchmarkIssuer = typeof req.query.benchmark === 'string'
      ? req.query.benchmark.toUpperCase().trim()
      : null;
    let benchmarkPoints = null;
    if (benchmarkIssuer && benchmarkIssuer !== result.data.issuer) {
      const benchMarket = benchmarkIssuer === 'EA' ? 'EU' : benchmarkIssuer;
      const benchChain = registry.route(benchMarket, 'curve', 'curve');
      if (benchChain && benchChain.length > 0) {
        const benchRes = await executeChain(benchChain, 'curve', [benchMarket]);
        if (benchRes.ok && Array.isArray(benchRes.data.points)) {
          benchmarkPoints = benchRes.data.points;
        }
      }
    }
    const { analytics } = annotateCurve(result.data, benchmarkPoints
      ? { benchmarkPoints }
      : undefined);

    return res.json({
      issuer: result.data.issuer,
      currency: result.data.currency,
      asOf: result.data.asOf,
      points: result.data.points,
      analytics,
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
    console.error('[curve] unhandled error:', e.message);
    return res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ── /yield-curves — Multi-country yield curves (BR, US, UK, EU) ─────
router.get('/yield-curves', async (req, res) => {
  try {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();

    // SNB rendoblim window: ask for the last ~14 days so we always catch
    // the latest observation even if today hasn't published yet (CH is
    // on a one-business-day lag for the official CSV export).
    const snbTo   = now.toISOString().slice(0, 10);
    const snbFrom = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);

    const [tdRes, selicRes, usTreasuryRes, ukBoeRes, ecbYcRes, chSnbRes] = await Promise.allSettled([
      fetchWithTimeout('https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.tesourodireto.com.br/' },
      }).then(r => { if (!r.ok) throw new Error(`TD ${r.status}`); return r.json(); }),

      // BCB series 4189 = Selic meta (annual target rate, e.g. 14.25)
      // Fallback: series 432 is monthly accumulated — NOT annual; must be avoided
      fetchWithTimeout('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4189/dados/ultimos/1?formato=json', {
        headers: { 'Accept': 'application/json' },
      }).then(r => r.json()),

      fetchWithTimeout(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdate_value=${yyyymm}`, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/xml,text/xml,*/*' },
      }).then(r => { if (!r.ok) throw new Error(`Treasury ${r.status}`); return r.text(); }),

      fetchWithTimeout(`https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?csv.x=yes&CSVF=TN&UsingCodes=Y&VFD=N&DP=2&Datefrom=01/${mm}/${yyyy}&Dateto=${dd}/${mm}/${yyyy}&SeriesCodes=IUMVZC,IUM2ZC,IUM5ZC,IUM10ZC,IUM20ZC`, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'text/csv,text/plain,*/*', 'Referer': 'https://www.bankofengland.co.uk/' },
      }).then(r => { if (!r.ok) throw new Error(`BoE ${r.status}`); return r.text(); }),

      fetchWithTimeout('https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M+SR_6M+SR_1Y+SR_2Y+SR_3Y+SR_5Y+SR_7Y+SR_10Y+SR_20Y+SR_30Y?lastNObservations=1&format=jsondata', {
        headers: { 'Accept': 'application/json', 'User-Agent': YF_UA },
      }).then(r => { if (!r.ok) throw new Error(`ECB ${r.status}`); return r.json(); }),

      // #225 — Swiss Confederation zero-coupon spot yields from SNB.
      fetchWithTimeout(`https://data.snb.ch/api/cube/rendoblim/data/csv/en?fromDate=${snbFrom}&toDate=${snbTo}`, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'text/csv,text/plain,*/*', 'Referer': 'https://data.snb.ch/' },
      }).then(r => { if (!r.ok) throw new Error(`SNB ${r.status}`); return r.text(); }),
    ]);

    // —— BR curve ——
    // Default = current Selic target; used ONLY when BCB API is unreachable.
    // No hardcoded bounds — we trust the authoritative source (BCB series 4189).
    let diRate = 14.75;
    if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
      const parsed = parseFloat(selicRes.value[0].valor);
      if (!isNaN(parsed) && parsed > 0) {
        diRate = parsed;
      } else {
        console.warn(`[Yield] BCB Selic returned non-numeric/negative value: ${selicRes.value[0].valor}; using default ${diRate}`);
      }
    }
    const brCurve = [{ tenor: 'DI', months: 0.5, rate: parseFloat(diRate.toFixed(2)) }];
    if (tdRes.status === 'fulfilled') {
      const bonds = tdRes.value?.response?.TrsrBdTradgList || [];
      const prefixados = bonds
        .filter(b => { const nm = (b.TrsrBd?.nm || '').toLowerCase(); return nm.includes('prefixado') && !nm.includes('juros') && b.TrsrBd?.anulInvstmtRate; })
        .map(b => {
          const matDate = new Date(b.TrsrBd.mtrtyDt);
          const daysToMat = Math.round((matDate - now) / 86400000);
          const months = Math.round(daysToMat / 30.44);
          const rawRate = parseFloat(b.TrsrBd.anulInvstmtRate);
          const rate = rawRate < 1 ? parseFloat((rawRate * 100).toFixed(2)) : parseFloat(rawRate.toFixed(2));
          let tenor;
          if (months < 4) tenor = '3M'; else if (months < 8) tenor = '6M';
          else if (months < 18) tenor = '1Y'; else if (months < 30) tenor = '2Y';
          else if (months < 42) tenor = '3Y'; else if (months < 54) tenor = '4Y';
          else if (months < 66) tenor = '5Y'; else if (months < 90) tenor = '7Y';
          else tenor = Math.round(months / 12) + 'Y';
          return { tenor, months, rate, maturity: (b.TrsrBd.mtrtyDt || '').split('T')[0] };
        })
        .filter(b => b.months > 0 && b.rate > 0)
        .sort((a, b_) => a.months - b_.months);
      brCurve.push(...prefixados);
    }
    if (brCurve.length < 3) {
      const base = diRate;
      brCurve.push(
        { tenor: '3M', months: 3, rate: parseFloat((base + 0.15).toFixed(2)) },
        { tenor: '6M', months: 6, rate: parseFloat((base + 0.10).toFixed(2)) },
        { tenor: '1Y', months: 12, rate: parseFloat((base - 0.50).toFixed(2)) },
        { tenor: '2Y', months: 24, rate: parseFloat((base - 1.50).toFixed(2)) },
        { tenor: '3Y', months: 36, rate: parseFloat((base - 2.50).toFixed(2)) },
        { tenor: '5Y', months: 60, rate: parseFloat((base - 3.50).toFixed(2)) },
      );
    }

    // —— US curve (Treasury XML → FRED CSV fallback) ——
    let usCurve = [];
    let usSource = 'unavailable';
    if (usTreasuryRes.status === 'fulfilled') {
      usCurve = parseUsTreasury(usTreasuryRes.value);
      usSource = usCurve.length > 0 ? 'US Treasury' : 'unavailable';
      if (usCurve.length > 0) {
        const tenY = usCurve.find(p => p.tenor === '10Y');
      }
    } else {
      console.warn('[Yield] US Treasury XML fetch failed:', usTreasuryRes.reason?.message);
    }
    // FRED CSV fallback (Task 3): if Treasury XML failed, returned < 3 points, or sanity check rejected
    if (usCurve.length < 3) {
      console.warn('[Yield] US Treasury parse returned <3 valid points, trying FRED CSV fallback…');
      const fredCurve = await fetchFredYieldCurve();
      if (fredCurve.length >= 3) {
        usCurve = fredCurve;
        usSource = 'FRED';
      } else {
        console.warn('[Yield] FRED fallback also insufficient:', fredCurve.length, 'points');
      }
    }

    // —— UK curve ——
    let ukCurve = [];
    let ukSource = 'synthetic';
    if (ukBoeRes.status === 'fulfilled') {
      ukCurve = parseBoeCsv(ukBoeRes.value);
      ukSource = ukCurve.length > 0 ? 'Bank of England' : 'synthetic';
    }
    if (ukCurve.length < 3) {
      console.warn('[Yield] BoE parse failed, using synthetic:', ukBoeRes.reason?.message || 'no data');
      ukCurve = ukSynthetic(4.50);
      ukSource = 'BoE+synthetic';
    }

    // —— EU curve ——
    let euCurve = [];
    let euSource = 'synthetic';
    if (ecbYcRes.status === 'fulfilled') {
      euCurve = parseEcbYieldCurve(ecbYcRes.value);
      euSource = euCurve.length > 0 ? 'ECB' : 'synthetic';
    }
    if (euCurve.length < 3) {
      console.warn('[Yield] ECB parse failed, using synthetic:', ecbYcRes.reason?.message || 'no data');
      euCurve = euSynthetic(2.50);
      euSource = 'ECB+synthetic';
    }

    // —— CH curve (SNB rendoblim CSV → synthetic) ——————————————
    let chCurve = [];
    let chSource = 'synthetic';
    if (chSnbRes.status === 'fulfilled') {
      chCurve = parseSnbCsv(chSnbRes.value);
      chSource = chCurve.length > 0 ? 'SNB' : 'synthetic';
    } else {
      console.warn('[Yield] SNB rendoblim fetch failed:', chSnbRes.reason?.message);
    }
    if (chCurve.length < 3) {
      console.warn('[Yield] SNB parse returned <3 points, using synthetic fallback:', chCurve.length);
      chCurve = chSynthetic(0.50);
      chSource = chSnbRes.status === 'fulfilled' ? 'SNB+synthetic' : 'synthetic';
    }

    // #225 — derive Swiss implied 1Y forward curve from the spot curve.
    // This is what the CIO meant by "Swiss forward yield curve": given
    // the spot zeros, back out the 1-year forward rate implied at each
    // tenor. Useful for reading the market's path of short rates.
    const chForwards = forwardsFromSpot(chCurve);

    // Log BR curve for debugging data integrity
    const brSource = tdRes.status === 'fulfilled' ? 'Tesouro Direto' : 'BCB+synthetic';
    console.log(`[Yield] BR curve: ${brCurve.length} points, source=${brSource}, DI=${diRate}, range=${brCurve.length > 0 ? brCurve[0].rate + '-' + brCurve[brCurve.length - 1].rate : 'empty'}`);
    console.log(`[Yield] CH curve: ${chCurve.length} points, source=${chSource}, forwards=${chForwards.length}`);

    const payload = {
      BR: { curve: brCurve, source: brSource, updatedAt: now.toISOString() },
      US: { curve: usCurve, source: usSource, updatedAt: now.toISOString() },
      UK: { curve: ukCurve, source: ukSource, updatedAt: now.toISOString() },
      EU: { curve: euCurve, source: euSource, updatedAt: now.toISOString() },
      CH: {
        curve: chCurve,
        forwards: chForwards,
        source: chSource,
        updatedAt: now.toISOString(),
      },
    };

    // Attach integrity status from previous validation (if available)
    const integrity = getIntegrityStatus('yield-curves');
    if (integrity) {
      payload._integrity = {
        valid: integrity.valid,
        source: integrity.source,
        issues: (integrity.issues || []).filter(i => i.severity === 'critical').length,
        summary: integrity.summary,
        checkedAt: integrity.checkedAt,
      };
    }

    // Cache yield curve data for bond-detail fallback
    cacheSet('yield-curves-data', payload, TTL.yields);

    // Serve response immediately — NEVER block for validation
    res.json(payload);

    // Fire-and-forget: validate data integrity async
    validateYieldCurves(payload);
  } catch (err) {
    console.error('[API] /yield-curves error:', err.message);
    sendError(res, err);
  }
});

// ── Data integrity status endpoint ────────────────────────────────────
// GET /data-integrity — returns latest validation verdicts for ALL domains
router.get('/data-integrity', (req, res) => {
  res.json({
    ...getAllIntegrityStatus(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
