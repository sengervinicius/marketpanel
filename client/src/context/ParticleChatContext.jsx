/**
 * ParticleChatContext.jsx — Global state for the Particle AI assistant.
 *
 * Owns the conversation state that used to live inside useParticleAI so that:
 *   1) Switching screens no longer wipes the open chat.
 *   2) The ParticleScreen and ParticleSidebar share one conversation.
 *   3) DB-backed threads (from /api/ai-chat) can be loaded back into the UI.
 *
 * Streaming still targets /api/search/chat (Perplexity-backed). The server
 * writes each completed turn through aiChatStore, so the list at GET
 * /api/ai-chat is our source of truth for the sidebar.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch } from '../utils/api';
import { useAuth } from './AuthContext';

const ParticleChatContext = createContext(null);

const SYSTEM_CONTEXT = [
  'You are Particle, an AI market intelligence assistant inside a professional trading terminal.',
  'Deliver institutional-grade analysis, not generic summaries.',
  'For asset questions: start with [sentiment:bull], [sentiment:bear], or [sentiment:neutral] tag.',
  'Then give a headline insight with specific numbers, followed by price action context, catalysts, and forward outlook.',
  'Format tickers in bold: **AAPL**, **$150.25**, **+2.1%**.',
  'For major assets give thorough 300-400 word analysis. For quick questions keep it at 150-200 words.',
  'Always prioritize real market data: index levels, price moves, sector performance, FX, commodities.',
  'For morning briefs: cover indices, sector rotations, FX, crypto, and macro catalysts.',
  'Never give investment advice. You can reference indicators and data.',
  'If you lack specific data, say so — never pad with generic commentary.',
  'Reference sources with [1], [2] markers when citing data — the terminal renders these as styled badges.',
].join(' ');

export function ParticleChatProvider({ children }) {
  const { token, user } = useAuth();

  // ── Live conversation state (streams into this) ─────────────────────────
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // ── Conversation sidebar state (DB-backed list) ─────────────────────────
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [conversations, setConversations] = useState([]); // [{id, title, lastMessageAt, messageCount}]
  const [convoLoading, setConvoLoading] = useState(false);

  // Mirror the active conversation id onto window so the global
  // `particle:action` handler in App.jsx can target export/email endpoints
  // without having to consume this context. Cheap, explicitly namespaced,
  // and easy to stub in tests.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__particleActiveConvoId = activeConversationId || null;
  }, [activeConversationId]);

  const loadConversationList = useCallback(async () => {
    if (!user?.id) return;
    setConvoLoading(true);
    try {
      const res = await apiFetch('/api/ai-chat?limit=50');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.conversations)) {
        setConversations(data.conversations);
      }
    } catch { /* non-critical */ }
    finally { setConvoLoading(false); }
  }, [user?.id]);

  // Load the conversation list once the user is authenticated and whenever
  // the active conversation id changes (so newly-created chats appear).
  useEffect(() => {
    loadConversationList();
  }, [loadConversationList, activeConversationId]);

  // Load one conversation's messages into the live state.
  const loadConversation = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      const res = await apiFetch(`/api/ai-chat/${encodeURIComponent(conversationId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(msgs.map(m => ({
        role: m.role,
        content: m.content || '',
        streaming: false,
        ...(m.metadata || {}),
      })));
      setActiveConversationId(String(conversationId));
      setError(null);
    } catch { /* non-critical */ }
  }, []);

  // Start a fresh conversation (clears the composer, drops the active id).
  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setActiveConversationId(null);
  }, []);

  // Delete a conversation from the sidebar + server.
  const deleteConversation = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      await apiFetch(`/api/ai-chat/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
    } catch { /* non-critical */ }
    setConversations(prev => prev.filter(c => String(c.id) !== String(conversationId)));
    if (String(activeConversationId) === String(conversationId)) {
      newConversation();
    }
  }, [activeConversationId, newConversation]);

  // Rename a conversation.
  const renameConversation = useCallback(async (conversationId, title) => {
    if (!conversationId || !title?.trim()) return;
    try {
      await apiFetch(`/api/ai-chat/${encodeURIComponent(conversationId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim() }),
      });
      setConversations(prev => prev.map(c => String(c.id) === String(conversationId)
        ? { ...c, title: title.trim() } : c));
    } catch { /* non-critical */ }
  }, []);

  // ── Send message with SSE streaming ─────────────────────────────────────
  const send = useCallback(async (userMessage) => {
    if (!userMessage?.trim() || isStreaming) return;
    setError(null);

    const trimmed = userMessage.trim();
    const displayContent = trimmed.replace(/^\[SCREEN CONTEXT\].*?\n\nUser question:\s*/s, '');
    const userMsg = { role: 'user', content: displayContent };
    const userMsgForApi = { role: 'user', content: trimmed };
    const assistantMsg = { role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const historyForApi = [...messages, userMsgForApi]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/search/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          messages: historyForApi,
          context: SYSTEM_CONTEXT,
          conversationId: activeConversationId || undefined,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let serverError = null;
        try { serverError = errText ? JSON.parse(errText) : null; } catch { /* */ }
        const code = serverError && (serverError.error || serverError.code);
        const friendly = (() => {
          if (res.status === 402) return 'Particle AI needs an active subscription. Upgrade to keep the conversation going.';
          if (res.status === 401) return 'Please sign in again to ask Particle.';
          if (res.status === 429) return 'You have reached your AI quota for now. Give it a minute and try again.';
          if (code === 'ai_chat_disabled') return 'Particle AI is temporarily offline. The team has been notified — try again in a few minutes.';
          if (code === 'vault_disabled')   return 'Vault search is temporarily offline. Try again in a few minutes.';
          if (res.status >= 500)           return 'Particle AI hit a temporary glitch. Please try again in a moment.';
          if (serverError && typeof serverError.message === 'string' && serverError.message.trim() && !serverError.message.startsWith('{')) {
            return serverError.message;
          }
          return 'Particle AI couldn’t reach its brain just now. Please try again.';
        })();
        throw new Error(friendly);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let vaultSources = null;
      let webCitations = null;
      let structuredAnalysis = null;
      let newConvoCreated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
          const payload = trimmedLine.slice(6);
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.conversationId) {
              if (!activeConversationId) newConvoCreated = true;
              setActiveConversationId(String(parsed.conversationId));
              continue;
            }
            if (parsed.vaultSources) {
              vaultSources = parsed.vaultSources;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, vaultSources };
                return updated;
              });
              continue;
            }
            if (parsed.structuredAnalysis) {
              structuredAnalysis = parsed.structuredAnalysis;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, structuredAnalysis };
                return updated;
              });
              continue;
            }
            if (parsed.contextMeta) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, contextMeta: parsed.contextMeta };
                return updated;
              });
              continue;
            }
            if (parsed.partial) {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content || '',
                    streaming: false,
                    partial: true,
                    partialError: parsed.error || 'Response interrupted — tap to retry',
                  };
                }
                return updated;
              });
              continue;
            }
            if (parsed.citations && Array.isArray(parsed.citations)) {
              webCitations = parsed.citations;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, webCitations };
                return updated;
              });
              continue;
            }
            if (parsed.chunk) {
              fullText += parsed.chunk;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: fullText };
                return updated;
              });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: fullText || '(No response)',
            streaming: false,
            vaultSources: vaultSources || last.vaultSources,
            webCitations: webCitations || null,
            structuredAnalysis: structuredAnalysis || last.structuredAnalysis,
          };
        }
        return updated;
      });

      // Refresh sidebar if a new conversation was spawned or an existing one was updated
      if (newConvoCreated || activeConversationId) {
        loadConversationList();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content || '(Cancelled)', streaming: false };
          }
          return updated;
        });
      } else {
        setError(err.message);
        setMessages(prev => {
          const updated = [...prev];
          if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
            updated.pop();
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, token, activeConversationId, loadConversationList]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  // "clear" keeps API compatibility with the old useParticleAI hook.
  const clear = useCallback(() => { newConversation(); }, [newConversation]);

  return (
    <ParticleChatContext.Provider value={{
      // live state
      messages,
      isStreaming,
      error,
      send,
      stop,
      clear,
      // conversation history
      conversations,
      activeConversationId,
      convoLoading,
      loadConversation,
      loadConversationList,
      newConversation,
      deleteConversation,
      renameConversation,
    }}>
      {children}
    </ParticleChatContext.Provider>
  );
}

export function useParticleChat() {
  const ctx = useContext(ParticleChatContext);
  if (!ctx) {
    // Permissive fallback so a component rendered outside the provider
    // (e.g. storybook / tests) doesn't hard-crash — return a no-op surface.
    return {
      messages: [], isStreaming: false, error: null,
      send: () => {}, stop: () => {}, clear: () => {},
      conversations: [], activeConversationId: null, convoLoading: false,
      loadConversation: () => {}, loadConversationList: () => {},
      newConversation: () => {}, deleteConversation: () => {}, renameConversation: () => {},
    };
  }
  return ctx;
}
