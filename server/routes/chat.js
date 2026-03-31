/**
 * routes/chat.js
 * Enhanced DM chat REST endpoints. Requires auth.
 * Mounted at /api/chat.
 *
 * Phase 0: Control flow — all error/early paths use return, async handlers wrapped in try/catch
 * Phase 1: Validation — userId/toUserId as positive integers, text sanitization
 * Phase 5: Chat security — recipient validation, XSS prevention via sanitizeText, logging
 */

const express = require('express');
const router = express.Router();
const chatStore = require('../chatStore');
const { getUserById } = require('../authStore');
const { isUserId, sanitizeText } = require('../utils/validate');
const { sendApiError, ProviderError } = require('../utils/apiError');
const logger = require('../utils/logger');

/**
 * GET /api/chat/conversations
 * List conversations with unread counts for the authenticated user.
 */
router.get('/conversations', (req, res) => {
  try {
    const convs = chatStore.listConversationsForUser(req.user.id, (id) => {
      const u = getUserById(id);
      return u ? u.username : String(id);
    });
    const totalUnread = chatStore.getTotalUnread(req.user.id);
    logger.info(`[chat] Retrieved conversations for user ${req.user.id}: ${convs.length} total`);
    return res.json({ conversations: convs, totalUnread });
  } catch (err) {
    logger.error(`[chat] Error retrieving conversations: ${err.message}`);
    return sendApiError(res, 500, 'Failed to retrieve conversations');
  }
});

/**
 * GET /api/chat/messages?userId=<other>
 * Retrieve messages between req.user and userId.
 * Validates userId as a positive integer, marks messages as read.
 */
router.get('/messages', (req, res) => {
  try {
    const { userId } = req.query;

    // Validate userId parameter
    if (!userId) {
      logger.warn(`[chat] GET /messages missing userId parameter from user ${req.user.id}`);
      return sendApiError(res, 400, 'userId is required');
    }

    if (!isUserId(userId)) {
      logger.warn(`[chat] GET /messages invalid userId: ${userId} from user ${req.user.id}`);
      return sendApiError(res, 400, 'userId must be a positive integer');
    }

    const numUserId = Number(userId);

    // Retrieve messages and mark as read
    const msgs = chatStore.getMessagesBetween(req.user.id, numUserId);
    const readIds = chatStore.markRead(req.user.id, numUserId);

    logger.info(`[chat] Retrieved ${msgs.length} messages between user ${req.user.id} and ${numUserId}`);
    return res.json({ messages: msgs, readIds });
  } catch (err) {
    logger.error(`[chat] Error retrieving messages: ${err.message}`);
    return sendApiError(res, 500, 'Failed to retrieve messages');
  }
});

/**
 * POST /api/chat/messages
 * Send a message from req.user to toUserId.
 * Validates toUserId exists, validates and sanitizes text, sanitizes for XSS prevention.
 */
router.post('/messages', (req, res) => {
  try {
    const { toUserId, text } = req.body;

    // Validate required fields
    if (!toUserId || !text) {
      logger.warn(`[chat] POST /messages missing required fields from user ${req.user.id}`);
      return sendApiError(res, 400, 'toUserId and text are required');
    }

    // Validate toUserId is a positive integer
    if (!isUserId(toUserId)) {
      logger.warn(`[chat] POST /messages invalid toUserId: ${toUserId} from user ${req.user.id}`);
      return sendApiError(res, 400, 'toUserId must be a positive integer');
    }

    // Validate text is a string
    if (typeof text !== 'string') {
      logger.warn(`[chat] POST /messages text is not a string from user ${req.user.id}`);
      return sendApiError(res, 400, 'Message text must be a string');
    }

    // Validate text length (1-1000 characters)
    if (text.length < 1 || text.length > 1000) {
      logger.warn(`[chat] POST /messages text length out of range (${text.length}) from user ${req.user.id}`);
      return sendApiError(res, 400, 'Message text must be 1-1000 characters');
    }

    const numToUserId = Number(toUserId);

    // Validate recipient exists
    const recipient = getUserById(numToUserId);
    if (!recipient) {
      logger.warn(`[chat] POST /messages recipient not found: ${numToUserId} (from user ${req.user.id})`);
      return sendApiError(res, 404, 'Recipient not found');
    }

    // Sanitize text to prevent XSS (strip control characters and normalize)
    const sanitized = sanitizeText(text);

    // Add message to store
    const msg = chatStore.addMessage(req.user.id, numToUserId, sanitized);

    logger.info(`[chat] Message sent from user ${req.user.id} to ${numToUserId}`);

    // TODO: Phase 5+ — Future WebSocket integration: emit real-time event to recipient if connected
    // TODO: Phase 5+ — Rate limiting: implement per-user rate limit (e.g., 10 msgs/min) to prevent spam
    // TODO: Phase 5+ — Multi-tenant: add org/workspace filtering to ensure users can only message within their org

    return res.status(201).json({ ok: true, message: msg });
  } catch (err) {
    logger.error(`[chat] Error sending message: ${err.message}`);
    return sendApiError(res, 500, 'Failed to send message');
  }
});

/**
 * POST /api/chat/read
 * Mark messages as read between req.user and userId.
 * Validates userId as a positive integer.
 */
router.post('/read', (req, res) => {
  try {
    const { userId } = req.body;

    // Validate userId parameter
    if (!userId) {
      logger.warn(`[chat] POST /read missing userId from user ${req.user.id}`);
      return sendApiError(res, 400, 'userId is required');
    }

    if (!isUserId(userId)) {
      logger.warn(`[chat] POST /read invalid userId: ${userId} from user ${req.user.id}`);
      return sendApiError(res, 400, 'userId must be a positive integer');
    }

    const numUserId = Number(userId);

    // Mark messages as read
    const readIds = chatStore.markRead(req.user.id, numUserId);

    logger.info(`[chat] Marked ${readIds.length} messages as read for user ${req.user.id} from ${numUserId}`);
    return res.json({ ok: true, readIds });
  } catch (err) {
    logger.error(`[chat] Error marking messages as read: ${err.message}`);
    return sendApiError(res, 500, 'Failed to mark messages as read');
  }
});

/**
 * GET /api/chat/unread
 * Retrieve total unread message count for req.user.
 */
router.get('/unread', (req, res) => {
  try {
    const total = chatStore.getTotalUnread(req.user.id);
    logger.info(`[chat] Retrieved unread count for user ${req.user.id}: ${total}`);
    return res.json({ unread: total });
  } catch (err) {
    logger.error(`[chat] Error retrieving unread count: ${err.message}`);
    return sendApiError(res, 500, 'Failed to retrieve unread count');
  }
});

module.exports = router;
