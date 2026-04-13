/**
 * services/memoryManager.js — Two-Tier Memory Architecture for Particle
 *
 * Tier 1: In-Session Working Memory (Server-Side)
 *   - In-memory Map keyed by userId
 *   - Rolling window: keep last 12,000 tokens
 *   - Auto-expire sessions after 2 hours of inactivity
 *
 * Tier 2: Cross-Session Persistent Memory (Postgres)
 *   - Extracts factual items, preferences, positions, theses
 *   - Non-blocking (fire-and-forget) memory extraction
 *   - Memory decay: below 0.3 confidence after 30 days, deleted
 */

'use strict';

const fetch = require('node-fetch');
const db = require('../db/postgres');
const logger = require('../utils/logger');

// In-memory session store: userId → { messages, summary, lastActive, totalTokens }
const SESSION_STORE = new Map();
const MAX_SESSION_TOKENS = 12000; // Rolling window size
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes

/**
 * Estimate tokens using simple heuristic: ~4 chars per token
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Format session memory as a string for injection into system prompt
 */
function formatSessionMemory(session) {
  if (!session.summary && (!session.messages || session.messages.length === 0)) {
    return '';
  }

  const parts = [];
  if (session.summary) {
    parts.push(`[Previous conversation context: ${session.summary}]`);
  }
  if (session.messages && session.messages.length > 0) {
    const recentContext = session.messages
      .slice(-5) // Last 5 messages for immediate context
      .map(m => `${m.role === 'user' ? 'User' : 'Particle'}: ${m.content.slice(0, 100)}...`)
      .join('\n');
    if (recentContext) {
      parts.push(`[Recent messages:\n${recentContext}]`);
    }
  }

  return parts.join('\n');
}

/**
 * Get or initialize session memory for a user
 */
function getSessionMemory(userId) {
  if (!userId) return null;

  let session = SESSION_STORE.get(userId);
  if (!session) {
    session = {
      messages: [],
      summary: '',
      lastActive: Date.now(),
      totalTokens: 0,
    };
    SESSION_STORE.set(userId, session);
  }

  session.lastActive = Date.now();
  return session;
}

/**
 * Add a message to session memory and manage rolling window
 */
async function addMessageToSession(userId, role, content) {
  if (!userId) return;

  const session = getSessionMemory(userId);
  const tokens = estimateTokens(content);

  session.messages.push({ role, content, timestamp: Date.now() });
  session.totalTokens += tokens;

  // If we exceed the rolling window, compress older messages
  if (session.totalTokens > MAX_SESSION_TOKENS) {
    await _compressSessionMemory(userId, session);
  }
}

/**
 * Compress older messages into a summary when rolling window is exceeded
 */
async function _compressSessionMemory(userId, session) {
  if (!session.messages || session.messages.length < 5) {
    return; // Not enough messages to summarize
  }

  // Take oldest messages that are outside the token window
  const messagesToCompress = [];
  let tokensKept = 0;

  // Keep the last N messages that fit within MAX_SESSION_TOKENS
  const recentMessages = [];
  let tokenSum = 0;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i];
    const msgTokens = estimateTokens(msg.content);
    if (tokenSum + msgTokens <= MAX_SESSION_TOKENS) {
      recentMessages.unshift(msg);
      tokenSum += msgTokens;
    } else {
      messagesToCompress.unshift(msg);
    }
  }

  if (messagesToCompress.length === 0) {
    return; // No compression needed
  }

  // Call Haiku to summarize the compressed messages
  try {
    const conversationText = messagesToCompress
      .map(m => `${m.role === 'user' ? 'User' : 'Particle'}: ${m.content}`)
      .join('\n\n');

    const summarized = await _callSummarizationModel(conversationText);

    // Update session state
    session.messages = recentMessages;
    session.summary = summarized;
    session.totalTokens = tokenSum + estimateTokens(summarized);
  } catch (err) {
    logger.warn('[MemoryManager] Summarization failed, keeping original messages:', err.message);
    // Gracefully degrade: just truncate if summarization fails
    session.messages = recentMessages;
    session.totalTokens = tokenSum;
  }
}

/**
 * Call Claude Haiku to summarize conversation
 */
