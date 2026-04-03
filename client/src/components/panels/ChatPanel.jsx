/**
 * ChatPanel.jsx — Production-quality DM chat
 *
 * Phase 3B: Full visual system cleanup.
 *   - All inline styles replaced with CSS classes from App.css
 *   - Token-based design: backgrounds, borders, text, accent, spacing, radius
 *   - Improved spacing, typography, bubbles, badges, empty states, composer
 *   - Animated typing indicator with dot keyframes
 *   - Mobile-responsive via .chat-sidebar--mobile + media queries
 *   - Preserved all existing behavior: WS, REST fallback, optimistic send,
 *     typing indicators, presence, read receipts, dedup, auto-scroll
 */

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../utils/api';
import { WS_URL } from '../../utils/constants';
import UserAvatar from '../common/UserAvatar';
import './Chat.css';

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
    case 'sending': return '\u2022';
    case 'sent':    return '\u2713';
    case 'delivered': return '\u2713\u2713';
    case 'read':   return '\u2713\u2713';
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


// ── Instrument card component for shared instruments in chat ──
export function ChatInstrumentCard({ ticker, name, price, change, changePct, onClick }) {
  const dir = changePct >= 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '\u25B2' : '\u25BC';
  const sign = changePct >= 0 ? '+' : '';
  return (
    <div className="chat-instrument-card" onClick={() => onClick && onClick(ticker)}>
      <div className="chat-instrument-card-ticker">{ticker}</div>
      <div className="chat-instrument-card-name">{name}</div>
      <div className="chat-instrument-card-price">{price}</div>
      <div className={`chat-instrument-card-change ${dir}`}>
        {arrow} {sign}{change} ({sign}{changePct != null ? changePct.toFixed(2) : '0.00'}%)
      </div>
    </div>
  );
}

