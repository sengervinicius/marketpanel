/**
 * morningBrief.js — Daily Morning Intelligence Brief
 *
 * Wave 8B — Generates a personalized daily market brief at market open.
 * Shared macro section generated once, personalized watchlist sections per user.
 *
 * Architecture:
 *   - Shared macro brief generated at ~9:15 AM ET (15 min after open)
 *   - Per-user personalization layered on top (portfolio positions, brazil context)
 *   - Per-user section ordering based on 14+ days of engagement data
 *   - Cached for the day (regenerates next morning)
 *   - Falls back to shared brief if personalization fails
 */

'use strict';

const fetch  = require('node-fetch');
const logger = require('../utils/logger');
const predictionAggregator = require('./predictionAggregator');

// ── Config ──────────────────────────────────────────────────────────────────
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const MODEL          = 'sonar';
const TIMEOUT_MS     = 20000;
const BRIEF_INTERVAL = 60 * 60 * 1000; // Check every hour
const MORNING_HOUR   = 9;  // 9 AM ET
const MORNING_MIN    = 15; // 9:15 AM ET
const USER_BRIEF_TTL = 23 * 60 * 60 * 1000; // 23 hours
const ENGAGEMENT_REORDER_DAYS = 14; // Days of data needed for adaptive ordering
const BRIEF_GENERATION_HOUR = 6; // 6:30 AM user local time
const BRIEF_GENERATION_MIN = 30;

// ── State ───────────────────────────────────────────────────────────────────
let _timer        = null;
let _marketState  = null;
let _getUserById  = null;
let _getPortfolio = null;

// Today's shared macro brief
let _todayBrief   = null;  // { content, sections, timestamp, date }
let _todayDate    = null;  // 'YYYY-MM-DD'
let _generating   = false;

// Per-user brief cache: userId → { content, sections, timestamp, date, personalized }
const _userBriefs = new Map();

// ── Init ────────────────────────────────────────────────────────────────────
function init({ marketState, getUserById, getPortfolio } = {}) {
  _marketState  = marketState;
  _getUserById  = getUserById;
  _getPortfolio = getPortfolio;

  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => checkAndGenerate(), BRIEF_INTERVAL);

  // Check immediately
  setTimeout(() => checkAndGenerate(), 30_000);
  logger.info('brief', 'Morning Brief service started');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// ── Time check ──────────────────────────────────────────────────────────────
function getETTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTodayDateStr() {
  const et = getETTime();
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}

function isWeekday() {
  const day = getETTime().getDay();
  return day !== 0 && day !== 6;
}

async function checkAndGenerate() {
  if (!isWeekday()) return;

  const today = getTodayDateStr();
  if (_todayDate === today && _todayBrief) return; // Already generated today

  const et = getETTime();
  const h = et.getHours();
  const m = et.getMinutes();

  // Generate after 9:15 AM ET
  if (h > MORNING_HOUR || (h === MORNING_HOUR && m >= MORNING_MIN)) {
    await generateSharedBrief();
  }
}

// ── Shared macro brief ──────────────────────────────────────────────────────
async function generateSharedBrief() {
  if (_generating) return;
  _generating = true;

  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      logger.warn('brief', 'PERPLEXITY_API_KEY not set');
      _generating = false;
      return;
    }

    const context = buildBriefContext();

    const systemPrompt = `You are Particle's Morning Intelligence Brief — a concise daily market overview for professional traders and investors.

Write a structured morning brief with these exact sections (use markdown headers):

### Market Overnight
2-3 sentences on how markets closed yesterday and what happened overnight (Asia/Europe session).

### What to Watch Today
3-4 bullet points of the most important events, data releases, or earnings today.

### Prediction Markets
2-3 sentences on the most notable prediction market moves (probability shifts on rates, inflation, geopolitical events).

### The Take
1-2 sentences with your overall read on the day. Opinionated but measured.

Rules:
- Write in prose paragraphs, not bullet points
- Write like a trusted colleague drafting a morning memo
- Be direct and specific
- Total length: 200-300 words max
- Use $TICKER format for stocks
- Include specific numbers and percentages
- Sound like a veteran market strategist
- Be actionable — what should traders pay attention to?
- No greetings or sign-offs
- Today's date: ${getTodayDateStr()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate today's morning brief based on this market context:\n\n${context}` },
        ],
        temperature: 0.5,
        max_tokens: 600,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.error('brief', `Perplexity ${resp.status}`, { body: text.slice(0, 200) });
      _generating = false;
      return;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content || content.length < 50) {
      logger.warn('brief', 'Brief too short, skipping');
      _generating = false;
      return;
    }

    // Parse sections
    const sections = parseSections(content);

    _todayBrief = {
      content,
      sections,
      timestamp: Date.now(),
      date: getTodayDateStr(),
    };
    _todayDate = getTodayDateStr();
    _userBriefs.clear(); // Clear per-user cache for new day

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