async function _callSummarizationModel(conversationText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: 'You are a concise memory summarizer. Summarize the conversation focusing on key points, user preferences, and any financial positions or views discussed. Be very concise.',
      messages: [
        {
          role: 'user',
          content: `Summarize this conversation:\n\n${conversationText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Haiku API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const summary = data.content?.[0]?.text || '';
  return summary.trim();
}

/**
 * Extract new factual memories from a conversation turn
 * Fire-and-forget: non-blocking memory extraction
 */
function extractMemoriesAsync(userId, userMessage, aiResponse) {
  if (!userId || !userMessage) return;

  // Fire off async memory extraction without awaiting
  _extractMemoriesImpl(userId, userMessage, aiResponse).catch(err => {
    logger.warn('[MemoryManager] Memory extraction failed (non-blocking):', err.message);
  });
}

/**
 * Internal: Extract memories by calling Haiku
 */
async function _extractMemoriesImpl(userId, userMessage, aiResponse) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const prompt = `Extract any new factual memories from this conversation turn. Format as JSON array: [{"type": "fact"|"preference"|"position"|"thesis", "content": "..."}].

Examples:
- {"type": "position", "content": "User is long $NVDA"}
- {"type": "preference", "content": "User prefers swing trading with 3-month horizon"}
- {"type": "thesis", "content": "User is bearish on Chinese tech stocks"}
- {"type": "fact", "content": "User's portfolio is $500k across 12 positions"}

Return ONLY the JSON array. If nothing new to remember, return empty array [].

User: ${userMessage}
Assistant: ${aiResponse}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logger.warn('[MemoryManager] Haiku extraction error:', errText);
      return;
    }

    const data = await response.json();
    const extractedText = data.content?.[0]?.text || '[]';

    // Parse the JSON response
    let memories = [];
    try {
      memories = JSON.parse(extractedText);
      if (!Array.isArray(memories)) memories = [];
    } catch (parseErr) {
      logger.warn('[MemoryManager] Failed to parse memory extraction JSON:', extractedText);
      return;
    }

    // Insert new memories into database
    if (memories.length > 0 && db.isConnected()) {
      for (const mem of memories) {
        try {
          await db.query(
            `INSERT INTO user_memories (user_id, memory_type, content, confidence, last_referenced, reference_count)
             VALUES ($1, $2, $3, $4, NOW(), 1)`,
            [userId, mem.type || 'fact', mem.content || '', 1.0]
          );
        } catch (insertErr) {
          // Silently fail on insert — non-critical
          logger.debug('[MemoryManager] Memory insert failed:', insertErr.message);
        }
      }
    }
  } catch (err) {
    logger.warn('[MemoryManager] Memory extraction error:', err.message);
  }
}

/**
 * Retrieve persistent memories for a user (from database)
 * Returns formatted string for injection into system prompt
 */
async function getPersistedMemories(userId) {
  if (!userId || !db.isConnected()) return '';

  try {
    const result = await db.query(
      `SELECT memory_type, content, confidence FROM user_memories
       WHERE user_id = $1 AND confidence > 0.3
       ORDER BY last_referenced DESC, reference_count DESC
       LIMIT 10`,
      [userId]
    );

    if (!result || result.rows.length === 0) return '';

    const memories = result.rows
      .map(row => `${row.memory_type}: ${row.content}`)
      .join('\n');

    return `[USER MEMORY] Particle remembers:\n${memories}`;
  } catch (err) {
    logger.warn('[MemoryManager] Failed to retrieve persistent memories:', err.message);
    return '';
  }
}

/**
 * Update memory reference count and last_referenced timestamp
 * Called when a memory is used in a response
 */
async function updateMemoryReference(memoryId) {
  if (!memoryId || !db.isConnected()) return;

  try {
    await db.query(
      `UPDATE user_memories
       SET last_referenced = NOW(), reference_count = reference_count + 1
       WHERE id = $1`,
      [memoryId]
    );
  } catch (err) {
    logger.debug('[MemoryManager] Reference update failed:', err.message);
  }
}

/**
 * Clean up expired sessions (> 2 hours of inactivity)
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [userId, session] of SESSION_STORE.entries()) {
    if (now - session.lastActive > SESSION_TIMEOUT) {
      SESSION_STORE.delete(userId);
      logger.debug(`[MemoryManager] Expired session for userId ${userId}`);
    }
  }
}

/**
 * Clean up old memories (memory decay: below 0.3 confidence after 30 days)
 */
async function cleanupOldMemories() {
  if (!db.isConnected()) return;

  try {
    // Mark memories not referenced for 30 days with reduced confidence
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.query(
      `UPDATE user_memories
       SET confidence = 0.3
       WHERE last_referenced < $1 AND confidence > 0.3`,
      [thirtyDaysAgo]
    );

    // Delete memories below confidence threshold
    await db.query(
      `DELETE FROM user_memories WHERE confidence < 0.3`
    );
  } catch (err) {
    logger.warn('[MemoryManager] Memory cleanup failed:', err.message);
  }
}

/**
 * Start cleanup timers (called once at server init)
 */
function startCleanupTimers() {
  // Clean up expired sessions every 30 minutes
  setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch (err) {
      logger.error('[MemoryManager] Session cleanup error:', err.message);
    }
  }, CLEANUP_INTERVAL);

  // Clean up old memories every 6 hours
  setInterval(() => {
    try {
      cleanupOldMemories();
    } catch (err) {
      logger.error('[MemoryManager] Memory cleanup error:', err.message);
    }
  }, 6 * 60 * 60 * 1000);

  logger.info('[MemoryManager] Cleanup timers started');
}

/**
 * Get diagnostic info about memory usage
 */
function getDiagnostics() {
  const sessions = Array.from(SESSION_STORE.entries()).map(([userId, session]) => ({
    userId,
    messages: session.messages.length,
    totalTokens: session.totalTokens,
    hasSummary: !!session.summary,
    lastActive: new Date(session.lastActive).toISOString(),
  }));

  return {
    activeSessions: SESSION_STORE.size,
    sessions,
    maxSessionTokens: MAX_SESSION_TOKENS,
    sessionTimeout: SESSION_TIMEOUT,
  };
}

module.exports = {
  getSessionMemory,
  addMessageToSession,
  formatSessionMemory,
  extractMemoriesAsync,
  getPersistedMemories,
  updateMemoryReference,
  cleanupExpiredSessions,
  cleanupOldMemories,
  startCleanupTimers,
  getDiagnostics,
};
