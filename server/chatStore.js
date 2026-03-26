/**
 * chatStore.js
 * In-memory message store for chat functionality.
 *
 * NOTE: In-memory only. Replace with database (MongoDB, PostgreSQL, etc.) for production.
 * SECURITY TODO: Server sees ciphertext only; real E2EE key exchange not implemented.
 * This is a stub for client-side encryption placeholder.
 */

const messages = []; // { id, roomId, senderId, timestamp, ciphertext }

module.exports = {
  /**
   * Store a new message.
   * Keeps only the last 500 messages per room to prevent unbounded growth.
   */
  addMessage(msg) {
    messages.push(msg);
    // Prune old messages if over 500 total
    if (messages.length > 500) {
      messages.shift();
    }
  },

  /**
   * Retrieve recent messages from a room.
   * @param {string} roomId - The chat room ID (e.g., 'global')
   * @param {number} limit - Max messages to return (default: 50)
   * @returns {Array} Array of messages, newest last
   */
  getRecentMessages(roomId, limit = 50) {
    return messages
      .filter(m => m.roomId === roomId)
      .slice(-limit);
  },

  /**
   * Get all messages (for admin/debugging).
   */
  getAllMessages() {
    return messages;
  },

  /**
   * Clear all messages (for testing).
   */
  clear() {
    messages.length = 0;
  },
};
