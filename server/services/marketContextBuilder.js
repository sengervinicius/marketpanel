/**
 * marketContextBuilder.js — Assembles rich market context for Particle AI calls.
 *
 * This is the keystone of Wave 6: it transforms Particle from a generic AI wrapper
 * into a contextual intelligence engine. Every AI call gets a snapshot of:
 *   1. Live market data (indices, top movers, sector performance)
 *   2. User context (watchlist tickers + prices, portfolio positions)
 *   3. Temporal context (market state, time of day, upcoming events)
 *
 * The assembled context is injected into the system prompt before the AI call,
 * giving the model real data to reason about instead of relying on stale training data.
 *
 * Design constraints:
 *   - Total context budget: ~1500 tokens (to keep AI costs under control)
 *   - Must run synchronously from in-memory data (no async DB calls in hot path)
 *   - Falls back gracefully if any data source is unavailable
 */

const logger = require('../utils/logger');
const predictionAggregator = require('./predictionAggregator');

// ── Reference: late-bound by init() ─────────────────────────────────────────
let _marketState = null;   // { stocks: {}, forex: {}, crypto: {} }
let _getUserById = null;   // (id) => user | null
let _getPortfolio = null;  // (userId) => portfolioDoc | null

/**
 * Late-bind dependencies so this module can be required before Express starts.
 * Called once from index.js after marketState and stores are ready.
 */
function init({ marketState, getUserById, getPortfolio }) {
  _marketState = marketState;
  _getUserById = getUserById;
  _getPortfolio = getPortfolio;
}

// ── Query intent classification ─────────────────────────────────────────────

const INTENT_PATTERNS = [
  { intent: 'ticker',     pattern: /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/i,           test: (q) => /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/i.test(q.trim()) },
  { intent: 'portfolio',  pattern: /portfol|my (hold|position|stock|invest)|exposure|concentrated|diversif/i },
  { intent: 'macro',      pattern: /fed |fomc|rate cut|rate hike|cpi|inflat|gdp|recession|unemployment|treasury|yield curve|macro|monetary policy/i },
  { intent: 'sector',     pattern: /sector|tech sector|energy sector|financials|healthcare|industrials|materials|utilities|consumer|real estate/i },
  { intent: 'comparison', pattern: /vs\.?|versus|compare|comparison|better|which.*should/i },
  { intent: 'thesis',     pattern: /bullish|bearish|bull case|bear case|thesis|conviction|counter.?thesis|stress.?test/i },
  { intent: 'crypto',     pattern: /bitcoin|btc|eth|ethereum|crypto|solana|sol|defi|nft|altcoin/i },
  { intent: 'forex',      pattern: /dollar|usd|eur|gbp|jpy|brl|fx|forex|currency|exchange rate/i },
  { intent: 'brazil',     pattern: /brazil|selic|b3|ibovespa|petrobras|vale|brl|bovespa|copom/i },
  { intent: 'general',    pattern: /.*/ },  // fallback
];

/**
 * Classify the user's query into an intent category.
 * @param {string} query
 * @returns {string} intent name
 */
function classifyIntent(query) {
  const q = query.trim();
  // Special case: bare ticker symbol
  if (INTENT_PATTERNS[0].test && INTENT_PATTERNS[0].test(q)) return 'ticker';
  for (const { intent, pattern, test } of INTENT_PATTERNS) {
    if (test ? test(q) : pattern.test(q)) return intent;
  }
  return 'general';
}

// ── Ticker extraction ───────────────────────────────────────────────────────

/**
 * Extract ticker symbols mentioned in a query.
 * Handles $AAPL, AAPL, VALE3.SA patterns.
 */
function extractTickers(query) {
  const matches = query.match(/\$?[A-Z]{1,5}(?:\.[A-Z]{1,2})?/g) || [];
  return [...new Set(matches.map(t => t.replace(/^\$/, '')))].slice(0, 5);
}

// ── Market data snapshot builders ───────────────────────────────────────────

/**
 * Get top movers from the in-memory market state.
 * Returns sorted arrays of biggest gainers and losers.
 */
