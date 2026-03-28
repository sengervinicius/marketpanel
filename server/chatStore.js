/**
 * chatStore.js — Enhanced DM conversation store
 *
 * Features:
 *   - Per-conversation message storage (capped at 500 per conversation)
 *   - Unread message tracking per user per conversation
 *   - Online presence tracking
 *   - Typing indicator tracking
 *   - Message status: sent / delivered / read
 */

// conversationId → [message, ...]
const conversationMessages = new Map();
// userId → Set of conversationIds they participate in
const userConversations    = new Map();
// Online users: userId → { socketCount, lastSeen }
const onlineUsers = new Map();
// Typing indicators: conversationId → Set of userIds currently typing
const typingUsers = new Map();
// Unread counts: `userId:conversationId` → count
const unreadCounts = new Map();

function getConversationId(idA, idB) {
  return [String(idA), String(idB)].sort().join(':');
}

function ensureConversation(convId, idA, idB) {
  if (!conversationMessages.has(convId)) {
    conversationMessages.set(convId, []);
  }
  for (const uid of [idA, idB]) {
    const key = String(uid);
    if (!userConversations.has(key)) userConversations.set(key, new Set());
    userConversations.get(key).add(convId);
  }
}

// ── Messages ──────────────────────────────────────────────────────────────────

function addMessage(fromUserId, toUserId, text) {
  const convId = getConversationId(fromUserId, toUserId);
  ensureConversation(convId, fromUserId, toUserId);
  const msg = {
    id:         Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    convId,
    fromUserId: Number(fromUserId),
    toUserId:   Number(toUserId),
    text:       text.trim(),
    timestamp:  new Date().toISOString(),
    status:     'sent', // sent → delivered → read
  };
  const msgs = conversationMessages.get(convId);
  msgs.push(msg);
  // Prune to last 500 messages per conversation
  if (msgs.length > 500) msgs.splice(0, msgs.length - 500);

  // Increment unread for recipient
  const unreadKey = `${toUserId}:${convId}`;
  unreadCounts.set(unreadKey, (unreadCounts.get(unreadKey) || 0) + 1);

  // Clear typing indicator for sender
  clearTyping(convId, fromUserId);

  return msg;
}

function getMessagesBetween(idA, idB, limit = 50) {
  const convId = getConversationId(idA, idB);
  const msgs   = conversationMessages.get(convId) || [];
  return msgs.slice(-limit);
}

// ── Mark messages as delivered/read ───────────────────────────────────────────

function markDelivered(convId, userId) {
  const msgs = conversationMessages.get(convId) || [];
  let changed = false;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.toUserId === Number(userId) && m.status === 'sent') {
      m.status = 'delivered';
      changed = true;
    }
    if (m.status === 'delivered' || m.status === 'read') continue;
  }
  return changed;
}

function markRead(userId, otherUserId) {
  const convId = getConversationId(userId, otherUserId);
  const msgs = conversationMessages.get(convId) || [];
  const readMsgIds = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.toUserId === Number(userId) && m.status !== 'read') {
      m.status = 'read';
      readMsgIds.push(m.id);
    }
  }
  // Clear unread count
  const unreadKey = `${userId}:${convId}`;
  unreadCounts.set(unreadKey, 0);
  return readMsgIds;
}

// ── Unread counts ─────────────────────────────────────────────────────────────

function getUnreadCount(userId, otherUserId) {
  const convId = getConversationId(userId, otherUserId);
  return unreadCounts.get(`${userId}:${convId}`) || 0;
}

function getTotalUnread(userId) {
  let total = 0;
  const prefix = `${userId}:`;
  for (const [key, count] of unreadCounts) {
    if (key.startsWith(prefix)) total += count;
  }
  return total;
}

// ── Online presence ───────────────────────────────────────────────────────────

function setOnline(userId) {
  const current = onlineUsers.get(Number(userId)) || { socketCount: 0, lastSeen: Date.now() };
  current.socketCount++;
  current.lastSeen = Date.now();
  onlineUsers.set(Number(userId), current);
}

function setOffline(userId) {
  const current = onlineUsers.get(Number(userId));
  if (!current) return;
  current.socketCount = Math.max(0, current.socketCount - 1);
  current.lastSeen = Date.now();
  if (current.socketCount === 0) {
    // Keep in map with lastSeen for "last seen" display
  }
}

function isOnline(userId) {
  const current = onlineUsers.get(Number(userId));
  return current ? current.socketCount > 0 : false;
}

function getLastSeen(userId) {
  const current = onlineUsers.get(Number(userId));
  return current ? current.lastSeen : null;
}

// ── Typing indicators ─────────────────────────────────────────────────────────

function setTyping(convId, userId) {
  if (!typingUsers.has(convId)) typingUsers.set(convId, new Set());
  typingUsers.get(convId).add(Number(userId));
}

function clearTyping(convId, userId) {
  const set = typingUsers.get(convId);
  if (set) set.delete(Number(userId));
}

function getTypingUsers(convId) {
  const set = typingUsers.get(convId);
  return set ? [...set] : [];
}

// ── Conversations ─────────────────────────────────────────────────────────────

function listConversationsForUser(userId, usernameFn) {
  const key   = String(userId);
  const convs = userConversations.get(key) || new Set();
  const result = [];
  for (const convId of convs) {
    const msgs = conversationMessages.get(convId) || [];
    const last = msgs[msgs.length - 1] || null;
    const [a, b]   = convId.split(':').map(Number);
    const otherId  = a === Number(userId) ? b : a;
    const username = usernameFn ? usernameFn(otherId) : String(otherId);
    const unread   = unreadCounts.get(`${userId}:${convId}`) || 0;
    result.push({
      convId,
      otherUserId: otherId,
      otherUsername: username,
      lastMessage: last,
      unread,
      online: isOnline(otherId),
    });
  }
  return result.sort((a, b) => {
    const ta = a.lastMessage?.timestamp || '';
    const tb = b.lastMessage?.timestamp || '';
    return tb.localeCompare(ta);
  });
}

module.exports = {
  addMessage,
  getMessagesBetween,
  listConversationsForUser,
  getConversationId,
  markDelivered,
  markRead,
  getUnreadCount,
  getTotalUnread,
  setOnline,
  setOffline,
  isOnline,
  getLastSeen,
  setTyping,
  clearTyping,
  getTypingUsers,
};
