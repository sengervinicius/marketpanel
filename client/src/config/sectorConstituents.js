/**
 * sectorConstituents.js — Phase S W1 item 2 (SECTOR PULSE).
 *
 * Top ~10 holdings per SPDR sector ETF (XL*), hardcoded. Polygon/Yahoo
 * snapshot rows carry no GICS sector, so the cheapest CORRECT way to name
 * "the stocks driving today's best/worst sector" is to quote the biggest
 * constituents of that sector's ETF via the existing batch snapshot
 * endpoint and rank them by day %.
 *
 * Weights drift slowly; the top-10 of each SPDR is stable for quarters at
 * a time. Order within a list is irrelevant — the panel ranks by day %.
 * Snapshot: State Street holdings, mid-2026.
 */

export const SECTOR_ETF_HOLDINGS = {
  XLK:  ['MSFT', 'NVDA', 'AAPL', 'AVGO', 'ORCL', 'PLTR', 'CSCO', 'CRM', 'AMD', 'IBM', 'ACN', 'ADBE', 'TXN', 'QCOM', 'INTU', 'NOW', 'AMAT', 'MU'],
  XLF:  ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'SPGI', 'AXP', 'C', 'SCHW', 'BLK', 'CB', 'PGR', 'MMC', 'BX'],
  XLV:  ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'ISRG', 'AMGN', 'PFE', 'DHR', 'BMY', 'GILD', 'CVS', 'MDT', 'VRTX', 'CI', 'ELV'],
  XLE:  ['XOM', 'CVX', 'COP', 'WMB', 'EOG', 'SLB', 'KMI', 'PSX', 'MPC', 'OKE', 'VLO', 'OXY', 'HES', 'FANG', 'BKR', 'DVN', 'HAL'],
  XLI:  ['GE', 'CAT', 'RTX', 'UBER', 'HON', 'UNP', 'BA', 'ETN', 'DE', 'LMT', 'UPS', 'ADP', 'TT', 'PH', 'GD', 'MMM', 'EMR', 'CSX', 'NSC'],
  XLY:  ['AMZN', 'TSLA', 'HD', 'MCD', 'BKNG', 'LOW', 'TJX', 'SBUX', 'NKE', 'ORLY', 'ABNB', 'MAR', 'GM', 'CMG', 'HLT', 'ROST', 'YUM', 'F'],
  XLP:  ['PG', 'COST', 'WMT', 'KO', 'PEP', 'PM', 'MDLZ', 'MO', 'CL', 'KMB', 'TGT', 'GIS', 'SYY', 'KHC', 'HSY', 'STZ', 'KR'],
  XLU:  ['NEE', 'SO', 'DUK', 'CEG', 'D', 'AEP', 'SRE', 'VST', 'EXC', 'XEL', 'PEG', 'ED', 'EIX', 'WEC', 'DTE', 'AEE', 'PPL', 'ETR'],
  XLB:  ['LIN', 'SHW', 'APD', 'ECL', 'FCX', 'NEM', 'CTVA', 'MLM', 'VMC', 'DD', 'NUE', 'DOW', 'PPG', 'IFF', 'ALB', 'STLD', 'LYB', 'PKG'],
  XLRE: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'DLR', 'PSA', 'O', 'CCI', 'CBRE', 'VICI', 'EXR', 'AVB', 'EQR', 'IRM', 'VTR', 'WY', 'INVH'],
  XLC:  ['META', 'GOOGL', 'GOOG', 'NFLX', 'DIS', 'TMUS', 'CMCSA', 'VZ', 'T', 'EA', 'CHTR', 'TTWO', 'OMC', 'WBD', 'LYV', 'MTCH', 'FOXA'],
};

/** Constituent list for a sector ETF ([] when unknown). */
export function getSectorHoldings(etf) {
  return SECTOR_ETF_HOLDINGS[String(etf || '').toUpperCase()] || [];
}

