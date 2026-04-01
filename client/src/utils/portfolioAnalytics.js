/**
 * portfolioAnalytics.js — Pure computation helpers for portfolio analytics
 *
 * Phase 4C: Summary metrics, allocations, benchmark comparison.
 * All functions are pure — they take positions + price data and return computed values.
 * Designed to be called from memoized selectors in components.
 */

// ── Formatters ──
export const fmt = (n) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
export const fmtCompact = (n) => {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
};

// ── Asset type inference from symbol ──
export function inferAssetType(symbol) {
  if (!symbol) return 'other';
  const s = symbol.toUpperCase();
  if (s.endsWith('.SA')) return 'brazil';
  if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|DOT|AVAX|MATIC|LINK|UNI|ATOM|NEAR|APT)USD$/.test(s)) return 'crypto';
  if (/^[A-Z]{6}$/.test(s) && !s.endsWith('USD')) return 'fx';
  if (/^(GLD|SLV|USO|UNG|CORN|WEAT|SOYB|DBA|CPER|REMX|BHP|RIO|NEM|GOLD)$/.test(s)) return 'commodity';
  if (/^(SPY|QQQ|DIA|IWM|EWZ|EEM|EFA|FXI|EWJ|EWW|EWA|EWC|TLT|HYG|LQD|EMB|JNK|BNDX|VTI|VOO|IVV)$/.test(s)) return 'etf';
  return 'equity';
}

// ── Asset type display labels ──
const ASSET_TYPE_LABELS = {
  equity: 'Equities',
  brazil: 'Brazil B3',
  crypto: 'Crypto',
  fx: 'FX',
  etf: 'ETFs',
  commodity: 'Commodities',
  other: 'Other',
};
export function assetTypeLabel(type) {
  return ASSET_TYPE_LABELS[type] || type;
}

// ── Suggest default benchmark based on portfolio composition ──
export function suggestBenchmark(positions) {
  if (!positions || positions.length === 0) return 'SPY';
  const types = {};
  for (const p of positions) {
    const t = inferAssetType(p.symbol);
    types[t] = (types[t] || 0) + 1;
  }
  const total = positions.length;
  if ((types.brazil || 0) / total > 0.4) return 'EWZ';
  if ((types.crypto || 0) / total > 0.4) return 'BTCUSD';
  return 'SPY';
}

/**
 * Compute summary metrics for a set of positions + price data.
 *
 * @param {Array} positions - Position objects from PortfolioContext
 * @param {Function} getPriceData - (symbol) => { price, changePct, change } or null
 * @returns {Object} Summary metrics
 */
