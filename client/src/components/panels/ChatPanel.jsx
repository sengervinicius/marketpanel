/**
 * ChatPanel.jsx — Production-quality DM chat
 *
 * Features:
 *   - Real-time messages via WebSocket
 *   - Typing indicators
 *   - Message delivery status (sent → delivered → read)
 *   - Online presence indicators
 *   - Unread message badges
 *   - Optimistic message sending with deduplication
 *   - Auto-scroll on new messages
 *   - REST fallback when WS is unavailable
 *   - Mobile-responsive with list/chat view switching
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import { WS_URL } from '../../utils/constants';

const ORANGE = '#ff6600';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return 'now';
  if (diff < 3600)  return Math.round(diff / 60) + 'm';
  if (diff < 86400) return Math.round(diff / 3600) + 'h';
  return Math.round(diff / 86400) + 'd';
}

function statusIcon(status) {
  switch (status) {
    case 'sending': return '\u2022';     // bullet (pending)
    case 'sent':    return '\u2713';     // single check
    case 'delivered': return '\u2713\u2713'; // double check
    case 'read':   return '\u2713\u2713';    // double check (colored)
    default: return '';
  }
}

// Open chat in a separate browser window
export function openChatWindow(userId) {
  const path = userId
    ? `${window.location.origin}/#/chat/${userId}`
    : `${window.location.origin}/#/chat`;
  window.open(path, '_blank', 'width=820,height=620,noopener,noreferrer');
}

function ChatPanel({ mobile, initialUserId }) {
  const { user, token } = useAuth();
  const [conversations,    setConversations]    = useState([]);
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchResults,    setSearchResults]    = useState([]);
  const [activeChatUser,   setActiveChatUser]   = useState(
    initialUserId ? { id: initialUserId, username: '\u2026' } : null
  );
  const [messages,         setMessages]         = useState({});   // userId -> [msg]
  const [input,            setInput]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [mobileView,       setMobileView]       = useState('list');
  const [onlineMap,        setOnlineMap]        = useState({});   // userId -> boolean
  const [typingMap,        setTypingMap]        = useState({});   // userId -> boolean
  const [totalUnread,      setTotalUnread]      = useState(0);
  const messagesEndRef = useRef(null);
  const wsRef          = useRef(null);
  const typingTimer    = useRef(null);
  const isTyping       = useRef(false);
  const activeChatRef  = useRef(activeChatUser);

  // Keep ref in sync
  useEffect(() => { activeChatRef.current = activeChatUser; }, [activeChatUser]);

  // Load conversations on mount
  useEffect(() => {
    apiFetch('/api/chat/conversations')
      .then(r => r.json())
      .then(d => {
        setConversations(d.conversations || []);
        setTotalUnread(d.totalUnread || 0);
        // Build initial online map
        const online = {};
        (d.conversations || []).forEach(c => { online[c.otherUserId] = c.online; });
        setOnlineMap(prev => ({ ...prev, ...online }));
      })
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
          const partnerId = m.fromUserId === user?.id ? m.toUserId : m.fromUserId;

          setMessages(prev => {
            const existing = prev[partnerId] || [];
            // Dedup: skip if we already have this message (optimistic or duplicate)
            if (existing.some(e => e.id === m.id || (e.id?.startsWith('opt-') && e.text === m.text && e.toUserId === m.toUserId))) {
              // Replace optimistic message with real one
              return {
                ...prev,
                [partnerId]: existing.map(e =>
                  (e.id?.startsWith('opt-') && e.text === m.text && e.toUserId === m.toUserId) ? m : e
                ),
              };
            }
            return { ...prev, [partnerId]: [...existing, m] };
          });

          // Auto-mark as read if we're viewing this conversation
          if (m.fromUserId !== user?.id && activeChatRef.current?.id === partnerId) {
            ws.send(JSON.stringify({ type: 'mark_read', otherUserId: partnerId }));
          }

          // Refresh conversations list
          apiFetch('/api/chat/conversations')
            .then(r => r.json())
            .then(d => {
              setConversations(d.conversations || []);
              setTotalUnread(d.totalUnread || 0);
            })
            .catch(() => {});
        }

        // Typing indicator
        if (msg.type === 'typing') {
          setTypingMap(prev => ({ ...prev, [msg.fromUserId]: msg.isTyping }));
          // Auto-clear typing after 5s (in case clearTyping message was lost)
          if (msg.isTyping) {
            setTimeout(() => {
              setTypingMap(prev => ({ ...prev, [msg.fromUserId]: false }));
            }, 5000);
          }
        }

        // Online presence
        if (msg.type === 'presence') {
          setOnlineMap(prev => ({ ...prev, [msg.userId]: msg.online }));
        }

        // Read receipts
        if (msg.type === 'messages_read') {
          const byUser = msg.byUserId;
          setMessages(prev => {
            const updated = { ...prev };
            if (updated[byUser]) {
              updated[byUser] = updated[byUser].map(m =>
                msg.messageIds.includes(m.id) ? { ...m, status: 'read' } : m
              );
            }
            return updated;
          });
        }
      } catch {}
    };

    return () => ws.close();
  }, [token, user?.id]);

  // User search (debounced)
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
      try {
        const res = await apiFetch(`/api/chat/messages?userId=${otherUser.id}`);
        const data = await res.json();
        setMessages(prev => ({ ...prev, [otherUser.id]: data.messages || [] }));
      } catch {} finally {
        setLoading(false);
      }
    }
    // Mark as read via WS
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'mark_read', otherUserId: otherUser.id }));
    }
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, mobile]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (activeChatUser) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeChatUser]);

  // ── Typing indicator logic ──────────────────────────────────────────────────
  const sendTyping = useCallback((typing) => {
    if (!activeChatUser || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'typing',
      toUserId: activeChatUser.id,
      isTyping: typing,
    }));
  }, [activeChatUser]);

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    if (!isTyping.current) {
      isTyping.current = true;
      sendTyping(true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTyping.current = false;
      sendTyping(false);
    }, 2000);
  }, [sendTyping]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeChatUser) return;
    setInput('');
    isTyping.current = false;
    sendTyping(false);

    // Optimistic update
    const optimistic = {
      id:         'opt-' + Date.now(),
      fromUserId: user?.id,
      toUserId:   activeChatUser.id,
      text,
      timestamp:  new Date().toISOString(),
      status:     'sending',
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
      try {
        await apiFetch('/api/chat/messages', {
          method: 'POST',
          body: JSON.stringify({ toUserId: activeChatUser.id, text }),
        });
      } catch {
        // Mark as failed
        setMessages(prev => ({
          ...prev,
          [activeChatUser.id]: (prev[activeChatUser.id] || []).map(m =>
            m.id === optimistic.id ? { ...m, status: 'failed' } : m
          ),
        }));
      }
    }
  }, [input, activeChatUser, user?.id, sendTyping]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────

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
    minHeight: '48px',
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

  const onlineDot = (online) => ({
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
    background: online ? '#00cc44' : '#333',
    border: online ? '1px solid #009933' : '1px solid #222',
  });

  const unreadBadge = {
    background: ORANGE, color: '#000', fontSize: 9,
    fontWeight: 'bold', borderRadius: 8,
    padding: '1px 5px', minWidth: 16, textAlign: 'center',
    lineHeight: '14px',
  };

  // ── Conversation list panel ─────────────────────────────────────────────────
  const renderList = () => (
    <div style={{ width: mobile ? '100%' : 240, display: 'flex', flexDirection: 'column', borderRight: mobile ? 'none' : '1px solid #1e1e1e', height: '100%' }}>
      <div style={panelHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: ORANGE, fontSize: 10, fontWeight: 'bold', letterSpacing: '0.2em' }}>MESSAGES</span>
          {totalUnread > 0 && <span style={unreadBadge}>{totalUnread}</span>}
        </div>
        {!mobile && (
          <button
            onClick={() => openChatWindow()}
            title="Open in separate window"
            style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 11, padding: 0 }}
          >{'\u229E'}</button>
        )}
      </div>

      {/* User search */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #141414', flexShrink: 0 }}>
        <input
          style={{
            width: '100%', background: '#080808', border: '1px solid #2a2a2a',
            color: '#e0e0e0', padding: '7px 8px', fontSize: 11,
            fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', borderRadius: 2,
          }}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search users\u2026"
        />
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div style={{ borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
          {searchResults.map(u => (
            <div key={u.id} style={listItem(activeChatUser?.id === u.id)}
              onClick={() => { setSearchQuery(''); setSearchResults([]); openConversation(u); }}>
              <span style={{ color: '#ccc', fontSize: 11 }}>{u.username}</span>
              <span style={{ color: '#444', fontSize: 9 }}>START CONVERSATION</span>
            </div>
          ))}
        </div>
      )}

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length === 0 && !searchQuery && (
          <div style={{ padding: 20, color: '#2a2a2a', fontSize: 10, textAlign: 'center', lineHeight: 1.6 }}>
            No conversations yet.<br />Search for a user above to start messaging.
          </div>
        )}
        {conversations.map(c => {
          const isTypingNow = typingMap[c.otherUserId];
          return (
            <div key={c.convId} style={listItem(activeChatUser?.id === c.otherUserId)}
              onClick={() => openConversation({ id: c.otherUserId, username: c.otherUsername })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={onlineDot(onlineMap[c.otherUserId])} />
                  <span style={{ color: '#ccc', fontSize: 11, fontWeight: 'bold' }}>{c.otherUsername}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.unread > 0 && <span style={unreadBadge}>{c.unread}</span>}
                  <span style={{ color: '#2a2a2a', fontSize: 8 }}>{timeAgo(c.lastMessage?.timestamp)}</span>
                </div>
              </div>
              {isTypingNow ? (
                <span style={{ color: ORANGE, fontSize: 9, fontStyle: 'italic' }}>typing\u2026</span>
              ) : c.lastMessage ? (
                <span style={{ color: c.unread > 0 ? '#888' : '#444', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread > 0 ? '600' : 'normal' }}>
                  {c.lastMessage.fromUserId === user?.id ? 'You: ' : ''}{c.lastMessage.text}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── Conversation view ─────────────────────────────────────────────────────────
  const renderChat = () => {
    const msgs = activeChatUser ? (messages[activeChatUser.id] || []) : [];
    const partnerTyping = activeChatUser ? typingMap[activeChatUser.id] : false;
    const partnerOnline = activeChatUser ? onlineMap[activeChatUser.id] : false;

    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={panelHeader}>
          {mobile && (
            <button onClick={() => setMobileView('list')}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18, marginRight: 8, minHeight: 36, minWidth: 36 }}>
              {'\u2190'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            {activeChatUser && <span style={onlineDot(partnerOnline)} />}
            <div>
              <span style={{ color: '#e0e0e0', fontSize: 11, fontWeight: 'bold' }}>
                {activeChatUser?.username || '\u2014'}
              </span>
              {activeChatUser && (
                <div style={{ color: partnerOnline ? '#00cc44' : '#444', fontSize: 8 }}>
                  {partnerOnline ? 'online' : 'offline'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 6, WebkitOverflowScrolling: 'touch' }}>
          {loading && <div style={{ color: '#2a2a2a', fontSize: 10, textAlign: 'center' }}>Loading\u2026</div>}
          {!loading && msgs.length === 0 && activeChatUser && (
            <div style={{ color: '#2a2a2a', fontSize: 10, textAlign: 'center', marginTop: 20 }}>
              Start a conversation with {activeChatUser.username}.
            </div>
          )}
          {msgs.map(m => {
            const mine = m.fromUserId === user?.id;
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <div style={msgBubble(mine)}>{m.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <span style={{ color: '#2a2a2a', fontSize: 8 }}>{timeAgo(m.timestamp)}</span>
                  {mine && (
                    <span style={{ fontSize: 8, color: m.status === 'read' ? '#00cc44' : m.status === 'failed' ? '#ff4444' : '#444' }}>
                      {m.status === 'failed' ? '\u2717' : statusIcon(m.status || 'sent')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {/* Typing indicator */}
          {partnerTyping && (
            <div style={{ alignSelf: 'flex-start', padding: '6px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px 12px 12px 2px', fontSize: 11, color: '#666' }}>
              <span style={{ animation: 'pulse 1.5s infinite' }}>{'\u2022'} {'\u2022'} {'\u2022'}</span>
            </div>
          )}
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
                color: '#e0e0e0', padding: '10px 12px', fontSize: 12,
                fontFamily: 'inherit', outline: 'none', borderRadius: 3,
              }}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKey}
              placeholder={`Message ${activeChatUser.username}\u2026`}
              maxLength={1000}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              style={{
                background: ORANGE, border: 'none', color: '#000',
                padding: '10px 16px', cursor: 'pointer', fontSize: 12,
                fontFamily: 'inherit', fontWeight: 'bold', borderRadius: 3,
                opacity: input.trim() ? 1 : 0.4,
                minHeight: 40, minWidth: 40,
              }}
            >{'\u2191'}</button>
          </div>
        )}

        {/* No chat selected (desktop) */}
        {!activeChatUser && !mobile && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2a2a2a', fontSize: 11, flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 24 }}>{'\uD83D\uDCAC'}</div>
            Select a conversation to start messaging
          </div>
        )}
      </div>
    );
  };

  // Mobile routing
  if (mobile) {
    return <div style={base}>{mobileView === 'list' ? renderList() : renderChat()}</div>;
  }

  // Desktop: side-by-side
  return (
    <div style={base}>
      {renderList()}
      {renderChat()}
    </div>
  );
}

export { ChatPanel };
export default memo(ChatPanel);
