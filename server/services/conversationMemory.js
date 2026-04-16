/**
 * services/conversationMemory.js — Phase 5: Typed Conversation Memory
 *
 * Replaces the flat rolling-window message array with structured, typed
 * memory records. Each record has a type, TTL, and extracted tickers so
 * Claude gets focused, relevant context rather than the full chat log.
 *
 * Memory types and TTL rules:
 *   topic         (current discussion focus):           2 hours
 *   entity_focus  (user is analyzing NVDA right now):   4 hours
 *   thesis        (user investment view on a sector):  48 hours
 *   constraint    (user said "don't recommend X"):    168 hours (1 week)
 *   preference    (user likes counter-thesis framing): 720 hours (30 days)
 *   followup      (open question from prior message):   1 hour
 *
 * Dual-mode: Postgres when available, in-memory fallback otherwise.
 */

'use strict';

const fetch = require('node-fetch');
const db    = require('../db/postgres');
const logger = require('../utils/logger');

// ── TTL rules by memory type (hours) ──────────────────────────────────────
const TTL_MAP = {
  topic:        2,
  entity_focus: 4,
  thesis:       48,
  constraint:   168,   // 1 week
  preference:   720,   // 30 days
  followup:     1,
};

// ── In-memory fallback store: userId → record[] ───────────────────────────
const _memStore = new Map();
const MAX_MEMORY_RECORDS = 50; // per user, in-memory mode

// ── Ensure DB table exists ────────────────────────────────────────────────
async function ensureTable() {
  if (!db.isConnected()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversation_memory (
        id                SERIAL PRIMARY KEY,
        user_id           INTEGER NOT NULL,
        session_id        TEXT NOT NULL,
        type              VARCHAR(20) NOT NULL,
        content           TEXT NOT NULL,
        tickers_mentioned TEXT[] DEFAULT '{}',
        ttl_hours         INTEGER NOT NULL DEFAULT 2,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
      );
      CREATE INDEX IF NOT EXISTS idx_conv_memory_user_active
        ON conversation_memory(user_id, expires_at) WHERE expires_at > NOW();
    `);
  } catch (e) {
    logger.warn('[ConvMemory] Table creation failed (non-critical):', e.message);
  }
}

// ── Extract ticker symbols from text ──────────────────────────────────────
function extractTickers(text) {
  if (!text) return [];
  const matches = text.match(/\$([A-Z]{1,5})\b/g) || [];
  const camelCase = text.match(/\b([A-Z]{1,5})\b/g) || [];
  const combined = new Set([
    ...matches.map(m => m.replace('$', '')),
    ...camelCase.filter(t => t.length >= 2 && t.length <= 5),
  ]);
  // Filter out common English words that look like tickers
  const excludes = new Set(['THE','AND','FOR','NOT','BUT','ARE','WAS','HAS','HAD','HIS','HER',
    'ITS','CAN','DID','GET','GOT','HAS','HIM','HOW','LET','MAY','NEW','NOW','OLD','OUR',
    'OUT','OWN','SAY','SHE','TOO','USE','DAD','MOM','WAY','WHO','BOY','DID','ALL','SET',
    'TOP','RUN','ANY','YET','YOU','WILL','WITH','WHAT','THIS','THAT','FROM','THEY','BEEN',
    'HAVE','MOST','JUST','OVER','SUCH','ALSO','BACK','INTO','THAN','THEM','VERY','WHEN',
    'SOME','MADE','LIKE','LONG','LOOK','MANY','THEN','COME','SAME','TELL','DOES','EACH',
    'GOOD','TAKE','MUCH','MAX','MIN','AVG','LOW','HIGH','PUT','CALL','BUY','SELL']);
  return [...combined].filter(t => !excludes.has(t));
}

// ── Store a memory record ─────────────────────────────────────────────────
async function store(userId, sessionId, type, content, tickers = null) {
  if (!userId || !content) return;

  const ttlHours = TTL_MAP[type] || 2;
  const tickersMentioned = tickers || extractTickers(content);

  if (db.isConnected()) {
    try {
      await db.query(
        `INSERT INTO conversation_memory
           (user_id, session_id, type, content, tickers_mentioned, ttl_hours, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($6 || ' hours')::INTERVAL)`,
        [userId, sessionId, type, content, tickersMentioned, ttlHours]
      );
      return;
    } catch (e) {
      logger.debug('[ConvMemory] DB insert failed, using in-memory:', e.message);
    }
  }

  // In-memory fallback
  if (!_memStore.has(userId)) _memStore.set(userId, []);
  const records = _memStore.get(userId);
  records.push({
    id: Date.now(),
    user_id: userId,
    session_id: sessionId,
    type,
    content,
    tickers_mentioned: tickersMentioned,
    ttl_hours: ttlHours,
    created_at: new Date(),
    expires_at: new Date(Date.now() + ttlHours * 3600000),
  });
  // Trim to limit
  if (records.length > MAX_MEMORY_RECORDS) {
    records.splice(0, records.length - MAX_MEMORY_RECORDS);
  }
}

// ── Retrieve active (non-expired) records for a user ──────────────────────
async function getActive(userId) {
  if (!userId) return [];

  if (db.isConnected()) {
    try {
      const result = await db.query(
        `SELECT id, session_id, type, content, tickers_mentioned, created_at
         FROM conversation_memory
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 30`,
        [userId]
      );
      return result?.rows || [];
    } catch (e) {
      logger.debug('[ConvMemory] DB read failed, using in-memory:', e.message);
    }
  }

  // In-memory fallback
  const records = _memStore.get(userId) || [];
  const now = new Date();
  return records
    .filter(r => r.expires_at > now)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 30);
}

// ── Get records for a specific session ────────────────────────────────────
async function getSessionRecords(userId, sessionId) {
  if (!userId || !sessionId) return [];

  if (db.isConnected()) {
    try {
      const result = await db.query(
        `SELECT id, type, content, tickers_mentioned, created_at
         FROM conversation_memory
         WHERE user_id = $1 AND session_id = $2 AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [userId, sessionId]
      );
      return result?.rows || [];
    } catch (e) {
      logger.debug('[ConvMemory] Session read failed:', e.message);
    }
  }

  const records = _memStore.get(userId) || [];
  const now = new Date();
  return records
    .filter(r => r.session_id === sessionId && r.expires_at > now)
    .sort((a, b) => b.created_at - a.created_at);
}

