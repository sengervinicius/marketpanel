/**
 * ParticleSidebar.jsx — Wave 13A: Persistent collapsible Particle sidebar for desktop.
 *
 * Shows on the right side of the terminal layout:
 * - Search bar (submits to Particle AI)
 * - Recent conversation messages
 * - Wire feed (latest entries)
 * - Collapse/expand toggle
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import useParticleAI from '../../hooks/useParticleAI';
import { useWireFeed } from '../../hooks/useWire';
import './ParticleSidebar.css';

export default function ParticleSidebar({ collapsed, onToggle }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const { messages, isStreaming, error, send, stop, clear } = useParticleAI();
  const { entries: wireEntries } = useWireFeed(5);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    send(query.trim());
    setQuery('');
  }, [query, isStreaming, send]);

  const handleNewChat = useCallback(() => {
    clear();
    setQuery('');
    inputRef.current?.focus();
  }, [clear]);

  // Auto-scroll messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (collapsed) {
    return (
      <div className="psb-collapsed" onClick={onToggle} title="Open Particle sidebar">
        <ParticleLogo size={20} />
        <span className="psb-collapsed-label">AI</span>
      </div>
    );
  }

  return (
    <div className="psb-container">
      {/* Header */}
      <div className="psb-header">
        <ParticleLogo size={18} />
        <span className="psb-header-title">Particle</span>
        <div style={{ flex: 1 }} />
        {messages.length > 0 && (
          <button className="psb-btn" onClick={handleNewChat} title="New conversation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
        <button className="psb-btn" onClick={onToggle} title="Collapse sidebar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Search input */}
      <form className="psb-search" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="psb-search-input"
          type="text"
          placeholder={isStreaming ? 'Thinking…' : 'Ask Particle…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          disabled={isStreaming}
          autoComplete="off"
        />
        {isStreaming ? (
          <button type="button" className="psb-search-btn" onClick={stop} aria-label="Stop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="psb-search-btn" disabled={!query.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </form>

      {/* Messages area */}
      {messages.length > 0 ? (
        <div className="psb-messages" ref={scrollRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`psb-msg psb-msg--${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="psb-msg-avatar"><ParticleLogo size={14} /></div>
              )}
              <div className="psb-msg-text">
                {msg.content || (msg.streaming ? '...' : '')}
              </div>
            </div>
          ))}
          {error && <div className="psb-error">{error}</div>}
        </div>
      ) : (
        /* Wire feed when no conversation */
        <div className="psb-wire-section">
          <div className="psb-wire-header">
            <span className="psb-wire-badge">THE WIRE</span>
          </div>
          {wireEntries.length === 0 ? (
            <div className="psb-wire-empty">No Wire entries yet</div>
          ) : (
            wireEntries.map((entry, i) => (
              <div key={i} className="psb-wire-entry" onClick={() => {
                send(`Tell me more about: ${entry.content.slice(0, 80)}`);
              }}>
                <div className="psb-wire-content">{entry.content}</div>
                <div className="psb-wire-meta">
                  {entry.tickers?.map(t => (
                    <span key={t} className="psb-wire-ticker">${t}</span>
                  ))}
                  <span className="psb-wire-time">{formatTime(entry.created_at || entry.timestamp)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
