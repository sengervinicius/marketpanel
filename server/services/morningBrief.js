/**
 * morningBrief.js — Phase 5: Multi-Stage Personalized Morning Brief Pipeline
 *
 * Architecture:
 *   STAGE 1 — Market State Assembly (run at user-configured time, default 06:30 UTC)
 *   STAGE 2 — User Relevance Join (cross-reference portfolio, watchlist, memory)
 *   STAGE 3 — Insight Extraction (score events, detect thesis conflicts, find surprises)
 *   STAGE 4 — Brief Generation (Claude Sonnet, single call)
 *   STAGE 5 — Brief Display (structured card data with action chips)
 *
 * Backward-compatible: preserves all existing exports and API endpoints.
 */

'use strict';

const fetch  = require('node-fetch');
const logger = require('../utils/logger');
const predictionAggregator = require('./predictionAggregator');

// ── Config ──────────────────────────────────────────────────────────────────
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const BRIEF_MODEL    = 'claude-sonnet-4-20250514'; // Phase 5: upgraded from Perplexity sonar
const FALLBACK_MODEL = 'sonar-pro';                // Fallback if no Anthropic key
const TIMEOUT_MS     = 20000;
const BRIEF_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes (was 60 min)
const DEFAULT_BRIEF_HOUR = 6;  // 6:30 UTC default
const DEFAULT_BRIEF_MIN  = 30;
const USER_BRIEF_TTL = 23 * 60 * 60 * 1000; // 23 hours
const ENGAGEMENT_REORDER_DAYS = 14;

// ── State ───────────────────────────────────────────────────────────────────
let _timer        = null;
let _marketState  = null;
let _getUserById  = null;
let _getPortfolio = null;

// Today's shared market snapshot (Stage 1 output)
let _marketSnapshot = null;
let _todayBrief     = null;  // { content, sections, timestamp, date }
let _todayDate      = null;  // 'YYYY-MM-DD'
let _generating     = false;

// Per-user brief cache: userId → { content, sections, timestamp, date, personalized, actionChips }
const _userBriefs = new Map();

// ── Init ────────────────────────────────────────────────────────────────────
function init({ marketState, getUserById, getPortfolio } = {}) {
  _marketState  = marketState;
  _getUserById  = getUserById;
  _getPortfolio = getPortfolio;

  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => checkAndGenerate(), BRIEF_INTERVAL);

  // Check immediately after short delay
  setTimeout(() => checkAndGenerate(), 30_000);
  logger.info('brief', 'Morning Brief pipeline started (Phase 5)');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// ── Time utilities ──────────────────────────────────────────────────────────
function getETTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getUTCTime() {
  return new Date();
}

function getTodayDateStr() {
  const et = getETTime();
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}

function isWeekday() {
  const day = getETTime().getDay();
  return day !== 0 && day !== 6;
}

function getTimeInTimezone(tz = 'America/New_York') {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  } catch {
    return getETTime();
  }
}

/**
 * Check if it's time to generate the brief for a user given their preferred time.
 * User can set their preferred brief time in settings.morningBriefTime (e.g., "06:30").
 * @param {string} userTimezone - IANA timezone
 * @param {string} preferredTime - HH:MM format (default "06:30")
 */
function shouldGenerateForUser(userTimezone = 'America/New_York', preferredTime = '06:30') {
  const local = getTimeInTimezone(userTimezone);
  const h = local.getHours();
  const m = local.getMinutes();

  const [prefH, prefM] = preferredTime.split(':').map(Number);
  const localMins = h * 60 + m;
  const prefMins = prefH * 60 + prefM;

  // Generation window: preferred time to preferred time + 30 min
  return localMins >= prefMins && localMins < prefMins + 30;
}

