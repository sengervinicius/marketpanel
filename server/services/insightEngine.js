/**
 * insightEngine.js — Proactive Insights Engine (Phase 7)
 *
 * Detects market events every 60 seconds and surfaces them to users
 * based on their watchlist, portfolio, and recent activity.
 *
 * Architecture:
 *   1. Event detector: deterministic rules, no LLM calls
 *   2. Relevance scorer: per-user scoring based on holdings + interests
 *   3. LLM narration: Claude Haiku for cheap one-sentence descriptions
 *   4. Latent questions: template-based follow-up chips
 *
 * Cost model: ~$0.01–0.03/user/day (Haiku narration only for relevant events)
 */

'use strict';

const logger = require('../utils/logger');
const twelvedata = require('../providers/twelvedata');

// ── Constants ──────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 60_000;     // 60 seconds
const NARRATION_CACHE_TTL = 600_000; // 10 minutes
const MAX_EVENTS_PER_SCAN = 20;      // cap to prevent runaway
const MAX_EVENTS_PER_USER = 10;      // max stored per user
const DEDUP_WINDOW_MS = 300_000;     // 5 minutes — same event won't re-fire

// Event severity thresholds
const PRICE_MOVE_PCT = 2;
const UNUSUAL_VOLUME_MULT = 2;
const UNUSUAL_VOLUME_MIN_PCT = 1;
const VIX_MOVE_PCT = 10;
const UST_MOVE_BPS = 5;
const DXY_MOVE_PCT = 0.5;
const PREDICTION_CHANGE_PCT = 10;

// Macro tickers to monitor
const MACRO_TICKERS = {
  VIX: { name: 'VIX', type: 'volatility' },
  'US10Y': { name: '10Y UST Yield', type: 'rates' },
  DXY: { name: 'Dollar Index', type: 'currency' },
};

// Sector ETF mapping for divergence detection
const SECTOR_ETFS = {
  XLK: ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'GOOGL', 'META', 'AVGO', 'ADBE', 'CRM', 'AMD', 'INTC', 'ORCL'],
  XLF: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'AXP', 'BLK', 'SCHW', 'USB'],
  XLV: ['UNH', 'JNJ', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'DHR', 'BMY'],
  XLE: ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'HAL'],
  XLY: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'LOW', 'TJX', 'BKNG', 'CMG'],
  XLP: ['PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'STZ'],
  XLI: ['CAT', 'BA', 'HON', 'UPS', 'RTX', 'DE', 'LMT', 'GE', 'MMM', 'FDX'],
  XLU: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'SRE', 'EXC', 'ED', 'XEL', 'WEC'],
  XLRE: ['PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'DLR', 'WELL', 'AVB'],
  XLC: ['META', 'GOOG', 'GOOGL', 'NFLX', 'DIS', 'CMCSA', 'VZ', 'T', 'TMUS', 'CHTR'],
  XLB: ['LIN', 'APD', 'SHW', 'FCX', 'ECL', 'NEM', 'DOW', 'DD', 'NUE', 'VMC'],
};

// Reverse mapping: ticker → sector ETF
const TICKER_TO_SECTOR = {};
for (const [etf, tickers] of Object.entries(SECTOR_ETFS)) {
  for (const t of tickers) {
    TICKER_TO_SECTOR[t] = etf;
  }
}

// ── State ──────────────────────────────────────────────────────────────────────

let _anthropicKey = null;
let _scanTimer = null;
let _running = false;

// Global event store: array of event objects
const _events = [];

// Per-user insight store: userId → [{ event, relevanceScore, narrative, questions }]
const _userInsights = new Map();

// Narration cache: eventKey → { narrative, cachedAt }
const _narrationCache = new Map();

// Dedup map: eventKey → timestamp (last fired)
const _dedupMap = new Map();

// Quote cache for the scan cycle: ticker → quote (cleared each scan)
let _scanQuoteCache = new Map();

// ── Event Types ────────────────────────────────────────────────────────────────

