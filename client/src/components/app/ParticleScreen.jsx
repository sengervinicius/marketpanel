/**
 * ParticleScreen.jsx — The Particle AI-first screen.
 *
 * Three.js particle field behind a centered greeting + search bar.
 * Submits queries to /api/search/chat via SSE streaming.
 * Shows conversation history with typing indicator.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import useParticleCanvas from './useParticleCanvas';
import useParticleAI from '../../hooks/useParticleAI';
import { useWireLatest, useMorningBrief } from '../../hooks/useWire';
import { useStocksData } from '../../context/MarketContext';
import { useBehaviorTracker, useSmartChips } from '../../hooks/useBehavior';

export default function ParticleScreen() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const { messages, isStreaming, error, send, stop, clear } = useParticleAI();

  // Behavior tracking + smart chips (Wave 10)
  const { trackSearch, trackChipClick } = useBehaviorTracker();
  const { chips: smartChips } = useSmartChips();

  // Wire & Brief hooks
  const wireLatest = useWireLatest();
  const { brief, dismissed: briefDismissed, dismiss: dismissBrief } = useMorningBrief();

  // Live market data for data-driven canvas (Wave 9)
  let stocksData = null;
  try { stocksData = useStocksData(); } catch (e) { /* MarketContext may not be available */ }
  const marketData = useMemo(() => stocksData ? { stocks: stocksData } : null, [stocksData]);

  // Determine canvas mood from conversation state
  const mood = useMemo(() => {
    if (isStreaming) return 'volatile';
    if (messages.length > 0) return 'bullish';
    return 'neutral';
  }, [isStreaming, messages.length]);

  // Tap-to-ask: when user taps a data particle, pre-fill search
  const handleParticleTap = useCallback((particle) => {
    if (particle.type === 'hero' || particle.type === 'entity') {
      const dir = (particle.changePct || 0) > 0 ? 'up' : 'down';
      const pct = Math.abs(particle.changePct || 0).toFixed(1);
      send(`Tell me about $${particle.ticker} (${dir} ${pct}% today) — what's driving the move?`);
    } else if (particle.type === 'prediction') {
      send(`Tell me about this prediction market: "${particle.title}" — currently at ${((particle.probability || 0.5) * 100).toFixed(0)}% probability.`);
    }
  }, [send]);

  // Three.js particle canvas (now data-driven)
  const canvasRef = useParticleCanvas({
    mood,
    particleCount: 40,
    marketData,
    onParticleTap: handleParticleTap,
  });

  // Whether we're in conversation mode (has messages)
  const inConversation = messages.length > 0;

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    trackSearch(query.trim());
    send(query.trim());
    setQuery('');
    inputRef.current?.blur();
  }, [query, isStreaming, send, trackSearch]);

  const handleChipClick = useCallback((chipQuery) => {
    if (isStreaming) return;
    trackChipClick(chipQuery);
    send(chipQuery);
    setQuery('');
  }, [isStreaming, send]);

  const handleNewChat = useCallback(() => {
    clear();
    setQuery('');
    inputRef.current?.focus();
  }, [clear]);

  // Focus search bar on '/' key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Escape to stop streaming
      if (e.key === 'Escape' && isStreaming) {
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStreaming, stop]);

  return (
    <div className="particle-screen">
      {/* Three.js canvas */}
      <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />

      {/* ── Welcome state (no messages) ── */}
      {!inConversation && (
        <div className="particle-screen-content">
          <ParticleLogo size={56} glow className="particle-screen-logo" />
          <h1 className="particle-screen-greeting">Good {getTimeGreeting()}</h1>
          <p className="particle-screen-subtitle">Ask anything about markets</p>

          {/* Morning Brief card */}
          {brief && !briefDismissed && (
            <MorningBriefCard brief={brief} onDismiss={dismissBrief} onAsk={send} />
          )}

          {/* Search bar */}
          <form className={`particle-search${focused ? ' particle-search--focused' : ''}`} onSubmit={handleSubmit}>
            <svg className="particle-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              ref={inputRef}
              className="particle-search-input"
              type="text"
              placeholder={focused ? 'Ask about any stock, sector, or trend…' : 'What\'s moving today?'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {query ? (
              <button type="button" className="particle-search-clear" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : (
              <kbd className="particle-search-kbd">/</kbd>
            )}
          </form>

          {/* Smart chips (personalized via Wave 10) */}
          <div className="particle-chips" style={{ opacity: focused ? 0.4 : 1, transition: 'opacity var(--duration-fast, 150ms)' }}>
            {smartChips.map(c => (
              <button key={c.label} className="particle-chip" type="button" onClick={() => handleChipClick(c.query)}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Wire teaser — latest entry */}
          {wireLatest && (
            <div className="particle-wire-teaser" onClick={() => handleChipClick(`Tell me more about: ${wireLatest.content.slice(0, 80)}`)}>
              <span className="particle-wire-label">Wire</span>
              <span className="particle-wire-text">{wireLatest.content}</span>
              <span className="particle-wire-time">{wireLatest.timestamp ? formatWireTime(wireLatest.timestamp) : ''}</span>
            </div>
          )}

          {error && (
            <div className="particle-error">{error}</div>
          )}
        </div>
      )}

      {/* ── Conversation state (has messages) ── */}
      {inConversation && (
        <div className="particle-conversation">
          {/* Header bar */}
          <div className="particle-conv-header">
            <ParticleLogo size={24} />
            <span className="particle-conv-title">Particle</span>
            <div style={{ flex: 1 }} />
            <button className="particle-conv-new" onClick={handleNewChat} title="New conversation">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Messages scroll area */}
          <div className="particle-messages" ref={scrollRef}>
            {messages.map((msg, i) => (
              <div key={i} className={`particle-msg particle-msg--${msg.role}`}>
                {msg.role === 'assistant' && (
                  <div className="particle-msg-avatar">
                    <ParticleLogo size={20} />
                  </div>
                )}
                <div className="particle-msg-bubble">
                  {msg.role === 'assistant' && msg.streaming && !msg.content ? (
                    <span className="particle-typing">
                      <span /><span /><span />
                    </span>
                  ) : (
                    <ParticleMarkdown text={msg.content} />
                  )}
                </div>
              </div>
            ))}
            {error && (
              <div className="particle-error" style={{ margin: '8px 16px' }}>{error}</div>
            )}
          </div>

          {/* Input bar (conversation mode) */}
          <form className="particle-conv-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              className="particle-search-input"
              type="text"
              placeholder={isStreaming ? 'Thinking…' : 'Follow up…'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={isStreaming}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {isStreaming ? (
              <button type="button" className="particle-conv-stop" onClick={stop} aria-label="Stop">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button type="submit" className="particle-conv-send" disabled={!query.trim()} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

// ── Markdown renderer v2 (headers, bold, bullets, tickers, code) ────────────
function ParticleMarkdown({ text }) {
  if (!text) return null;

  // Split into blocks by double newlines, preserving structure
  const blocks = text.split(/\n{2,}/).filter(Boolean);

  return (
    <div className="particle-md">
      {blocks.map((block, i) => {
        const trimmed = block.trim();

        // Heading: ### or ## or # (only at block start)
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/m);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const Tag = `h${level + 2}`; // h3, h4, h5
          return <Tag key={i} className="particle-md-heading">{renderInline(headingMatch[2])}</Tag>;
        }

        // Bullet list: lines starting with - or *
        const lines = trimmed.split('\n');
        const isList = lines.every(l => /^\s*[-*]\s/.test(l) || !l.trim());
        if (isList && lines.filter(l => l.trim()).length > 0) {
          return (
            <ul key={i} className="particle-md-list">
              {lines.filter(l => l.trim()).map((line, j) => (
                <li key={j}>{renderInline(line.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        // Numbered list: lines starting with 1. 2. etc
        const isNumbered = lines.every(l => /^\s*\d+[.)]\s/.test(l) || !l.trim());
        if (isNumbered && lines.filter(l => l.trim()).length > 0) {
          return (
            <ol key={i} className="particle-md-list">
              {lines.filter(l => l.trim()).map((line, j) => (
                <li key={j}>{renderInline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>
              ))}
            </ol>
          );
        }

        // Regular paragraph (with single newlines as line breaks)
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text) {
  // Split on: **bold**, `code`, $TICKER patterns
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?)/g);
  return parts.map((part, i) => {
    // Bold: **text**
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="particle-md-bold">{part.slice(2, -2)}</strong>;
    }
    // Code/numbers: `text`
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="particle-md-code">{part.slice(1, -1)}</code>;
    }
    // Ticker link: $AAPL (rendered as a styled tag)
    if (/^\$[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(part)) {
      return <span key={i} className="particle-md-ticker">{part}</span>;
    }
    return part;
  });
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ── Morning Brief Card ──────────────────────────────────────────────────────
function MorningBriefCard({ brief, onDismiss, onAsk }) {
  const [expanded, setExpanded] = useState(false);

  if (!brief || !brief.content) return null;

  // Extract headline (first section or first ~80 chars)
  const headline = brief.sections?.market_overnight
    ? brief.sections.market_overnight.split('.')[0] + '.'
    : brief.content.slice(0, 100).split('.')[0] + '.';

  return (
    <div className="particle-brief-card">
      <div className="particle-brief-header">
        <span className="particle-brief-badge">Morning Brief</span>
        <button className="particle-brief-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      {!expanded ? (
        <div className="particle-brief-preview" onClick={() => setExpanded(true)}>
          <p className="particle-brief-headline">{headline}</p>
          <span className="particle-brief-expand">Tap to expand</span>
        </div>
      ) : (
        <div className="particle-brief-full">
          <ParticleMarkdown text={brief.content} />
          <button
            className="particle-brief-ask"
            onClick={() => onAsk('Based on today\'s morning brief, what should I watch most closely today?')}
          >
            Ask Particle about this
          </button>
        </div>
      )}
    </div>
  );
}

function formatWireTime(ts) {
  const d = new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
