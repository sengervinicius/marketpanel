/**
 * routes/chat.js
 * DM chat REST endpoints. Requires auth.
 * Mounted at /api/chat.
 */

const express  = require('express');
const router   = express.Router();
const chatStore = require('../chatStore');
const { getUserById } = require('../authStore');

// GET /api/chat/conversations — list conversations for logged-in user
router.get('/conversations', (req, res) => {
  const convs = chatStore.listConversationsForUser(req.user.id, (id) => {
    const u = getUserById(id);
    return u ? u.username : String(id);
  });
  res.json({ conversations: convs });
});

// GET /api/chat/messages?userId=<other> — get messages between req.user and userId
router.get('/messages', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const msgs = chatStore.getMessagesBetween(req.user.id, Number(userId));
  res.json({ messages: msgs });
});

// POST /api/chat/messages — send a message
router.post('/messages', (req, res) => {
  const { toUserId, text } = req.body;
  if (!toUserId || !text) return res.status(400).json({ error: 'toUserId and text required' });
  const to = getUserById(Number(toUserId));
  if (!to) return res.status(404).json({ error: 'Recipient not found' });
  const msg = chatStore.addMessage(req.user.id, Number(toUserId), text);
  res.status(201).json({ ok: true, message: msg });
});

module.exports = router;