const EVENT_TYPES = {
  PRICE_MOVE:       'price_move',
  HIGH_LOW_BREAK:   'high_low_break',
  UNUSUAL_VOLUME:   'unusual_volume',
  SECTOR_DIVERGE:   'sector_divergence',
  FACTOR_MOVE:      'factor_move',
  PREDICTION_SHIFT: 'prediction_shift',
  VIX_SPIKE:        'vix_spike',
  RATE_MOVE:        'rate_move',
  DXY_MOVE:         'dxy_move',
};

// ── Latent Question Templates ──────────────────────────────────────────────────

const QUESTION_TEMPLATES = {
  [EVENT_TYPES.PRICE_MOVE]: [
    'Why is {TICKER} moving?',
    'Is this confirmed by sector?',
  ],
  [EVENT_TYPES.HIGH_LOW_BREAK]: [
    'What are the technicals on {TICKER}?',
    'Is {TICKER} at a support or resistance level?',
  ],
  [EVENT_TYPES.UNUSUAL_VOLUME]: [
    'What is driving volume in {TICKER}?',
    'Any news on {TICKER}?',
  ],
  [EVENT_TYPES.SECTOR_DIVERGE]: [
    'Why is {TICKER} diverging from sector?',
    'Is this a buying opportunity?',
  ],
  [EVENT_TYPES.FACTOR_MOVE]: [
    'What factor is driving this move?',
    'How does this affect my portfolio?',
  ],
  [EVENT_TYPES.PREDICTION_SHIFT]: [
    'What changed in this prediction market?',
    'How does this affect my positions?',
  ],
  [EVENT_TYPES.VIX_SPIKE]: [
    'How does this affect my portfolio?',
    'What should I watch?',
  ],
  [EVENT_TYPES.RATE_MOVE]: [
    'How does this affect my portfolio?',
    'What should I watch?',
  ],
  [EVENT_TYPES.DXY_MOVE]: [
    'How does this affect my portfolio?',
    'What should I watch?',
  ],
};

/**
 * Generate latent questions for an event.
 */
function getLatentQuestions(event) {
  const templates = QUESTION_TEMPLATES[event.type] || [
    'How does this affect my portfolio?',
    'What should I watch?',
  ];
  return templates.map(t => t.replace(/{TICKER}/g, event.ticker || event.description?.split(' ')[0] || 'this'));
}

// ── Quote Fetching ─────────────────────────────────────────────────────────────

/**
 * Fetch a quote with scan-cycle caching (avoids duplicate API calls within a single scan).
 */
async function getQuoteCached(ticker) {
  if (_scanQuoteCache.has(ticker)) return _scanQuoteCache.get(ticker);
  try {
    const q = await twelvedata.getQuote(ticker);
    if (q && q.price != null) {
      _scanQuoteCache.set(ticker, q);
      return q;
    }
  } catch (e) {
    logger.debug('insights', `Quote fetch failed for ${ticker}: ${e.message}`);
  }
  return null;
}

/**
 * Batch-fetch quotes with concurrency limiting.
 */
async function batchQuotes(tickers, concurrency = 5) {
  const results = new Map();
  for (let i = 0; i < tickers.length; i += concurrency) {
    const batch = tickers.slice(i, i + concurrency);
    const promises = batch.map(async t => {
      const q = await getQuoteCached(t);
      if (q) results.set(t, q);
    });
    await Promise.allSettled(promises);
  }
  return results;
}

// ── Event Detection ────────────────────────────────────────────────────────────

/**
 * Create an event object with dedup check.
 * Returns null if the same event was already fired within DEDUP_WINDOW_MS.
 */
function createEvent(type, ticker, description, severity, data = {}) {
  const key = `${type}:${ticker || 'macro'}:${severity}`;
  const lastFired = _dedupMap.get(key);
  if (lastFired && Date.now() - lastFired < DEDUP_WINDOW_MS) {
    return null; // Deduplicated
  }
  _dedupMap.set(key, Date.now());

  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    ticker: ticker || null,
    description,
    severity,
    detected_at: new Date().toISOString(),
    data,
  };
}

/**
 * Detect price events for a set of tickers.
 */
