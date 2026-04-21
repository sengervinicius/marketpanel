/**
 * routes/memory.js
 *
 * P2.2 — User memory dashboard (GET/PATCH/DELETE).
 *
 * Particle AI's memoryManager automatically extracts "persistent facts"
 * from user conversations (positions, preferences, theses, etc.) and
 * stuffs them into the `user_memories` Postgres table, where they're
 * re-injected into the system prompt on the next turn. Until this route
 * existed the user had no way to see what the model remembered, no way
 * to correct it, and no way to make it forget something — a trust hole
 * we closed on P2.2.
 *
 * Endpoints (all require auth; scoped to req.user.id):
 *   GET    /api/memory            → list the user's memories
 *   PATCH  /api/memory/:id        → edit content / confidence on one
 *   DELETE /api/memory/:id        → delete one
 *   DELETE /api/memory            → forget everything (destructive)
 *
 * The table lives in server/db/init.sql under `user_memories`. If
 * Postgres isn't connected (dev mode without DB) the endpoints return
 * an empty list and 503 on writes rather than crashing — same pattern
 * memoryManager itself uses for graceful degradation.
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const pg = require('../db/postgres');

// Reject prototype-pollution keys in any PATCH body.
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
function hasDangerousKeys(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.includes(key)) return true;
    const v = obj[key];
    if (v && typeof v === 'object') {
      if (hasDangerousKeys(v, depth + 1)) return true;
    }
  }
  return false;
}

const VALID_TYPES = new Set(['fact', 'preference', 'position', 'thesis']);
const MAX_CONTENT_LEN = 500;

// ── GET /api/memory ────────────────────────────────────────────────────────
// Returns every memory the AI currently retains for this user, ordered by
// most-referenced first so the items the model leans on hardest are at the
// top. Low-confidence items (<= 0.3) are included here — the model suppresses
// them at inference time, but the user should still see and be able to
// delete them.
router.get('/', async (req, res) => {
  try {
    if (!pg.isConnected()) {
      return res.json({ ok: true, data: [], connected: false });
    }
    const r = await pg.query(
      `SELECT id, memory_type, content, confidence,
              created_at, last_referenced, reference_count
       FROM user_memories
       WHERE user_id = $1
       ORDER BY reference_count DESC, last_referenced DESC
       LIMIT 500`,
      [req.user.id],
    );
    const data = (r && r.rows ? r.rows : []).map(row => ({
      id: row.id,
      type: row.memory_type,
      content: row.content,
      confidence: Number(row.confidence),
      createdAt: row.created_at,
      lastReferenced: row.last_referenced,
      referenceCount: row.reference_count,
    }));
    res.json({ ok: true, data, connected: true });
  } catch (e) {
    logger.error('GET /memory error:', e);
    sendApiError(res, 500, 'Failed to load memories');
  }
});

// ── PATCH /api/memory/:id ──────────────────────────────────────────────────
// Edit a memory's content / type / confidence. Caller must own the memory
// — the UPDATE is gated by user_id so another user's id can't be touched
// even if guessed. Nothing is created here; if :id doesn't exist for this
// user we return 404 instead of silently inserting.
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendApiError(res, 400, 'Invalid memory id');
    }
    const body = req.body || {};
    if (hasDangerousKeys(body)) return sendApiError(res, 400, 'Invalid payload');

    if (!pg.isConnected()) return sendApiError(res, 503, 'Memory store unavailable');

    const updates = [];
    const values = [];
    let i = 1;

    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || body.content.trim().length === 0) {
        return sendApiError(res, 400, 'content must be a non-empty string');
      }
      if (body.content.length > MAX_CONTENT_LEN) {
        return sendApiError(res, 400, `content too long (max ${MAX_CONTENT_LEN} chars)`);
      }
      updates.push(`content = $${i++}`); values.push(body.content.trim());
    }
    if (body.type !== undefined) {
      if (!VALID_TYPES.has(body.type)) {
        return sendApiError(res, 400, `type must be one of: ${[...VALID_TYPES].join(', ')}`);
      }
      updates.push(`memory_type = $${i++}`); values.push(body.type);
    }
    if (body.confidence !== undefined) {
      const c = Number(body.confidence);
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        return sendApiError(res, 400, 'confidence must be between 0 and 1');
      }
      updates.push(`confidence = $${i++}`); values.push(c);
    }
    if (updates.length === 0) {
      return sendApiError(res, 400, 'No editable fields in payload');
    }

    values.push(req.user.id, id);
    const sql = `
      UPDATE user_memories
      SET ${updates.join(', ')}
      WHERE user_id = $${i++} AND id = $${i}
      RETURNING id, memory_type, content, confidence,
                created_at, last_referenced, reference_count
    `;
    const r = await pg.query(sql, values);
    if (!r || !r.rows || r.rows.length === 0) {
      return sendApiError(res, 404, 'Memory not found');
    }
    const row = r.rows[0];
    logger.info('Memory updated', { userId: req.user.id, memoryId: row.id });
    res.json({
      ok: true,
      data: {
        id: row.id,
        type: row.memory_type,
        content: row.content,
        confidence: Number(row.confidence),
        createdAt: row.created_at,
        lastReferenced: row.last_referenced,
        referenceCount: row.reference_count,
      },
    });
  } catch (e) {
    logger.error('PATCH /memory/:id error:', e);
    sendApiError(res, 500, 'Failed to update memory');
  }
});

// ── DELETE /api/memory/:id ────────────────────────────────────────────────
// Remove one memory. Scoped by user_id so cross-user IDs return 404.
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendApiError(res, 400, 'Invalid memory id');
    }
    if (!pg.isConnected()) return sendApiError(res, 503, 'Memory store unavailable');

    const r = await pg.query(
      `DELETE FROM user_memories
       WHERE user_id = $1 AND id = $2
       RETURNING id`,
      [req.user.id, id],
    );
    if (!r || !r.rows || r.rows.length === 0) {
      return sendApiError(res, 404, 'Memory not found');
    }
    logger.info('Memory deleted', { userId: req.user.id, memoryId: id });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /memory/:id error:', e);
    sendApiError(res, 500, 'Failed to delete memory');
  }
});

// ── DELETE /api/memory ────────────────────────────────────────────────────
// Forget everything. Destructive — the client always confirms first.
router.delete('/', async (req, res) => {
  try {
    if (!pg.isConnected()) return sendApiError(res, 503, 'Memory store unavailable');
    const r = await pg.query(
      `DELETE FROM user_memories WHERE user_id = $1 RETURNING id`,
      [req.user.id],
    );
    const deleted = r && r.rows ? r.rows.length : 0;
    logger.info('Memories bulk-forgotten', { userId: req.user.id, deleted });
    res.json({ ok: true, deleted });
  } catch (e) {
    logger.error('DELETE /memory error:', e);
    sendApiError(res, 500, 'Failed to forget memories');
  }
});

module.exports = router;