// ── Auto-generate check ─────────────────────────────────────────────────────
async function checkAndGenerate() {
  if (!isWeekday()) return;

  const today = getTodayDateStr();
  if (_todayDate === today && _todayBrief) return; // Already generated today

  const et = getETTime();
  const h = et.getHours();
  const m = et.getMinutes();

  // Generate after 9:15 AM ET (shared macro brief)
  if (h > 9 || (h === 9 && m >= 15)) {
    await generateSharedBrief();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 1 — Market State Assembly
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Collect overnight index moves, VIX, DXY, FX, crypto, yields,
 * pre-market movers, economic calendar, earnings for the day.
 */
function assembleMarketSnapshot() {
  const snapshot = {
    timestamp: Date.now(),
    date: getTodayDateStr(),
    indices: {},
    vix: null,
    dxy: null,
    fx: {},
    crypto: {},
    yields: {},
    topMovers: [],
    predictions: [],
  };

  if (!_marketState) return snapshot;

  try {
    const stocks = _marketState.stocks || {};

    // Major indices
    const indexSymbols = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', DIA: 'Dow 30', IWM: 'Russell 2000' };
    for (const [sym, label] of Object.entries(indexSymbols)) {
      const d = stocks[sym];
      if (d?.price) {
        snapshot.indices[sym] = {
          label,
          price: d.price,
          change: d.changePercent || 0,
          volume: d.volume || 0,
        };
      }
    }

    // VIX
    const vix = stocks['VIX'] || stocks['UVXY'];
    if (vix?.price) {
      snapshot.vix = { price: vix.price, change: vix.changePercent || 0 };
    }

    // Crypto
    for (const sym of ['BTC', 'ETH', 'BTCUSD', 'ETHUSD']) {
      const d = stocks[sym];
      if (d?.price) {
        const key = sym.replace('USD', '');
        snapshot.crypto[key] = { price: d.price, change: d.changePercent || 0 };
      }
    }

    // Top pre-market movers (from all tracked stocks)
    snapshot.topMovers = Object.entries(stocks)
      .filter(([, d]) => d?.changePercent && Math.abs(d.changePercent) > 2 && d.volume > 100000)
      .sort((a, b) => Math.abs(b[1].changePercent) - Math.abs(a[1].changePercent))
      .slice(0, 10)
      .map(([sym, d]) => ({
        symbol: sym,
        price: d.price,
        change: d.changePercent,
        volume: d.volume,
      }));
  } catch (e) {
    logger.debug('brief', 'Market snapshot assembly partial failure:', e.message);
  }

  // Prediction markets
  try {
    const predictions = predictionAggregator.getTopMarkets?.(8) || [];
    snapshot.predictions = predictions.map(m => ({
      title: m.title,
      probability: m.probability,
      source: m.source,
    }));
  } catch (e) { /* non-critical */ }

  return snapshot;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 2 — User Relevance Join
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cross-reference market snapshot against user's watchlist, portfolio, and memory records.
 * Score each event by "consequence to this user".
 */
async function joinUserRelevance(snapshot, userId) {
  const relevance = {
    watchlistMoves: [],
    portfolioMoves: [],
    memoryConflicts: [],
    topEvents: [],
  };

  try {
    // Get user's portfolio
    const portfolio = _getPortfolio ? await _getPortfolio(userId) : null;
    const portfolioTickers = new Set(
      (portfolio?.positions || []).map(p => (p.ticker || p.symbol || '').toUpperCase()).filter(Boolean)
    );

    // Get user's watchlist from settings
    const user = _getUserById ? await _getUserById(userId) : null;
    const watchlist = new Set(
      (user?.settings?.watchlist || []).map(t => t.toUpperCase())
    );

    // briefPrefs.tickersOfInterest — names the user has flagged for the
    // brief specifically (e.g. "I'd like the brief to keep an eye on
    // $VALE3 and $PBR"). Treated as between watchlist (1x) and
    // portfolio (2x) — they aren't holdings, but they're stronger
    // signal than "happen to be on my watchlist".
    const briefPrefs = user?.settings?.briefPrefs || {};
    const tickersOfInterest = new Set(
      (briefPrefs.tickersOfInterest || []).map(t => String(t).toUpperCase())
    );

    // Score each market mover against user's holdings
    const stocks = _marketState?.stocks || {};
    const allUserTickers = new Set([...portfolioTickers, ...watchlist, ...tickersOfInterest]);

    for (const ticker of allUserTickers) {
      const d = stocks[ticker];
      if (!d?.price) continue;

      const isPortfolio = portfolioTickers.has(ticker);
      const isWatchlist = watchlist.has(ticker);
      const isInterest = tickersOfInterest.has(ticker);
      const changePct = d.changePercent || 0;

      // Score: portfolio 2x, explicit brief interest 1.5x, watchlist 1x
      const weight = isPortfolio ? 2 : (isInterest ? 1.5 : 1);
      const score = Math.abs(changePct) * weight;

      if (score > 0.5) { // Only include meaningful moves
        const source = isPortfolio ? 'portfolio' : (isInterest && !isWatchlist ? 'interest' : 'watchlist');
        const entry = {
          symbol: ticker,
          price: d.price,
          change: changePct,
          source,
          score,
        };

        if (isPortfolio) relevance.portfolioMoves.push(entry);
        else relevance.watchlistMoves.push(entry);
      }
    }

    // Sort by score
    relevance.portfolioMoves.sort((a, b) => b.score - a.score);
    relevance.watchlistMoves.sort((a, b) => b.score - a.score);

    // Phase 5: Check memory records for thesis conflicts
    try {
      const conversationMemory = require('./conversationMemory');
      const records = await conversationMemory.getActive(userId);
      const theses = records.filter(r => r.type === 'thesis');

      for (const thesis of theses) {
        // Check if any thesis-related tickers moved against the thesis
        const thesisTickers = thesis.tickers_mentioned || [];
        for (const ticker of thesisTickers) {
          const d = stocks[ticker];
          if (!d?.changePercent) continue;

          const isBullish = /bull|long|buy|upside|recovery/i.test(thesis.content);
          const isBearish = /bear|short|sell|downside|risk/i.test(thesis.content);
          const moved = d.changePercent;

          if ((isBullish && moved < -1.5) || (isBearish && moved > 1.5)) {
            relevance.memoryConflicts.push({
              thesis: thesis.content,
              ticker,
              move: moved,
              conflict: isBullish ? 'Bullish thesis but stock down' : 'Bearish thesis but stock up',
            });
          }
        }
      }
    } catch { /* conversationMemory not available — skip */ }

    // Combine and rank top events
    relevance.topEvents = [
      ...relevance.portfolioMoves.slice(0, 3),
      ...relevance.watchlistMoves.slice(0, 3),
    ].sort((a, b) => b.score - a.score).slice(0, 5);

  } catch (e) {
    logger.debug('brief', 'User relevance join error:', e.message);
  }

  return relevance;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 3 — Insight Extraction
// ══════════════════════════════════════════════════════════════════════════════

/**
 * From the relevance-scored snapshot, extract:
 * - Top 3 events relevant to user (with specific numbers)
 * - Thesis conflicts (from memory)
 * - One "surprise" (moved against dominant narrative)
 * - 3 follow-up questions
 */
function extractInsights(snapshot, relevance) {
  const insights = {
    topEvents: [],
    thesisConflicts: relevance.memoryConflicts || [],
    surprise: null,
    followUpQuestions: [],
  };

  // Top events with specific numbers
  for (const event of (relevance.topEvents || []).slice(0, 3)) {
    insights.topEvents.push({
      symbol: event.symbol,
      price: event.price,
      change: event.change,
      source: event.source,
      narrative: `$${event.symbol} ${event.change > 0 ? '+' : ''}${event.change.toFixed(2)}% (${event.source})`,
    });
  }

  // Find a "surprise" — top mover that goes against the overall market direction
  const spyChange = snapshot.indices.SPY?.change || 0;
  const marketDirection = spyChange > 0 ? 'up' : 'down';
  const surprise = (snapshot.topMovers || []).find(m => {
    if (marketDirection === 'up' && m.change < -3) return true;
    if (marketDirection === 'down' && m.change > 3) return true;
    return false;
  });
  if (surprise) {
    insights.surprise = {
      symbol: surprise.symbol,
      change: surprise.change,
      narrative: `$${surprise.symbol} moved ${surprise.change > 0 ? '+' : ''}${surprise.change.toFixed(1)}% against the tape`,
    };
  }

  // Generate follow-up questions based on the data
  if (relevance.portfolioMoves.length > 0) {
    const topMover = relevance.portfolioMoves[0];
    const dir = topMover.change > 0 ? 'adding to' : 'reducing';
    insights.followUpQuestions.push(`Should you consider ${dir} $${topMover.symbol}?`);
  }
  if (relevance.watchlistMoves.length > 0) {
    const top = relevance.watchlistMoves[0];
    insights.followUpQuestions.push(`Watch $${top.symbol} at $${top.price.toFixed(2)}`);
  }
  if (insights.thesisConflicts.length > 0) {
    const conflict = insights.thesisConflicts[0];
    insights.followUpQuestions.push(`Revisit your thesis on $${conflict.ticker}?`);
  }
  // Pad to 3 questions
  if (insights.followUpQuestions.length < 3 && snapshot.indices.SPY) {
    insights.followUpQuestions.push(`$SPY setup for today — key levels?`);
  }

  return insights;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 4 — Brief Generation (Claude Sonnet, single call)
// ══════════════════════════════════════════════════════════════════════════════

const BRIEF_SYSTEM_PROMPT_EN = `Generate a pre-market brief in exactly 3 sections. Use markdown headers (###).

### TODAY'S SETUP
2 sentences: market tone + key driver. Include specific index numbers from the data.

### YOUR NAMES
One bullet per relevant position/watchlist item with specific move + context. Use $TICKER format. Bold prices and percentages. Max 5 items.

### WATCH TODAY
3 numbered items: specific levels, events, or catalysts to monitor. Be actionable.

Rules:
- No filler. No generic macro commentary. Use ONLY the data provided.
- Never say "I" or "As an AI"
- Use trader shorthand: bid, offered, vol, carry
- Include specific numbers from the data — never approximate
- Total: 150-250 words max
- Today's date: `;

// Portuguese (pt-BR) variant for users who set briefPrefs.language = 'pt-BR'.
// Kept structurally identical so parseSections() still finds the same headers.
const BRIEF_SYSTEM_PROMPT_PT = `Gere um briefing pré-mercado em exatamente 3 seções. Use cabeçalhos markdown (###).

### TODAY'S SETUP
2 frases: tom de mercado + driver principal. Inclua números específicos de índices dos dados fornecidos.

### YOUR NAMES
Um bullet por posição/watchlist relevante com movimento específico + contexto. Use formato $TICKER. Coloque preços e percentuais em negrito. Máx 5 itens.

### WATCH TODAY
3 itens numerados: níveis, eventos ou catalisadores específicos para acompanhar. Seja acionável.

Regras:
- Sem enrolação. Sem comentário macro genérico. Use APENAS os dados fornecidos.
- Nunca diga "eu" ou "como IA"
- Use jargão de trader: bid, offered, vol, carry
- Inclua números específicos dos dados — nunca aproxime
- Total: 150-250 palavras no máximo
- Mantenha cabeçalhos de seção EM INGLÊS exatamente como acima (o corpo em português)
- Data de hoje: `;

// Back-compat alias — older call sites may still import BRIEF_SYSTEM_PROMPT.
const BRIEF_SYSTEM_PROMPT = BRIEF_SYSTEM_PROMPT_EN;

/**
 * Fold user brief preferences into the system prompt as a PREFERENCES block
 * plus tone / language directives. Returns the system prompt to use for this
 * generation call. Falls back to the English default when no prefs are set.
 */
function applyBriefPrefs(basePromptEn, basePromptPt, briefPrefs, dateStr) {
  const prefs = briefPrefs || {};
  const useSpanish = false; // reserved
  const usePortuguese = prefs.language === 'pt-BR';
  const base = usePortuguese ? basePromptPt : basePromptEn;
  let prompt = base + dateStr;

  const prefLines = [];
  if (Array.isArray(prefs.focusRegions) && prefs.focusRegions.length) {
    prefLines.push(`FOCUS REGIONS: ${prefs.focusRegions.join(', ')} — prioritise names and events from these markets when multiple candidates are equally relevant.`);
  }
  if (Array.isArray(prefs.focusSectors) && prefs.focusSectors.length) {
    prefLines.push(`FOCUS SECTORS: ${prefs.focusSectors.join(', ')}.`);
  }
  if (Array.isArray(prefs.focusThemes) && prefs.focusThemes.length) {
    prefLines.push(`FOCUS THEMES: ${prefs.focusThemes.join(', ')}.`);
  }
  if (Array.isArray(prefs.avoidTopics) && prefs.avoidTopics.length) {
    prefLines.push(`AVOID: do not dedicate bullets or commentary to ${prefs.avoidTopics.join(', ')} unless they are directly moving the user's holdings today.`);
  }

  const toneMap = {
    concise: 'Tone: terse, no hedging, every sentence carries a number or an instruction.',
    detailed: 'Tone: fuller context, 250-350 words, may expand WATCH TODAY to 4-5 items.',
    contrarian: 'Tone: contrarian — surface the consensus view first in one sentence, then argue against it with specific data.',
    institutional: 'Tone: institutional research voice — passive constructions OK, cite levels and basis points, no retail flair.',
  };
  if (prefs.tone && toneMap[prefs.tone]) {
    prefLines.push(toneMap[prefs.tone]);
  }

  if (prefLines.length) {
    prompt += '\n\nUSER PREFERENCES (honour these when they don\'t conflict with the rules above):\n' + prefLines.map(l => `- ${l}`).join('\n');
  }

  if (usePortuguese) {
    prompt += '\n\nIDIOMA: escreva o corpo em português brasileiro. Mantenha os cabeçalhos de seção em inglês.';
  }

  return prompt;
}

async function generateBriefContent(snapshot, relevance, insights, dateStr, briefPrefs) {
  // Build structured context for the AI
  const contextParts = [];

  // Indices
  const indexLines = Object.entries(snapshot.indices)
    .map(([sym, d]) => `$${sym} (${d.label}): $${d.price} ${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}%`)
    .join('\n');
  if (indexLines) contextParts.push(`INDICES:\n${indexLines}`);

  // VIX
  if (snapshot.vix) {
    contextParts.push(`VIX: ${snapshot.vix.price} (${snapshot.vix.change > 0 ? '+' : ''}${snapshot.vix.change.toFixed(2)}%)`);
  }

  // Crypto
  const cryptoLines = Object.entries(snapshot.crypto)
    .map(([sym, d]) => `$${sym}: $${d.price} ${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}%`)
    .join(', ');
  if (cryptoLines) contextParts.push(`CRYPTO: ${cryptoLines}`);

  // Top movers
  if (snapshot.topMovers.length > 0) {
    const movers = snapshot.topMovers.slice(0, 5).map(m =>
      `$${m.symbol} ${m.change > 0 ? '+' : ''}${m.change.toFixed(1)}%`
    ).join(', ');
    contextParts.push(`TOP MOVERS: ${movers}`);
  }

  // Predictions
  if (snapshot.predictions.length > 0) {
    const preds = snapshot.predictions.slice(0, 3).map(p =>
      `${p.title}: ${(p.probability * 100).toFixed(0)}% (${p.source})`
    ).join('\n');
    contextParts.push(`PREDICTION MARKETS:\n${preds}`);
  }

  // User's relevant moves
  if (insights.topEvents.length > 0) {
    contextParts.push(`USER'S RELEVANT MOVES:\n${insights.topEvents.map(e => e.narrative).join('\n')}`);
  }

  // Thesis conflicts
  if (insights.thesisConflicts.length > 0) {
    contextParts.push(`THESIS CONFLICTS:\n${insights.thesisConflicts.map(c => `${c.conflict}: ${c.thesis} but $${c.ticker} is ${c.move > 0 ? '+' : ''}${c.move.toFixed(1)}%`).join('\n')}`);
  }

  // Surprise
  if (insights.surprise) {
    contextParts.push(`SURPRISE: ${insights.surprise.narrative}`);
  }

  const contextStr = contextParts.join('\n\n');
  const fullSystemPrompt = applyBriefPrefs(BRIEF_SYSTEM_PROMPT_EN, BRIEF_SYSTEM_PROMPT_PT, briefPrefs, dateStr);

  // Try Claude Sonnet first, fall back to Perplexity
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;

  if (anthropicKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: BRIEF_MODEL,
          max_tokens: 600,
          system: fullSystemPrompt,
          messages: [{
            role: 'user',
            content: `Generate today's morning brief based on this data:\n\n${contextStr}`,
          }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        return data.content?.[0]?.text?.trim() || null;
      }
    } catch (e) {
      logger.warn('brief', 'Claude brief generation failed, trying Perplexity:', e.message);
    }
  }

  // Fallback to Perplexity
  if (perplexityKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(PERPLEXITY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: FALLBACK_MODEL,
          messages: [
            { role: 'system', content: fullSystemPrompt },
            { role: 'user', content: `Generate today's morning brief:\n\n${contextStr}` },
          ],
          temperature: 0.5,
          max_tokens: 600,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch (e) {
      logger.warn('brief', 'Perplexity brief fallback failed:', e.message);
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// STAGE 5 — Brief Display (structured card data)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Build action chips for the brief card: "Ask about [ticker]", "Analyze [event]", etc.
 */
function buildActionChips(insights) {
  const chips = [];

  for (const event of (insights.topEvents || []).slice(0, 2)) {
    chips.push({
      label: `Ask about $${event.symbol}`,
      action: `analyze ${event.symbol}`,
      type: 'query',
    });
  }

  if (insights.surprise) {
    chips.push({
      label: `Analyze $${insights.surprise.symbol}`,
      action: `why is ${insights.surprise.symbol} ${insights.surprise.change > 0 ? 'up' : 'down'} today?`,
      type: 'query',
    });
  }

  for (const q of (insights.followUpQuestions || []).slice(0, 1)) {
    // Extract ticker from question if present
    const tickerMatch = q.match(/\$([A-Z]{1,5})/);
    if (tickerMatch) {
      chips.push({
        label: q,
        action: q,
        type: 'query',
      });
    }
  }

  return chips.slice(0, 4); // Max 4 chips
}

// ══════════════════════════════════════════════════════════════════════════════
// Main generation flow
// ══════════════════════════════════════════════════════════════════════════════

async function generateSharedBrief() {
  if (_generating) return;
  _generating = true;

  try {
    // STAGE 1: Market state assembly
    _marketSnapshot = assembleMarketSnapshot();
    logger.info('brief', `Stage 1: Market snapshot assembled (${Object.keys(_marketSnapshot.indices).length} indices, ${_marketSnapshot.topMovers.length} movers)`);

    // For the shared brief, we do Stage 4 with snapshot only (no user-specific data)
    const dateStr = getTodayDateStr();
    const emptyRelevance = { watchlistMoves: [], portfolioMoves: [], memoryConflicts: [], topEvents: [] };
    const basicInsights = extractInsights(_marketSnapshot, emptyRelevance);
    const content = await generateBriefContent(_marketSnapshot, emptyRelevance, basicInsights, dateStr);

    if (!content || content.length < 50) {
      logger.warn('brief', 'Brief too short, skipping');
      _generating = false;
      return;
    }

    const sections = parseSections(content);

    _todayBrief = {
      content,
      sections,
      timestamp: Date.now(),
      date: dateStr,
    };
    _todayDate = dateStr;
    _userBriefs.clear();

    logger.info('brief', `Generated morning brief (${content.length} chars)`);
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('brief', 'Generation timed out');
    } else {
      logger.error('brief', 'Generation failed', { error: e.message });
    }
  } finally {
    _generating = false;
  }
}

function parseSections(content) {
  const sections = {};
  const sectionRegex = /###\s*(.+?)(?:\n)([\s\S]*?)(?=###|$)/g;
  let match;
  while ((match = sectionRegex.exec(content)) !== null) {
    const title = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    sections[title] = match[2].trim();
  }
  return sections;
}

// ── Per-user brief (runs Stages 2-5 on top of shared Stage 1 snapshot) ──────
async function getUserBrief(userId) {
  // #213 FIX — previously this early-returned null whenever _todayBrief and
  // _marketSnapshot were both empty. That made the 06:30-local dispatcher
  // path fail for every US/BR/EU/UK user, because the shared brief is gated
  // behind 09:15 ET and pre-9:15 ET the two in-memory caches are empty.
  // We now proceed and assemble a snapshot on-demand further down; the
  // shared brief is separately ensured via ensureTodayBrief() by the
  // dispatcher before this function is called.

  // Check cache
  const cached = _userBriefs.get(userId);
  if (cached && cached.date === _todayDate && (Date.now() - cached.timestamp) < USER_BRIEF_TTL) {
    return cached;
  }

  try {
    const snapshot = _marketSnapshot || assembleMarketSnapshot();
    const dateStr = getTodayDateStr();

    // STAGE 2: User relevance join
    const relevance = await joinUserRelevance(snapshot, userId);
    logger.debug('brief', `Stage 2: Relevance join for user ${userId}: ${relevance.portfolioMoves.length} portfolio, ${relevance.watchlistMoves.length} watchlist`);

    // STAGE 3: Insight extraction
    const insights = extractInsights(snapshot, relevance);

    // Pull user's brief preferences so Stage 4 can apply tone/language/focus.
    const user = _getUserById ? await _getUserById(userId) : null;
    const briefPrefs = user?.settings?.briefPrefs || null;

    // STAGE 4: Generate personalized brief (or augment shared brief)
    let content;
    const hasPersonalData =
      relevance.portfolioMoves.length > 0 ||
      relevance.watchlistMoves.length > 0 ||
      relevance.memoryConflicts.length > 0 ||
      !!(briefPrefs && Object.keys(briefPrefs).length);

    if (hasPersonalData) {
      // Generate a fully personalized brief
      content = await generateBriefContent(snapshot, relevance, insights, dateStr, briefPrefs);
    }

    // Fall back to shared brief if personalization fails or no personal data.
    if (!content || content.length < 50) {
      content = _todayBrief?.content || null;
    }

    // #213 FIX — if we STILL have no content (new user with no prefs, before
    // the 9:15 ET shared brief was generated), synthesize one now from the
    // on-demand market snapshot. Without this, default-settings users whose
    // preferred 06:30 window fires pre-9:15 ET get nothing in their inbox,
    // which is the incident that kicked #213.
    if (!content || content.length < 50) {
      try {
        content = await generateBriefContent(snapshot, relevance, insights, dateStr, briefPrefs);
      } catch (e) {
        logger.warn('brief', 'on-demand fallback generation failed', { userId, error: e.message });
      }
    }

    if (!content) return _todayBrief ? { ..._todayBrief, userId, personalized: false } : null;

    const sections = parseSections(content);

    // STAGE 5: Build display data
    const actionChips = buildActionChips(insights);

    // Vault enrichment (from existing logic)
    try {
      const vault = require('./vault');
      const behaviorTracker = require('./behaviorTracker');
      const profile = await behaviorTracker.getCachedProfile(userId).catch(() => null);

      const portfolio = _getPortfolio ? await _getPortfolio(userId) : null;
      const topTickers = (portfolio?.positions || []).slice(0, 5).map(p => p.ticker || p.symbol).filter(Boolean);
      const topTopics = profile?.topTopics || [];
      const vaultQuery = [...topTickers.map(t => `$${t}`), ...topTopics.slice(0, 3)].join(' ') || 'market outlook';

      if (vaultQuery.trim()) {
        const passages = await vault.retrieve(userId, vaultQuery, 3);
        if (passages && passages.length > 0) {
          const vaultInsight = passages
            .map(p => {
              const src = p.doc_metadata?.bank || p.filename || 'Research';
              return `[${src}] ${p.content.slice(0, 200)}`;
            })
            .join('\n');
          sections.research_insights = `Relevant from your research vault:\n${vaultInsight}`;
        }
      }
    } catch { /* Vault not available */ }

    // Portfolio section
    try {
      const portfolio = _getPortfolio ? await _getPortfolio(userId) : null;
      if (portfolio) {
        const portfolioSection = formatPortfolioSection(portfolio);
        if (portfolioSection) sections.your_positions = portfolioSection;
      }
    } catch { /* non-critical */ }

    // Adaptive section ordering
    try {
      const user = _getUserById ? await _getUserById(userId) : null;
      const userProfile = user?.settings?.interests || {};
      if (userProfile.lastComputed &&
          (Date.now() - userProfile.lastComputed) < ENGAGEMENT_REORDER_DAYS * 86400000) {
        const engagementRates = {
          what_to_watch_today: userProfile.topics?.earnings || 0.5,
          watch_today: userProfile.topics?.earnings || 0.5,
          prediction_markets: userProfile.topics?.prediction || 0.4,
          the_take: 0.6,
          todays_setup: 0.8,
          your_names: 0.9,
          your_positions: userProfile.sectors?.us_equities || 0.7,
        };
        sections._ordered = orderSections(sections, engagementRates);
      }
    } catch { /* non-critical */ }

    // Reconstruct content from sections
    const reconstructedContent = Object.entries(sections)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        const title = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return `### ${title}\n${value}`;
      })
      .join('\n\n');

    const brief = {
      content: reconstructedContent,
      sections,
      timestamp: Date.now(),
      date: _todayDate || dateStr,
      userId,
      personalized: hasPersonalData,
      actionChips,
      relevantCount: insights.topEvents.length,
    };

    _userBriefs.set(userId, brief);
    return brief;
  } catch (e) {
    logger.error('brief', `getUserBrief failed for user ${userId}`, { error: e.message });
    return _todayBrief ? { ..._todayBrief, userId, personalized: false } : null;
  }
}

// ── Helper functions ────────────────────────────────────────────────────────

function formatPortfolioSection(portfolio) {
  if (!portfolio?.positions?.length) return null;

  const positions = portfolio.positions
    .filter(p => p?.ticker)
    .slice(0, 8)
    .map(p => {
      const chg = p.changePercent
        ? `${p.changePercent > 0 ? '+' : ''}${p.changePercent.toFixed(2)}%`
        : 'no data';
      const size = p.quantity ? ` (${p.quantity} shares)` : '';
      return `$${p.ticker}: ${chg}${size}`;
    })
    .join(', ');

  return `Your overnight portfolio moves: ${positions}. Monitor these for any significant gaps.`;
}

function orderSections(sections, engagementRates = {}) {
  if (!sections || Object.keys(sections).length === 0) return sections;

  const ordered = {};
  // Keep setup/overnight first
  for (const anchor of ["todays_setup", 'market_overnight']) {
    if (sections[anchor]) {
      ordered[anchor] = sections[anchor];
    }
  }

  const anchorKeys = new Set(["todays_setup", 'market_overnight']);
  const remaining = Object.entries(sections)
    .filter(([key]) => !anchorKeys.has(key) && !key.startsWith('_'))
    .sort((a, b) => (engagementRates[b[0]] || 0) - (engagementRates[a[0]] || 0));

  for (const [key, content] of remaining) {
    ordered[key] = content;
  }

  return ordered;
}

// ── Public API ──────────────────────────────────────────────────────────────

function getSharedBrief() { return _todayBrief; }

function hasTodayBrief() {
  return _todayDate === getTodayDateStr() && _todayBrief !== null;
}

async function forceGenerate() {
  _todayBrief = null;
  _todayDate = null;
  _generating = false;
  await generateSharedBrief();
  return _todayBrief;
}

/**
 * #213 — ensureTodayBrief()
 *
 * If today's shared brief hasn't been generated yet, generate it now —
 * UNCONDITIONALLY of the 09:15 ET gate that `checkAndGenerate()` enforces.
 *
 * The morningBriefDispatcher fires inside each user's local send window
 * (default 06:30 in their timezone). For US/BR/EU/UK timezones that window
 * is strictly BEFORE 09:15 ET, so the auto-generator won't have produced
 * the shared brief yet. Before the fix, the dispatcher called getUserBrief,
 * which short-circuited and returned null, and the user saw "No morning
 * briefs yet" indefinitely.
 *
 * Safe to call concurrently or repeatedly — `generateSharedBrief` respects
 * an in-flight flag. No-ops when today's brief already exists.
 */
async function ensureTodayBrief() {
  if (hasTodayBrief()) return _todayBrief;
  await generateSharedBrief();
  return _todayBrief;
}

function getSummary() {
  return {
    hasBrief: !!_todayBrief,
    briefDate: _todayDate,
    briefLength: _todayBrief?.content?.length || 0,
    cachedUsers: _userBriefs.size,
    isWeekday: isWeekday(),
    hasSnapshot: !!_marketSnapshot,
  };
}

function shouldGenerateBriefForUser(userId, userProfile = {}) {
  return isWeekday() && hasTodayBrief();
}

/**
 * Contextual greeting using live market data.
 * Returns a 2-3 sentence brief.
 */
async function getContextualGreeting(userId = null) {
  const et = getETTime();
  const h = et.getHours();
  const timeOfDay = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';

  try {
    const { getEffectiveMarketState } = require('./marketContextBuilder');
    const { state: ms } = getEffectiveMarketState();

    const parts = [];

    if (ms?.stocks) {
      const spy = ms.stocks['SPY'];
      const qqq = ms.stocks['QQQ'];
      if (spy?.price && spy?.changePercent != null) {
        const dir = spy.changePercent >= 0 ? '+' : '';
        parts.push(`**$SPY** ${dir}${spy.changePercent.toFixed(1)}%`);
      }
      if (qqq?.price && qqq?.changePercent != null) {
        const dir = qqq.changePercent >= 0 ? '+' : '';
        parts.push(`**$QQQ** ${dir}${qqq.changePercent.toFixed(1)}%`);
      }
    }

    let portfolioPart = '';
    if (userId) {
      try {
        const portfolioStore = require('../portfolioStore');
        const portfolio = portfolioStore.getPortfolio(userId);
        if (portfolio?.positions?.length > 0 && _marketState?.stocks) {
          let totalVal = 0, totalCost = 0;
          for (const pos of portfolio.positions) {
            const d = _marketState.stocks[pos.symbol];
            const price = d?.price || pos.currentPrice || 0;
            totalVal += price * (pos.quantity || 0);
            totalCost += (pos.entryPrice || 0) * (pos.quantity || 0);
          }
          if (totalCost > 0) {
            const pnlPct = ((totalVal - totalCost) / totalCost * 100);
            const dir = pnlPct >= 0 ? '+' : '';
            portfolioPart = `Your portfolio is ${dir}${pnlPct.toFixed(1)}%.`;
          }
        }
      } catch { /* non-critical */ }
    }

    if (parts.length > 0) {
      const indexLine = `Good ${timeOfDay}. ${parts.join(', ')}.`;
      const greeting = portfolioPart ? `${indexLine} ${portfolioPart}` : indexLine;
      return { greeting, hasBrief: hasTodayBrief() };
    }
  } catch { /* Fall through */ }

  return {
    greeting: `Good ${timeOfDay}. Markets are loading — ask me anything.`,
    hasBrief: hasTodayBrief(),
  };
}

module.exports = {
  init,
  stop,
  getSharedBrief,
  getUserBrief,
  hasTodayBrief,
  forceGenerate,
  ensureTodayBrief,
  getSummary,
  shouldGenerateBriefForUser,
  shouldGenerateForUser,
  orderSections,
  getContextualGreeting,
  // Phase 5 internals for testing
  assembleMarketSnapshot,
  joinUserRelevance,
  extractInsights,
  buildActionChips,
  applyBriefPrefs,
};
