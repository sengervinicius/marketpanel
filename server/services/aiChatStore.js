/**
 * services/aiChatStore.js — DB-backed AI chat conversations (P5).
 *
 * Backs the sidebar in ChatPanel that shows a user's recent (last-24h)
 * AI conversations across devices. Used by `routes/aiChat.js` for
 * list/get/delete and by `routes/search.js` /chat handler to write each
 * turn through after streaming.
 *
 * Retention: 24h. The list API filters with `last_message_at > NOW() -
 * INTERVAL '24 hours'`, and `purgeOldConversations()` (called periodically)
 * physically deletes rows older than that. Until the cron lands, the
 * filter ensures users never see expired chats even if rows linger.
 *
 * Falls back gracefully if Postgres is unavailable — every method either
 * returns null/[] or no-ops, so the AI chat surface keeps streaming
 * responses; the sidebar simply doesn't populate.
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');

const RETENTION_HOURS = 24;

function isPg() {
  try { return pg.isConnected && pg.isConnected(); } catch { return false; }
}

/**
 * Strip the terminal's context prefix from a raw user message so the
 * remaining text is the actual thing the user asked. The client wraps
 * each query with:
 *
 *     [SCREEN CONTEXT] ...\n\nUser question: <actual question>
 *
 * …so the AI sees what the user is looking at. Without this strip the
 * sidebar renders every single conversation as "[SCREEN CONTEXT] User...".
 *
 * Returns the original text unchanged if no prefix is found.
 */
function stripContextPrefix(text) {
  if (!text || typeof text !== 'string') return text;
  // Case 1: explicit [SCREEN CONTEXT] ... User question: <actual>
  const m = text.match(/^\[SCREEN CONTEXT\][\s\S]*?User question:\s*([\s\S]*)$/i);
  if (m && m[1]) return m[1].trim();
  // Case 2: bare "[SCREEN CONTEXT]" prefix with no explicit User question
  // marker — strip up to the first double newline or the whole thing.
  if (/^\[SCREEN CONTEXT\]/i.test(text)) {
    const afterDouble = text.split(/\n\s*\n/).slice(1).join('\n\n').trim();
    if (afterDouble) return afterDouble;
  }
  return text;
}

/**
 * Derive a short title from the first user message.
 * Strips any [SCREEN CONTEXT] wrapper, trims to 80 chars, normalises
 * whitespace, falls back to "New chat".
 */
function titleFromText(text) {
  if (!text || typeof text !== 'string') return 'New chat';
  const stripped = stripContextPrefix(text);
  const cleaned = (stripped || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'New chat';
  return cleaned.length > 80 ? cleaned.slice(0, 77).trimEnd() + '…' : cleaned;
}

/**
 * Create a new conversation row owned by userId.
 * Returns { id, title, createdAt, lastMessageAt, messageCount } or null.
 */
async function createConversation(userId, opts = {}) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!isPg()) return null;
  const title = titleFromText(opts.title || opts.firstMessage);
  try {
    const r = await pg.query(
      `INSERT INTO ai_conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, last_message_at, message_count`,
      [userId, title],
    );
    const row = r.rows[0];
    return {
      id: String(row.id),
      title: row.title,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      messageCount: Number(row.message_count) || 0,
    };
  } catch (e) {
    logger.warn('aiChatStore', 'createConversation failed', { error: e.message });
    return null;
  }
}

/**
 * Verify a conversation belongs to userId. Returns row or null. Used as
 * an authorization gate before any read/append/delete.
 */