async function detectPriceEvents(tickers) {
  if (tickers.length === 0) return [];
  const events = [];
  const quotes = await batchQuotes(tickers);

  for (const [ticker, q] of quotes) {
    if (!q || q.price == null) continue;

    const changePct = q.changePct != null ? q.changePct : 0;
    const absChange = Math.abs(changePct);

    // Price move > 2%
    if (absChange >= PRICE_MOVE_PCT) {
      const dir = changePct > 0 ? 'up' : 'down';
      const severity = absChange >= 5 ? 'high' : absChange >= 3 ? 'medium' : 'low';
      const evt = createEvent(
        EVENT_TYPES.PRICE_MOVE, ticker,
        `${ticker} ${dir} ${absChange.toFixed(1)}% in today's session`,
        severity,
        { changePct, price: q.price, volume: q.volume }
      );
      if (evt) events.push(evt);
    }

    // 30-day high/low break (using 52-week as proxy if 30-day not available)
    if (q.high52w && q.price >= q.high52w * 0.98) {
      const evt = createEvent(
        EVENT_TYPES.HIGH_LOW_BREAK, ticker,
        `${ticker} near 52-week high at $${q.price.toFixed(2)}`,
        'medium',
        { price: q.price, high52w: q.high52w }
      );
      if (evt) events.push(evt);
    }
    if (q.low52w && q.price <= q.low52w * 1.02) {
      const evt = createEvent(
        EVENT_TYPES.HIGH_LOW_BREAK, ticker,
        `${ticker} near 52-week low at $${q.price.toFixed(2)}`,
        'high',
        { price: q.price, low52w: q.low52w }
      );
      if (evt) events.push(evt);
    }

    // Unusual volume: > 2x average with > 1% move
    if (q.volume && q.avgVolume && q.avgVolume > 0) {
      const volumeRatio = q.volume / q.avgVolume;
      if (volumeRatio >= UNUSUAL_VOLUME_MULT && absChange >= UNUSUAL_VOLUME_MIN_PCT) {
        const evt = createEvent(
          EVENT_TYPES.UNUSUAL_VOLUME, ticker,
          `${ticker} ${changePct > 0 ? 'up' : 'down'} ${absChange.toFixed(1)}% on ${volumeRatio.toFixed(1)}x average volume`,
          volumeRatio >= 3 ? 'high' : 'medium',
          { changePct, volume: q.volume, avgVolume: q.avgVolume, volumeRatio }
        );
        if (evt) events.push(evt);
      }
    }
  }

  return events;
}

/**
 * Detect cross-asset events: sector divergence, factor moves.
 */
async function detectCrossAssetEvents(portfolioTickers, watchlistTickers) {
  const events = [];
  const allTickers = [...new Set([...portfolioTickers, ...watchlistTickers])];

  // Sector divergence: ticker moving opposite to sector ETF
  const tickersWithSectors = allTickers
    .filter(t => TICKER_TO_SECTOR[t])
    .slice(0, 10); // Limit API calls

  if (tickersWithSectors.length > 0) {
    const sectorETFs = [...new Set(tickersWithSectors.map(t => TICKER_TO_SECTOR[t]))];
    await batchQuotes([...tickersWithSectors, ...sectorETFs]);

    for (const ticker of tickersWithSectors) {
      const etf = TICKER_TO_SECTOR[ticker];
      const tq = _scanQuoteCache.get(ticker);
      const eq = _scanQuoteCache.get(etf);
      if (!tq || !eq || tq.changePct == null || eq.changePct == null) continue;

      // Divergence: opposite direction AND both significant (> 1%)
      if (Math.abs(tq.changePct) >= 1 && Math.abs(eq.changePct) >= 1) {
        if ((tq.changePct > 0 && eq.changePct < 0) || (tq.changePct < 0 && eq.changePct > 0)) {
          const evt = createEvent(
            EVENT_TYPES.SECTOR_DIVERGE, ticker,
            `${ticker} (${tq.changePct > 0 ? '+' : ''}${tq.changePct.toFixed(1)}%) diverging from ${etf} (${eq.changePct > 0 ? '+' : ''}${eq.changePct.toFixed(1)}%)`,
            'medium',
            { tickerChange: tq.changePct, etfChange: eq.changePct, sectorETF: etf }
          );
          if (evt) events.push(evt);
        }
      }
    }
  }

  // Factor move: > 2 portfolio holdings moving > 2% same direction
  if (portfolioTickers.length >= 2) {
    const pQuotes = await batchQuotes(portfolioTickers);
    const bigMoversUp = [];
    const bigMoversDown = [];

    for (const [t, q] of pQuotes) {
      if (!q || q.changePct == null) continue;
      if (q.changePct >= PRICE_MOVE_PCT) bigMoversUp.push({ ticker: t, changePct: q.changePct });
      if (q.changePct <= -PRICE_MOVE_PCT) bigMoversDown.push({ ticker: t, changePct: q.changePct });
    }

    if (bigMoversUp.length >= 2) {
      const tickers = bigMoversUp.map(m => m.ticker).join(', ');
      const avgMove = bigMoversUp.reduce((s, m) => s + m.changePct, 0) / bigMoversUp.length;
      const evt = createEvent(
        EVENT_TYPES.FACTOR_MOVE, null,
        `${bigMoversUp.length} portfolio holdings up >2%: ${tickers} (avg +${avgMove.toFixed(1)}%)`,
        bigMoversUp.length >= 4 ? 'high' : 'medium',
        { direction: 'up', count: bigMoversUp.length, movers: bigMoversUp, avgMove }
      );
      if (evt) events.push(evt);
    }

    if (bigMoversDown.length >= 2) {
      const tickers = bigMoversDown.map(m => m.ticker).join(', ');
      const avgMove = bigMoversDown.reduce((s, m) => s + m.changePct, 0) / bigMoversDown.length;
      const evt = createEvent(
        EVENT_TYPES.FACTOR_MOVE, null,
        `${bigMoversDown.length} portfolio holdings down >2%: ${tickers} (avg ${avgMove.toFixed(1)}%)`,
        bigMoversDown.length >= 4 ? 'high' : 'medium',
        { direction: 'down', count: bigMoversDown.length, movers: bigMoversDown, avgMove }
      );
      if (evt) events.push(evt);
    }
  }

  return events;
}

