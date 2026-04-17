/**
 * providers/macroProvider.js
 * Macro-economic data provider — Eulerpool PRIMARY, FRED/BCB/WorldBank fallbacks.
 *
 * Fallback chain:
 *   1. Eulerpool API (getMacroSnapshot)
 *   2. FRED CSV (US — no API key needed)
 *   3. BCB API (Brazil — free, no key)
 *   4. Static stubs (last resort, marked stub:true)
 */

'use strict';

const fetch = require('node-fetch');
const euler = require('./eulerpool');

// ── Static fallback stubs ────────────────────────────────────────────────────
const STUBS = {
  US: { country: 'US', currency: 'USD', name: 'United States', policyRate: 0.055, cpiYoY: 0.027, gdpGrowthYoY: 0.028, unemploymentRate: 0.042, currentAcctGDP: -0.031, debtGDP: 1.24, asOf: '2026-03-01', source: 'FRED (stub)', stub: true },
  BR: { country: 'BR', currency: 'BRL', name: 'Brazil', policyRate: 0.1350, cpiYoY: 0.048, gdpGrowthYoY: 0.031, unemploymentRate: 0.065, currentAcctGDP: -0.024, debtGDP: 0.88, asOf: '2026-03-01', source: 'BCB / IBGE (stub)', stub: true },
  EU: { country: 'EU', currency: 'EUR', name: 'Euro Area', policyRate: 0.029, cpiYoY: 0.024, gdpGrowthYoY: 0.009, unemploymentRate: 0.059, currentAcctGDP: 0.028, debtGDP: 0.92, asOf: '2026-03-01', source: 'ECB / Eurostat (stub)', stub: true },
  GB: { country: 'GB', currency: 'GBP', name: 'United Kingdom', policyRate: 0.0475, cpiYoY: 0.025, gdpGrowthYoY: 0.007, unemploymentRate: 0.045, currentAcctGDP: -0.032, debtGDP: 1.00, asOf: '2026-03-01', source: 'Bank of England / ONS (stub)', stub: true },
  JP: { country: 'JP', currency: 'JPY', name: 'Japan', policyRate: 0.0050, cpiYoY: 0.022, gdpGrowthYoY: 0.002, unemploymentRate: 0.025, currentAcctGDP: 0.037, debtGDP: 2.63, asOf: '2026-03-01', source: 'BOJ / Cabinet Office (stub)', stub: true },
  DE: { country: 'DE', currency: 'EUR', name: 'Germany', policyRate: 0.029, cpiYoY: 0.022, gdpGrowthYoY: -0.002, unemploymentRate: 0.058, currentAcctGDP: 0.063, debtGDP: 0.64, asOf: '2026-03-01', source: 'Destatis / ECB (stub)', stub: true },
  CN: { country: 'CN', currency: 'CNY', name: 'China', policyRate: 0.0300, cpiYoY: 0.003, gdpGrowthYoY: 0.049, unemploymentRate: 0.051, currentAcctGDP: 0.021, debtGDP: 0.55, asOf: '2026-03-01', source: 'NBS / PBoC (stub)', stub: true },
  MX: { country: 'MX', currency: 'MXN', name: 'Mexico', policyRate: 0.0900, cpiYoY: 0.038, gdpGrowthYoY: 0.015, unemploymentRate: 0.028, currentAcctGDP: -0.010, debtGDP: 0.48, asOf: '2026-03-01', source: 'Banxico / INEGI (stub)', stub: true },
  AU: { country: 'AU', currency: 'AUD', name: 'Australia', policyRate: 0.0435, cpiYoY: 0.026, gdpGrowthYoY: 0.013, unemploymentRate: 0.038, currentAcctGDP: 0.008, debtGDP: 0.35, asOf: '2026-03-01', source: 'RBA / ABS (stub)', stub: true },
  CA: { country: 'CA', currency: 'CAD', name: 'Canada', policyRate: 0.0300, cpiYoY: 0.028, gdpGrowthYoY: 0.011, unemploymentRate: 0.068, currentAcctGDP: -0.006, debtGDP: 0.42, asOf: '2026-03-01', source: 'Bank of Canada / StatCan (stub)', stub: true },
  IN: { country: 'IN', currency: 'INR', name: 'India', policyRate: 0.065, cpiYoY: 0.051, gdpGrowthYoY: 0.067, unemploymentRate: 0.073, currentAcctGDP: -0.018, debtGDP: 0.83, asOf: '2026-03-01', source: 'RBI / MOSPI (stub)', stub: true },
  KR: { country: 'KR', currency: 'KRW', name: 'South Korea', policyRate: 0.035, cpiYoY: 0.023, gdpGrowthYoY: 0.021, unemploymentRate: 0.027, currentAcctGDP: 0.042, debtGDP: 0.54, asOf: '2026-03-01', source: 'BOK / KOSTAT (stub)', stub: true },
};

const COUNTRY_NAMES = {
  US: 'United States', BR: 'Brazil', EU: 'Euro Area', GB: 'United Kingdom',
  JP: 'Japan', DE: 'Germany', CN: 'China', MX: 'Mexico', AU: 'Australia',
  CA: 'Canada', IN: 'India', KR: 'South Korea',
};

// ── FRED CSV helper (no API key) ─────────────────────────────────────────────
const _fredMacroCache = new Map();
const FRED_MACRO_TTL = 3600_000; // 1 hour

