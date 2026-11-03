/**
 * providers/yahooFuturesCurve.js — term structure from individually listed
 * contracts on Yahoo Finance (e.g. CLZ26.NYM, CLF27.NYM, …).
 *
 * WHY
 * ---
 * /api/derivatives/futures/:symbol depended on Eulerpool's /futures/curve,
 * which returns nothing on the current key, so every curve chart in the
 * terminal was an empty box. Yahoo lists each exchange contract as its own
 * symbol and serves it through the same crumb-authenticated quote endpoint
 * the snapshot already uses — no extra key, no new vendor.
 *
 * HOW
 * ---
 * For a root (CL, BZ, GC, …) we build the candidate codes for the next
 * `horizonMonths` months using the exchange's listed-month cycle, batch
 * them through yahooQuote(), keep whatever Yahoo actually prices, and sort
 * by expiry. Contracts Yahoo does not know simply drop out — nothing is
 * interpolated. `quoteType === 'FUTURE'` and a positive price are required.
 *
 * Coverage note: Yahoo's list is thin beyond ~12-18 months for most roots;
 * the deferred strip is still real, just shorter than a CME terminal.
 */

'use strict';

const { yahooQuote } = require('../routes/market/lib/providers');
const { cacheGet, cacheSet } = require('../routes/market/lib/cache');

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']; // Jan..Dec

// root → { ex: Yahoo exchange suffix, months: listed cycle (codes), name }
const ROOTS = {
  CL: { ex: 'NYM', months: 'FGHJKMNQUVXZ', name: 'WTI Crude' },
  BZ: { ex: 'NYM', months: 'FGHJKMNQUVXZ', name: 'Brent Crude' },
  NG: { ex: 'NYM', months: 'FGHJKMNQUVXZ', name: 'Henry Hub Nat Gas' },
  HO: { ex: 'NYM', months: 'FGHJKMNQUVXZ', name: 'Heating Oil' },
  RB: { ex: 'NYM', months: 'FGHJKMNQUVXZ', name: 'RBOB Gasoline' },
  GC: { ex: 'CMX', months: 'GJMQVZ',       name: 'Gold' },
  SI: { ex: 'CMX', months: 'HKNUZ',        name: 'Silver' },
  HG: { ex: 'CMX', months: 'HKNUZ',        name: 'Copper' },
  PL: { ex: 'NYM', months: 'FJNV',         name: 'Platinum' },
  ZC: { ex: 'CBT', months: 'HKNUZ',        name: 'Corn' },
  ZS: { ex: 'CBT', months: 'FHKNQUX',      name: 'Soybeans' },
  ZW: { ex: 'CBT', months: 'HKNUZ',        name: 'Wheat (SRW)' },
  KC: { ex: 'NYB', months: 'HKNUZ',        name: 'Coffee C' },
  SB: { ex: 'NYB', months: 'HKNV',         name: 'Sugar No.11' },
  CT: { ex: 'NYB', months: 'HKNVZ',        name: 'Cotton' },
  CC: { ex: 'NYB', months: 'HKNUZ',        name: 'Cocoa' },
  LE: { ex: 'CME', months: 'GJMQVZ',       name: 'Live Cattle' },
  ES: { ex: 'CME', months: 'HMUZ',         name: 'E-mini S&P 500' },
  NQ: { ex: 'CME', months: 'HMUZ',         name: 'E-mini Nasdaq 100' },
  YM: { ex: 'CBT', months: 'HMUZ',         name: 'E-mini Dow' },
  ZN: { ex: 'CBT', months: 'HMUZ',         name: '10Y T-Note' },
  ZB: { ex: 'CBT', months: 'HMUZ',         name: 'T-Bond' },
  '6E': { ex: 'CME', months: 'HMUZ',       name: 'Euro FX' },
  '6B': { ex: 'CME', months: 'HMUZ',       name: 'British Pound' },
  '6J': { ex: 'CME', months: 'HMUZ',       name: 'Japanese Yen' },
  BTC: { ex: 'CME', months: 'FGHJKMNQUVXZ', name: 'Bitcoin (CME)' },
};

