/**
 * wireGenerator.js — "The Wire": Proactive AI Market Commentary
 *
 * Wave 8A — Generates short, sharp market commentary every 7 minutes during
 * market hours. Shared across all users (not per-user). Uses Perplexity Sonar
 * for real-time market awareness, kept cheap via Haiku-style brevity.
 *
 * Architecture:
 *   - Cron loop runs every WIRE_INTERVAL_MS (7 min) during market hours
 *   - Pulls data from MarketContextBuilder + PredictionAggregator
 *   - Generates 2–3 sentence commentary via Perplexity
 *   - Stores in PostgreSQL wire_entries table (falls back to in-memory ring buffer)
 *   - Exposes getLatest() / getRecent() for Particle screen & Wire panel
 */

'use strict';

const fetch  = require('node-fetch');
const logger = require('../utils/logger');
const db     = require('../db/postgres');
const predictionAggregator = require('./predictionAggregator');

// ── Config ──────────────────────────────────────────────────────────────────
const WIRE_INTERVAL_MS  = 7 * 60 * 1000; // 7 minutes
const MAX_MEMORY_ENTRIES = 100;           // in-memory fallback ring buffer
const PERPLEXITY_URL     = 'https://api.perplexity.ai/chat/completions';
const MODEL              = 'sonar';       // cheaper model for Wire (not sonar-pro)
const TIMEOUT_MS         = 12000;

// ── State ───────────────────────────────────────────────────────────────────
let _timer        = null;
let _running      = false;
let _memoryBuffer = [];         // fallback when no Postgres
let _marketState  = null;       // late-bound via init()
let _lastGenAt    = 0;

// ── Market hours check (US Eastern) ─────────────────────────────────────────
function isMarketHours() {
  const now = new Date();
  // Convert to ET
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  // Pre-market 8:00 AM to post-market 6:00 PM ET
  return mins >= 480 && mins <= 1080;
}

// ── Initialise ──────────────────────────────────────────────────────────────
function init({ marketState } = {}) {
  _marketState = marketState;

  // Ensure DB table exists (non-blocking, Postgres may not be available)
  ensureTable().catch(() => {});

  // Start the cron loop
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => tick(), WIRE_INTERVAL_MS);

  // Generate first entry after short delay
  setTimeout(() => tick(), 15_000);
  logger.info('wire', `Wire generator started (interval ${WIRE_INTERVAL_MS / 1000}s)`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  logger.info('wire', 'Wire generator stopped');
}

// ── DB helpers ──────────────────────────────────────────────────────────────
async function ensureTable() {
  if (!db.isConnected()) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS wire_entries (
      id          SERIAL PRIMARY KEY,
      content     TEXT NOT NULL,
      tickers     TEXT[] DEFAULT '{}',
      category    TEXT DEFAULT 'market',
      mood        TEXT DEFAULT 'neutral',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_wire_created ON wire_entries (created_at DESC);
  `);
}

async function storeEntry(entry) {
  // Always store in memory buffer
  _memoryBuffer.unshift(entry);
  if (_memoryBuffer.length > MAX_MEMORY_ENTRIES) _memoryBuffer.pop();

  // Try Postgres
  if (db.isConnected()) {
    try {
      await db.query(
        `INSERT INTO wire_entries (content, tickers, category, mood, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [entry.content, entry.tickers || [], entry.category || 'market', entry.mood || 'neutral']
      );
    } catch (e) {
      logger.error('wire', 'DB insert failed', { error: e.message });
    }
  }
}