/**
 * Detect macro events: VIX, 10Y, DXY.
 */
async function detectMacroEvents() {
  const events = [];
  const macroQuotes = await batchQuotes(Object.keys(MACRO_TICKERS));

  // VIX spike
  const vix = macroQuotes.get('VIX');
  if (vix && vix.changePct != null && Math.abs(vix.changePct) >= VIX_MOVE_PCT) {
    const dir = vix.changePct > 0 ? 'spiked' : 'dropped';
    const evt = createEvent(
      EVENT_TYPES.VIX_SPIKE, 'VIX',
      `VIX ${dir} ${Math.abs(vix.changePct).toFixed(1)}% to ${vix.price?.toFixed(2)}`,
      Math.abs(vix.changePct) >= 15 ? 'high' : 'medium',
      { changePct: vix.changePct, level: vix.price }
    );
    if (evt) events.push(evt);
  }

  // 10Y UST yield move (> 5bps)
  const ust = macroQuotes.get('US10Y');
  if (ust && ust.change != null && Math.abs(ust.change) >= UST_MOVE_BPS / 100) {
    const bps = Math.round(ust.change * 100);
    const dir = bps > 0 ? 'rose' : 'fell';
    const evt = createEvent(
      EVENT_TYPES.RATE_MOVE, 'US10Y',
      `10Y yield ${dir} ${Math.abs(bps)}bps to ${ust.price?.toFixed(3)}%`,
      Math.abs(bps) >= 10 ? 'high' : 'medium',
      { changeBps: bps, yield: ust.price }
    );
    if (evt) events.push(evt);
  }

  // DXY move
  const dxy = macroQuotes.get('DXY');
  if (dxy && dxy.changePct != null && Math.abs(dxy.changePct) >= DXY_MOVE_PCT) {
    const dir = dxy.changePct > 0 ? 'strengthened' : 'weakened';
    const evt = createEvent(
      EVENT_TYPES.DXY_MOVE, 'DXY',
      `Dollar index ${dir} ${Math.abs(dxy.changePct).toFixed(2)}% to ${dxy.price?.toFixed(2)}`,
      Math.abs(dxy.changePct) >= 1 ? 'high' : 'medium',
      { changePct: dxy.changePct, level: dxy.price }
    );
    if (evt) events.push(evt);
  }

  return events;
}

/**
 * Detect prediction market shifts.
 */