function ChatPanel({ mobile, initialUserId }) {
  const { user, token } = useAuth();
  const [conversations,    setConversations]    = useState([]);
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchResults,    setSearchResults]    = useState([]);
  const [activeChatUser,   setActiveChatUser]   = useState(
    initialUserId ? { id: initialUserId, username: '\u2026' } : null
  );
  const [messages,         setMessages]         = useState({});
  const [aiMessages,       setAiMessages]       = useState([]);
  const [input,            setInput]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [aiLoading,        setAiLoading]        = useState(false);
  const [mobileView,       setMobileView]       = useState('list');
  const [onlineMap,        setOnlineMap]        = useState({});
  const [typingMap,        setTypingMap]        = useState({});
  const [totalUnread,      setTotalUnread]      = useState(0);
  const messagesEndRef = useRef(null);
  const wsRef          = useRef(null);
  const typingTimer    = useRef(null);
  const isTyping       = useRef(false);
  const activeChatRef  = useRef(activeChatUser);

  useEffect(() => { activeChatRef.current = activeChatUser; }, [activeChatUser]);

  // Load conversations on mount
  useEffect(() => {
    apiFetch('/api/chat/conversations')
      .then(r => r.json())
      .then(d => {
        setConversations(d.conversations || []);
        setTotalUnread(d.totalUnread || 0);
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
            if (existing.some(e => e.id === m.id || (e.id?.startsWith('opt-') && e.text === m.text && e.toUserId === m.toUserId))) {
              return {
                ...prev,
                [partnerId]: existing.map(e =>
                  (e.id?.startsWith('opt-') && e.text === m.text && e.toUserId === m.toUserId) ? m : e
                ),
              };
            }
            return { ...prev, [partnerId]: [...existing, m] };
          });

          if (m.fromUserId !== user?.id && activeChatRef.current?.id === partnerId) {
            ws.send(JSON.stringify({ type: 'mark_read', otherUserId: partnerId }));
          }

          apiFetch('/api/chat/conversations')
            .then(r => r.json())
            .then(d => {
              setConversations(d.conversations || []);
              setTotalUnread(d.totalUnread || 0);
            })
            .catch(() => {});
        }

        if (msg.type === 'typing') {
          setTypingMap(prev => ({ ...prev, [msg.fromUserId]: msg.isTyping }));
          if (msg.isTyping) {
            setTimeout(() => {
              setTypingMap(prev => ({ ...prev, [msg.fromUserId]: false }));
            }, 5000);
          }
        }

        if (msg.type === 'presence') {
          setOnlineMap(prev => ({ ...prev, [msg.userId]: msg.online }));
        }

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

    // AI Assistant doesn't load messages
    if (otherUser.id === 'ai-assistant') {
      return;
    }

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

  // ── Typing indicator logic ──
  const sendTyping = useCallback((typing) => {
    if (!activeChatUser || activeChatUser.id === 'ai-assistant') return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'typing',
      toUserId: activeChatUser.id,
      isTyping: typing,
    }));
  }, [activeChatUser]);

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    if (!activeChatUser || activeChatUser.id === 'ai-assistant') return;
    if (!isTyping.current) {
      isTyping.current = true;
      sendTyping(true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTyping.current = false;
      sendTyping(false);
    }, 2000);
  }, [sendTyping, activeChatUser]);

  // ── AI Chat: send message with streaming response ──
  const sendAiMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeChatUser || activeChatUser.id !== 'ai-assistant') return;
    setInput('');

    const userMsg = { role: 'user', content: text, id: 'msg-' + Date.now() };
    const assistantMsg = { role: 'assistant', content: '', id: 'msg-' + (Date.now() + 1) };

    setAiMessages(prev => [...prev, userMsg, assistantMsg]);
    setAiLoading(true);

    try {
      const authToken = localStorage.getItem('token');
      const response = await fetch('/api/search/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          messages: [...aiMessages, userMsg].map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.chunk) {
                setAiMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: updated[updated.length - 1].content + parsed.chunk,
                  };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('AI chat error:', err);
      setAiMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: 'Error: Failed to get response from AI.',
        };
        return updated;
      });
    } finally {
      setAiLoading(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [input, activeChatUser, aiMessages]);

  // ── Send message ──
  const sendMessage = useCallback(async () => {
    if (activeChatUser?.id === 'ai-assistant') {
      return sendAiMessage();
    }

    const text = input.trim();
    if (!text || !activeChatUser) return;
    setInput('');
    isTyping.current = false;
    sendTyping(false);

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

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat_message',
        toUserId: activeChatUser.id,
        text,
      }));
    } else {
      try {
        await apiFetch('/api/chat/messages', {
          method: 'POST',
          body: JSON.stringify({ toUserId: activeChatUser.id, text }),
        });
      } catch {
        setMessages(prev => ({
          ...prev,
          [activeChatUser.id]: (prev[activeChatUser.id] || []).map(m =>
            m.id === optimistic.id ? { ...m, status: 'failed' } : m
          ),
        }));
      }
    }
  }, [input, activeChatUser, user?.id, sendTyping, sendAiMessage]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Conversation list panel ──
  const renderList = () => (
    <div className={`chat-sidebar${mobile ? ' chat-sidebar--mobile' : ''}`}>
      <div className="chat-header">
        <div className="chat-header-title">
          <span className="chat-header-label">MESSAGES</span>
          {totalUnread > 0 && <span className="chat-badge">{totalUnread}</span>}
        </div>
        {!mobile && (
          <button className="btn chat-btn-icon"
            onClick={() => openChatWindow()}
            title="Open in separate window"

          >{'\u229E'}</button>
        )}
      </div>

      {/* User search */}
      <div className="chat-search-wrap">
        <input
          className="chat-search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search users\u2026"
        />
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="chat-search-results">
          {searchResults.map(u => (
            <div key={u.id} className="chat-search-item"
              onClick={() => { setSearchQuery(''); setSearchResults([]); openConversation(u); }}>
              <span className="chat-search-item-name">{u.username}</span>
              <span className="chat-search-item-hint">START CONVERSATION</span>
            </div>
          ))}
        </div>
      )}

      {/* Conversation list */}
      <div className="chat-list">
        {/* AI Assistant (pinned) */}
        {!searchQuery && (
          <div className={`chat-ai-entry${activeChatUser?.id === 'ai-assistant' ? ' chat-ai-entry--active' : ''}`}
            onClick={() => openConversation({ id: 'ai-assistant', username: 'AI Assistant' })}>
            <div className="chat-ai-avatar">🤖</div>
            <div className="chat-ai-entry-body">
              <div className="chat-ai-entry-name">AI Assistant</div>
              <div className="chat-ai-entry-hint">Chat with AI</div>
            </div>
          </div>
        )}

        {conversations.length === 0 && !searchQuery && (
          <div className="chat-empty">
            <div className="chat-empty-icon">{'\uD83D\uDCAC'}</div>
            <div className="chat-empty-title">No conversations yet</div>
            <div>Search for a user above to start messaging.</div>
          </div>
        )}
        {conversations.map(c => {
          const isTypingNow = typingMap[c.otherUserId];
          const isActive = activeChatUser?.id === c.otherUserId;
          return (
            <div key={c.convId} className="chat-list-item" data-active={isActive}
              onClick={() => openConversation({ id: c.otherUserId, username: c.otherUsername })}>
              <div className="chat-list-row">
                <div className="chat-list-user">
                  <UserAvatar user={{ id: c.otherUserId, username: c.otherUsername, persona: c.otherPersona }} size="small" />
                  <span className={`chat-dot chat-dot--${onlineMap[c.otherUserId] ? 'online' : 'offline'}`} />
                  <span className="chat-list-name">{c.otherUsername}</span>
                </div>
                <div className="chat-list-meta">
                  {c.unread > 0 && <span className="chat-badge">{c.unread}</span>}
                  <span className="chat-list-time">{timeAgo(c.lastMessage?.timestamp)}</span>
                </div>
              </div>
              {isTypingNow ? (
                <span className="chat-list-typing">typing{'\u2026'}</span>
              ) : c.lastMessage ? (
                <span className={`chat-list-preview${c.unread > 0 ? ' chat-list-preview--unread' : ''}`}>
                  {c.lastMessage.fromUserId === user?.id ? 'You: ' : ''}{c.lastMessage.text}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── AI Chat view ──
  const renderAiChat = () => {
    const isAiChat = activeChatUser?.id === 'ai-assistant';
    if (!isAiChat) return null;

    return (
      <div className="chat-main">
        <div className="chat-header">
          {mobile && (
            <button onClick={() => setMobileView('list')} className="chat-back-btn">
              {'\u2190'}
            </button>
          )}
          <div className="chat-header-title">
            <span style={{ fontSize: '18px', marginRight: '8px' }}>🤖</span>
            <div>
              <span className="chat-header-name">AI Assistant</span>
              <div className="chat-header-status chat-header-status--online">
                Always available
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {aiMessages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon">🤖</div>
              <div className="chat-empty-title">Start a conversation</div>
              <div>Ask AI Assistant anything below.</div>
            </div>
          )}
          {aiMessages.map(m => (
            <div key={m.id} className={`chat-msg-wrap chat-msg-wrap--${m.role === 'user' ? 'mine' : 'theirs'}`}>
              <div className={`chat-bubble${m.role === 'user' ? ' chat-bubble--mine' : ' chat-bubble--ai'}`}>
                {m.content}
              </div>
            </div>
          ))}
          {aiLoading && (
            <div className="chat-typing-bubble">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="chat-composer">
          <input
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask AI Assistant..."
            maxLength={2000}
          />
          <button className="btn chat-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || aiLoading}

          >{'\u2191'}</button>
        </div>
      </div>
    );
  };

  // ── Conversation view ──
  const renderChat = () => {
    const isAiChat = activeChatUser?.id === 'ai-assistant';
    if (isAiChat) return renderAiChat();

    const msgs = activeChatUser ? (messages[activeChatUser.id] || []) : [];
    const partnerTyping = activeChatUser ? typingMap[activeChatUser.id] : false;
    const partnerOnline = activeChatUser ? onlineMap[activeChatUser.id] : false;

    return (
      <div className="chat-main">
        <div className="chat-header">
          {mobile && (
            <button onClick={() => setMobileView('list')} className="chat-back-btn">
              {'\u2190'}
            </button>
          )}
          <div className="chat-header-title">
            {activeChatUser && (
              <span className={`chat-dot chat-dot--${partnerOnline ? 'online' : 'offline'}`} />
            )}
            <div>
              <span className="chat-header-name">
                {activeChatUser?.username || '\u2014'}
              </span>
              {activeChatUser && (
                <div className={`chat-header-status chat-header-status--${partnerOnline ? 'online' : 'offline'}`}>
                  {partnerOnline ? 'online' : 'offline'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {loading && (
            <div className="chat-empty">Loading{'\u2026'}</div>
          )}
          {!loading && msgs.length === 0 && activeChatUser && (
            <div className="chat-empty">
              <div className="chat-empty-icon">{'\u270D'}</div>
              <div className="chat-empty-title">Start a conversation</div>
              <div>Send {activeChatUser.username} a message below.</div>
            </div>
          )}
          {msgs.map(m => {
            const mine = m.fromUserId === user?.id;
            return (
              <div key={m.id} className={`chat-msg-wrap chat-msg-wrap--${mine ? 'mine' : 'theirs'}`}>
                <div className={`chat-bubble chat-bubble--${mine ? 'mine' : 'theirs'}`}>{m.text}</div>
                <div className="chat-msg-meta">
                  <span className="chat-msg-time">{timeAgo(m.timestamp)}</span>
                  {mine && (
                    <span className={`chat-msg-status chat-msg-status--${m.status || 'sent'}`}>
                      {m.status === 'failed' ? '\u2717' : statusIcon(m.status || 'sent')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {/* Typing indicator */}
          {partnerTyping && (
            <div className="chat-typing-bubble">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        {activeChatUser && (
          <div className="chat-composer">
            <input
              className="chat-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKey}
              placeholder={`Message ${activeChatUser.username}\u2026`}
              maxLength={1000}
            />
            <button className="btn chat-send-btn"
              onClick={sendMessage}
              disabled={!input.trim()}

            >{'\u2191'}</button>
          </div>
        )}

        {/* No chat selected (desktop) */}
        {!activeChatUser && !mobile && (
          <div className="chat-empty" style={{ flex: 1, justifyContent: 'center' }}>
            <div className="chat-empty-icon">{'\uD83D\uDCAC'}</div>
            <div className="chat-empty-title">Select a conversation</div>
            <div>Pick someone from the list to start messaging.</div>
          </div>
        )}
      </div>
    );
  };

  // Mobile routing
  if (mobile) {
    return <div className="chat-root">{mobileView === 'list' ? renderList() : renderChat()}</div>;
  }

  // Desktop: side-by-side
  return (
    <div className="chat-root">
      {renderList()}
      {renderChat()}
    </div>
  );
}

export { ChatPanel };
export default memo(ChatPanel);
