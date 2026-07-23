/**
 * VaultDocChat.jsx — Document-scoped Q&A interface
 *
 * Mini chat panel for asking questions about a specific vault document.
 * Uses Server-Sent Events (SSE) to stream responses from the backend via
 * the shared readSSEStream util (UTF-8-safe, line-buffered, abortable).
 */

import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../../utils/api';
import { readSSEStream, createChatAbort } from '../../utils/sseStream';
import { useAuth } from '../../context/AuthContext';
import ParticleMarkdown from '../common/ParticleMarkdown';
import AIDisclaimer from '../common/AIDisclaimer';
import './VaultDocChat.css';

export default function VaultDocChat({ documentId, filename, onClose }) {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Abort any in-flight stream when the panel unmounts so we stop fetching
  // and never setState on an unmounted component.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const question = inputValue.trim();
    setInputValue('');
    setError(null);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    // One controller per request; unmount cleanup aborts it.
    const { controller, signal } = createChatAbort();
    abortRef.current = controller;

    try {
      // Stream response from backend
      const response = await fetch(
        `${API_BASE}/api/vault/documents/${documentId}/ask`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          signal,
          body: JSON.stringify({ question }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to get response');
      }

      // Process SSE stream through the shared parser.
      let assistantContent = '';
      await readSSEStream(response, {
        signal,
        onData: (parsed) => {
          // Server-side stream failure markers (modelRouter emits
          // `{ partial: true, error }`; legacy path emitted `{ error }`).
          if (parsed.partial || (parsed.error && !parsed.content && !parsed.chunk)) {
            throw new Error(
              typeof parsed.error === 'string' ? parsed.error : 'Stream error'
            );
          }
          // NOTE: the server also emits a `{ vaultSources: [...] }` citation
          // event (same format as the main chat path). This panel doesn't
          // render citations yet, so it is intentionally ignored here.
          const delta = parsed.content ?? parsed.chunk;
          if (delta) {
            assistantContent += delta;
            // Update last message with streaming content (immutably —
            // mutating lastMsg.content in place breaks React memoization).
            setMessages(prev => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                updated[updated.length - 1] = { ...lastMsg, content: assistantContent };
              } else {
                updated.push({ role: 'assistant', content: assistantContent });
              }
              return updated;
            });
          }
        },
      });

      if (assistantContent.length === 0) {
        throw new Error('Empty response from server');
      }
    } catch (err) {
      // Unmount/abort: stop quietly — no error bubble, no setState churn.
      if (err?.name === 'AbortError') return;
      setError('Something went wrong answering that — please try again in a moment.');
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong answering that — please try again in a moment.',
          isError: true,
        },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="vault-doc-chat">
      <div className="vault-doc-chat-header">
        <div className="vault-doc-chat-title">
          <h3>{filename}</h3>
          <p className="vault-doc-chat-subtitle">Document Q&A</p>
        </div>
        <button
          className="vault-doc-chat-close"
          onClick={onClose}
          title="Close chat"
          aria-label="Close chat"
        >
          ✕
        </button>
      </div>

      <div className="vault-doc-chat-messages">
        {messages.length === 0 && !error && (
          <div className="vault-doc-chat-empty">
            <p>Ask a question about this document...</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`vault-doc-chat-message vault-doc-chat-message-${msg.role}`}
          >
            <div className="vault-doc-chat-message-avatar">
              {msg.role === 'user' ? 'You' : 'Particle'}
            </div>
            <div className="vault-doc-chat-message-content">
              {msg.isError ? (
                <p className="vault-doc-chat-error">{msg.content}</p>
              ) : (
                <ParticleMarkdown content={msg.content} />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="vault-doc-chat-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about this document..."
          disabled={loading}
          className="vault-doc-chat-input"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !inputValue.trim()}
          className="vault-doc-chat-submit"
          title="Send question"
        >
          {loading ? '⧖' : '→'}
        </button>
      </form>

      {error && (
        <div className="vault-doc-chat-error-banner">
          {error}
        </div>
      )}

      <AIDisclaimer variant="foot" />
    </div>
  );
}
