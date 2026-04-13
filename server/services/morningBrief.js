/**
 * morningBrief.js — Daily Morning Intelligence Brief
 *
 * Wave 8B — Generates a personalized daily market brief at market open.
 * Shared macro section generated once, personalized watchlist sections per user.
 *
 * Architecture:
 *   - Shared macro brief generated at ~9:15 AM ET (15 min after open)
 *   - Per-user personalization layered on top (watchlist, portfolio context)
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

// ── State ───────────────────────────────────────────────────────────────────
let _timer        = null;
let _marketState  = null;
let _getUserById  = null;
let _getPortfolio = null;

// Today's shared macro brief
let _todayBrief   = null;  // { content, sections, timestamp, date }
let _todayDate    = null;  // 'YYYY-MM-DD'
let _generating   = false;

// Per-user brief cache: userId → { content, timestamp }
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
function buildBriefContext() {
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

  return parts.join('\n\n') || 'Generate a morning brief based on current market conditions.';
}

// ── Per-user brief (adds watchlist context) ─────────────────────────────────
async function getUserBrief(userId) {
  if (!_todayBrief) return null;

  // Check cache
  const cached = _userBriefs.get(userId);
  if (cached && cached.date === _todayDate) return cached;

  // For now, return the shared brief (personalization in future wave)
  // TODO: Layer watchlist/portfolio context
  const brief = {
    ..._todayBrief,
    userId,
    personalized: false,
  };

  _userBriefs.set(userId, { ...brief, date: _todayDate });
  return brief;
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

module.exports = {
  init,
  stop,
  getSharedBrief,
  getUserBrief,
  hasTodayBrief,
  forceGenerate,
  getSummary,
};
