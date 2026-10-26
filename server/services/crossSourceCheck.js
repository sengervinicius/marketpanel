/**
 * crossSourceCheck.js — #292 Wave 3
 *
 * Two independent sources, same instrument, same moment: do they agree?
 *
 * The whole 26-Oct incident was one feed (Yahoo) silently serving
 * Friday's close while the market moved 10%+. No second opinion existed.
 * This module takes the rows one provider produced, re-asks a different
 * provider for a small sample, and reports per-symbol divergence in
 * PRICE (percent gap) and TIME (age gap). The caller attaches the result
 * to the payload and tags the diverging rows; nothing is rewritten —
 * the user is told, not "corrected".
 *
 * Pure function + a Brazil convenience wrapper. No caching here: the
 * providers cache themselves.
 */

const PRICE_GAP_WARN_PCT = 2;      // > 2% between sources ⇒ flag
const AGE_GAP_WARN_MS = 15 * 60e3; // primary > 15 min older than secondary ⇒ flag

/**
 * @param {Array<{symbol, price, asOf}>} primaryRows   rows already in the payload
 * @param {Array<{symbol, price, asOf}>} secondaryRows independent quotes for a subset
 * @param {{priceGapPct?:number, ageGapMs?:number, primary?:string, secondary?:string}} opts
 * @returns {{checked:number, agree:number, diverged:Array, staleVsSecondary:Array, maxGapPct:number|null, verdict:'OK'|'DIVERGED'|'UNCHECKED'}}
 */
function compare(primaryRows, secondaryRows, opts = {}) {
  const pGap = opts.priceGapPct ?? PRICE_GAP_WARN_PCT;
  const aGap = opts.ageGapMs ?? AGE_GAP_WARN_MS;
  const byP = new Map((primaryRows || []).map(r => [String(r.symbol).toUpperCase(), r]));
  const diverged = [], staleVsSecondary = [];
  let checked = 0, agree = 0, maxGap = null;
  for (const s of secondaryRows || []) {
    const sym = String(s.symbol).toUpperCase();
    const p = byP.get(sym);
    if (!p || !(p.price > 0) || !(s.price > 0)) continue;
    checked++;
    const gapPct = Math.abs(p.price - s.price) / s.price * 100;
    maxGap = maxGap == null ? gapPct : Math.max(maxGap, gapPct);
    const pAs = toMs(p.asOf), sAs = toMs(s.asOf);
    const ageGap = pAs != null && sAs != null ? sAs - pAs : null; // >0 ⇒ primary older
    let bad = false;
    if (gapPct > pGap) { bad = true; diverged.push({ symbol: sym, primary: p.price, secondary: s.price, gapPct: +gapPct.toFixed(2), primaryAsOf: pAs, secondaryAsOf: sAs }); }
    if (ageGap != null && ageGap > aGap) { bad = true; staleVsSecondary.push({ symbol: sym, primaryAsOf: pAs, secondaryAsOf: sAs, behindMin: Math.round(ageGap / 60e3) }); }
    if (!bad) agree++;
  }
  return {
    primary: opts.primary || 'primary', secondary: opts.secondary || 'secondary',
    checked, agree, diverged, staleVsSecondary,
    maxGapPct: maxGap != null ? +maxGap.toFixed(2) : null,
    verdict: checked === 0 ? 'UNCHECKED' : (diverged.length || staleVsSecondary.length) ? 'DIVERGED' : 'OK',
  };
}

function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
  const ms = Date.parse(t); return Number.isFinite(ms) ? ms : null;
}

/**
 * Brazil board: sample the core names that came from Yahoo and ask brapi.
 * Returns the comparison plus a Set of symbols to tag. Never throws.
 */
async function checkBrazil(results, { sample = 5, core = [] } = {}) {
  try {
    const yahooRows = results.filter(r => r.source === 'yahoo' || !r.source);
    const pick = core.filter(c => yahooRows.some(r => r.symbol === c)).slice(0, sample);
    if (!pick.length) return { report: compare([], [], { primary: 'yahoo', secondary: 'brapi' }), flagged: new Set() };
    const brapi = require('../providers/brapi');
    const b = await brapi.getQuotes(pick);
    const report = compare(yahooRows, b.quotes, { primary: 'yahoo', secondary: 'brapi' });
    const flagged = new Set([...report.diverged, ...report.staleVsSecondary].map(d => d.symbol));
    return { report, flagged };
  } catch (e) {
    return { report: { primary: 'yahoo', secondary: 'brapi', checked: 0, agree: 0, diverged: [], staleVsSecondary: [], maxGapPct: null, verdict: 'UNCHECKED', error: e.message }, flagged: new Set() };
  }
}

module.exports = { compare, checkBrazil, PRICE_GAP_WARN_PCT, AGE_GAP_WARN_MS };