// ── Build context ───────────────────────────────────────────────────────────
function buildBriefContext(extras = {}) {
  const parts = [];

  if (_marketState) {
    try {
      const stocks = _marketState.stocks || {};
      const indices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];
      const idxLines = indices
        .map(sym => {
          const d = stocks[sym];
          if (!d || !d.price) return null;
          const chg = d.changePercent ? `${d.changePercent > 0 ? '+' : ''}${d.changePercent.toFixed(2)}%` : '';
          return `${sym}: $${d.price} ${chg}`;
        })
        .filter(Boolean);
      if (idxLines.length) parts.push(`Indices: ${idxLines.join(' | ')}`);

      // Additional tickers from user's portfolio
      if (extras.portfolioTickers && extras.portfolioTickers.length > 0) {
        const posLines = extras.portfolioTickers
          .map(sym => {
            const d = stocks[sym] || stocks[sym.toUpperCase()];
            if (!d || !d.price) return null;
            const chg = d.changePct ?? d.changePercent;
            const chgStr = chg != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%` : '';
            return `$${sym}: $${d.price} ${chgStr}`;
          })
          .filter(Boolean);
        if (posLines.length) parts.push(`User portfolio prices:\n${posLines.join('\n')}`);
      }
    } catch (e) { /* non-critical */ }
  }

  try {
    const predictions = predictionAggregator.getTopMarkets?.(8) || [];
    if (predictions.length) {
      const predLines = predictions.map(m =>
        `${m.title}: ${(m.probability * 100).toFixed(0)}% (${m.source})`
      ).join('\n');
      parts.push(`Prediction Markets:\n${predLines}`);
    }
  } catch (e) { /* non-critical */ }

  // Vault context: central research vault passages relevant to user's sectors
  if (extras.vaultContext) {
    parts.push(extras.vaultContext);
  }

  // Behavioral context: user interests and engagement patterns
  if (extras.behaviorContext) {
    parts.push(extras.behaviorContext);
  }

  return parts.join('\n\n') || 'Generate a morning brief based on current market conditions.';
}

// ── Timezone utilities ─────────────────────────────────────────────────────
/**
 * Get time in a user's timezone
 * @param {string} userTimezone - IANA timezone (e.g., 'America/New_York', 'America/Sao_Paulo')
 * @returns {Date} local time in user's timezone
 */
function getTimeInTimezone(userTimezone = 'America/New_York') {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: userTimezone }));
  } catch (e) {
    // Fallback to ET if timezone is invalid
    return getETTime();
  }
}

/**
 * Check if it's 6:30 AM in the user's timezone (brief generation window)
 * @param {string} userTimezone - IANA timezone
 * @returns {boolean}
 */
function shouldGenerateForUser(userTimezone = 'America/New_York') {
  const local = getTimeInTimezone(userTimezone);
  const h = local.getHours();
  const m = local.getMinutes();
  // Generate window: 6:30 AM - 7:00 AM in user's timezone
  return (h === BRIEF_GENERATION_HOUR && m >= BRIEF_GENERATION_MIN) ||
         (h === BRIEF_GENERATION_HOUR + 1 && m < 1);
}

// ── Portfolio & personalization helpers ────────────────────────────────────
/**
 * Format portfolio positions for brief
 */
function formatPortfolioSection(portfolio) {
  if (!portfolio || !portfolio.positions || portfolio.positions.length === 0) {
    return null;
  }

  const positions = portfolio.positions
    .filter(p => p && p.ticker)
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

/**
 * Build Brazil brief if applicable
 */
function buildBrazilSection() {
  // This would normally pull from _marketState
  // For now, return a template that can be filled by AI
  return `Brazil market context: BRL/USD movement, IBOV performance, Selic rate implications, and key B3 movers for the session.`;
}

/**
 * Reorder sections based on engagement data
 * Keep "Market Overnight" first, then sort rest by engagement
 */
function orderSections(sections, engagementRates = {}) {
  if (!sections || Object.keys(sections).length === 0) return sections;

  // Define ordering preference: always keep market_overnight first
  const ordered = {};
  const anchorKey = 'market_overnight';

  if (sections[anchorKey]) {
    ordered[anchorKey] = sections[anchorKey];
  }

  // Sort remaining sections by engagement rate (highest first)
  const remaining = Object.entries(sections)
    .filter(([key]) => key !== anchorKey)
    .sort((a, b) => {
      const rateA = engagementRates[a[0]] || 0;
      const rateB = engagementRates[b[0]] || 0;
      return rateB - rateA;
    });

  for (const [key, content] of remaining) {
    ordered[key] = content;
  }

  return ordered;
}

// ── Per-user brief (adds portfolio & personalization) ─────────────────────────────────
/**
 * Get per-user brief with personalized sections
 * Takes the shared brief base and adds:
 *  - Your Positions section (portfolio overnight changes with live prices)
 *  - Vault Insights section (relevant central + private vault context)
 *  - Brazil Brief section (if user has brazil exposure)
 *  - Reorders sections based on engagement data (if 14+ days of data)
 */
async function getUserBrief(userId) {
  if (!_todayBrief) return null;

  // Check cache
  const cached = _userBriefs.get(userId);
  if (cached && cached.date === _todayDate && (Date.now() - cached.timestamp) < USER_BRIEF_TTL) {
    return cached;
  }

  try {
    // Start with shared brief base
    let sections = { ...(_todayBrief.sections || {}) };
    let content = _todayBrief.content;
    let personalized = false;

    // Fetch user profile and portfolio
    const user = _getUserById ? await _getUserById(userId) : null;
    const portfolio = _getPortfolio ? await _getPortfolio(userId) : null;
    const userProfile = user?.settings?.interests || {};

    // ── Vault enrichment: pull relevant passages from central + private vault ──
    try {
      const vault = require('./vault');
      const behaviorTracker = require('./behaviorTracker');
      const profile = await behaviorTracker.getCachedProfile(userId).catch(() => null);

      // Build a query from user's top interests and portfolio tickers
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
          personalized = true;
        }
      }
    } catch (e) {
      // Vault not available — continue without it
    }

    // Add "Your Positions" section
    if (portfolio) {
      const portfolioSection = formatPortfolioSection(portfolio);
      if (portfolioSection) {
        sections.your_positions = portfolioSection;
        personalized = true;
      }
    }

    // Add "Brazil Brief" section if user has brazil exposure
    const hasBrazilExposure = userProfile.sectors?.brazil > 0.3 ||
                             (portfolio?.positions || []).some(p =>
                               p.ticker && (p.ticker.includes('SA') ||
                                           ['EWZ', 'VALE', 'PBR', 'ITUB'].includes(p.ticker))
                             );
    if (hasBrazilExposure) {
      sections.brazil_brief = buildBrazilSection();
      personalized = true;
    }

    // Adaptive section ordering: if 14+ days of engagement data, reorder by engagement
    if (userProfile.lastComputed &&
        (Date.now() - userProfile.lastComputed) < ENGAGEMENT_REORDER_DAYS * 86400000) {
      const engagementRates = {
        what_to_watch_today: userProfile.topics?.earnings || 0.5,
        prediction_markets: userProfile.topics?.prediction || 0.4,
        the_take: 0.6, // The Take is always important
        your_positions: userProfile.sectors?.us_equities || 0.7,
        brazil_brief: userProfile.sectors?.brazil || 0.3,
      };
      sections = orderSections(sections, engagementRates);
    } else {
      // Default ordering without engagement data
      sections = orderSections(sections);
    }

    // Reconstruct content from reordered sections
    const reconstructedContent = Object.entries(sections)
      .map(([key, value]) => {
        const title = key
          .split('_')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        return `### ${title}\n${value}`;
      })
      .join('\n\n');

    const brief = {
      content: reconstructedContent,
      sections,
      timestamp: Date.now(),
      date: _todayDate,
      userId,
      personalized,
    };

    _userBriefs.set(userId, brief);
    return brief;
  } catch (e) {
    logger.error('brief', `getUserBrief failed for user ${userId}`, { error: e.message });
    // Fallback to shared brief on error
    return {
      ..._todayBrief,
      userId,
      personalized: false,
    };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

function getSharedBrief() {
  return _todayBrief;
}

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

function getSummary() {
  return {
    hasBrief: !!_todayBrief,
    briefDate: _todayDate,
    briefLength: _todayBrief?.content?.length || 0,
    cachedUsers: _userBriefs.size,
    isWeekday: isWeekday(),
  };
}

/**
 * Check if it's time to generate brief for a given user.
 * Currently uses shared brief generation (9:15 AM ET),
 * but can be extended to per-user timezones.
 * TODO: Implement per-user timezone scheduling in Wave 9
 *   - Call shouldGenerateForUser(userId, userProfile.timezone) per user
 *   - Trigger per-user brief generation at 6:30 AM in their timezone
 */
function shouldGenerateBriefForUser(userId, userProfile = {}) {
  // For now, use shared ET-based generation
  // Future: add userProfile.timezone and call shouldGenerateForUser(userProfile.timezone)
  return isWeekday() && hasTodayBrief();
}

module.exports = {
  init,
  stop,
  getSharedBrief,
  getUserBrief,
  hasTodayBrief,
  forceGenerate,
  getSummary,
  shouldGenerateBriefForUser,
  shouldGenerateForUser,
  orderSections,
};