// ── FEAT-2: sector drill-down window ────────────────────────────────────────
// Rough index weights (%) per top-10 holding — publicly known approximations
// of each SPDR sector ETF's weighting, hardcoded and intentionally coarse
// (each sums to <100 because only the top 10 are listed). Used ONLY to rank
// an approximate contribution = weight × day move in the sector window;
// labelled "CONTRIB (approx)" in the UI.
export const SECTOR_ETF_WEIGHTS = {
  XLK:  { MSFT: 14.0, NVDA: 13.5, AAPL: 12.0, AVGO: 6.0, ORCL: 4.0, PLTR: 3.5, CSCO: 3.0, CRM: 2.5, AMD: 2.5, IBM: 2.5, ACN: 2.0, ADBE: 2.0, TXN: 1.8, QCOM: 1.6, INTU: 1.6, NOW: 1.5, AMAT: 1.5, MU: 1.4 },
  XLF:  { 'BRK-B': 13.0, JPM: 10.0, V: 8.0, MA: 6.5, BAC: 4.5, WFC: 4.0, GS: 3.5, MS: 3.0, SPGI: 3.0, AXP: 3.0, C: 2.5, SCHW: 2.3, BLK: 2.2, CB: 2.0, PGR: 2.0, MMC: 1.9, BX: 1.8 },
  XLV:  { LLY: 12.0, UNH: 8.5, JNJ: 8.0, ABBV: 7.0, MRK: 5.0, TMO: 4.0, ABT: 4.0, ISRG: 4.0, AMGN: 3.5, PFE: 3.5, DHR: 3.2, BMY: 3.0, GILD: 2.6, CVS: 2.4, MDT: 2.4, VRTX: 2.2, CI: 2.0, ELV: 2.0 },
  XLE:  { XOM: 22.0, CVX: 17.0, COP: 8.0, WMB: 5.0, EOG: 4.5, SLB: 4.5, KMI: 4.0, PSX: 4.0, MPC: 4.0, OKE: 4.0, VLO: 3.5, OXY: 3.2, HES: 3.0, FANG: 2.8, BKR: 2.6, DVN: 2.4, HAL: 2.2 },
  XLI:  { GE: 5.0, CAT: 4.5, RTX: 4.5, UBER: 4.5, HON: 4.0, UNP: 3.5, BA: 3.5, ETN: 3.5, DE: 3.0, LMT: 2.5, UPS: 3.2, ADP: 3.0, TT: 2.8, PH: 2.6, GD: 2.4, MMM: 2.4, EMR: 2.2, CSX: 2.2, NSC: 2.0 },
  XLY:  { AMZN: 22.0, TSLA: 18.0, HD: 7.0, MCD: 4.0, BKNG: 4.0, LOW: 3.0, TJX: 3.0, SBUX: 2.0, NKE: 2.0, ORLY: 2.0, ABNB: 2.0, MAR: 2.0, GM: 1.8, CMG: 1.8, HLT: 1.6, ROST: 1.6, YUM: 1.4, F: 1.4 },
  XLP:  { PG: 14.0, COST: 13.0, WMT: 12.0, KO: 9.0, PEP: 7.0, PM: 6.0, MDLZ: 4.0, MO: 3.5, CL: 3.0, KMB: 2.5, TGT: 2.4, GIS: 2.2, SYY: 2.0, KHC: 1.8, HSY: 1.8, STZ: 1.6, KR: 1.6 },
  XLU:  { NEE: 11.0, SO: 8.0, DUK: 7.0, CEG: 7.0, D: 5.0, AEP: 5.0, SRE: 4.5, VST: 4.5, EXC: 4.0, XEL: 3.5, PEG: 3.2, ED: 3.0, EIX: 2.8, WEC: 2.6, DTE: 2.4, AEE: 2.2, PPL: 2.0, ETR: 2.0 },
  XLB:  { LIN: 16.0, SHW: 7.0, APD: 6.0, ECL: 6.0, FCX: 5.5, NEM: 5.0, CTVA: 5.0, MLM: 4.5, VMC: 4.5, DD: 4.0, NUE: 3.8, DOW: 3.4, PPG: 3.2, IFF: 3.0, ALB: 2.6, STLD: 2.4, LYB: 2.4, PKG: 2.2 },
  XLRE: { PLD: 9.0, AMT: 8.0, EQIX: 7.0, WELL: 7.0, SPG: 5.0, DLR: 5.0, PSA: 4.5, O: 4.5, CCI: 4.0, CBRE: 4.0, VICI: 3.8, EXR: 3.6, AVB: 3.4, EQR: 3.2, IRM: 3.0, VTR: 2.8, WY: 2.6, INVH: 2.4 },
  XLC:  { META: 22.0, GOOGL: 12.0, GOOG: 10.0, NFLX: 7.0, DIS: 5.0, TMUS: 4.5, CMCSA: 4.0, VZ: 4.0, T: 4.0, EA: 2.0, CHTR: 2.0, TTWO: 1.8, OMC: 1.6, WBD: 1.6, LYV: 1.4, MTCH: 1.2, FOXA: 1.2 },
};

export const SECTOR_NAMES = {
  XLK: 'Technology', XLF: 'Financials', XLV: 'Health Care',
  XLY: 'Cons. Discretionary', XLC: 'Communications', XLI: 'Industrials',
  XLP: 'Cons. Staples', XLE: 'Energy', XLU: 'Utilities',
  XLRE: 'Real Estate', XLB: 'Materials',
};

/**
 * getSectorConstituents('XLK') → [{ symbol: 'MSFT', weight: 14.0 }, ...]
 * weight is null when we don't have an approximation for the holding.
 */
export function getSectorConstituents(etf) {
  const key = String(etf || '').toUpperCase();
  const holdings = SECTOR_ETF_HOLDINGS[key] || [];
  const weights = SECTOR_ETF_WEIGHTS[key] || {};
  return holdings.map((symbol) => ({ symbol, weight: weights[symbol] ?? null }));
}