function detectPredictionEvents() {
  const events = [];
  try {
    const predAgg = require('./predictionAggregator');
    const markets = predAgg.getTopMarkets?.({ limit: 30 }) || [];

    for (const m of markets) {
      // Check if probability changed > 10% (stored as 0-1 scale)
      if (m.previousProb != null && m.currentProb != null) {
        const pctChange = Math.abs(m.currentProb - m.previousProb) * 100;
        if (pctChange >= PREDICTION_CHANGE_PCT) {
          const dir = m.currentProb > m.previousProb ? 'rose' : 'fell';
          const evt = createEvent(
            EVENT_TYPES.PREDICTION_SHIFT, null,
            `"${(m.title || m.question || '').slice(0, 60)}" probability ${dir} ${pctChange.toFixed(0)}% to ${(m.currentProb * 100).toFixed(0)}%`,
            pctChange >= 20 ? 'high' : 'medium',
            { title: m.title, currentProb: m.currentProb, previousProb: m.previousProb, source: m.source }
          );
          if (evt) events.push(evt);
        }
      }
    }
  } catch (e) {
    logger.debug('insights', 'Prediction event detection skipped', { error: e.message });
  }
  return events;
}

// ── Relevance Scoring (Task 2) ─────────────────────────────────────────────────

/**
 * Compute relevance score for an event relative to a user.
 * @param {Object} event
 * @param {Object} userContext — { portfolioTickers, watchlistTickers, recentTopicTickers }
 * @returns {number} score (0+)
 */
function computeRelevance(event, userContext) {
  const { portfolioTickers = [], watchlistTickers = [], recentTopicTickers = [] } = userContext;
  let score = 0;

  const ticker = event.ticker;
  if (ticker) {
    if (portfolioTickers.includes(ticker)) score += 3;
    if (watchlistTickers.includes(ticker)) score += 2;
    if (recentTopicTickers.includes(ticker)) score += 1;
  }

  // Factor moves reference multiple tickers — check if any are in user's lists
  if (event.type === EVENT_TYPES.FACTOR_MOVE && event.data?.movers) {
    const movers = event.data.movers.map(m => m.ticker);
    const portfolioOverlap = movers.filter(t => portfolioTickers.includes(t)).length;
    if (portfolioOverlap >= 2) score += 3;
  }

  // Severity bonus
  if (event.severity === 'high') score += 2;
  if (event.severity === 'medium') score += 1;

  // Macro events get a base relevance — they affect everyone
  if ([EVENT_TYPES.VIX_SPIKE, EVENT_TYPES.RATE_MOVE, EVENT_TYPES.DXY_MOVE].includes(event.type)) {
    score = Math.max(score, 2);
  }

  return score;
}

// ── LLM Narration (Task 3) ─────────────────────────────────────────────────────

/**
 * Generate a one-sentence narrative for an event using Claude Haiku.
 * Caches for 10 minutes to avoid re-calling for the same event.
 */
async function narrateEvent(event) {
  const cacheKey = `${event.type}:${event.ticker || 'macro'}:${event.severity}`;

  // Check cache
  const cached = _narrationCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < NARRATION_CACHE_TTL) {
    return cached.narrative;
  }

  // Fallback if no API key
  if (!_anthropicKey) {
    return event.description;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': _anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: `In one sentence (max 20 words), describe this market event for a professional investor. Be specific. Use numbers. No emojis. Format: [TICKER/ASSET]: [what happened] -- [why it matters].\nEvent: ${JSON.stringify(event.data)}. Context: ${event.description}`,
        }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.debug('insights', 'Haiku narration failed', { status: response.status });
      return event.description;
    }

    const data = await response.json();
    const narrative = data.content?.[0]?.text?.trim() || event.description;

    // Cache it
    _narrationCache.set(cacheKey, { narrative, cachedAt: Date.now() });

    return narrative;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.debug('insights', 'Haiku narration timeout (4s)');
    } else {
      logger.debug('insights', 'Haiku narration error', { error: e.message });
    }
    return event.description;
  }
}

// ── User Context Helpers ───────────────────────────────────────────────────────

/**
 * Extract user's portfolio tickers from portfolioStore.
 */