async function fredSeries(seriesId) {
  const ck = `fredMacro:${seriesId}`;
  const cached = _fredMacroCache.get(ck);
  if (cached && Date.now() < cached.exp) return cached.v;

  try {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${d.toISOString().slice(0, 10)}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => !l.startsWith('DATE'));
    if (lines.length === 0) return null;

    const last = lines[lines.length - 1].split(',');
    const value = parseFloat(last[1]);
    if (isNaN(value) || last[1] === '.') return null;
    const result = { value, date: last[0] };
    _fredMacroCache.set(ck, { v: result, exp: Date.now() + FRED_MACRO_TTL });
    return result;
  } catch (e) {
    console.warn(`[macroProvider] FRED ${seriesId} failed:`, e.message);
    return null;
  }
}

async function fredMacroUS() {
  const [fedFunds, cpiYoY, gdp, unemp, debtGdp, currentAcct] = await Promise.allSettled([
    fredSeries('FEDFUNDS'),
    fredSeries('CPIAUCSL'),              // CPI index
    fredSeries('A191RL1Q225SBEA'),       // Real GDP growth annualized
    fredSeries('UNRATE'),                // Unemployment rate
    fredSeries('GFDEGDQ188S'),           // Federal debt as % of GDP
    fredSeries('NETFI'),                 // Net lending/borrowing (current account proxy)
  ]);

  const result = { country: 'US', currency: 'USD', name: 'United States', source: 'FRED' };
  if (fedFunds.status === 'fulfilled' && fedFunds.value)
    result.policyRate = fedFunds.value.value / 100;
  if (unemp.status === 'fulfilled' && unemp.value)
    result.unemploymentRate = unemp.value.value / 100;
  if (gdp.status === 'fulfilled' && gdp.value)
    result.gdpGrowthYoY = gdp.value.value / 100;
  if (debtGdp.status === 'fulfilled' && debtGdp.value)
    result.debtGDP = debtGdp.value.value / 100;

  // CPI YoY — fetch last 13 months to compute year-over-year change
  if (cpiYoY.status === 'fulfilled' && cpiYoY.value) {
    try {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 2);
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL&cosd=${d.toISOString().slice(0, 10)}`;
      const res = await fetch(url, { timeout: 8000 });
      if (res.ok) {
        const text = await res.text();
        const lines = text.trim().split('\n').filter(l => !l.startsWith('DATE'));
        if (lines.length >= 13) {
          const latest = parseFloat(lines[lines.length - 1].split(',')[1]);
          const yearAgo = parseFloat(lines[lines.length - 13].split(',')[1]);
          if (latest > 0 && yearAgo > 0) {
            result.cpiYoY = +((latest - yearAgo) / yearAgo).toFixed(4);
          }
        }
      }
    } catch (e) { /* silent */ }
  }

  result.asOf = fedFunds.value?.date || new Date().toISOString().slice(0, 10);
  return Object.keys(result).length > 4 ? result : null;
}

// ── BCB API (Brazil) ─────────────────────────────────────────────────────────
async function bcbMacroBR() {
  try {
    const [selic, ipca] = await Promise.allSettled([
      // BCB series 4189 = Selic meta (annual target rate, e.g. 14.25)
      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.4189/dados/ultimos/1?formato=json', { timeout: 8000 }).then(r => r.json()),
      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/12?formato=json', { timeout: 8000 }).then(r => r.json()),
    ]);

    const result = { country: 'BR', currency: 'BRL', name: 'Brazil', source: 'BCB' };

    if (selic.status === 'fulfilled' && Array.isArray(selic.value) && selic.value.length > 0) {
      result.policyRate = parseFloat(selic.value[0].valor) / 100;
      result.asOf = selic.value[0].data;
    }

    if (ipca.status === 'fulfilled' && Array.isArray(ipca.value) && ipca.value.length >= 12) {
      // Sum last 12 months for accumulated YoY
      const monthly = ipca.value.map(v => parseFloat(v.valor) / 100);
      const yoy = monthly.reduce((acc, m) => acc * (1 + m), 1) - 1;
      result.cpiYoY = +yoy.toFixed(4);
    }

    return Object.keys(result).length > 4 ? result : null;
  } catch (e) {
    console.warn('[macroProvider] BCB macro failed:', e.message);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get macro snapshot for a country.
 * Fallback: Eulerpool → FRED/BCB → stub
 */
async function getSnapshot(code) {
  // 1. Try Eulerpool
  if (euler.isConfigured()) {
    try {
      const data = await euler.getMacroSnapshot(code);
      if (data && typeof data === 'object' && !data.error) {
        return {
          country: code,
          name: COUNTRY_NAMES[code] || code,
          ...data,
          source: 'eulerpool',
        };
      }
    } catch (e) {
      console.warn(`[macroProvider] Eulerpool snapshot failed for ${code}:`, e.message);
    }
  }

  // 2. Country-specific real fallbacks
  if (code === 'US') {
    const fred = await fredMacroUS();
    if (fred) return { ...STUBS.US, ...fred, stub: false };
  }
  if (code === 'BR') {
    const bcb = await bcbMacroBR();
    if (bcb) return { ...STUBS.BR, ...bcb, stub: false };
  }

  // 3. Static stub
  return STUBS[code] || null;
}

function getAvailableCodes() {
  return Object.keys(STUBS);
}

function getCountryList() {
  return Object.entries(STUBS).map(([code, d]) => ({ code, name: d.name, currency: d.currency }));
}

/**
 * Get macro calendar events.
 * Eulerpool → null (fallback not yet implemented for other sources)
 */
async function getMacroCalendar(opts = {}) {
  if (euler.isConfigured()) {
    try {
      return await euler.getMacroCalendar();
    } catch (e) {
      console.warn('[macroProvider] Eulerpool calendar failed:', e.message);
    }
  }
  return [];
}

module.exports = { getSnapshot, getAvailableCodes, getCountryList, getMacroCalendar, STUBS };
