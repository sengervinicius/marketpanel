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
  XLK:  ['MSFT', 'NVDA', 'AAPL', 'AVGO', 'ORCL', 'PLTR', 'CSCO', 'CRM', 'AMD', 'IBM'],
  XLF:  ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'SPGI', 'AXP'],
  XLV:  ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'ISRG', 'AMGN', 'PFE'],
  XLE:  ['XOM', 'CVX', 'COP', 'WMB', 'EOG', 'SLB', 'KMI', 'PSX', 'MPC', 'OKE'],
  XLI:  ['GE', 'CAT', 'RTX', 'UBER', 'HON', 'UNP', 'BA', 'ETN', 'DE', 'LMT'],
  XLY:  ['AMZN', 'TSLA', 'HD', 'MCD', 'BKNG', 'LOW', 'TJX', 'SBUX', 'NKE', 'ORLY'],
  XLP:  ['PG', 'COST', 'WMT', 'KO', 'PEP', 'PM', 'MDLZ', 'MO', 'CL', 'KMB'],
  XLU:  ['NEE', 'SO', 'DUK', 'CEG', 'D', 'AEP', 'SRE', 'VST', 'EXC', 'XEL'],
  XLB:  ['LIN', 'SHW', 'APD', 'ECL', 'FCX', 'NEM', 'CTVA', 'MLM', 'VMC', 'DD'],
  XLRE: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'DLR', 'PSA', 'O', 'CCI', 'CBRE'],
  XLC:  ['META', 'GOOGL', 'GOOG', 'NFLX', 'DIS', 'TMUS', 'CMCSA', 'VZ', 'T', 'EA'],
};

/** Constituent list for a sector ETF ([] when unknown). */
export function getSectorHoldings(etf) {
  return SECTOR_ETF_HOLDINGS[String(etf || '').toUpperCase()] || [];
}