export function computeSummary(positions, getPriceData) {
  let totalInvested = 0;
  let totalCurrentValue = 0;
  let totalDailyChange = 0;
  let positionsWithValue = 0;
  let bestPerformer = null;
  let worstPerformer = null;
  let bestPnlPct = -Infinity;
  let worstPnlPct = Infinity;

  for (const pos of positions) {
    const data = getPriceData(pos.symbol);
    const livePrice = data?.price || null;
    const dailyChangePct = data?.changePct || 0;

    // Invested amount calculation
    if (pos.investedAmount != null) {
      totalInvested += pos.investedAmount;
    } else if (pos.entryPrice != null && pos.quantity != null) {
      totalInvested += pos.entryPrice * pos.quantity;
    }

    // Current value (needs quantity and live price)
    if (pos.quantity != null && livePrice != null) {
      const currentValue = livePrice * pos.quantity;
      totalCurrentValue += currentValue;
      positionsWithValue++;

      // Daily change contribution
      if (data?.change != null) {
        totalDailyChange += data.change * pos.quantity;
      }
    }

    // P&L % per position (for best/worst)
    if (pos.entryPrice != null && livePrice != null && pos.entryPrice > 0) {
      const pnlPct = ((livePrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (pnlPct > bestPnlPct) {
        bestPnlPct = pnlPct;
        bestPerformer = { symbol: pos.symbol, pnlPct };
      }
      if (pnlPct < worstPnlPct) {
        worstPnlPct = pnlPct;
        worstPerformer = { symbol: pos.symbol, pnlPct };
      }
    }
  }

  const totalPnl = positionsWithValue > 0 ? totalCurrentValue - totalInvested : null;
  const totalPnlPct = totalInvested > 0 && totalPnl != null ? (totalPnl / totalInvested) * 100 : null;
  const dailyPnlPct = totalCurrentValue > 0 ? (totalDailyChange / (totalCurrentValue - totalDailyChange)) * 100 : null;

  return {
    totalInvested: totalInvested > 0 ? totalInvested : null,
    totalCurrentValue: positionsWithValue > 0 ? totalCurrentValue : null,
    totalPnl,
    totalPnlPct,
    dailyPnl: totalDailyChange !== 0 ? totalDailyChange : null,
    dailyPnlPct,
    positionCount: positions.length,
    positionsWithValue,
    bestPerformer: bestPnlPct !== -Infinity ? bestPerformer : null,
    worstPerformer: worstPnlPct !== Infinity ? worstPerformer : null,
  };
}

/**
 * Compute allocation breakdown by a given key.
 *
 * @param {Array} positions - Position objects
 * @param {Function} getPriceData - (symbol) => { price, ... } or null
 * @param {string} groupBy - 'subportfolio' | 'symbol' | 'assetType' | 'currency'
 * @param {Array} portfolios - Portfolio objects (for subportfolio name resolution)
 * @returns {Array<{label, value, pct, count}>} Sorted by value descending
 */
export function computeAllocation(positions, getPriceData, groupBy, portfolios) {
  const groups = {};

  for (const pos of positions) {
    let key;
    switch (groupBy) {
      case 'subportfolio': {
        key = pos.subportfolioId || 'ungrouped';
        break;
      }
      case 'symbol':
        key = pos.symbol;
        break;
      case 'assetType':
        key = inferAssetType(pos.symbol);
        break;
      case 'currency':
        key = pos.currency || 'USD';
        break;
      default:
        key = 'other';
    }

    if (!groups[key]) groups[key] = { value: 0, count: 0, key };
    groups[key].count++;

    const data = getPriceData(pos.symbol);
    const livePrice = data?.price || null;

    if (pos.quantity != null && livePrice != null) {
      groups[key].value += livePrice * pos.quantity;
    } else if (pos.investedAmount != null) {
      groups[key].value += pos.investedAmount;
    } else if (pos.entryPrice != null && pos.quantity != null) {
      groups[key].value += pos.entryPrice * pos.quantity;
    }
  }

  const totalValue = Object.values(groups).reduce((s, g) => s + g.value, 0);

  const result = Object.entries(groups).map(([key, g]) => {
    let label = key;
    if (groupBy === 'subportfolio') {
      // Resolve subportfolio name
      for (const p of (portfolios || [])) {
        const sub = p.subportfolios?.find(sp => sp.id === key);
        if (sub) { label = `${p.name} / ${sub.name}`; break; }
      }
      if (label === 'ungrouped') label = 'Ungrouped';
    } else if (groupBy === 'assetType') {
      label = assetTypeLabel(key);
    }
    return {
      key,
      label,
      value: g.value,
      pct: totalValue > 0 ? (g.value / totalValue) * 100 : 0,
      count: g.count,
    };
  });

  return result.sort((a, b) => b.value - a.value);
}

/**
 * Compute benchmark comparison.
 *
 * @param {Object} summary - Result from computeSummary
 * @param {Object} benchmarkData - { price, changePct, change } from useTickerPrice
 * @param {string} benchmarkSymbol - e.g. 'SPY'
 * @returns {Object} Benchmark comparison
 */
export function computeBenchmarkComparison(summary, benchmarkData, benchmarkSymbol) {
  const benchmarkDailyPct = benchmarkData?.changePct ?? null;
  const portfolioDailyPct = summary.dailyPnlPct ?? null;

  let relativePerformance = null;
  if (portfolioDailyPct != null && benchmarkDailyPct != null) {
    relativePerformance = portfolioDailyPct - benchmarkDailyPct;
  }

  return {
    benchmarkSymbol,
    benchmarkDailyPct,
    portfolioDailyPct,
    relativePerformance,
    outperforming: relativePerformance != null ? relativePerformance > 0 : null,
  };
}
