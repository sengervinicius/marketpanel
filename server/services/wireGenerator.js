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
const MODEL              = 'sonar-pro';   // Phase 4: upgraded for higher-quality Wire output
const TIMEOUT_MS         = 12000;

// ── State ───────────────────────────────────────────────────────────────────
let _timer        = null;
let _running      = false;
let _memoryBuffer = [];         // fallback when no Postgres
let _marketState  = null;       // late-bound via init()
let _lastGenAt    = 0;

// Phase 5: Deduplication — track last 5 entries + market state snapshots
const _recentSnapshots = [];    // [{indexSnapshot, dominantTopic, timestamp}]
const DEDUP_THRESHOLD  = 0.3;   // % index move required to consider "different"
const DEDUP_WINDOW     = 5;     // number of recent entries to check

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

// ── Phase 5: Deduplication check ────────────────────────────────────────────
/**
 * Check if current market conditions are significantly different from recent Wire entries.
 * Returns true if we should generate (conditions are different), false to skip.
 */
function shouldGenerate() {
  if (_recentSnapshots.length === 0) return true; // No history, always generate

  // Get current index levels
  const currentSnapshot = _getIndexSnapshot();
  if (!currentSnapshot) return true; // No data, generate anyway

  // Check if any major index moved > DEDUP_THRESHOLD % since last entry
  const lastSnapshot = _recentSnapshots[0];
  if (!lastSnapshot.indexSnapshot) return true;

  let significantMove = false;
  for (const [sym, current] of Object.entries(currentSnapshot)) {
    const prev = lastSnapshot.indexSnapshot[sym];
    if (prev && current) {
      const pctDiff = Math.abs(current - prev);
      if (pctDiff > DEDUP_THRESHOLD) {
        significantMove = true;
        break;
      }
    }
  }

  // Also check: has the dominant topic changed?
  const currentTopics = _getDominantTopics();
  const lastTopics = lastSnapshot.dominantTopics || [];
  const topicChanged = currentTopics.length > 0 && lastTopics.length > 0 &&
                       currentTopics[0] !== lastTopics[0];

  if (significantMove || topicChanged) return true;

  logger.debug('wire', 'Dedup: skipping generation — market conditions unchanged');
  return false;
}

function _getIndexSnapshot() {
  if (!_marketState?.stocks) return null;
  const stocks = _marketState.stocks;
  const snapshot = {};
  for (const sym of ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX']) {
    const d = stocks[sym];
    if (d?.changePercent != null) {
      snapshot[sym] = d.changePercent;
    }
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function _getDominantTopics() {
  // Determine dominant topic from top movers
  if (!_marketState?.stocks) return [];
  const stocks = _marketState.stocks;
  const movers = Object.entries(stocks)
    .filter(([, d]) => d?.changePercent && Math.abs(d.changePercent) > 2)
    .sort((a, b) => Math.abs(b[1].changePercent) - Math.abs(a[1].changePercent))
    .slice(0, 3)
    .map(([sym]) => sym);
  return movers;
}

function _recordSnapshot(entry) {
  _recentSnapshots.unshift({
    indexSnapshot: _getIndexSnapshot(),
    dominantTopics: _getDominantTopics(),
    category: entry?.category || 'market',
    timestamp: Date.now(),
  });
  // Keep only last DEDUP_WINDOW snapshots
  if (_recentSnapshots.length > DEDUP_WINDOW) {
    _recentSnapshots.length = DEDUP_WINDOW;
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
    // Phase 5: Deduplication check
    if (!shouldGenerate()) {
      _running = false;
      return;
    }

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      logger.warn('wire', 'PERPLEXITY_API_KEY not set — Wire disabled');
      _running = false;
      return;
    }

    // Build context from live data
    const context = buildWireContext();

    const systemPrompt = `Generate a 2-sentence market update in the style of a Reuters or Bloomberg wire headline. Max 40 words. Use $TICKER format. Include one specific number (price, %, bps). No filler, no "currently", no greetings. Lead with the most notable move. End with what to watch next.

Categories (pick most fitting): macro, sector, earnings, crypto, geopolitics, momentum, prediction

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

    // Phase 5: Record market snapshot for dedup comparison
    _recordSnapshot(entry);

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