// Aliases the UI already uses (Yahoo front-month tickers and friendly names)
const ALIASES = {
  'CL=F': 'CL', 'BZ=F': 'BZ', 'NG=F': 'NG', 'HO=F': 'HO', 'RB=F': 'RB',
  'GC=F': 'GC', 'SI=F': 'SI', 'HG=F': 'HG', 'PL=F': 'PL',
  'ZC=F': 'ZC', 'ZS=F': 'ZS', 'ZW=F': 'ZW', 'KC=F': 'KC', 'SB=F': 'SB', 'CT=F': 'CT', 'CC=F': 'CC', 'LE=F': 'LE',
  'ES=F': 'ES', 'NQ=F': 'NQ', 'YM=F': 'YM', 'ZN=F': 'ZN', 'ZB=F': 'ZB',
  WTI: 'CL', BRENT: 'BZ', NATGAS: 'NG', GOLD: 'GC', SILVER: 'SI', COPPER: 'HG',
  CORN: 'ZC', SOYBEANS: 'ZS', WHEAT: 'ZW', COFFEE: 'KC', SUGAR: 'SB', COTTON: 'CT', COCOA: 'CC',
  SPX: 'ES', NDX: 'NQ', DJI: 'YM', UST10Y: 'ZN', US10Y: 'ZN',
};

function resolveRoot(input) {
  const s = String(input || '').trim().toUpperCase();
  if (ROOTS[s]) return s;
  if (ALIASES[s]) return ALIASES[s];
  return null;
}

function candidateCodes(root, { now = new Date(), horizonMonths = 24 } = {}) {
  const cfg = ROOTS[root];
  const out = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based; include the current month (may still be live)
  for (let i = 0; i < horizonMonths; i++) {
    const code = MONTH_CODES[m];
    if (cfg.months.includes(code)) {
      out.push({ symbol: `${root}${code}${String(y % 100).padStart(2, '0')}.${cfg.ex}`, year: y, month: m + 1, code });
    }
    m++; if (m === 12) { m = 0; y++; }
  }
  return out;
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * @returns {{ root, name, curve: [{contract, label, symbol, price, changePct, volume, oi, expiry, year, month}], source, asOf, error? }}
 */
async function getFuturesCurve(input, opts = {}) {
  const root = resolveRoot(input);
  if (!root) return { root: null, curve: [], source: 'unavailable', error: `no listed-contract map for ${input}` };
  const ck = `yfcurve:${root}`;
  const hit = cacheGet(ck);
  if (hit) return hit;

  const cands = candidateCodes(root, opts);
  // yahooQuote takes a comma-joined string; keep batches ≤ 20 to stay polite.
  const results = [];
  for (let i = 0; i < cands.length; i += 20) {
    const batch = cands.slice(i, i + 20);
    try {
      const rows = await yahooQuote(batch.map(c => c.symbol).join(','));
      for (const r of rows || []) results.push(r);
    } catch (e) {
      // partial strips are still real — note and continue
      results.err = e.message;
    }
  }
  const bySym = new Map(results.map(r => [String(r.symbol || '').toUpperCase(), r]));
  let asOf = null;
  const curve = [];
  for (const c of cands) {
    const r = bySym.get(c.symbol.toUpperCase());
    if (!r) continue;
    const price = Number(r.regularMarketPrice);
    if (!(price > 0)) continue;
    if (r.quoteType && String(r.quoteType).toUpperCase() !== 'FUTURE') continue;
    const t = Number(r.regularMarketTime) * 1000;
    if (t && (!asOf || t > asOf)) asOf = t;
    curve.push({
      contract: `${MONTH_NAMES[c.month - 1]} ${String(c.year).slice(2)}`,
      label: r.shortName || r.longName || c.symbol,
      symbol: c.symbol,
      price,
      changePct: Number.isFinite(Number(r.regularMarketChangePercent)) ? Number(r.regularMarketChangePercent) : null,
      volume: Number.isFinite(Number(r.regularMarketVolume)) ? Number(r.regularMarketVolume) : null,
      oi: Number.isFinite(Number(r.openInterest)) ? Number(r.openInterest) : null,
      expiry: r.expireDate ? new Date(Number(r.expireDate) * 1000).toISOString().slice(0, 10) : null,
      year: c.year, month: c.month,
    });
  }
  const out = {
    root, name: ROOTS[root].name, curve,
    source: curve.length ? 'yahoo listed contracts' : 'unavailable',
    asOf: asOf ? new Date(asOf).toISOString() : null,
    frequency: 'delayed',
    error: curve.length ? undefined : (results.err || 'Yahoo returned no priced contracts'),
  };
  if (curve.length) cacheSet(ck, out, 5 * 60 * 1000);
  return out;
}

module.exports = { getFuturesCurve, resolveRoot, candidateCodes, ROOTS };