function getTopMovers(category = 'stocks', limit = 5) {
  if (!_marketState || !_marketState[category]) return { gainers: [], losers: [] };

  const entries = Object.entries(_marketState[category])
    .filter(([, d]) => d && typeof d.changePercent === 'number' && d.price > 0)
    .map(([sym, d]) => ({
      symbol: sym,
      price: d.price,
      change: d.changePercent,
      volume: d.volume || 0,
    }));

  entries.sort((a, b) => b.change - a.change);
  const gainers = entries.slice(0, limit);
  const losers  = entries.slice(-limit).reverse();

  return { gainers, losers };
}

/**
 * Get major index prices from market state.
 */
function getIndices() {
  if (!_marketState?.stocks) return [];

  const indexSymbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'EWZ', 'VGK', 'EEM', 'FXI'];
  return indexSymbols
    .map(sym => {
      const d = _marketState.stocks[sym];
      if (!d || !d.price) return null;
      return {
        symbol: sym,
        price: d.price,
        change: d.changePercent ?? 0,
      };
    })
    .filter(Boolean);
}

/**
 * Get forex prices.
 */
function getForexSnapshot() {
  if (!_marketState?.forex) return [];

  const pairs = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDBRL', 'USDCNY'];
  return pairs
    .map(sym => {
      const d = _marketState.forex[sym];
      if (!d || !d.price) return null;
      return { symbol: sym, price: d.price, change: d.changePercent ?? 0 };
    })
    .filter(Boolean);
}

/**
 * Get crypto prices.
 */
function getCryptoSnapshot() {
  if (!_marketState?.crypto) return [];

  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD'];
  return coins
    .map(sym => {
      const d = _marketState.crypto[sym];
      if (!d || !d.price) return null;
      return { symbol: sym, price: d.price, change: d.changePercent ?? 0 };
    })
    .filter(Boolean);
}

// ── User context builders ───────────────────────────────────────────────────

/**
 * Get the user's watchlist tickers with current prices from market state.
 */
function getWatchlistContext(userId) {
  if (!_getUserById) return [];

  const user = _getUserById(userId);
  if (!user?.settings?.watchlist?.length) return [];

  return user.settings.watchlist.slice(0, 10).map(sym => {
    // Try stocks first, then forex, then crypto
    const d = _marketState?.stocks?.[sym] || _marketState?.forex?.[sym] || _marketState?.crypto?.[sym];
    return {
      symbol: sym,
      price: d?.price || null,
      change: d?.changePercent ?? null,
    };
  });
}

/**
 * Get a compact summary of the user's portfolio positions.
 * Enhanced with:
 *   - Total portfolio value
 *   - Top 5 holdings with allocation percentages
 *   - Sector concentration analysis
 */
