/**
 * ChatPanel.jsx
 * Direct-message chat with user search.
 * WS delivers real-time messages. REST loads history.
 *
 * NOTE: Server stores message text in plaintext.
 * Real E2EE requires client-side key exchange (e.g., X25519 + AES-GCM).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import { WS_URL } from '../../utils/constants';

const ORANGE = '#ff6600';
const GREEN  = '#00cc44';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return 'now';
  if (diff < 3600)  return Math.round(diff / 60) + 'm';
  if (diff < 86400) return Math.round(diff / 3600) + 'h';
  return Math.round(diff / 86400) + 'd';
}

// Open chat in a separate browser window
export function openChatWindow(userId) {
  const path = userId
    ? `${window.location.origin}/#/chat/${userId}`
    : `${window.location.origin}/#/chat`;
  window.open(path, '_blank', 'width=820,height=620,noopener,noreferrer');
}

export function ChatPanel({ mobile, initialUserId }) {
  const { user, token } = useAuth();
  const [conversations,    setConversations]    = useState([]);
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchResults,    setSearchResults]    = useState([]);
  const [activeChatUser,   setActiveChatUser]   = useState(
    initialUserId ? { id: initialUserId, username: '…' } : null
  ); // { id, username }
  const [messages,         setMessages]         = useState({});   // userId → [msg]
  const [input,            setInput]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [mobileView,       setMobileView]       = useState('list'); // 'list' | 'chat'
  const messagesEndRef = useRef(null);
  const wsRef          = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    apiFetch('/api/chat/conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations || []))
      .catch(() => {});
  }, []);

  // Connect WS for real-time messages
  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'chat_message') {
          const m = msg.message;
          // Determine the conversation partner's userId from our perspective
          const partnerId = m.fromUserId === user?.id ? m.toUserId : m.fromUserId;
          setMessages(prev => ({
            ...prev,
            [partnerId]: [...(prev[partnerId] || []), m],
          }));
          // Refresh conversations list
          apiFetch('/api/chat/conversations')
            .then(r => r.json())
            .then(d => setConversations(d.conversations || []))
            .catch(() => {});
        }
      } catch {}
    };
    return () => ws.close();
  }, [token, user?.id]);

  // User search
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      apiFetch(`/api/users/search?query=${encodeURIComponent(searchQuery)}`)
        .then(r => r.json())
        .then(d => setSearchResults(d.users || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Load messages for active conversation
  const openConversation = useCallback(async (otherUser) => {
    setActiveChatUser(otherUser);
    if (mobile) setMobileView('chat');
    if (!messages[otherUser.id]) {
      setLoading(true);
      const res = await apiFetch(`/api/chat/messages?userId=${otherUser.id}`);
      const data = await res.json();
      setMessages(prev => ({ ...prev, [otherUser.id]: data.messages || [] }));
      setLoading(false);
    }
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, mobile]);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (activeChatUser) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeChatUser]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeChatUser) return;
    setInput('');
    // Optimistic update
    const optimistic = {
      id:         'opt-' + Date.now(),
      fromUserId: user?.id,
      toUserId:   activeChatUser.id,
      text,
      timestamp:  new Date().toISOString(),
    };
    setMessages(prev => ({
      ...prev,
      [activeChatUser.id]: [...(prev[activeChatUser.id] || []), optimistic],
    }));
    // Send via WS
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        toUserId: activeChatUser.id,
        text,
      }));
    } else {
      // Fallback to REST
      await apiFetch('/api/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ toUserId: activeChatUser.id, text }),
      });
    }
  }, [input, activeChatUser, user?.id]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Styles ─────────────────────────────────────────────────────────────────

  const base = {
    height: '100%', display: 'flex', fontFamily: '"Courier New", monospace', color: '#e0e0e0',
    background: '#0a0a0a',
  };

  const panelHeader = {
    padding: '6px 12px', borderBottom: '1px solid #1e1e1e',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  };

  const listItem = (active) => ({
    padding: '10px 12px', borderBottom: '1px solid #141414',
    cursor: 'pointer', background: active ? '#120800' : 'transparent',
    borderLeft: active ? `2px solid ${ORANGE}` : '2px solid transparent',
    display: 'flex', flexDirection: 'column', gap: 3,
  });

  const msgBubble = (mine) => ({
    maxWidth: '75%', padding: '8px 12px',
    background:   mine ? '#1a0900' : '#111',
    border:       `1px solid ${mine ? ORANGE : '#2a2a2a'}`,
    borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
    fontSize: 11, lineHeight: 1.5, color: '#e0e0e0',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    wordBreak: 'break-word',
  });

  // ── Conversation list panel ─────────────────────────────────────────────────
  const renderList = () => (
    <div style={{ width: mobile ? '100%' : 220, display: 'flex', flexDirection: 'column', borderRight: mobile ? 'none' : '1px solid #1e1e1e', height: '100%' }}>
      <div style={panelHeader}>
        <span style={{ color: ORANGE, fontSize: 10, fontWeight: 'bold', letterSpacing: '0.2em' }}>MESSAGES</span>
        {!mobile && (
          <button
            onClick={() => openChatWindow()}
            title="Open in separate window"
            style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 11, padding: 0 }}
          >⊞</button>
        )}
      </div>
      {/* User search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #141414', flexShrink: 0 }}>
        <input
          style={{
            width: '100%', background: '#080808', border: '1px solid #2a2a2a',
            color: '#e0e0e0', padding: '5px 8px', fontSize: 10,
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', borderRadius: 2,
          }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search users…"
        />
      </div>
      {/* Search results */}
      {searchResults.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
          {searchResults.map(u => (
            <div key={u.id} style={listItem(activeChatUser?.id === u.id)}
              onClick={() => { setSearchQuery(''); setSearchResults([]); openConversation(u); }}>
              <span style={{ color: '#ccc', fontSize: 11 }}>{u.username}</span>
              <span style={{ color: '#444', fontSize: 9 }}>NEW CONVERSATION</span>
            </div>
          ))}
        </div>
      )}
      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length === 0 && !searchQuery && (
          <div style={{ padding: 16, color: '#2a2a2a', fontSize: 10 }}>
            No conversations yet.<br />Search for a user to start messaging.
          </div>
        )}
        {conversations.map(c => (
          <div key={c.convId} style={listItem(activeChatUser?.id === c.otherUserId)}
            onClick={() => openConversation({ id: c.otherUserId, username: c.otherUsername })}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#ccc', fontSize: 11, fontWeight: 'bold' }}>{c.otherUsername}</span>
              <span style={{ color: '#2a2a2a', fontSize: 8 }}>{timeAgo(c.lastMessage?.timestamp)}</span>
            </div>
            {c.lastMessage && (
              <span style={{ color: '#444', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.lastMessage.fromUserId === user?.id ? 'You: ' : ''}{c.lastMessage.text}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Conversation view ───────────────────────────────────────────────────────
  const renderChat = () => {
    const msgs = activeChatUser ? (messages[activeChatUser.id] || []) : [];
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={panelHeader}>
          {mobile && (
            <button onClick={() => setMobileView('list')}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, marginRight: 8 }}>
              ←
            </button>
          )}
          <span style={{ color: '#e0e0e0', fontSize: 11, fontWeight: 'bold' }}>
            {activeChatUser?.username || '—'}
          </span>
          <span style={{ color: '#2a2a2a', fontSize: 8 }}>E2EE stub</span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, WebkitOverflowScrolling: 'touch' }}>
          {loading && <div style={{ color: '#2a2a2a', fontSize: 10, textAlign: 'center' }}>Loading…</div>}
          {!loading && msgs.length === 0 && (
            <div style={{ color: '#2a2a2a', fontSize: 10, textAlign: 'center', marginTop: 20 }}>
              Start a conversation with {activeChatUser?.username}.
            </div>
          )}
          {msgs.map(m => {
            const mine = m.fromUserId === user?.id;
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <div style={msgBubble(mine)}>{m.text}</div>
                <span style={{ color: '#2a2a2a', fontSize: 8, marginTop: 2 }}>{timeAgo(m.timestamp)}</span>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {activeChatUser && (
          <div style={{
            padding: '8px 12px', borderTop: '1px solid #1e1e1e',
            display: 'flex', gap: 8, flexShrink: 0,
          }}>
            <input
              style={{
                flex: 1, background: '#080808', border: '1px solid #2a2a2a',
                color: '#e0e0e0', padding: '8px 10px', fontSize: 11,
                fontFamily: 'inherit', outline: 'none', borderRadius: 2,
              }}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message ${activeChatUser.username}…`}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              style={{
                background: ORANGE, border: 'none', color: '#000',
                padding: '8px 14px', cursor: 'pointer', fontSize: 11,
                fontFamily: 'inherit', fontWeight: 'bold', borderRadius: 2,
                opacity: input.trim() ? 1 : 0.4,
              }}
            >↑</button>
          </div>
        )}

        {/* No chat selected (desktop) */}
        {!activeChatUser && !mobile && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 11 }}>
            Select a conversation to start messaging
          </div>
        )}
      </div>
    );
  };

  // Mobile routing
  if (mobile) {
    if (mobileView === 'list') {
      return <div style={base}>{renderList()}</div>;
    } else {
      return <div style={base}>{renderChat()}</div>;
    }
  }

  // Desktop: side-by-side
  return (
    <div style={base}>
      {renderList()}
      {renderChat()}
    </div>
  );
}
