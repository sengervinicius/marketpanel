/**
 * routes/aiChat.js — DB-backed AI chat history (P5).
 *
 * Mounted at /api/ai-chat. All routes require auth.
 *
 *   GET    /                  → list recent (last-24h) conversations
 *   POST   /                  → create new conversation (optional title/firstMessage)
 *   GET    /:id               → load one conversation + its messages
 *   POST   /:id/messages      → append a message (used as fallback / non-streaming path)
 *   PATCH  /:id               → rename
 *   DELETE /:id               → delete (cascades to messages)
 *
 * The streaming /api/search/chat handler also writes through this store
 * so message persistence is consistent regardless of which path created
 * the turn.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const aiChatStore = require('../services/aiChatStore');
const logger      = require('../utils/logger');

function userIdFromReq(req) {
  return req.user?.id || req.userId || null;
}

function sendError(res, status, code, message) {
  return res.status(status).json({ ok: false, error: code, message });
}

// ── List recent conversations ────────────────────────────────────────────
router.get('/', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const rows = await aiChatStore.listRecentConversations(userId, limit);
    res.json({ ok: true, retentionHours: aiChatStore.RETENTION_HOURS, conversations: rows });
  } catch (err) {
    logger.error('ai-chat', 'list failed', { error: err.message });
    sendError(res, 500, 'list_failed', err.message);
  }
});

// ── Create new conversation ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const { title, firstMessage } = req.body || {};
    const conv = await aiChatStore.createConversation(userId, { title, firstMessage });
    if (!conv) return sendError(res, 503, 'create_failed', 'Could not create conversation');
    res.status(201).json({ ok: true, conversation: conv });
  } catch (err) {
    logger.error('ai-chat', 'create failed', { error: err.message });
    sendError(res, 500, 'create_failed', err.message);
  }
});

// ── Load one conversation + its messages ─────────────────────────────────
router.get('/:id', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const conv = await aiChatStore.getConversation(userId, req.params.id);
    if (!conv) return sendError(res, 404, 'not_found', 'Conversation not found');
    const messages = await aiChatStore.listMessages(userId, req.params.id, 500);
    res.json({ ok: true, conversation: conv, messages });
  } catch (err) {
    logger.error('ai-chat', 'get failed', { error: err.message });
    sendError(res, 500, 'get_failed', err.message);
  }
});

// ── Append a message (non-streaming write) ───────────────────────────────
router.post('/:id/messages', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const { role, content, metadata } = req.body || {};
    const ok = await aiChatStore.appendMessage(userId, req.params.id, role, content, metadata);
    if (!ok) return sendError(res, 400, 'append_failed', 'Could not append message');
    res.json({ ok: true, message: ok });
  } catch (err) {
    logger.error('ai-chat', 'append failed', { error: err.message });
    sendError(res, 500, 'append_failed', err.message);
  }
});

// ── Rename ───────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const { title } = req.body || {};
    if (typeof title !== 'string' || !title.trim()) {
      return sendError(res, 400, 'bad_title', 'Title is required');
    }
    const ok = await aiChatStore.renameConversation(userId, req.params.id, title);
    if (!ok) return sendError(res, 404, 'not_found', 'Conversation not found');
    res.json({ ok: true });
  } catch (err) {
    logger.error('ai-chat', 'rename failed', { error: err.message });
    sendError(res, 500, 'rename_failed', err.message);
  }
});

// ── Delete ───────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const ok = await aiChatStore.deleteConversation(userId, req.params.id);
    if (!ok) return sendError(res, 404, 'not_found', 'Conversation not found');
    res.json({ ok: true });
  } catch (err) {
    logger.error('ai-chat', 'delete failed', { error: err.message });
    sendError(res, 500, 'delete_failed', err.message);
  }
});

module.exports = router;