function getPortfolioContext(userId) {
  if (!_getPortfolio) return null;

  const doc = _getPortfolio(userId);
  if (!doc?.positions || !Array.isArray(doc.positions)) return null;

  const positions = doc.positions.slice(0, 15).map(p => {
    const d = _marketState?.stocks?.[p.symbol] || _marketState?.forex?.[p.symbol] || _marketState?.crypto?.[p.symbol];
    // Calculate current value: investedAmount (preferred) or quantity * currentPrice
    const currentValue = p.investedAmount || (p.quantity * (d?.price || p.entryPrice || 0));
    return {
      symbol: p.symbol,
      shares: p.shares || p.quantity || 0,
      avgCost: p.avgCost || p.averageCost || p.entryPrice || 0,
      currentPrice: d?.price || null,
      change: d?.changePercent ?? null,
      currentValue: currentValue,
    };
  });

  // Calculate total portfolio value
  const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);

  // Top 5 holdings with allocation percentages
  const topHoldings = positions
    .filter(p => p.currentValue > 0)
    .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
    .slice(0, 5)
    .map(p => {
      const pct = totalValue > 0 ? ((p.currentValue / totalValue) * 100).toFixed(1) : '0';
      return `${p.symbol}: ${pct}%`;
    })
    .join(', ');

  // Sector concentration using TICKER_SECTORS mapping from behaviorTracker
  const TICKER_SECTORS = {
    AAPL: 'tech', MSFT: 'tech', NVDA: 'tech', GOOGL: 'tech', META: 'tech', AMZN: 'tech', TSLA: 'tech',
    AMD: 'tech', INTC: 'tech', CRM: 'tech', ORCL: 'tech', AVGO: 'tech', ADBE: 'tech',
    JPM: 'finance', GS: 'finance', MS: 'finance', BAC: 'finance', WFC: 'finance', C: 'finance',
    XOM: 'energy', CVX: 'energy', COP: 'energy', SLB: 'energy', USO: 'energy',
    LLY: 'health', UNH: 'health', JNJ: 'health', PFE: 'health', ABBV: 'health', MRK: 'health',
    WMT: 'consumer', COST: 'consumer', NKE: 'consumer', MCD: 'consumer', SBUX: 'consumer',
    CAT: 'industrial', BA: 'industrial', HON: 'industrial', UPS: 'industrial', LMT: 'industrial',
    'X:BTCUSD': 'crypto', 'X:ETHUSD': 'crypto', 'X:SOLUSD': 'crypto',
    'VALE3.SA': 'brazil', 'PETR4.SA': 'brazil', 'ITUB4.SA': 'brazil', 'BBDC4.SA': 'brazil',
    EWZ: 'brazil', VALE: 'brazil', PBR: 'brazil', ITUB: 'brazil',
    SPY: 'indices', QQQ: 'indices', DIA: 'indices', IWM: 'indices', VIX: 'indices',
  };

  const sectorWeights = {};
  positions.forEach(p => {
    const sector = TICKER_SECTORS[p.symbol] || 'other';
    sectorWeights[sector] = (sectorWeights[sector] || 0) + (p.currentValue || 0);
  });

  const sectorConcentration = Object.entries(sectorWeights)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sector, value]) => {
      const pct = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0';
      const sectorLabel = sector.charAt(0).toUpperCase() + sector.slice(1);
      return `${sectorLabel}: ${pct}%`;
    })
    .join(', ');

  // Return enriched positions with summary metadata
  const result = positions.length > 0 ? positions : null;
  if (result) {
    result._allocation = {
      totalValue,
      topHoldings,
      sectorConcentration,
    };
  }

  return result;
}

// ── Temporal context ────────────────────────────────────────────────────────

/**
 * Build time-aware context about market state.
 */
