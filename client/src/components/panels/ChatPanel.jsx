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
import { useScreenContext } from '../../context/ScreenContext';
import { useAIChatWithContext } from '../../hooks/useAIChatWithContext';
import { apiFetch } from '../../utils/api';
import { WS_URL } from '../../utils/constants';
import UserAvatar from '../common/UserAvatar';
import { swallow } from '../../utils/swallow';
import ParticleLogo from '../ui/ParticleLogo';
import ParticleMarkdown from '../common/ParticleMarkdown';
import InsightFeed from '../insights/InsightFeed';
import AIDisclaimer from '../common/AIDisclaimer';
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

// AI chat history lives entirely on the user's device (localStorage) and
// expires 24h after the last save. The rolling 24h window keeps the UX of
// "my chat is still here if I flip to another screen and come back" while
// bounding how long sensitive research text sits on disk — there is no
// server-side retention for AI chat. Users can also hit Clear at any time.
const AI_CHAT_TTL_MS = 24 * 60 * 60 * 1000;

function ChatPanel({ mobile, initialUserId }) {
  const { user, token } = useAuth();
  const screenContext = useScreenContext();
  const { buildContextualMessage } = useAIChatWithContext();
  const [conversations,    setConversations]    = useState([]);
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchResults,    setSearchResults]    = useState([]);
  const [activeChatUser,   setActiveChatUser]   = useState(
    initialUserId ? { id: initialUserId, username: '\u2026' } : null
  );
  const [messages,         setMessages]         = useState({});
  const [aiMessages,       setAiMessages]       = useState([]);
  // P5: DB-backed AI chat history.
  // - aiConversations: sidebar list of recent (last 24h) conversations.
  // - activeAiConvoId: id of the conversation currently open (null = unsaved /
  //   brand-new chat that hasn't been persisted yet).
  // - aiHistoryLoading: gates spinner/empty-state in the rail.
  const [aiConversations,  setAiConversations]  = useState([]);
  const [activeAiConvoId,  setActiveAiConvoId]  = useState(null);
  const [aiHistoryLoading, setAiHistoryLoading] = useState(false);
  // Inline rename state for the AI conversation rail. `renamingConvoId` is
  // the id of the row currently being renamed (null = nothing open).
  const [renamingConvoId,  setRenamingConvoId]  = useState(null);
  const [renameDraft,      setRenameDraft]      = useState('');
  const [input,            setInput]            = useState('');
  const [loading,          setLoading]          = useState(false);
  const [aiLoading,        setAiLoading]        = useState(false);
  const [mobileView,       setMobileView]       = useState('list');
  const [onlineMap,        setOnlineMap]        = useState({});
  const [typingMap,        setTypingMap]        = useState({});
  const [totalUnread,      setTotalUnread]      = useState(0);
  const [copiedMsgId,      setCopiedMsgId]      = useState(null);
  const [showTtlNotice,    setShowTtlNotice]    = useState(false);
  const messagesEndRef = useRef(null);
  const wsRef          = useRef(null);
  const typingTimer    = useRef(null);
  const isTyping       = useRef(false);
  const activeChatRef  = useRef(activeChatUser);

  useEffect(() => { activeChatRef.current = activeChatUser; }, [activeChatUser]);

  // Load AI messages from localStorage on mount, honouring the 24h TTL.
  // Stored shape is { messages, savedAt }. Legacy plain-array entries from
  // before TTL was introduced are upgraded in place on the next save.
  useEffect(() => {
    if (!user?.id) return;
    try {
      const storageKey = `particle_ai_chat_${user.id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        let list = null;
        let savedAt = null;
        if (Array.isArray(parsed)) {
          // Legacy format — no savedAt, treat as a fresh start to avoid
          // silently keeping potentially-very-old history around.
          list = parsed;
          savedAt = null;
        } else if (parsed && Array.isArray(parsed.messages)) {
          list = parsed.messages;
          savedAt = Number(parsed.savedAt) || null;
        }
        if (list) {
          if (savedAt && Date.now() - savedAt > AI_CHAT_TTL_MS) {
            // Expired — drop it and clear the key.
            localStorage.removeItem(storageKey);
            setAiMessages([]);
          } else {
            setAiMessages(list.slice(-50));
          }
        }
      }
      // First-use banner: show once per user so they know chats live locally
      // for 24h. Dismissal persists in a separate key.
      const noticeKey = `particle_ai_chat_ttl_notice_${user.id}`;
      if (!localStorage.getItem(noticeKey)) {
        setShowTtlNotice(true);
      }
    } catch (err) {
      console.warn('Failed to load AI chat history from localStorage:', err);
    }
  }, [user?.id]);

  // Save AI messages to localStorage whenever they change, stamping savedAt
  // so the TTL window rolls forward with activity. Quiet sessions still
  // expire 24h after the last save.
  useEffect(() => {
    if (!user?.id || aiMessages.length === 0) return;
    try {
      const storageKey = `particle_ai_chat_${user.id}`;
      const toStore = aiMessages.slice(-50);
      localStorage.setItem(storageKey, JSON.stringify({
        messages: toStore,
        savedAt:  Date.now(),
      }));
    } catch (err) {
      console.warn('Failed to save AI chat history to localStorage:', err);
    }
  }, [aiMessages, user?.id]);

  const dismissTtlNotice = useCallback(() => {
    setShowTtlNotice(false);
    if (user?.id) {
      try {
        localStorage.setItem(`particle_ai_chat_ttl_notice_${user.id}`, String(Date.now()));
      } catch (e) { swallow(e, 'panel.chat.ls_ttl_notice'); }
    }
  }, [user?.id]);

  // ── P5: DB-backed AI chat history loaders ──────────────────────────────
  // Pull the sidebar list (last 24h). Credentials are required because the
  // endpoint is auth-gated. Swallows errors into an empty list so the UI
  // degrades to the localStorage-only experience on API failure.
  const loadAiConversations = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { API_BASE } = await import('../../utils/api');
      const res = await fetch(`${API_BASE}/api/ai-chat`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.ok && Array.isArray(data.conversations)) {
        setAiConversations(data.conversations);
      }
    } catch (err) {
      console.warn('Failed to load AI conversations:', err);
    }
  }, [user?.id]);

  // Load one conversation's full message history and make it the active one.
  // Replaces whatever is currently in aiMessages.
  const openAiConversation = useCallback(async (convoId) => {
    if (!user?.id || !convoId) return;
    setAiHistoryLoading(true);
    try {
      const { API_BASE } = await import('../../utils/api');
      const res = await fetch(`${API_BASE}/api/ai-chat/${convoId}`, { credentials: 'include' });
      if (!res.ok) {
        setAiHistoryLoading(false);
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.ok && Array.isArray(data.messages)) {
        // Normalise to the shape the renderer expects (role, content, id).
        const msgs = data.messages.map((m, i) => ({
          id: 'hist-' + (m.id || i),
          role: m.role,
          content: m.content,
        }));
        setAiMessages(msgs);
        setActiveAiConvoId(String(convoId));
      }
    } catch (err) {
      console.warn('Failed to load AI conversation:', err);
    } finally {
      setAiHistoryLoading(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [user?.id]);

  // "New chat" — clear the active conversation so the next turn triggers
  // server-side lazy creation and the sidebar gets a fresh entry.
  const startNewAiConversation = useCallback(() => {
    setActiveAiConvoId(null);
    setAiMessages([]);
  }, []);

  // Rename a conversation (owner-only on server). Optimistically apply the
  // new title locally so the rail updates without waiting for the round
  // trip, then rollback if the PATCH fails.
  const beginRenameAiConversation = useCallback((convo) => {
    if (!convo) return;
    setRenamingConvoId(String(convo.id));
    setRenameDraft(convo.title || '');
  }, []);

  const cancelRenameAiConversation = useCallback(() => {
    setRenamingConvoId(null);
    setRenameDraft('');
  }, []);

  const commitRenameAiConversation = useCallback(async () => {
    const convoId = renamingConvoId;
    const next = renameDraft.trim().slice(0, 80);
    // Always close the input first — the UI shouldn't linger on network.
    setRenamingConvoId(null);
    setRenameDraft('');
    if (!convoId || !user?.id) return;
    // Server requires a non-empty title; an empty/whitespace draft means
    // "don't change it". Just exit without touching anything.
    if (!next) return;
    const prev = aiConversations;
    const current = prev.find(c => String(c.id) === String(convoId));
    if (!current) return;
    if ((current.title || '') === next) return; // no-op
    // Optimistic update.
    setAiConversations(list => list.map(c =>
      String(c.id) === String(convoId) ? { ...c, title: next } : c
    ));
    try {
      const { API_BASE } = await import('../../utils/api');
      const res = await fetch(`${API_BASE}/api/ai-chat/${convoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        // Roll back on failure.
        setAiConversations(prev);
      }
    } catch (err) {
      console.warn('Failed to rename AI conversation:', err);
      setAiConversations(prev);
    }
  }, [renamingConvoId, renameDraft, user?.id, aiConversations]);

  // Delete a conversation (owner-only on server). Optimistically remove
  // from the list; if the currently-open conversation is deleted, reset
  // to the empty "new chat" state.
  const deleteAiConversation = useCallback(async (convoId) => {
    if (!user?.id || !convoId) return;
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      const { API_BASE } = await import('../../utils/api');
      const res = await fetch(`${API_BASE}/api/ai-chat/${convoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setAiConversations(prev => prev.filter(c => String(c.id) !== String(convoId)));
        if (String(activeAiConvoId) === String(convoId)) {
          startNewAiConversation();
        }
      }
    } catch (err) {
      console.warn('Failed to delete AI conversation:', err);
    }
  }, [user?.id, activeAiConvoId, startNewAiConversation]);

  // Load the list once on mount (and whenever user changes), plus again
  // when the user switches into the AI chat surface so a conversation
  // started in another tab shows up on return.
  useEffect(() => {
    if (!user?.id) return;
    loadAiConversations();
  }, [user?.id, loadAiConversations]);

  useEffect(() => {
    if (activeChatUser?.id === 'ai-assistant' && user?.id) {
      loadAiConversations();
    }
  }, [activeChatUser?.id, user?.id, loadAiConversations]);

  // ── Per-message share helpers ──────────────────────────────────────
  const shareSubject = 'Particle AI answer';
  const copyAiMessage = useCallback(async (m) => {
    const text = (m?.content || '').trim();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback for older Safari / non-secure contexts.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedMsgId(m.id);
      setTimeout(() => setCopiedMsgId(prev => (prev === m.id ? null : prev)), 1600);
    } catch (err) {
      console.warn('Copy failed:', err);
    }
  }, []);

  const emailAiMessage = useCallback((m) => {
    const text = (m?.content || '').trim();
    if (!text) return;
    // mailto: payloads must be URL-encoded; most clients accept ~8KB in the
    // body before truncating. Particle replies are usually well within.
    const body = encodeURIComponent(text + '\n\n— Shared from Particle');
    const subject = encodeURIComponent(shareSubject);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }, []);

  const whatsappAiMessage = useCallback((m) => {
    const text = (m?.content || '').trim();
    if (!text) return;
    // https://wa.me/?text=... opens WhatsApp (web/desktop/mobile) with the
    // text pre-filled and lets the user pick the recipient. No phone number
    // means no recipient is preselected, which is what we want for share.
    const url = `https://wa.me/?text=${encodeURIComponent(text + '\n\n— Shared from Particle')}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

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
      } catch (e) { swallow(e, 'panel.chat.ws_message'); }
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
      } catch (e) { swallow(e, 'panel.chat.load_messages'); } finally {
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

    // Display original user message, but build contextual content for API
    const contextualContent = buildContextualMessage(text);
    const userMsg = { role: 'user', content: text, id: 'msg-' + Date.now() };
    const userMsgForApi = { role: 'user', content: contextualContent };
    const assistantMsg = { role: 'assistant', content: '', id: 'msg-' + (Date.now() + 1) };

    setAiMessages(prev => [...prev, userMsg, assistantMsg]);
    setAiLoading(true);

    try {
      const { API_BASE } = await import('../../utils/api');
      const response = await fetch(`${API_BASE}/api/search/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: [
            ...aiMessages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            userMsgForApi,
          ],
          // P5: thread the active conversation through so the server appends
          // to the same row instead of creating a new one each turn.
          conversationId: activeAiConvoId || undefined,
        }),
      });

      if (!response.ok) throw new Error('Failed to get AI response');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Tracks whether this turn produced a brand-new conversation row so
      // we can refresh the sidebar after the stream finishes (rather than
      // on every chunk).
      let newConvoCreated = false;

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
              // P5: server emits conversationId once at stream start. Bind it
              // to the active conversation so subsequent turns land on the
              // same row.
              if (parsed.conversationId) {
                if (!activeAiConvoId) newConvoCreated = true;
                setActiveAiConvoId(String(parsed.conversationId));
              }
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
            } catch (e) { swallow(e, 'panel.chat.sse_parse'); }
          }
        }
      }
      // Refresh sidebar after the assistant turn lands so the title (which
      // is derived from the first user message) and last_message_at appear
      // immediately. Done after the stream so we don't thrash on every chunk.
      if (newConvoCreated || activeAiConvoId) {
        loadAiConversations();
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
  }, [input, activeChatUser, aiMessages, buildContextualMessage, activeAiConvoId, loadAiConversations]);

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
            <div className="chat-ai-avatar"><ParticleLogo size={18} /></div>
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
  const clearAiChatHistory = useCallback(() => {
    if (!user?.id) return;
    if (!window.confirm('Clear AI chat history? This cannot be undone.')) return;
    try {
      const storageKey = `particle_ai_chat_${user.id}`;
      localStorage.removeItem(storageKey);
      setAiMessages([]);
    } catch (err) {
      console.error('Failed to clear chat history:', err);
    }
  }, [user?.id]);

  // P5: short relative-time formatter for the conversation rail.
  // Mirrors timeAgo() but uses lastMessageAt and stays compact for the rail.
  const aiConvoTimeAgo = (iso) => {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.round(diff / 60) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    return Math.round(diff / 86400) + 'd ago';
  };

  // P5 / Phase 9.4: AI conversation history rail. Renders the user's
  // last-24h conversations from the server (DB-backed, cross-device).
  // Hidden on mobile to keep the chat surface uncluttered — mobile users
  // can still start a new chat, just without the rail.
  //
  // Interactions: click a row to load it; pencil icon to rename inline
  // (Enter commits, Esc cancels); × icon to delete. The active row is
  // marked with an orange accent bar to match the terminal's selection
  // visual vocabulary.
  const renderAiHistoryRail = () => (
    <div className="chat-ai-rail">
      <div className="chat-ai-rail-header">
        <span className="chat-ai-rail-title">AI &middot; LAST 24H</span>
        <button
          type="button"
          className="chat-ai-rail-new-btn"
          onClick={startNewAiConversation}
          title="Start a new conversation"
        >+ NEW</button>
      </div>
      <div className="chat-ai-rail-list">
        {aiHistoryLoading && aiConversations.length === 0 && (
          <div className="chat-ai-rail-loading">Loading</div>
        )}
        {!aiHistoryLoading && aiConversations.length === 0 && (
          <div className="chat-ai-rail-empty">
            No recent chats. Ask something to start one.
          </div>
        )}
        {aiConversations.map(c => {
          const isActive = String(c.id) === String(activeAiConvoId);
          const isRenaming = String(c.id) === String(renamingConvoId);
          const hasTitle = Boolean(c.title);
          const itemClass = [
            'chat-ai-rail-item',
            isActive ? 'chat-ai-rail-item--active' : '',
          ].filter(Boolean).join(' ');
          const titleClass = [
            'chat-ai-rail-item-title',
            hasTitle ? '' : 'chat-ai-rail-item-title--placeholder',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={c.id}
              className={itemClass}
              data-active={isActive}
              onClick={() => { if (!isRenaming) openAiConversation(c.id); }}
            >
              <div className="chat-ai-rail-item-row">
                {isRenaming ? (
                  <input
                    autoFocus
                    type="text"
                    className="chat-ai-rail-title-input"
                    value={renameDraft}
                    maxLength={80}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRenameAiConversation();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRenameAiConversation();
                      }
                    }}
                    onBlur={() => commitRenameAiConversation()}
                  />
                ) : (
                  <span className={titleClass} title={c.title || 'New chat'}>
                    {c.title || 'New chat'}
                  </span>
                )}
                {!isRenaming && (
                  <span className="chat-ai-rail-actions">
                    <button
                      type="button"
                      className="chat-ai-rail-icon-btn"
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); beginRenameAiConversation(c); }}
                    >{'\u270E'}</button>
                    <button
                      type="button"
                      className="chat-ai-rail-icon-btn chat-ai-rail-icon-btn--danger"
                      title="Delete conversation"
                      onClick={(e) => { e.stopPropagation(); deleteAiConversation(c.id); }}
                    >{'\u00D7'}</button>
                  </span>
                )}
              </div>
              <span className="chat-ai-rail-meta">
                {aiConvoTimeAgo(c.lastMessageAt)}
                {c.messageCount ? ` \u00B7 ${c.messageCount} msg` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderAiChat = () => {
    const isAiChat = activeChatUser?.id === 'ai-assistant';
    if (!isAiChat) return null;

    // Wrap the rail + chat surface in a horizontal flex so the rail sits
    // to the left of the existing chat-main column. Hidden on mobile.
    return (
      <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%' }}>
        {!mobile && renderAiHistoryRail()}
      <div className="chat-main">
        <div className="chat-header">
          {mobile && (
            <button onClick={() => setMobileView('list')} className="chat-back-btn">
              {'\u2190'}
            </button>
          )}
          <div className="chat-header-title">
            <div style={{ marginRight: '8px' }}><ParticleLogo size={18} /></div>
            <div>
              <span className="chat-header-name">AI Assistant</span>
              <div className="chat-header-status chat-header-status--online">
                Always available
              </div>
            </div>
          </div>
          {aiMessages.length > 0 && (
            <>
              <button
                onClick={startNewAiConversation}
                className="chat-clear-history-btn"
                title="Start a new conversation"
                style={{
                  background: 'none',
                  border: '1px solid var(--border, #2a2a2a)',
                  cursor: 'pointer',
                  padding: '4px 10px',
                  marginRight: 6,
                  borderRadius: 4,
                  color: 'var(--text-secondary, #999)',
                  fontSize: 12,
                }}
              >
                + New
              </button>
              <button
                onClick={clearAiChatHistory}
                className="chat-clear-history-btn"
                title="Clear local cache"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px',
                  color: 'var(--text-secondary, #999)',
                  fontSize: '14px',
                }}
              >
                Clear
              </button>
            </>
          )}
        </div>

        {showTtlNotice && (
          <div className="chat-ttl-notice" role="status">
            <span className="chat-ttl-notice-body">
              Chats are kept for 24 hours so you can pick them back up across devices,
              then cleared automatically.
            </span>
            <button
              type="button"
              className="chat-ttl-notice-dismiss"
              onClick={dismissTtlNotice}
              aria-label="Dismiss notice"
            >OK</button>
          </div>
        )}

        {/* Messages */}
        <div className="chat-messages">
          {aiMessages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-icon"><ParticleLogo size={32} /></div>
              <div className="chat-empty-title">Start a conversation</div>
              <div>Ask AI Assistant anything below.</div>
            </div>
          )}
          {aiMessages.map(m => {
            const isAssistant = m.role === 'assistant';
            // Hide share actions on the streaming placeholder (empty content)
            // until the first chunk lands — otherwise Copy/Email fire on ''.
            const canShare = isAssistant && !!(m.content || '').trim();
            return (
              <div key={m.id} className={`chat-msg-wrap chat-msg-wrap--${m.role === 'user' ? 'mine' : 'theirs'}`}>
                <div className={`chat-bubble${m.role === 'user' ? ' chat-bubble--mine' : ' chat-bubble--ai'}`}>
                  {isAssistant ? <ParticleMarkdown content={m.content} /> : m.content}
                </div>
                {canShare && (
                  <div className="chat-msg-actions" role="group" aria-label="Share this answer">
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() => copyAiMessage(m)}
                      title="Copy to clipboard"
                    >{copiedMsgId === m.id ? 'Copied' : 'Copy'}</button>
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() => emailAiMessage(m)}
                      title="Share via email"
                    >Email</button>
                    <button
                      type="button"
                      className="chat-msg-action"
                      onClick={() => whatsappAiMessage(m)}
                      title="Share via WhatsApp"
                    >WhatsApp</button>
                  </div>
                )}
              </div>
            );
          })}
          {aiLoading && (
            <div className="chat-typing-bubble">
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
              <span className="chat-typing-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Phase 7: Proactive Insight Feed — between messages and composer */}
        <InsightFeed
          onAskAI={(question) => {
            setInput(question);
          }}
          maxCards={3}
        />

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
        {/* W0.4 — AI disclaimer, persistent on every AI chat surface */}
        <AIDisclaimer variant="foot" />
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