function getPortfolioTickers(userId) {
  try {
    const { getPortfolio } = require('../portfolioStore');
    const portfolio = getPortfolio(userId);
    if (!portfolio?.positions) return [];
    return portfolio.positions
      .map(p => p.symbol || p.ticker)
      .filter(Boolean)
      .map(t => t.toUpperCase());
  } catch {
    return [];
  }
}

/**
 * Extract user's watchlist tickers from settings.
 */
function getWatchlistTickers(userId) {
  try {
    const { getUserById } = require('../authStore');
    const user = getUserById(userId);
    const watchlist = user?.settings?.watchlist;
    if (Array.isArray(watchlist)) return watchlist.map(t => String(t).toUpperCase());
    return [];
  } catch {
    return [];
  }
}

/**
 * Extract recent topic tickers from conversation memory.
 * Returns a promise since memory access is async.
 */
async function getRecentTopicTickers(userId) {
  try {
    const memory = require('./conversationMemory');
    const records = await memory.getActive(userId);
    const tickers = new Set();
    for (const r of (records || [])) {
      if (r.tickers_mentioned && Array.isArray(r.tickers_mentioned)) {
        r.tickers_mentioned.forEach(t => tickers.add(t.toUpperCase()));
      }
    }
    return [...tickers];
  } catch {
    return [];
  }
}

// ── Core Scan Loop ─────────────────────────────────────────────────────────────

/**
 * Get all unique tickers to scan (union of all users' portfolios + watchlists + macro).
 */
function getAllScanTickers() {
  try {
    const { listUsers } = require('../authStore');
    const users = listUsers?.('') || [];
    const tickers = new Set(Object.keys(MACRO_TICKERS));

    for (const u of users) {
      const portfolio = getPortfolioTickers(u.id);
      const watchlist = getWatchlistTickers(u.id);
      portfolio.forEach(t => tickers.add(t));
      watchlist.forEach(t => tickers.add(t));
    }

    return [...tickers];
  } catch {
    return Object.keys(MACRO_TICKERS);
  }
}

/**
 * Run a full event detection scan.
 * Called every 60 seconds by the background timer.
 */
