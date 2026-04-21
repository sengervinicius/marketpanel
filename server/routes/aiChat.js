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

// ── Email conversation to the signed-in user ─────────────────────────────
// POST /api/ai-chat/:id/email
// Body (optional): { mode: 'full' | 'last', scope?: 'summary' | 'full' }
//   mode=full (default) — whole conversation
//   mode=last           — only the most recent assistant turn
// The email is ALWAYS sent to the user's own account email (looked up via
// authStore). We never accept a free-form "to:" address — this keeps the
// endpoint from being weaponised by an AI-emitted action tag. The only
// exfil channel is the user's own inbox.
router.post('/:id/email', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const mode = (req.body?.mode === 'last') ? 'last' : 'full';

    // Load conversation + messages
    const conv = await aiChatStore.getConversation(userId, req.params.id);
    if (!conv) return sendError(res, 404, 'not_found', 'Conversation not found');
    const messages = await aiChatStore.listMessages(userId, req.params.id, 500);
    if (!messages || messages.length === 0) {
      return sendError(res, 400, 'empty', 'Nothing to email — conversation is empty');
    }

    // Look up the user's email (ALWAYS use the account email — never trust
    // an address coming from the request or from AI-generated content).
    const authStore = require('../authStore');
    const user = (authStore.getUserById && authStore.getUserById(userId)) || null;
    const to = user?.email;
    if (!to) {
      return sendError(res, 400, 'no_email', 'Account has no email on file');
    }

    // Select content to send
    let picked;
    if (mode === 'last') {
      // Last assistant message only
      picked = [...messages].reverse().find(m => m.role === 'assistant') || messages[messages.length - 1];
      picked = [picked];
    } else {
      picked = messages;
    }

    // Render to simple HTML + plain text. We deliberately do NOT run the
    // AI output through a markdown renderer here — it could contain
    // action tags or citation markers that aren't useful in email. Instead
    // we fence everything as pre-formatted text for the plain view and a
    // minimal styled block for HTML. Anyone wanting polish can copy into
    // a doc.
    const title = conv.title || 'Particle AI conversation';
    const plainLines = [];
    plainLines.push(`${title}`);
    plainLines.push('='.repeat(Math.min(title.length, 60)));
    plainLines.push('');
    for (const m of picked) {
      const role = m.role === 'assistant' ? 'Particle' : (m.role === 'user' ? 'You' : m.role);
      const when = m.created_at ? new Date(m.created_at).toISOString() : '';
      plainLines.push(`--- ${role}${when ? ` (${when})` : ''} ---`);
      plainLines.push(String(m.content || ''));
      plainLines.push('');
    }
    const plain = plainLines.join('\n');

    const htmlBlocks = picked.map(m => {
      const role = m.role === 'assistant' ? 'Particle' : (m.role === 'user' ? 'You' : m.role);
      const body = String(m.content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const bg = m.role === 'assistant' ? '#1a1a2e' : '#0f0f1a';
      return `
<div style="background:${bg};border-left:3px solid #ff6600;padding:12px 16px;margin-bottom:12px;border-radius:4px;">
  <div style="color:#ff9d4d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">${role}</div>
  <pre style="white-space:pre-wrap;word-wrap:break-word;margin:0;color:#e0e0e0;font-family:'SF Mono',Menlo,monospace;font-size:13px;line-height:1.5;">${body}</pre>
</div>`;
    }).join('\n');
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:0 auto;background:#0a0a14;color:#e0e0e0;padding:24px;">
  <h2 style="color:#ff6600;margin:0 0 8px;font-size:20px;">${String(title).replace(/</g, '&lt;')}</h2>
  <div style="color:#888;font-size:12px;margin-bottom:20px;">Exported from Particle — ${new Date().toUTCString()}</div>
  ${htmlBlocks}
  <div style="color:#666;font-size:11px;margin-top:24px;border-top:1px solid #222;padding-top:12px;">
    Particle AI output is informational only, not investment advice. Verify numbers before trading.
  </div>
</div>`;

    const emailService = require('../services/emailService');
    const ok = await emailService.sendEmail({
      to,
      subject: `Particle AI — ${title}`,
      html,
      text: plain,
      reason: 'ai_export',
    });
    if (!ok) return sendError(res, 502, 'send_failed', 'Email provider rejected the message');

    res.json({ ok: true, to, mode, messageCount: picked.length });
  } catch (err) {
    logger.error('ai-chat', 'email export failed', { error: err.message });
    sendError(res, 500, 'email_failed', err.message);
  }
});

// ── Export conversation as plain text (client wraps into .md/.pdf) ──────
// GET /api/ai-chat/:id/export?mode=full|last
// Returns { title, messages } so the client can render to whatever format
// the user chose (markdown download for now; client-side PDF lib later).
// This stays a read endpoint so a missing conversation is 404, not 500.
router.get('/:id/export', async (req, res) => {
  const userId = userIdFromReq(req);
  if (!userId) return sendError(res, 401, 'unauthenticated', 'Login required');
  try {
    const mode = (req.query.mode === 'last') ? 'last' : 'full';
    const conv = await aiChatStore.getConversation(userId, req.params.id);
    if (!conv) return sendError(res, 404, 'not_found', 'Conversation not found');
    const messages = await aiChatStore.listMessages(userId, req.params.id, 500);
    let picked = messages;
    if (mode === 'last') {
      const last = [...messages].reverse().find(m => m.role === 'assistant');
      picked = last ? [last] : [];
    }
    res.json({
      ok: true,
      title: conv.title || 'Particle AI conversation',
      createdAt: conv.created_at,
      mode,
      messages: picked.map(m => ({
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      })),
    });
  } catch (err) {
    logger.error('ai-chat', 'export failed', { error: err.message });
    sendError(res, 500, 'export_failed', err.message);
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
