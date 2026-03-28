/**
 * routes/chat.js
 * Enhanced DM chat REST endpoints. Requires auth.
 * Mounted at /api/chat.
 */

const express  = require('express');
const router   = express.Router();
const chatStore = require('../chatStore');
const { getUserById } = require('../authStore');

// GET /api/chat/conversations — list conversations with unread counts
router.get('/conversations', (req, res) => {
  const convs = chatStore.listConversationsForUser(req.user.id, (id) => {
    const u = getUserById(id);
    return u ? u.username : String(id);
  });
  const totalUnread = chatStore.getTotalUnread(req.user.id);
  res.json({ conversations: convs, totalUnread });
});

// GET /api/chat/messages?userId=<other> — get messages between req.user and userId
router.get('/messages', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const msgs = chatStore.getMessagesBetween(req.user.id, Number(userId));
  // Mark messages as read when fetching
  const readIds = chatStore.markRead(req.user.id, Number(userId));
  res.json({ messages: msgs, readIds });
});

// POST /api/chat/messages — send a message (REST fallback)
router.post('/messages', (req, res) => {
  const { toUserId, text } = req.body;
  if (!toUserId || !text) return res.status(400).json({ error: 'toUserId and text required' });
  if (typeof text !== 'string' || text.length > 1000) {
    return res.status(400).json({ error: 'Message text must be 1-1000 characters' });
  }
  const to = getUserById(Number(toUserId));
  if (!to) return res.status(404).json({ error: 'Recipient not found' });
  const msg = chatStore.addMessage(req.user.id, Number(toUserId), text);
  res.status(201).json({ ok: true, message: msg });
});

// POST /api/chat/read — mark messages as read
router.post('/read', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const readIds = chatStore.markRead(req.user.id, Number(userId));
  res.json({ ok: true, readIds });
});

// GET /api/chat/unread — get total unread count
router.get('/unread', (req, res) => {
  const total = chatStore.getTotalUnread(req.user.id);
  res.json({ unread: total });
});

module.exports = router;
