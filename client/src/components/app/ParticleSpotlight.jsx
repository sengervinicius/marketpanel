/**
 * ParticleSpotlight.jsx — Wave 13A: Cmd+K / Ctrl+K floating Particle search.
 *
 * Opens a centered overlay search bar (like macOS Spotlight).
 * Submits to Particle AI, shows streaming results in a floating panel.
 * Escape or click backdrop to close.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import useParticleAI from '../../hooks/useParticleAI';
import './ParticleSpotlight.css';

export default function ParticleSpotlight({ open, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const { messages, isStreaming, error, send, stop, clear } = useParticleAI();

  // Focus input when opened
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Listen for external query dispatch (from TickerContextMenu)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail && typeof e.detail === 'string') {
        send(e.detail);
      }
    };
    window.addEventListener('particle-spotlight-query', handler);
    return () => window.removeEventListener('particle-spotlight-query', handler);
  }, [send]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    send(query.trim());
    setQuery('');
  }, [query, isStreaming, send]);

  const handleClose = useCallback(() => {
    clear();
    setQuery('');
    onClose();
  }, [clear, onClose]);

  if (!open) return null;

  return (
    <div className="pspot-overlay" onClick={handleClose}>
      <div className="pspot-panel" onClick={(e) => e.stopPropagation()}>
        {/* Search bar */}
        <form className="pspot-search" onSubmit={handleSubmit}>
          <ParticleLogo size={20} />
          <input
            ref={inputRef}
            className="pspot-input"
            type="text"
            placeholder="Ask Particle anything…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {isStreaming ? (
            <button type="button" className="pspot-stop" onClick={stop}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <kbd className="pspot-kbd">ESC</kbd>
          )}
        </form>

        {/* Results area (messages) */}
        {messages.length > 0 && (
          <div className="pspot-results" ref={scrollRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`pspot-msg pspot-msg--${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="pspot-msg-avatar"><ParticleLogo size={16} /></div>
                )}
                <div className="pspot-msg-text">
                  {msg.content || (msg.streaming ? '...' : '')}
                </div>
              </div>
            ))}
            {error && <div className="pspot-error">{error}</div>}
          </div>
        )}

        {/* Hint when empty */}
        {messages.length === 0 && !query && (
          <div className="pspot-hints">
            <span className="pspot-hint">Try: "How is tech doing today?"</span>
            <span className="pspot-hint">Try: "Analyze my portfolio"</span>
            <span className="pspot-hint">Try: "What if the Fed cuts rates?"</span>
          </div>
        )}
      </div>
    </div>
  );
}