// ── Format active records into a structured context string ────────────────
async function formatContext(userId) {
  const records = await getActive(userId);
  if (records.length === 0) return '';

  // Group by type for structured output
  const grouped = {};
  for (const r of records) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type].push(r);
  }

  const parts = ['[CONVERSATION MEMORY]'];

  // Current focus
  if (grouped.topic) {
    parts.push('Current focus: ' + grouped.topic.map(r => r.content).join('; '));
  }

  // Active entities
  if (grouped.entity_focus) {
    const tickers = new Set();
    grouped.entity_focus.forEach(r => {
      (r.tickers_mentioned || []).forEach(t => tickers.add(t));
      parts.push('Analyzing: ' + r.content);
    });
    if (tickers.size > 0) {
      parts.push('Active tickers: ' + [...tickers].map(t => `$${t}`).join(', '));
    }
  }

  // Standing theses
  if (grouped.thesis) {
    parts.push('User theses: ' + grouped.thesis.map(r => r.content).join('; '));
  }

  // Constraints
  if (grouped.constraint) {
    parts.push('Constraints: ' + grouped.constraint.map(r => r.content).join('; '));
  }

  // Preferences
  if (grouped.preference) {
    parts.push('Preferences: ' + grouped.preference.map(r => r.content).join('; '));
  }

  // Open followups
  if (grouped.followup) {
    parts.push('Open threads: ' + grouped.followup.map(r => r.content).join('; '));
  }

  return parts.join('\n');
}

