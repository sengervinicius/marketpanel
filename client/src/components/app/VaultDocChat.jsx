/**
 * VaultDocChat.jsx — Document-scoped Q&A interface
 *
 * Mini chat panel for asking questions about a specific vault document.
 * Uses Server-Sent Events (SSE) to stream responses from the backend.
 */

import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import ParticleMarkdown from '../common/ParticleMarkdown';
import './VaultDocChat.css';

export default function VaultDocChat({ documentId, filename, onClose }) {
  const { token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const question = inputValue.trim();
    setInputValue('');
    setError(null);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);

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
          body: JSON.stringify({ question }),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to get response');
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // Stream complete
                break;
              } else if (data === '[ERROR]') {
                throw new Error('Stream error');
              } else {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.content) {
                    assistantContent += parsed.content;
                    // Update last message with streaming content
                    setMessages(prev => {
                      const updated = [...prev];
                      const lastMsg = updated[updated.length - 1];
                      if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.content = assistantContent;
                      } else {
                        updated.push({ role: 'assistant', content: assistantContent });
                      }
                      return updated;
                    });
                  }
                } catch {
                  // Skip parse errors
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (assistantContent.length === 0) {
        throw new Error('Empty response from server');
      }
    } catch (err) {
      setError(err.message);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
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
    </div>
  );
}