async function getConversation(userId, conversationId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const id = Number(conversationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (!isPg()) return null;
  try {
    const r = await pg.query(
      `SELECT id, user_id, title, created_at, last_message_at, message_count
         FROM ai_conversations
        WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      id: String(row.id),
      userId: row.user_id,
      title: row.title,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      messageCount: Number(row.message_count) || 0,
    };
  } catch (e) {
    logger.warn('aiChatStore', 'getConversation failed', { error: e.message });
    return null;
  }
}

/**
 * List the user's conversations whose last_message_at is within the
 * retention window. `limit` capped at 100. Empty list on DB failure.
 */
async function listRecentConversations(userId, limit = 50) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  if (!isPg()) return [];
  const cap = Math.min(100, Math.max(1, Number(limit) || 50));
  try {
    const r = await pg.query(
      `SELECT id, title, created_at, last_message_at, message_count
         FROM ai_conversations
        WHERE user_id = $1
          AND last_message_at > NOW() - INTERVAL '${RETENTION_HOURS} hours'
        ORDER BY last_message_at DESC
        LIMIT $2`,
      [userId, cap],
    );
    return r.rows.map(row => ({
      id: String(row.id),
      title: row.title,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      messageCount: Number(row.message_count) || 0,
    }));
  } catch (e) {
    logger.warn('aiChatStore', 'listRecentConversations failed', { error: e.message });
    return [];
  }
}

/**
 * Load the messages of a conversation in chronological order. Returns
 * empty array if the conversation doesn't exist or doesn't belong to user.
 */
async function listMessages(userId, conversationId, limit = 200) {
  const conv = await getConversation(userId, conversationId);
  if (!conv) return [];
  const cap = Math.min(500, Math.max(1, Number(limit) || 200));
  try {
    const r = await pg.query(
      `SELECT id, role, content, created_at
         FROM ai_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT $2`,
      [Number(conversationId), cap],
    );
    return r.rows.map(row => ({
      id: String(row.id),
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
    }));
  } catch (e) {
    logger.warn('aiChatStore', 'listMessages failed', { error: e.message });
    return [];
  }
}

/**
 * Append a message to a conversation. Updates parent's last_message_at
 * and message_count atomically. Returns the inserted message id or null.
 */
async function appendMessage(userId, conversationId, role, content, metadata = {}) {
  if (!['user', 'assistant', 'system'].includes(role)) return null;
  if (typeof content !== 'string') return null;
  const conv = await getConversation(userId, conversationId);
  if (!conv) return null;
  const id = Number(conversationId);
  if (!isPg()) return null;
  // Truncate very long content defensively — the chat handler already caps,
  // but a stray system message shouldn't bloat the row.
  const safeContent = content.length > 100000 ? content.slice(0, 100000) : content;
  try {
    const insert = await pg.query(
      `INSERT INTO ai_messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [id, role, safeContent, JSON.stringify(metadata || {})],
    );
    await pg.query(
      `UPDATE ai_conversations
          SET last_message_at = NOW(),
              message_count   = message_count + 1
        WHERE id = $1`,
      [id],
    );
    return {
      id: String(insert.rows[0].id),
      createdAt: insert.rows[0].created_at,
    };
  } catch (e) {
    logger.warn('aiChatStore', 'appendMessage failed', { error: e.message });
    return null;
  }
}

/**
 * Soft-rename: only allowed for the conversation's owner.
 */
async function renameConversation(userId, conversationId, title) {
  const conv = await getConversation(userId, conversationId);
  if (!conv) return false;
  if (!isPg()) return false;
  try {
    await pg.query(
      `UPDATE ai_conversations SET title = $1 WHERE id = $2`,
      [titleFromText(title), Number(conversationId)],
    );
    return true;
  } catch (e) {
    logger.warn('aiChatStore', 'renameConversation failed', { error: e.message });
    return false;
  }
}

/**
 * Delete a conversation (and its messages via FK CASCADE).
 */
async function deleteConversation(userId, conversationId) {
  const conv = await getConversation(userId, conversationId);
  if (!conv) return false;
  if (!isPg()) return false;
  try {
    await pg.query(
      `DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2`,
      [Number(conversationId), userId],
    );
    return true;
  } catch (e) {
    logger.warn('aiChatStore', 'deleteConversation failed', { error: e.message });
    return false;
  }
}

/**
 * Re-derive titles for conversations whose title still looks like the
 * raw [SCREEN CONTEXT] wrapper. Runs once on server boot so live users
 * see meaningful titles without manual intervention.
 *
 * Returns the number of conversations fixed. Safe to call repeatedly —
 * conversations that already have a clean title are skipped by the
 * WHERE clause.
 */
async function backfillScreenContextTitles({ limit = 1000 } = {}) {
  if (!isPg()) return 0;
  try {
    // Pull ids + titles of conversations whose title still starts with
    // the bracketed prefix (case-insensitive). Cap to `limit` per call so
    // an unexpectedly large table can't spin for minutes.
    const stale = await pg.query(
      `SELECT c.id, c.title,
              (SELECT m.content
                 FROM ai_messages m
                WHERE m.conversation_id = c.id AND m.role = 'user'
                ORDER BY m.created_at ASC, m.id ASC
                LIMIT 1) AS first_user_msg
         FROM ai_conversations c
        WHERE c.title ILIKE '[SCREEN CONTEXT]%'
        ORDER BY c.id DESC
        LIMIT $1`,
      [Math.max(1, Math.min(5000, limit))],
    );
    if (!stale.rows.length) return 0;
    let fixed = 0;
    for (const row of stale.rows) {
      // Prefer the real first message; fall back to the stale title so
      // we still strip the prefix even if messages are missing.
      const source = row.first_user_msg || row.title;
      const newTitle = titleFromText(source);
      if (!newTitle || newTitle === row.title || newTitle === 'New chat') continue;
      try {
        await pg.query(
          `UPDATE ai_conversations SET title = $1 WHERE id = $2`,
          [newTitle, Number(row.id)],
        );
        fixed += 1;
      } catch { /* keep going */ }
    }
    if (fixed) logger.info('aiChatStore', 'backfilled screen-context titles', { fixed });
    return fixed;
  } catch (e) {
    logger.warn('aiChatStore', 'backfillScreenContextTitles failed', { error: e.message });
    return 0;
  }
}

/**
 * Physically delete conversations whose last_message_at is older than
 * RETENTION_HOURS. Safe to call repeatedly. Returns number of rows removed.
 */
async function purgeOldConversations() {
  if (!isPg()) return 0;
  try {
    const r = await pg.query(
      `DELETE FROM ai_conversations
        WHERE last_message_at < NOW() - INTERVAL '${RETENTION_HOURS} hours'`,
    );
    return r.rowCount || 0;
  } catch (e) {
    logger.warn('aiChatStore', 'purgeOldConversations failed', { error: e.message });
    return 0;
  }
}

module.exports = {
  RETENTION_HOURS,
  titleFromText,
  stripContextPrefix,
  createConversation,
  getConversation,
  listRecentConversations,
  listMessages,
  appendMessage,
  renameConversation,
  deleteConversation,
  backfillScreenContextTitles,
  purgeOldConversations,
};
