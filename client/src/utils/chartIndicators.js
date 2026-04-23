/**
 * chartIndicators.js — Shared indicator computation + AI chart insight payload builder.
 *
 * Extracts the indicator logic originally implemented in InstrumentDetail.jsx (Phase 6)
 * into a reusable module consumed by InstrumentDetail, ChartPanel (desktop), and
 * ChartsPanelMobile.
 *
 * Uses the `technicalindicators` library already present in the project.
 */

import { SMA, EMA, RSI, MACD, BollingerBands } from 'technicalindicators';
import { swallow } from './swallow';

/* ── Public constants (shared across consumers) ─────────────────────────────── */

export const IND_COLORS = {
  SMA20: '#2196f3',  // blue
  EMA50: '#9c27b0',  // purple
  RSI14: '#ff9800',  // amber
  MACD:  '#00bcd4',  // teal
  BB:    '#ff9800',  // amber
};

export const INDICATOR_LIST = [
  { key: 'SMA20', label: 'SMA 20' },
  { key: 'EMA50', label: 'EMA 50' },
  { key: 'RSI14', label: 'RSI 14' },
  { key: 'MACD',  label: 'MACD' },
  { key: 'BB',    label: 'Bollinger' },
];

/* ── computeIndicators ──────────────────────────────────────────────────────── */

/**
 * Given raw bars and a Set (or array) of active indicator keys,
 * returns { bars: enrichedBars[], hasOverlay, hasSubChart }.
 *
 * Each enriched bar may gain: sma20, ema50, rsi14, macdLine, macdSignal, macdHist,
 * bbUpper, bbMiddle, bbLower — only for indicators present in `active`.
 *
 * @param {Array<{open,high,low,close,volume,t?,label?}>} bars
 * @param {Set<string>|string[]} active  — indicator keys that are turned on
 * @returns {{ bars: Array, hasOverlay: boolean, hasSubChart: boolean }}
 */
export function computeIndicators(bars, active) {
  const activeSet = active instanceof Set ? active : new Set(active || []);

  if (bars.length < 5) return { bars, hasOverlay: false, hasSubChart: false };

  const closes = bars.map(b => b.close);
  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);

  let sma20Vals = [];
  if (activeSet.has('SMA20') && closes.length >= 20) {
    try { sma20Vals = SMA.calculate({ period: 20, values: closes }); } catch (e) { swallow(e, 'util.chartIndicators.sma20'); }
  }

  let ema50Vals = [];
  if (activeSet.has('EMA50') && closes.length >= 50) {
    try { ema50Vals = EMA.calculate({ period: 50, values: closes }); } catch (e) { swallow(e, 'util.chartIndicators.ema50'); }
  }

  let rsi14Vals = [];
  if (activeSet.has('RSI14') && closes.length >= 15) {
    try { rsi14Vals = RSI.calculate({ period: 14, values: closes }); } catch (e) { swallow(e, 'util.chartIndicators.rsi14'); }
  }

  let macdVals = [];
  if (activeSet.has('MACD') && closes.length >= 26) {
    try {
      macdVals = MACD.calculate({
        values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
        SimpleMAOscillator: false, SimpleMASignal: false,
      });
    } catch (e) { swallow(e, 'util.chartIndicators.macd'); }
  }

  let bbVals = [];
  if (activeSet.has('BB') && closes.length >= 20) {
    try { bbVals = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }); } catch (e) { swallow(e, 'util.chartIndicators.bb'); }
  }

  // Merge into bars (align to end)
  const enriched = bars.map((b, i) => {
    const r = { ...b };
    const smaOff = closes.length - sma20Vals.length;
    if (i >= smaOff && sma20Vals[i - smaOff] != null) r.sma20 = sma20Vals[i - smaOff];

    const emaOff = closes.length - ema50Vals.length;
    if (i >= emaOff && ema50Vals[i - emaOff] != null) r.ema50 = ema50Vals[i - emaOff];

    const rsiOff = closes.length - rsi14Vals.length;
    if (i >= rsiOff && rsi14Vals[i - rsiOff] != null) r.rsi14 = rsi14Vals[i - rsiOff];

    const macdOff = closes.length - macdVals.length;
    if (i >= macdOff && macdVals[i - macdOff]) {
      r.macdLine   = macdVals[i - macdOff].MACD;
      r.macdSignal = macdVals[i - macdOff].signal;
      r.macdHist   = macdVals[i - macdOff].histogram;
    }

    const bbOff = closes.length - bbVals.length;
    if (i >= bbOff && bbVals[i - bbOff]) {
      r.bbUpper  = bbVals[i - bbOff].upper;
      r.bbMiddle = bbVals[i - bbOff].middle;
      r.bbLower  = bbVals[i - bbOff].lower;
    }
    return r;
  });

  const hasOverlay  = activeSet.has('SMA20') || activeSet.has('EMA50') || activeSet.has('BB');
  const hasSubChart = activeSet.has('RSI14') || activeSet.has('MACD');

  return { bars: enriched, hasOverlay, hasSubChart };
}

/* ── buildChartInsightPayload ───────────────────────────────────────────────── */

/**
 * Builds the request body for POST /api/search/chart-insight.
 * Mirrors InstrumentDetail's fetchChartInsight logic.
 *
 * @param {string} symbol   — normalized ticker
 * @param {string} rangeLabel — e.g. '1D', '1M'
 * @param {Array}  enrichedBars — bars with indicator fields attached
 * @returns {{ symbol, range, bars, indicators }}
 */
export function buildChartInsightPayload(symbol, rangeLabel, enrichedBars) {
  const lastBar = enrichedBars[enrichedBars.length - 1] || {};
  const indicators = {};

  if (lastBar.sma20 != null)    indicators.sma20 = lastBar.sma20;
  if (lastBar.ema50 != null)    indicators.ema50 = lastBar.ema50;
  if (lastBar.rsi14 != null)    indicators.rsi14 = lastBar.rsi14;
  if (lastBar.macdLine != null) indicators.macd = { MACD: lastBar.macdLine, signal: lastBar.macdSignal, histogram: lastBar.macdHist };
  if (lastBar.bbUpper != null)  { indicators.bbUpper = lastBar.bbUpper; indicators.bbLower = lastBar.bbLower; }

  const recentBars = enrichedBars.slice(-20).map(b => ({
    label: b.label, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }));

  return { symbol, range: rangeLabel, bars: recentBars, indicators };
}

/* ── getLatestIndicatorSnapshot (for compact badges) ────────────────────────── */

/**
 * Returns the latest computed value for each active indicator.
 * Useful for rendering numeric badges (RSI 63, MACD +0.12) in compact views.
 *
 * @param {Array} enrichedBars
 * @returns {{ rsi14?: number, macdLine?: number, macdSignal?: number, macdHist?: number, sma20?: number, ema50?: number }}
 */
export function getLatestIndicatorSnapshot(enrichedBars) {
  if (!enrichedBars || enrichedBars.length === 0) return {};
  const last = enrichedBars[enrichedBars.length - 1];
  const snap = {};
  if (last.rsi14 != null)    snap.rsi14 = last.rsi14;
  if (last.macdLine != null) snap.macdLine = last.macdLine;
  if (last.macdHist != null) snap.macdHist = last.macdHist;
  if (last.sma20 != null)    snap.sma20 = last.sma20;
  if (last.ema50 != null)    snap.ema50 = last.ema50;
  return snap;
}
