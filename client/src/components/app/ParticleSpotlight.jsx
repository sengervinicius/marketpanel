/**
 * ParticleSpotlight.jsx — Full-screen immersive Cmd+K / Ctrl+K particle search overlay.
 *
 * Opens a full-screen overlay with particle canvas background, centered search bar,
 * and streaming AI responses. Scale animation on open/close.
 * Escape or click backdrop to close.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import useParticleAI from '../../hooks/useParticleAI';
import useParticleCanvas from './useParticleCanvas';
import './ParticleSpotlight.css';

export default function ParticleSpotlight({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [closing, setClosing] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const canvasRef = useParticleCanvas({ particleCount: 30, mood: 'neutral' });
  const { messages, isStreaming, error, send, stop, clear } = useParticleAI();

  // Focus input when opened
  useEffect(() => {
    if (open && !closing) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, closing]);

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
        handleCloseAnimated();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  const handleCloseAnimated = useCallback(() => {
    setClosing(true);
    const timer = setTimeout(() => {
      clear();
      setQuery('');
      setClosing(false);
      onClose();
    }, 150);
    return () => clearTimeout(timer);
  }, [clear, onClose]);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      handleCloseAnimated();
    }
  }, [handleCloseAnimated]);

  if (!open) return null;

  return (
    <div
      className={`ps-overlay ${closing ? 'ps-overlay--closing' : ''}`}
      onClick={handleBackdropClick}
    >
      {/* Particle canvas as background */}
      <canvas ref={canvasRef} className="ps-canvas" />

      {/* Content above canvas */}
      <div className="ps-content">
        {/* Search bar */}
        <form className="ps-search" onSubmit={handleSubmit}>
          <ParticleLogo size={16} />
          <input
            ref={inputRef}
            className="ps-input"
            type="text"
            placeholder="Ask Particle anything…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
          />
          {isStreaming ? (
            <button type="button" className="ps-stop" onClick={stop}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <kbd className="ps-kbd">ESC</kbd>
          )}
        </form>

        {/* Results area (messages) */}
        {messages.length > 0 && (
          <div className="ps-results" ref={scrollRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`ps-msg ps-msg--${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="ps-msg-avatar"><ParticleLogo size={14} /></div>
                )}
                <div className="ps-msg-text">
                  {msg.content || (msg.streaming ? '...' : '')}
                </div>
              </div>
            ))}
            {error && <div className="ps-error">{error}</div>}
          </div>
        )}

        {/* Hint when empty */}
        {messages.length === 0 && !query && (
          <div className="ps-hints">
            <span className="ps-hint">Try: "How is tech doing today?"</span>
            <span className="ps-hint">Try: "Analyze my portfolio"</span>
            <span className="ps-hint">Try: "What if the Fed cuts rates?"</span>
          </div>
        )}
      </div>
    </div>
  );
}
