/**
 * ChatPanel.jsx
 * In-app chat interface with message history and live updates via WebSocket.
 *
 * TODO: Implement real E2EE key exchange. Currently uses stub encryption/decryption.
 * TODO: Add user session management (currently anonymous).
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

// TODO: Replace with real encryption library (e.g., TweetNaCl, libsodium.js)
const encrypt = (text) => {
  // STUB: Return plaintext with marker (replace with real E2EE)
  return Buffer.from(text).toString('base64');
};

const decrypt = (ciphertext) => {
  // STUB: Decode base64 (replace with real E2EE)
  try {
    return Buffer.from(ciphertext, 'base64').toString('utf-8');
  } catch {
    return '(unable to decrypt)';
  }
};

export function ChatPanel({ user }) {
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  // Use authenticated username if available, otherwise random ID
  const [senderId] = useState(() => user?.username || `anon_${Math.random().toString(36).slice(2, 9)}`);
  const roomId = 'global';

  // Fetch chat history on mount
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API}/api/chat/history?roomId=${roomId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setMessages(data.messages || []);
      } catch (e) {
        console.error('[Chat] Fetch history error:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, []);

  // Listen for incoming chat messages from WebSocket
  useEffect(() => {
    const handleChatMessage = (event) => {
      const msg = event.detail;
      if (msg.roomId === roomId) {
        setMessages(prev => [...prev, msg]);
      }
    };
    window.addEventListener('ws:chat_message', handleChatMessage);
    return () => window.removeEventListener('ws:chat_message', handleChatMessage);
  }, []);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const ciphertext = encrypt(input);
    window.dispatchEvent(new CustomEvent('ws:send', {
      detail: {
        type: 'chat_message',
        roomId,
        senderId,
        ciphertext,
      },
    }));
    setInput('');
    inputRef.current?.focus();
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid #2a2a2a',
        background: '#111',
        flexShrink: 0,
      }}>
        <span style={{
          color: '#ff9900',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '1px',
        }}>
          💬 CHAT
        </span>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        {loading && (
          <div style={{ color: '#555', fontSize: '9px', textAlign: 'center', marginTop: 'auto' }}>
            LOADING...
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div style={{ color: '#555', fontSize: '9px', textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
            No messages yet. Start a conversation.
          </div>
        )}
        {messages.map((msg) => {
          const isOwn = msg.senderId === senderId;
          const decrypted = decrypt(msg.ciphertext);
          const timeStr = new Date(msg.timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: isOwn ? 'row-reverse' : 'row',
                gap: '6px',
                alignItems: 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '70%',
                  backgroundColor: isOwn ? '#1a4d2e' : '#2a2a2a',
                  border: `1px solid ${isOwn ? '#00c853' : '#333'}`,
                  borderRadius: '4px',
                  padding: '6px 8px',
                  fontSize: '9px',
                  color: '#ddd',
                  wordBreak: 'break-word',
                }}
              >
                <div style={{ fontSize: '8px', color: isOwn ? '#4caf50' : '#888', marginBottom: '2px' }}>
                  {isOwn ? 'You' : msg.senderId}
                </div>
                <div>{decrypted}</div>
                <div style={{ fontSize: '7px', color: isOwn ? '#4caf5080' : '#55555580', marginTop: '2px' }}>
                  {timeStr}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          gap: '4px',
          padding: '6px',
          borderTop: '1px solid #2a2a2a',
          flexShrink: 0,
          background: '#0d0d0d',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{
            flex: 1,
            background: '#0a0a0a',
            border: '1px solid #2a2a2a',
            color: '#e0e0e0',
            fontFamily: 'inherit',
            fontSize: '9px',
            padding: '4px 6px',
            outline: 'none',
            borderRadius: '2px',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          style={{
            background: input.trim() ? '#1a0d00' : '#0a0a0a',
            border: '1px solid #ff9900',
            color: input.trim() ? '#ff9900' : '#555',
            fontSize: '9px',
            padding: '4px 8px',
            cursor: input.trim() ? 'pointer' : 'default',
            fontFamily: 'inherit',
            borderRadius: '2px',
            fontWeight: 600,
          }}
        >
          SEND
        </button>
      </form>
    </div>
  );
}
