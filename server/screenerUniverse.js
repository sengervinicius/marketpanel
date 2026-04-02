/**
 * screenerUniverse.js — Curated symbol universes for the fundamental screener.
 *
 * Each universe is an array of symbolKeys from the canonical REGISTRY
 * in routes/instruments.js.  The screener route resolves these to
 * instrument metadata + live quotes.
 */

// All equity + ETF symbols from the registry.  Forex, crypto, and
// fixed-income are excluded because they don't have marketCap / P/E.
const GLOBAL_CORE = [
  // US equities
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','BRKB','JPM','GS',
  'BAC','V','MA','XOM','CVX','COP','SLB','CAT','BA','WMT','LLY','UNH',
  'FCX','NEM','GOLD','MSTR','COIN','AMD',
  // Brazil B3
  'VALE3.SA','PETR4.SA','PETR3.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA',
  'WEGE3.SA','RENT3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA',
  'B3SA3.SA','CSAN3.SA','CSNA3.SA','JBSS3.SA',
  // Brazil ADRs
  'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
  // Global
  'RIO','BHP',
  // ETFs
  'SPY','QQQ','DIA','IWM','EWZ','EEM','EFA','FXI','EWJ','EWW','EWA','EWC',
  'GLD','SLV','USO','UNG','TLT','HYG','LQD','EMB','JNK','BNDX',
  'CORN','WEAT','SOYB','CPER','REMX','DBA',
];

const UNIVERSES = {
  GLOBAL_CORE,
};

/**
 * Get the array of symbolKeys for a given universeId.
 * @param {string} universeId
 * @returns {string[]|null}  null if unknown universe
 */
function getUniverse(universeId) {
  return UNIVERSES[universeId] || null;
}

/** List available universe ids */
function listUniverses() {
  return Object.keys(UNIVERSES);
}

module.exports = { getUniverse, listUniverses };
