/**
 * services/signalMonitor.js — Real-time Signal Detection & AI Insights
 *
 * Background worker that monitors market data and generates AI-powered signals
 * with push delivery via WebSocket.
 *
 * Detectors:
 *   1. Momentum Break — Stock/crypto moves >2% intraday
 *   2. Watchlist Earnings Alert — Watchlist stock has earnings in next 3 days
 *   3. Market Status Change — Major market opens/closes
 *
 * Signal structure: { type, ticker, title, severity, context, insight }
 * - type: 'momentum_break' | 'earnings_alert' | 'market_status'
 * - severity: 'high' | 'medium' | 'low'
 * - insight: AI-generated 2-3 sentence summary
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');
const earningsService = require('./earnings');

// ── Config ──────────────────────────────────────────────────────────────────
const MOMENTUM_THRESHOLD = 0.02; // 2% move
const MOMENTUM_CHECK_INTERVAL = 60 * 1000; // Every 60 seconds
const EARNINGS_CHECK_INTERVAL = 5 * 60 * 1000; // Every 5 minutes
const EARNINGS_WINDOW_DAYS = 3; // Alert if earnings in next 3 days
const SIGNALS_PER_USER_MAX = 100; // Keep last 100 signals per user
const SIGNAL_AI_TIMEOUT = 10000; // 10s timeout for AI insight generation
const MARKET_STATUS_CHECK_INTERVAL = 60 * 1000; // Every minute
const US_MARKET_OPEN_ET = 9.5; // 9:30 AM ET
const US_MARKET_CLOSE_ET = 16.0; // 4:00 PM ET

// ── Composite detector config (Phase 9.6) ──────────────────────────────────
// vol_flip: fire when current abs(change) exceeds K × stdev of recent samples
// AND the prior stdev was below a "calm regime" threshold. In plain English:
// the ticker was quiet, and it just woke up.
const VOL_FLIP_CHECK_INTERVAL  = 90 * 1000; // 90s
const VOL_FLIP_BUFFER_SIZE     = 30;        // rolling window
const VOL_FLIP_MIN_SAMPLES     = 12;        // need at least this much history
const VOL_FLIP_SIGMA_MULT      = 2.8;       // current |chg| > this × prior stdev
const VOL_FLIP_CALM_THRESHOLD  = 0.008;     // prior stdev < 0.8% is "calm"
const VOL_FLIP_MIN_ABS_CHANGE  = 0.015;     // floor: at least 1.5% absolute move

// correlation_break: compare each ticker to its sector benchmark's change%.
// Fire when opposite-signed + combined magnitude large, or ticker magnitude
// >= 3× benchmark and ticker alone > 2.5%.
const CORR_BREAK_CHECK_INTERVAL      = 120 * 1000; // 2min
const CORR_BREAK_OPPOSITE_COMBINED   = 0.035;      // |t|+|b| > 3.5% with opposite signs
const CORR_BREAK_MAG_RATIO           = 3.0;        // ticker magnitude ÷ benchmark magnitude
const CORR_BREAK_MIN_TICKER_MOVE     = 0.025;      // ticker must move > 2.5%

// news_spike: a ticker with |change%| > 3% that has a material news hit in the
// last ~60 minutes. Gated heavily by time + dedup so we don't hammer providers.
const NEWS_SPIKE_CHECK_INTERVAL      = 5 * 60 * 1000; // 5min
const NEWS_SPIKE_MIN_ABS_CHANGE      = 0.03;          // 3%
const NEWS_SPIKE_LOOKBACK_MS         = 60 * 60 * 1000;// 60min
const NEWS_SPIKE_TICKERS_PER_TICK    = 6;             // cap per user per tick

// ── State ───────────────────────────────────────────────────────────────────
let _timers = {};
let _marketState = null;
let _getWatchlists = null;
let _broadcastFn = null;

// Signal state: userId → [{ type, ticker, title, severity, context, insight, timestamp }]
const _userSignals = new Map();

// Prevent duplicate signals: type:ticker → lastTimestamp
const _lastSignalFired = new Map();
const DEDUP_WINDOW = 60 * 60 * 1000; // Don't re-fire same signal within 1 hour

// Market state tracking
let _lastMarketOpenFired = false;
let _lastMarketCloseFired = false;
let _lastMarketDate = null;

// Background job concurrency guards: prevent slow API responses from piling up
let _momentumRunning = false;
let _earningsRunning = false;
let _marketStatusRunning = false;
let _volFlipRunning = false;
let _corrBreakRunning = false;
let _newsSpikeRunning = false;

// Composite detector state (Phase 9.6)
// Rolling intraday change% samples: ticker → number[] (newest last)
const _tickerChangeHistory = new Map();
// Maps sector label → benchmark ETF symbol for correlation_break
const _SECTOR_BENCHMARK = {
  Tech: 'XLK', Technology: 'XLK', Semiconductors: 'SMH',
  Energy: 'XLE', Oil: 'XLE', Utilities: 'XLU',
  Financials: 'XLF', Banks: 'XLF', Insurance: 'XLF',
  Healthcare: 'XLV', Biotech: 'XBI', Pharma: 'XLV',
  'Consumer Staples': 'XLP', 'Consumer Disc.': 'XLY', 'Consumer Discretionary': 'XLY',
  Retail: 'XRT', Industrials: 'XLI', Materials: 'XLB',
  Mining: 'PICK', Steel: 'SLX', 'Pulp&Paper': 'WOOD',
  Aerospace: 'ITA', Defense: 'ITA', Agriculture: 'MOO',
  'Real Estate': 'XLRE', Telecom: 'XLC', Communications: 'XLC',
};
const DEFAULT_BENCHMARK = 'SPY';

// ── Init ────────────────────────────────────────────────────────────────────
function init({ marketState, getWatchlists, broadcast } = {}) {
  _marketState = marketState;
  _getWatchlists = getWatchlists;
  _broadcastFn = broadcast;

  // Start all detector timers
  if (_timers.momentum) clearInterval(_timers.momentum);
  _timers.momentum = setInterval(detectMomentumBreaks, MOMENTUM_CHECK_INTERVAL);

  if (_timers.earnings) clearInterval(_timers.earnings);
  _timers.earnings = setInterval(detectEarningsAlerts, EARNINGS_CHECK_INTERVAL);

  if (_timers.marketStatus) clearInterval(_timers.marketStatus);
  _timers.marketStatus = setInterval(detectMarketStatusChange, MARKET_STATUS_CHECK_INTERVAL);

  // Composite detectors (Phase 9.6)
  if (_timers.volFlip) clearInterval(_timers.volFlip);
  _timers.volFlip = setInterval(detectVolFlip, VOL_FLIP_CHECK_INTERVAL);

  if (_timers.corrBreak) clearInterval(_timers.corrBreak);
  _timers.corrBreak = setInterval(detectCorrelationBreak, CORR_BREAK_CHECK_INTERVAL);

  if (_timers.newsSpike) clearInterval(_timers.newsSpike);
  _timers.newsSpike = setInterval(detectNewsSpike, NEWS_SPIKE_CHECK_INTERVAL);

  logger.info('signals', 'Signal Monitor service started');
}

function stop() {
  Object.values(_timers).forEach(t => clearInterval(t));
  _timers = {};
  logger.info('signals', 'Signal Monitor service stopped');
}

// ── Helper: Time utilities ──────────────────────────────────────────────────
function getETTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isWeekday() {
  const day = getETTime().getDay();
  return day !== 0 && day !== 6;
}

function getETHours() {
  const et = getETTime();
  return et.getHours() + et.getMinutes() / 60;
}

function getTodayDateStr() {
  const et = getETTime();
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}

// ── Helper: Store & retrieve signals ────────────────────────────────────────
function addSignal(userId, signal) {
  if (!_userSignals.has(userId)) {
    _userSignals.set(userId, []);
  }

  const signals = _userSignals.get(userId);
  const fullSignal = { ...signal, timestamp: Date.now() };
  signals.unshift(fullSignal); // Most recent first

  // Keep only last N signals
  if (signals.length > SIGNALS_PER_USER_MAX) {
    signals.pop();
  }

  return fullSignal;
}

function getRecentSignals(userId, count = 20) {
  const signals = _userSignals.get(userId) || [];
  return signals.slice(0, count);
}

function getUnreadCount(userId) {
  const signals = _userSignals.get(userId) || [];
  // For now, all signals are "unread" by default
  // In a real system, would track read state in DB
  return signals.length;
}

// ── Helper: Dedup check ─────────────────────────────────────────────────────
function shouldFireSignal(type, ticker) {
  const key = `${type}:${ticker}`;
  const lastFired = _lastSignalFired.get(key) || 0;
  const now = Date.now();

  if (now - lastFired < DEDUP_WINDOW) {
    return false; // Signal already fired recently
  }

  _lastSignalFired.set(key, now);
  return true;
}

// ── Helper: Generate AI insight ─────────────────────────────────────────────
async function generateSignalInsight(context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('signals', 'ANTHROPIC_API_KEY not set, skipping AI insight');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIGNAL_AI_TIMEOUT);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 150,
        system: 'You are Particle, a terse market intelligence bot. Write 2-sentence alerts. Use $TICKER format. Be numeric and opinionated.',
        messages: [
          {
            role: 'user',
            content: `Generate a market signal alert for: ${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.warn('signals', `Claude API error ${resp.status}`, { slice: text.slice(0, 100) });
      return null;
    }

    const data = await resp.json();
    const insight = data.content?.[0]?.text?.trim();
    return insight || null;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('signals', 'AI insight generation timed out');
    } else {
      logger.warn('signals', 'AI insight generation failed', { error: e.message });
    }
    return null;
  }
}

// ── Detector 1: Momentum Break ──────────────────────────────────────────────
async function detectMomentumBreaks() {
  // Skip if already running: prevents slow API responses from piling up
  if (_momentumRunning) return;
  _momentumRunning = true;

  try {
    if (!isWeekday() || !_marketState) return;

    const stocks = _marketState.stocks || {};
    const watchlistMap = await getAllUserWatchlists();

    // For each user, check their watchlist for momentum breaks
    for (const [userId, watchlist] of watchlistMap) {
      for (const ticker of watchlist) {
        const stock = stocks[ticker.toUpperCase()];
        if (!stock) continue;

        const changePercent = stock.changePct || stock.changePercent || 0;
        const absMomentum = Math.abs(changePercent);

        if (absMomentum > MOMENTUM_THRESHOLD && shouldFireSignal('momentum_break', ticker)) {
          const direction = changePercent > 0 ? 'up' : 'down';
          const title = `$${ticker} moved ${direction} ${Math.abs(changePercent).toFixed(2)}%`;
          const severity = absMomentum > 0.05 ? 'high' : 'medium';
          const context = `$${ticker} moved ${direction} ${Math.abs(changePercent).toFixed(2)}% in ${direction} intraday. Price: $${stock.price?.toFixed(2) || 'N/A'}. Volume: ${stock.volume || 'N/A'}`;

          const insight = await generateSignalInsight(context);
          const signal = {
            type: 'momentum_break',
            ticker,
            title,
            severity,
            context,
            insight: insight || `${title}. Monitor for continued momentum.`,
          };

          const fullSignal = addSignal(userId, signal);
          broadcastSignalToUser(userId, fullSignal);
          logger.info('signals', `Momentum break: ${title}`, { userId, severity });
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Momentum detection error', { error: e.message });
  } finally {
    _momentumRunning = false;
  }
}

// ── Detector 2: Earnings Alert ──────────────────────────────────────────────
async function detectEarningsAlerts() {
  // Skip if already running: prevents slow API responses from piling up
  if (_earningsRunning) return;
  _earningsRunning = true;

  try {
    if (!isWeekday() || !earningsService.isConfigured()) return;

    const watchlistMap = await getAllUserWatchlists();

    for (const [userId, watchlist] of watchlistMap) {
      const upcoming = await earningsService.getUpcomingForWatchlist(watchlist);

      for (const earning of upcoming) {
        if (earning.daysUntil <= EARNINGS_WINDOW_DAYS && earning.daysUntil >= 0) {
          if (shouldFireSignal('earnings_alert', earning.symbol)) {
            const daysStr = earning.daysUntil === 0 ? 'today' : `in ${earning.daysUntil} days`;
            const title = `$${earning.symbol} earnings ${daysStr}`;
            const severity = earning.daysUntil === 0 ? 'high' : 'medium';
            const context = `$${earning.symbol} reports earnings ${daysStr} (${earning.date}, ${earning.hour === 'amc' ? 'after close' : 'before open'})`;

            const insight = await generateSignalInsight(context);
            const signal = {
              type: 'earnings_alert',
              ticker: earning.symbol,
              title,
              severity,
              context,
              insight: insight || `${title}. Watch for volatility.`,
            };

            const fullSignal = addSignal(userId, signal);
            broadcastSignalToUser(userId, fullSignal);
            logger.info('signals', `Earnings alert: ${title}`, { userId, severity });
          }
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Earnings detection error', { error: e.message });
  } finally {
    _earningsRunning = false;
  }
}

// ── Detector 3: Market Status Change ────────────────────────────────────────
async function detectMarketStatusChange() {
  // Skip if already running: prevents slow operations from piling up
  if (_marketStatusRunning) return;
  _marketStatusRunning = true;

  try {
    if (!isWeekday()) return;

    const etHours = getETHours();
    const today = getTodayDateStr();

    if (_lastMarketDate !== today) {
      // New day, reset market state
      _lastMarketOpenFired = false;
      _lastMarketCloseFired = false;
      _lastMarketDate = today;
    }

    // Market open: 9:30 AM ET
    if (etHours >= US_MARKET_OPEN_ET && etHours < US_MARKET_OPEN_ET + 0.5 && !_lastMarketOpenFired) {
      _lastMarketOpenFired = true;
      broadcastMarketStatusSignal('open');
    }

    // Market close: 4:00 PM ET
    if (etHours >= US_MARKET_CLOSE_ET && etHours < US_MARKET_CLOSE_ET + 0.5 && !_lastMarketCloseFired) {
      _lastMarketCloseFired = true;
      broadcastMarketStatusSignal('close');
    }
  } catch (e) {
    logger.error('signals', 'Market status detection error', { error: e.message });
  } finally {
    _marketStatusRunning = false;
  }
}

// ── Helper: rolling stdev ───────────────────────────────────────────────────
function stdev(xs) {
  if (!xs || xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

// ── Detector 4: Vol Flip ────────────────────────────────────────────────────
// A ticker was calm and just woke up. Classic regime-change trigger.
async function detectVolFlip() {
  if (_volFlipRunning) return;
  _volFlipRunning = true;

  try {
    if (!isWeekday() || !_marketState) return;
    const stocks = _marketState.stocks || {};
    const watchlistMap = await getAllUserWatchlists();

    // Union of all watchlist tickers so we only track what users care about
    const allTickers = new Set();
    for (const tickers of watchlistMap.values()) for (const t of tickers) allTickers.add(t.toUpperCase());

    // Update rolling buffers for every watched ticker in marketState
    for (const ticker of allTickers) {
      const stock = stocks[ticker];
      if (!stock) continue;
      const chg = (stock.changePct != null ? stock.changePct : stock.changePercent) || 0;
      // Normalize: our change% convention is already a decimal (0.02 = 2%) per momentum detector
      let buf = _tickerChangeHistory.get(ticker);
      if (!buf) { buf = []; _tickerChangeHistory.set(ticker, buf); }
      buf.push(chg);
      while (buf.length > VOL_FLIP_BUFFER_SIZE) buf.shift();
    }

    // Now scan for vol_flip per user+ticker
    for (const [userId, watchlist] of watchlistMap) {
      for (const ticker of watchlist) {
        const key = ticker.toUpperCase();
        const buf = _tickerChangeHistory.get(key);
        if (!buf || buf.length < VOL_FLIP_MIN_SAMPLES) continue;

        const current = buf[buf.length - 1];
        const prior = buf.slice(0, -1); // all but the current
        const priorStd = stdev(prior);
        const absCurrent = Math.abs(current);

        const isCalmPrior = priorStd > 0 && priorStd < VOL_FLIP_CALM_THRESHOLD;
        const breakoutFactor = priorStd > 0 ? absCurrent / priorStd : 0;

        if (
          isCalmPrior &&
          absCurrent >= VOL_FLIP_MIN_ABS_CHANGE &&
          breakoutFactor >= VOL_FLIP_SIGMA_MULT &&
          shouldFireSignal('vol_flip', key)
        ) {
          const direction = current > 0 ? 'up' : 'down';
          const stock = stocks[key] || {};
          const title = `$${key} vol regime flip (${direction} ${(absCurrent * 100).toFixed(2)}%)`;
          const severity = breakoutFactor > 4 ? 'high' : 'medium';
          const context =
            `$${key} was calm (σ ${(priorStd * 100).toFixed(2)}% over last ${prior.length} samples) ` +
            `and just moved ${(absCurrent * 100).toFixed(2)}%, a ${breakoutFactor.toFixed(1)}σ event. ` +
            `Price: $${stock.price != null ? stock.price.toFixed(2) : 'N/A'}.`;

          const insight = await generateSignalInsight(context);
          const signal = {
            type: 'vol_flip',
            ticker: key,
            title,
            severity,
            context,
            insight: insight || `${title}. Prior σ was ${(priorStd * 100).toFixed(2)}%; this is a ${breakoutFactor.toFixed(1)}σ breakout.`,
            metrics: {
              priorStdev: priorStd,
              currentChange: current,
              sigmaMultiple: breakoutFactor,
              samples: prior.length,
            },
          };
          const full = addSignal(userId, signal);
          broadcastSignalToUser(userId, full);
          logger.info('signals', `Vol flip: ${title}`, { userId, severity, sigma: breakoutFactor.toFixed(1) });
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Vol flip detection error', { error: e.message });
  } finally {
    _volFlipRunning = false;
  }
}

// ── Detector 5: Correlation Break ───────────────────────────────────────────
// Ticker decouples from its sector benchmark. Two trigger paths:
//   (a) opposite-signed large combined move
//   (b) ticker magnitude >= 3× benchmark AND ticker |chg| > 2.5%
async function detectCorrelationBreak() {
  if (_corrBreakRunning) return;
  _corrBreakRunning = true;

  try {
    if (!isWeekday() || !_marketState) return;
    const stocks = _marketState.stocks || {};
    const watchlistMap = await getAllUserWatchlists();

    // Load B3 metadata for sector lookups
    let b3Meta = {};
    try {
      b3Meta = require('../data/b3Metadata.json');
      if (b3Meta._schema) delete b3Meta._schema;
    } catch { /* optional */ }

    for (const [userId, watchlist] of watchlistMap) {
      for (const ticker of watchlist) {
        const key = ticker.toUpperCase();
        const stock = stocks[key];
        if (!stock) continue;

        const tickerChg = (stock.changePct != null ? stock.changePct : stock.changePercent) || 0;
        if (Math.abs(tickerChg) < CORR_BREAK_MIN_TICKER_MOVE) continue;

        // Resolve sector → benchmark (fall back to SPY)
        const sector = stock.sector || b3Meta[key.replace(/\.SA$/, '')]?.sector || null;
        const benchmarkSym = (_SECTOR_BENCHMARK[sector] || DEFAULT_BENCHMARK).toUpperCase();
        if (benchmarkSym === key) continue; // don't compare a sector ETF to itself
        const benchmark = stocks[benchmarkSym];
        if (!benchmark) continue;
        const benchChg = (benchmark.changePct != null ? benchmark.changePct : benchmark.changePercent) || 0;

        const combined = Math.abs(tickerChg) + Math.abs(benchChg);
        const sameSign = Math.sign(tickerChg) === Math.sign(benchChg);
        const magRatio = Math.abs(benchChg) > 0.001 ? Math.abs(tickerChg) / Math.abs(benchChg) : Infinity;

        const opposite = !sameSign && combined > CORR_BREAK_OPPOSITE_COMBINED;
        const dwarfs = magRatio >= CORR_BREAK_MAG_RATIO && Math.abs(tickerChg) > CORR_BREAK_MIN_TICKER_MOVE;

        if ((opposite || dwarfs) && shouldFireSignal('correlation_break', key)) {
          const direction = tickerChg > 0 ? 'up' : 'down';
          const benchDir = benchChg > 0 ? 'up' : 'down';
          const title = `$${key} decoupled from ${benchmarkSym}`;
          const severity = combined > 0.06 || magRatio > 5 ? 'high' : 'medium';
          const reason = opposite
            ? `$${key} ${direction} ${(Math.abs(tickerChg) * 100).toFixed(2)}% while ${benchmarkSym} ${benchDir} ${(Math.abs(benchChg) * 100).toFixed(2)}%`
            : `$${key} moved ${(Math.abs(tickerChg) * 100).toFixed(2)}%, ${magRatio.toFixed(1)}× the ${benchmarkSym} move of ${(Math.abs(benchChg) * 100).toFixed(2)}%`;
          const context = `${reason}. Sector: ${sector || 'unknown'}. Benchmark: ${benchmarkSym}. Idiosyncratic move — investigate news / flow / liquidity.`;

          const insight = await generateSignalInsight(context);
          const signal = {
            type: 'correlation_break',
            ticker: key,
            title,
            severity,
            context,
            insight: insight || `${title}. ${reason}.`,
            metrics: {
              tickerChange: tickerChg,
              benchmarkSymbol: benchmarkSym,
              benchmarkChange: benchChg,
              magnitudeRatio: magRatio === Infinity ? null : magRatio,
              oppositeSign: opposite,
            },
          };
          const full = addSignal(userId, signal);
          broadcastSignalToUser(userId, full);
          logger.info('signals', `Correlation break: ${title}`, { userId, severity, benchmark: benchmarkSym });
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Correlation break detection error', { error: e.message });
  } finally {
    _corrBreakRunning = false;
  }
}

// ── Detector 6: News Spike ──────────────────────────────────────────────────
// Ticker moved >3% AND has a material news hit in the last ~60 min. This fuses
// the momentum signal with the news feed, letting the user jump straight from
// "why did X move?" to the headline. Heavily rate-limited because it fires
// news-adapter fetches.
async function detectNewsSpike() {
  if (_newsSpikeRunning) return;
  _newsSpikeRunning = true;

  try {
    if (!isWeekday() || !_marketState) return;
    const stocks = _marketState.stocks || {};
    const watchlistMap = await getAllUserWatchlists();

    let fetchNewsRouted;
    try { ({ fetchNewsRouted } = require('../routes/market/lib/newsRouter')); }
    catch { return; /* newsRouter not available */ }

    for (const [userId, watchlist] of watchlistMap) {
      // Rank this user's tickers by |change| and take the top few
      const ranked = watchlist
        .map(t => {
          const s = stocks[t.toUpperCase()];
          const chg = s ? ((s.changePct != null ? s.changePct : s.changePercent) || 0) : 0;
          return { ticker: t.toUpperCase(), chg, abs: Math.abs(chg), stock: s };
        })
        .filter(x => x.stock && x.abs >= NEWS_SPIKE_MIN_ABS_CHANGE)
        .sort((a, b) => b.abs - a.abs)
        .slice(0, NEWS_SPIKE_TICKERS_PER_TICK);

      for (const entry of ranked) {
        if (!shouldFireSignal('news_spike', entry.ticker)) continue;

        // Fetch recent news for this ticker (≤ 5 items)
        let newsItems = [];
        try {
          const news = await fetchNewsRouted({ ticker: entry.ticker, limit: 5 });
          newsItems = Array.isArray(news?.items) ? news.items : (Array.isArray(news) ? news : []);
        } catch {
          continue;
        }

        const cutoff = Date.now() - NEWS_SPIKE_LOOKBACK_MS;
        const recent = newsItems.filter(n => {
          const ts = n.publishedAt ? new Date(n.publishedAt).getTime() : (n.datetime || n.ts || 0);
          return ts > cutoff;
        });

        if (recent.length === 0) continue;

        const headline = recent[0].title || recent[0].headline || 'news event';
        const source = recent[0].source || recent[0].adapter || '';
        const direction = entry.chg > 0 ? 'up' : 'down';
        const title = `$${entry.ticker} moved ${direction} ${(entry.abs * 100).toFixed(2)}% on news`;
        const severity = entry.abs > 0.06 ? 'high' : 'medium';
        const context = `${title}. Headline: "${String(headline).slice(0, 160)}"${source ? ` [${source}]` : ''}. ${recent.length} relevant item(s) in last hour.`;

        const insight = await generateSignalInsight(context);
        const signal = {
          type: 'news_spike',
          ticker: entry.ticker,
          title,
          severity,
          context,
          insight: insight || `${title}. ${String(headline).slice(0, 140)}`,
          metrics: {
            change: entry.chg,
            newsCount: recent.length,
            topHeadline: String(headline).slice(0, 200),
            topSource: source || null,
          },
        };
        const full = addSignal(userId, signal);
        broadcastSignalToUser(userId, full);
        logger.info('signals', `News spike: ${title}`, { userId, severity });
      }
    }
  } catch (e) {
    logger.error('signals', 'News spike detection error', { error: e.message });
  } finally {
    _newsSpikeRunning = false;
  }
}

function broadcastMarketStatusSignal(status) {
  const title = status === 'open' ? 'US Market Opened' : 'US Market Closed';
  const severity = 'low';
  const context = `US ${status === 'open' ? 'equities market opened' : 'equities market closed'}`;

  // Broadcast to all connected users
  if (_broadcastFn) {
    _broadcastFn({
      type: 'signal',
      data: {
        type: 'market_status',
        status,
        title,
        severity,
        context,
        insight: `${title}. ${status === 'open' ? 'Market ready for trading.' : 'Market closed for the day.'}`,
        timestamp: Date.now(),
      },
    });
  }

  logger.info('signals', `Market status: ${title}`);
}

// ── Helper: Get all user watchlists ─────────────────────────────────────────
async function getAllUserWatchlists() {
  const watchlistMap = new Map();

  if (!_getWatchlists) return watchlistMap;

  try {
    const allWatchlists = await _getWatchlists();

    // Structure: userId → watchlist (which can be array of tickers or object with tickers property)
    for (const [userId, watchlist] of Object.entries(allWatchlists || {})) {
      // Handle both formats: direct array or object with tickers property
      let tickers = [];
      if (Array.isArray(watchlist)) {
        tickers = watchlist.filter(t => t && typeof t === 'string');
      } else if (watchlist && Array.isArray(watchlist.tickers)) {
        tickers = watchlist.tickers.filter(t => t && typeof t === 'string');
      }

      if (tickers.length > 0) {
        watchlistMap.set(userId, tickers);
      }
    }
  } catch (e) {
    logger.warn('signals', 'Failed to fetch watchlists', { error: e.message });
  }

  return watchlistMap;
}

// ── Broadcast signal to user via WS ────────────────────────────────────────
function broadcastSignalToUser(userId, signal) {
  if (!_broadcastFn) return;

  _broadcastFn({
    type: 'signal',
    userId,
    data: signal,
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

function getRecentSignalsForUser(userId, count = 20) {
  return getRecentSignals(userId, count);
}

function getUnreadCountForUser(userId) {
  return getUnreadCount(userId);
}

function getSummary() {
  let totalSignals = 0;
  for (const signals of _userSignals.values()) {
    totalSignals += signals.length;
  }

  return {
    usersTracked: _userSignals.size,
    totalSignals,
    detectorsActive: Object.keys(_timers).length,
  };
}

function resetUserSignals(userId) {
  _userSignals.delete(userId);
}

module.exports = {
  init,
  stop,
  getRecentSignalsForUser,
  getUnreadCountForUser,
  getSummary,
  resetUserSignals,
  // For testing
  shouldFireSignal,
  detectMomentumBreaks,
  detectEarningsAlerts,
  detectMarketStatusChange,
  detectVolFlip,
  detectCorrelationBreak,
  detectNewsSpike,
};
