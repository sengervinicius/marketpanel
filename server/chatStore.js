/**
 * chatStore.js
 * Per-user DM conversation store.
 *
 * Conversation ID = [userIdA, userIdB].sort().join(':')
 * NOTE: In-memory only. Real production needs a DB.
 * NOTE: Server stores plaintext. Real E2EE requires client-side key exchange.
 */

// conversationId → [message, ...]
const conversationMessages = new Map();
// userId → Set of conversationIds they participate in
const userConversations    = new Map();

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

/**
 * Add a DM from fromUserId to toUserId.
 */
function addMessage(fromUserId, toUserId, text) {
  const convId = getConversationId(fromUserId, toUserId);
  ensureConversation(convId, fromUserId, toUserId);
  const msg = {
    id:         Date.now().toString() + Math.random().toString(36).slice(2),
    convId,
    fromUserId: Number(fromUserId),
    toUserId:   Number(toUserId),
    text,
    timestamp:  new Date().toISOString(),
  };
  const msgs = conversationMessages.get(convId);
  msgs.push(msg);
  // Prune to last 200 messages per conversation
  if (msgs.length > 200) msgs.shift();
  return msg;
}

/**
 * Get messages between two users.
 */
function getMessagesBetween(idA, idB, limit = 50) {
  const convId = getConversationId(idA, idB);
  const msgs   = conversationMessages.get(convId) || [];
  return msgs.slice(-limit);
}

/**
 * List all conversations for a user (returns summary objects).
 */
function listConversationsForUser(userId, usernameFn) {
  const key   = String(userId);
  const convs = userConversations.get(key) || new Set();
  const result = [];
  for (const convId of convs) {
    const msgs = conversationMessages.get(convId) || [];
    const last = msgs[msgs.length - 1] || null;
    // Find the other user's id
    const [a, b]   = convId.split(':').map(Number);
    const otherId  = a === Number(userId) ? b : a;
    const username = usernameFn ? usernameFn(otherId) : String(otherId);
    result.push({ convId, otherUserId: otherId, otherUsername: username, lastMessage: last });
  }
  return result.sort((a, b) => {
    const ta = a.lastMessage?.timestamp || '';
    const tb = b.lastMessage?.timestamp || '';
    return tb.localeCompare(ta);
  });
}

module.exports = { addMessage, getMessagesBetween, listConversationsForUser, getConversationId };