// ── Core tick: generate a Wire entry ────────────────────────────────────────
async function tick() {
  // Only generate during market hours (or if forced)
  if (!isMarketHours()) {
    return;
  }

  if (_running) return; // prevent overlap
  _running = true;

  try {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      logger.warn('wire', 'PERPLEXITY_API_KEY not set — Wire disabled');
      _running = false;
      return;
    }

    // Build context from live data
    const context = buildWireContext();

    const systemPrompt = `You are The Wire — a real-time market commentary feed for a professional market terminal called "Particle".

Your job: write a single, punchy market commentary entry (2-3 sentences max, ~40-60 words).

Style rules:
- Sound like a senior market analyst's running desk commentary
- Lead with the most notable move or shift RIGHT NOW
- Include specific numbers (%, $, bps) when available
- Mention 1-2 tickers when relevant (use $TICKER format)
- End with a forward-looking observation or what to watch
- Vary your sentence structure — don't start every entry the same way
- No greetings, no "currently", no "as of now"
- Be opinionated but factual

Categories (pick the most fitting):
- macro: Fed, rates, inflation, economic data
- sector: sector rotation, industry moves
- earnings: earnings surprises, guidance
- crypto: Bitcoin, ETH, major crypto moves
- geopolitics: trade war, sanctions, global events
- momentum: unusual volume, breakouts, technical moves
- prediction: prediction market shifts

Also extract:
- tickers: array of 0-3 ticker symbols mentioned (e.g. ["AAPL", "NVDA"])
- mood: one of "bullish", "bearish", "volatile", "cautious", "neutral"

Respond ONLY with valid JSON: {"content": "...", "tickers": [...], "category": "...", "mood": "..."}`;

    const userMessage = `Here's the current market snapshot. Write a Wire entry based on the most notable thing happening right now.

${context}

Remember: respond ONLY with valid JSON.`;

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
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.error('wire', `Perplexity ${resp.status}`, { body: text.slice(0, 200) });
      _running = false;
      return;
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      logger.warn('wire', 'Empty response from Perplexity');
      _running = false;
      return;
    }

    // Parse JSON response
    let entry;
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      entry = JSON.parse(cleaned);
    } catch (parseErr) {
      // Fallback: treat raw as plain text
      entry = { content: raw.slice(0, 300), tickers: [], category: 'market', mood: 'neutral' };
    }

    if (!entry.content || entry.content.length < 10) {
      logger.warn('wire', 'Wire entry too short, skipping');
      _running = false;
      return;
    }

    entry.timestamp = Date.now();
    await storeEntry(entry);
    _lastGenAt = Date.now();

    logger.info('wire', `Generated: ${entry.content.slice(0, 80)}…`);
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('wire', 'Generation timed out');
    } else {
      logger.error('wire', 'Generation failed', { error: e.message });
    }
  } finally {
    _running = false;
  }
}

// ── Build context string for the AI ─────────────────────────────────────────
function buildWireContext() {
  const parts = [];

  // Market state data
  if (_marketState) {
    try {
      const stocks = _marketState.stocks || {};

      // Major indices
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

      // Find top movers from all stocks
      const movers = Object.entries(stocks)
        .filter(([, d]) => d && d.changePercent && Math.abs(d.changePercent) > 2 && d.volume > 500000)
        .sort((a, b) => Math.abs(b[1].changePercent) - Math.abs(a[1].changePercent))
        .slice(0, 5)
        .map(([sym, d]) => `${sym} ${d.changePercent > 0 ? '+' : ''}${d.changePercent.toFixed(1)}%`);
      if (movers.length) parts.push(`Top movers: ${movers.join(', ')}`);
    } catch (e) {
      // Non-critical
    }
  }

  // Prediction market data
  try {
    const predictions = predictionAggregator.getTopMarkets?.(5) || [];
    if (predictions.length) {
      const predLines = predictions.map(m =>
        `${m.title}: ${(m.probability * 100).toFixed(0)}%`
      ).join(' | ');
      parts.push(`Prediction markets: ${predLines}`);
    }
  } catch (e) {
    // Non-critical
  }

  // Previous Wire entries (for variety)
  const recent = _memoryBuffer.slice(0, 3);
  if (recent.length) {
    parts.push(`Recent Wire entries (avoid repeating): ${recent.map(e => e.content.slice(0, 60)).join(' | ')}`);
  }

  return parts.join('\n\n') || 'No live data available. Generate a general market awareness commentary.';
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Get the most recent Wire entry */
function getLatest() {
  return _memoryBuffer[0] || null;
}

/** Get recent entries (most recent first) */
function getRecent(limit = 20) {
  return _memoryBuffer.slice(0, limit);
}

/** Get entries from Postgres (async, with offset/limit) */
async function getFromDB(limit = 30, offset = 0) {
  if (!db.isConnected()) return getRecent(limit);
  try {
    const result = await db.query(
      `SELECT id, content, tickers, category, mood, created_at
       FROM wire_entries ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return (result?.rows || []).map(r => ({
      id: r.id,
      content: r.content,
      tickers: r.tickers || [],
      category: r.category,
      mood: r.mood,
      timestamp: new Date(r.created_at).getTime(),
    }));
  } catch (e) {
    logger.error('wire', 'DB read failed', { error: e.message });
    return getRecent(limit);
  }
}

/** Force generate a Wire entry (for testing / manual trigger) */
async function forceGenerate() {
  _running = false; // reset lock
  await tick();
  return getLatest();
}

function getSummary() {
  return {
    entriesInMemory: _memoryBuffer.length,
    lastGeneratedAt: _lastGenAt ? new Date(_lastGenAt).toISOString() : null,
    isMarketHours: isMarketHours(),
    intervalMs: WIRE_INTERVAL_MS,
  };
}

module.exports = {
  init,
  stop,
  getLatest,
  getRecent,
  getFromDB,
  forceGenerate,
  getSummary,
};