function getTemporalContext() {
  const now = new Date();
  const nyHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const nyMin  = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));
  const dayOfWeek = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long' });

  let marketState = 'closed';
  if (['Saturday', 'Sunday'].includes(dayOfWeek)) {
    marketState = 'weekend';
  } else if (nyHour >= 4 && nyHour < 9 || (nyHour === 9 && nyMin < 30)) {
    marketState = 'pre-market';
  } else if ((nyHour === 9 && nyMin >= 30) || (nyHour > 9 && nyHour < 16)) {
    marketState = 'open';
  } else if (nyHour >= 16 && nyHour < 20) {
    marketState = 'after-hours';
  }

  return {
    date: now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }),
    marketState,
    timezone: 'ET',
  };
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtPrice(p) {
  if (p == null) return '?';
  return p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

function fmtChange(c) {
  if (c == null) return '';
  const sign = c >= 0 ? '+' : '';
  return `${sign}${c.toFixed(2)}%`;
}

function fmtList(items, transform) {
  return items.map(transform).join(', ');
}

// ── Main context builder ────────────────────────────────────────────────────

/**
 * Build the full market context string for injection into the AI system prompt.
 *
 * @param {object} opts
 * @param {string} opts.query        - The user's latest message
 * @param {number} [opts.userId]     - User ID for personalization
 * @param {string} [opts.intent]     - Pre-classified intent (auto-detected if omitted)
 * @returns {{ contextString: string, intent: string, mentionedTickers: string[] }}
 */
function buildContext({ query, userId, intent: forceIntent } = {}) {
  const intent = forceIntent || classifyIntent(query || '');
  const mentionedTickers = extractTickers(query || '');
  const sections = [];

  try {
    // ── 1. Temporal context (always included) ────────────────────────────
    const temporal = getTemporalContext();
    sections.push(`[Current time] ${temporal.date}, ${temporal.time} ${temporal.timezone}. US market: ${temporal.marketState}.`);

    // ── 2. Market snapshot (for most intents) ────────────────────────────
    if (['general', 'macro', 'sector', 'comparison', 'thesis', 'ticker'].includes(intent)) {
      const indices = getIndices();
      if (indices.length > 0) {
        sections.push(`[Major indices] ${fmtList(indices, i => `${i.symbol} ${fmtPrice(i.price)} (${fmtChange(i.change)})`)}`);
      }
    }

    // ── 3. Top movers (for general/sector queries) ───────────────────────
    if (['general', 'sector'].includes(intent)) {
      const { gainers, losers } = getTopMovers('stocks', 3);
      if (gainers.length > 0) {
        sections.push(`[Top gainers] ${fmtList(gainers, g => `${g.symbol} ${fmtChange(g.change)}`)}`);
      }
      if (losers.length > 0) {
        sections.push(`[Top losers] ${fmtList(losers, l => `${l.symbol} ${fmtChange(l.change)}`)}`);
      }
    }

    // ── 4. Mentioned ticker details ──────────────────────────────────────
    if (mentionedTickers.length > 0) {
      const details = mentionedTickers.map(sym => {
        const d = _marketState?.stocks?.[sym] || _marketState?.forex?.[sym] || _marketState?.crypto?.[sym];
        if (!d || !d.price) return `${sym}: no live data`;
        return `${sym}: ${fmtPrice(d.price)} (${fmtChange(d.changePercent)})${d.volume ? ` vol:${(d.volume / 1e6).toFixed(1)}M` : ''}`;
      });
      sections.push(`[Mentioned tickers] ${details.join('; ')}`);
    }

    // ── 5. Forex context (for forex/macro/brazil) ────────────────────────
    if (['forex', 'macro', 'brazil', 'general'].includes(intent)) {
      const fx = getForexSnapshot();
      if (fx.length > 0) {
        sections.push(`[FX rates] ${fmtList(fx, f => `${f.symbol} ${fmtPrice(f.price)} (${fmtChange(f.change)})`)}`);
      }
    }

    // ── 6. Crypto context ────────────────────────────────────────────────
    if (['crypto', 'general'].includes(intent)) {
      const crypto = getCryptoSnapshot();
      if (crypto.length > 0) {
        sections.push(`[Crypto] ${fmtList(crypto, c => `${c.symbol} ${fmtPrice(c.price)} (${fmtChange(c.change)})`)}`);
      }
    }

    // ── 7. User watchlist (if authenticated) ─────────────────────────────
    if (userId) {
      const watchlist = getWatchlistContext(userId);
      if (watchlist.length > 0) {
        const wlStr = watchlist
          .map(w => `${w.symbol}${w.price != null ? ` ${fmtPrice(w.price)}` : ''}${w.change != null ? ` (${fmtChange(w.change)})` : ''}`)
          .join(', ');
        sections.push(`[User watchlist] ${wlStr}`);
      }
    }

    // ── 8. User portfolio (for portfolio intent or if available) ─────────
    if (userId && ['portfolio', 'thesis', 'general'].includes(intent)) {
      const positions = getPortfolioContext(userId);
      if (positions && positions.length > 0) {
        const alloc = positions._allocation;
        const posStr = positions.slice(0, 8).map(p => {
          let s = p.symbol;
          if (p.shares) s += ` ${p.shares}sh`;
          if (p.avgCost) s += ` @${fmtPrice(p.avgCost)}`;
          if (p.currentPrice) s += ` now:${fmtPrice(p.currentPrice)}`;
          if (p.change != null) s += ` (${fmtChange(p.change)})`;
          return s;
        }).join('; ');

        // Build allocation context
        const allocStr = [];
        if (alloc?.totalValue) {
          allocStr.push(`Total value: $${alloc.totalValue.toFixed(2)}`);
        }
        if (alloc?.topHoldings) {
          allocStr.push(`Top holdings: ${alloc.topHoldings}`);
        }
        if (alloc?.sectorConcentration) {
          allocStr.push(`Sector exposure: ${alloc.sectorConcentration}`);
        }

        const allocSection = allocStr.length > 0 ? `\n  [Allocation] ${allocStr.join(' | ')}` : '';
        sections.push(`[User portfolio] ${posStr}${allocSection}`);
      }
    }

    // ── 9. Prediction markets (Kalshi + Polymarket) — included as supplementary context ──
    // Always available but limited to top 3 so they complement real market data, not dominate it
    try {
      const predictionMarkets = predictionAggregator.getForQuery(query || '');
      if (predictionMarkets.length > 0) {
        // If query is specifically about predictions, include more
        const isPredFocused = /\b(predict|odds|probability|polymarket|kalshi|bet|wager|election|forecast)\b/i.test(query || '');
        const limit = isPredFocused ? 6 : 3;
        const predStr = predictionAggregator.formatForAI(predictionMarkets.slice(0, limit));
        if (predStr) {
          sections.push(`[Prediction markets — supplementary consensus from Kalshi & Polymarket]\n${predStr}`);
        }
      }
    } catch (predErr) {
      // Prediction markets are non-critical — fail silently
    }

    // ── 10. User interest profile (Wave 10 — personalization + timezone/activeHours) ──────────
    try {
      if (userId && _getUserById) {
        const behaviorTracker = require('./behaviorTracker');
        const user = _getUserById(userId);
        const profile = user?.settings?.interests || null;
        const profileStr = behaviorTracker.formatForAI(profile);
        if (profileStr) {
          sections.push(profileStr);
        }
        // Additional behavioral metadata for improved personalization
        if (profile) {
          const metadata = [];
          if (profile.timezone && profile.timezone !== 'UTC') {
            metadata.push(`User timezone: ${profile.timezone}`);
          }
          if (profile.activeHours) {
            const hours = [profile.activeHours.primary];
            if (profile.activeHours.secondary) hours.push(profile.activeHours.secondary);
            metadata.push(`Typical activity hours: ${hours.join(', ')}`);
          }
          if (profile.preferredAnswerLength) {
            metadata.push(`Answer length preference: ${profile.preferredAnswerLength}`);
          }
          if (profile.engagementRates && Object.keys(profile.engagementRates).length > 0) {
            const topEngagement = Object.entries(profile.engagementRates)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([section, rate]) => `${section} (${(rate * 100).toFixed(0)}%)`)
              .join(', ');
            metadata.push(`Morning brief engagement: ${topEngagement}`);
          }
          if (profile.brazilExposure) {
            metadata.push('User has interest in Brazilian markets');
          }
          if (metadata.length > 0) {
            sections.push(`[User behavioral metadata]\n${metadata.join('\n')}`);
          }
        }
      }
    } catch (profileErr) {
      // Personalization is non-critical — fail silently
    }

  } catch (err) {
    logger.error('[MarketContextBuilder] Error building context:', err.message);
    // Graceful degradation: return whatever we have
  }

  const contextString = sections.join('\n');

  // Build structured JSON context alongside text (for future tooling, logging, & validation)
  let structuredContext = null;
  try {
    const temporal = getTemporalContext();
    const indices = getIndices();
    const { gainers, losers } = getTopMovers('stocks', 3);
    structuredContext = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      intent,
      mentionedTickers,
      temporal,
      market: {
        indices: indices.map(i => ({ symbol: i.symbol, price: i.price, changePct: i.change })),
        topGainers: gainers.map(g => ({ symbol: g.symbol, changePct: g.change })),
        topLosers: losers.map(l => ({ symbol: l.symbol, changePct: l.change })),
      },
      sectionCount: sections.length,
      tokenEstimate: Math.ceil(contextString.length / 4),
    };
  } catch {
    // structuredContext is non-critical — fail silently
  }

  return { contextString, structuredContext, intent, mentionedTickers };
}

function getMarketState() { return _marketState; }

module.exports = { init, buildContext, classifyIntent, extractTickers, getMarketState };