async function scan() {
  if (_running) return; // Prevent overlapping scans
  _running = true;

  try {
    // Clear scan-cycle quote cache
    _scanQuoteCache = new Map();

    // Gather all tickers to scan
    const allTickers = getAllScanTickers();
    const nonMacroTickers = allTickers.filter(t => !MACRO_TICKERS[t]);

    logger.debug('insights', `Scanning ${allTickers.length} tickers for events`);

    // Run detection in parallel
    const [priceEvents, macroEvents, predictionEvents] = await Promise.allSettled([
      detectPriceEvents(nonMacroTickers),
      detectMacroEvents(),
      detectPredictionEvents(),
    ]);

    const newEvents = [
      ...(priceEvents.status === 'fulfilled' ? priceEvents.value : []),
      ...(macroEvents.status === 'fulfilled' ? macroEvents.value : []),
      ...(predictionEvents.status === 'fulfilled' ? predictionEvents.value : []),
    ].slice(0, MAX_EVENTS_PER_SCAN);

    // Cross-asset detection needs portfolio context — get from all users
    try {
      const { listUsers } = require('../authStore');
      const users = listUsers?.('') || [];
      for (const u of users) {
        const portfolioTickers = getPortfolioTickers(u.id);
        const watchlistTickers = getWatchlistTickers(u.id);
        if (portfolioTickers.length > 0 || watchlistTickers.length > 0) {
          const crossEvents = await detectCrossAssetEvents(portfolioTickers, watchlistTickers);
          newEvents.push(...crossEvents);
        }
      }
    } catch (e) {
      logger.debug('insights', 'Cross-asset detection skipped', { error: e.message });
    }

    // Store events globally (capped)
    _events.push(...newEvents);
    while (_events.length > 100) _events.shift();

    // Clean up old dedup entries
    const dedupCutoff = Date.now() - DEDUP_WINDOW_MS * 2;
    for (const [key, ts] of _dedupMap) {
      if (ts < dedupCutoff) _dedupMap.delete(key);
    }

    // Clean up old narration cache
    const narrationCutoff = Date.now() - NARRATION_CACHE_TTL * 2;
    for (const [key, entry] of _narrationCache) {
      if (entry.cachedAt < narrationCutoff) _narrationCache.delete(key);
    }

    if (newEvents.length > 0) {
      logger.info('insights', `Detected ${newEvents.length} new events`, {
        types: [...new Set(newEvents.map(e => e.type))],
      });
    }
  } catch (e) {
    logger.error('insights', 'Event scan failed', { error: e.message });
  } finally {
    _running = false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialize the insight engine.
 */
function init({ anthropicKey } = {}) {
  _anthropicKey = anthropicKey || process.env.ANTHROPIC_API_KEY;

  if (_anthropicKey) {
    logger.info('insights', 'Insight engine initialized with Haiku narration');
  } else {
    logger.info('insights', 'Insight engine initialized (narration disabled — no Anthropic key)');
  }
}

/**
 * Start the background scan timer.
 */
function start() {
  if (_scanTimer) return;
  _scanTimer = setInterval(scan, SCAN_INTERVAL_MS);
  logger.info('insights', `Background scanner started (${SCAN_INTERVAL_MS / 1000}s interval)`);

  // Run first scan after 10s delay (let server boot)
  setTimeout(scan, 10_000);
}

/**
 * Stop the background scanner.
 */
function stop() {
  if (_scanTimer) {
    clearInterval(_scanTimer);
    _scanTimer = null;
    logger.info('insights', 'Background scanner stopped');
  }
}

/**
 * Get insights for a specific user with relevance scoring and narration.
 * @param {number|string} userId
 * @param {Object} opts — { limit }
 * @returns {Promise<Array>} Insight objects
 */
async function getInsightsForUser(userId, { limit = 5 } = {}) {
  const portfolioTickers = getPortfolioTickers(userId);
  const watchlistTickers = getWatchlistTickers(userId);
  const recentTopicTickers = await getRecentTopicTickers(userId);

  const userContext = { portfolioTickers, watchlistTickers, recentTopicTickers };

  // Score all recent events
  const scoredEvents = _events
    .slice(-50) // Only consider last 50 events
    .map(event => ({
      event,
      relevanceScore: computeRelevance(event, userContext),
    }))
    .filter(s => s.relevanceScore >= 2) // Threshold
    .sort((a, b) => {
      // Sort by severity first, then score, then recency
      const sevOrder = { high: 3, medium: 2, low: 1 };
      const sevDiff = (sevOrder[b.event.severity] || 0) - (sevOrder[a.event.severity] || 0);
      if (sevDiff !== 0) return sevDiff;
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return new Date(b.event.detected_at) - new Date(a.event.detected_at);
    })
    .slice(0, limit);

  // Generate narrations for top events (in parallel)
  const insights = await Promise.all(
    scoredEvents.map(async ({ event, relevanceScore }) => {
      const narrative = await narrateEvent(event);
      const questions = getLatentQuestions(event);
      return {
        id: event.id,
        type: event.type,
        ticker: event.ticker,
        narrative,
        severity: event.severity,
        timestamp: event.detected_at,
        relevanceScore,
        data: event.data,
        questions,
      };
    })
  );

  // Cache for user with TTL marker so stale entries can be evicted later.
  _userInsights.set(String(userId), { insights, cachedAt: Date.now() });

  // Opportunistic eviction: drop entries older than 24h each time we write.
  if (_userInsights.size > 1000) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [k, v] of _userInsights) {
      if ((v?.cachedAt || 0) < cutoff) _userInsights.delete(k);
    }
  }

  return insights;
}

/**
 * Get all recent events (for admin/debug).
 */
function getRecentEvents(limit = 20) {
  return _events.slice(-limit).reverse();
}

/**
 * Get event type constants.
 */
function getEventTypes() {
  return EVENT_TYPES;
}

/**
 * Get question templates.
 */
function getQuestionTemplates() {
  return QUESTION_TEMPLATES;
}

module.exports = {
  init,
  start,
  stop,
  scan,
  getInsightsForUser,
  getRecentEvents,
  getEventTypes,
  getQuestionTemplates,
  getLatentQuestions,
  computeRelevance,
  // For testing
  EVENT_TYPES,
  QUESTION_TEMPLATES,
  SECTOR_ETFS,
  TICKER_TO_SECTOR,
};