// ── Extract typed memories from a conversation turn using Haiku ───────────
async function extractFromTurn(userId, sessionId, userMessage, aiResponse) {
  if (!userId || !userMessage) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const prompt = `Extract structured conversation memories from this exchange. Return ONLY a JSON array of objects. Each object must have:
- "type": one of "topic", "entity_focus", "thesis", "constraint", "preference", "followup"
- "content": concise description (max 50 words)

Type definitions:
- topic: current discussion focus (e.g., "Discussing NVDA earnings impact on AI sector")
- entity_focus: specific ticker being analyzed (e.g., "Analyzing $NVDA post-earnings")
- thesis: investment view expressed (e.g., "Bearish on Chinese tech due to regulatory risk")
- constraint: explicit preference NOT to do something (e.g., "No small-cap recommendations")
- preference: analysis style preference (e.g., "Prefers counter-thesis framing")
- followup: open question that wasn't fully answered (e.g., "Wants to know NVDA support levels")

User: ${userMessage.slice(0, 500)}
${aiResponse ? `Assistant: ${aiResponse.slice(0, 500)}` : ''}

Return: [{"type":"...","content":"..."}] — return [] if nothing to extract.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return;

    const data = await response.json();
    const text = data.content?.[0]?.text?.trim() || '[]';

    let memories;
    try {
      memories = JSON.parse(text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, ''));
      if (!Array.isArray(memories)) return;
    } catch {
      return;
    }

    // Store each extracted memory
    for (const mem of memories) {
      if (!mem.type || !mem.content) continue;
      if (!TTL_MAP[mem.type]) continue; // validate type
      await store(userId, sessionId, mem.type, mem.content);
    }

    if (memories.length > 0) {
      logger.debug(`[ConvMemory] Extracted ${memories.length} records from turn`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      logger.debug('[ConvMemory] Extraction error:', e.message);
    }
  }
}

// ── Expire records by type (used during session switches) ─────────────────
async function expireByType(userId, types) {
  if (!userId || !types || types.length === 0) return;

  if (db.isConnected()) {
    try {
      await db.query(
        `UPDATE conversation_memory
         SET expires_at = NOW()
         WHERE user_id = $1 AND type = ANY($2) AND expires_at > NOW()`,
        [userId, types]
      );
      return;
    } catch (e) {
      logger.debug('[ConvMemory] Expire failed:', e.message);
    }
  }

  // In-memory fallback
  const records = _memStore.get(userId);
  if (!records) return;
  const now = new Date();
  for (const r of records) {
    if (types.includes(r.type) && r.expires_at > now) {
      r.expires_at = now;
    }
  }
}

// ── Cleanup expired records ───────────────────────────────────────────────
async function cleanup() {
  if (db.isConnected()) {
    try {
      const result = await db.query(
        `DELETE FROM conversation_memory WHERE expires_at < NOW()`
      );
      if (result?.rowCount > 0) {
        logger.debug(`[ConvMemory] Cleaned up ${result.rowCount} expired records`);
      }
    } catch (e) {
      logger.debug('[ConvMemory] Cleanup failed:', e.message);
    }
  }

  // In-memory cleanup
  for (const [userId, records] of _memStore.entries()) {
    const now = new Date();
    const active = records.filter(r => r.expires_at > now);
    if (active.length < records.length) {
      _memStore.set(userId, active);
    }
  }
}

// ── Start cleanup timer ───────────────────────────────────────────────────
function startCleanupTimer() {
  // Run cleanup every 15 minutes
  setInterval(() => cleanup().catch(() => {}), 15 * 60 * 1000);
  logger.info('[ConvMemory] Cleanup timer started');
}

// ── Diagnostics ───────────────────────────────────────────────────────────
function getDiagnostics() {
  return {
    inMemoryUsers: _memStore.size,
    inMemoryRecords: [..._memStore.values()].reduce((sum, r) => sum + r.length, 0),
    dbConnected: db.isConnected(),
  };
}

module.exports = {
  ensureTable,
  store,
  getActive,
  getSessionRecords,
  formatContext,
  extractFromTurn,
  expireByType,
  cleanup,
  startCleanupTimer,
  getDiagnostics,
  extractTickers,
  TTL_MAP,
};
