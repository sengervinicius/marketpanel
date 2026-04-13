/**
 * ParticleScreen.jsx — The Particle AI-first screen.
 *
 * Three.js particle field behind a centered greeting + search bar.
 * Submits queries to /api/search/chat via SSE streaming.
 * Shows conversation history with typing indicator.
 *
 * Wave 12: Dynamic greeting, live sentiment strip, empty state, pull-to-refresh
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import useParticleCanvas from './useParticleCanvas';
import useParticleAI from '../../hooks/useParticleAI';
import { useWireLatest } from '../../hooks/useWire';
import { useStocksData, useIndicesData } from '../../context/MarketContext';
import { useBehaviorTracker, useSmartChips } from '../../hooks/useBehavior';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useWireFeed } from '../../hooks/useWire';

const PLACEHOLDERS = [
  'What is moving in markets today?',
  'Analyze my portfolio risk',
  'What do analysts say about AAPL?',
  'Compare tech vs energy this quarter',
  'What happened in Asia overnight?',
  'Show me the top movers today',
];

export default function ParticleScreen() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const isMobile = useIsMobile();

  const { messages, isStreaming, error, send, stop, clear } = useParticleAI();

  // Behavior tracking + smart chips (Wave 10)
  const { trackSearch, trackChipClick } = useBehaviorTracker();
  const { chips: smartChips } = useSmartChips();

  // Wire & Brief hooks
  const wireLatest = useWireLatest();
  // Morning brief moved to BriefNotification at App.jsx level
  // Desktop Wire overlay feed (Wave 13B)
  const { entries: wireOverlayEntries } = useWireFeed(isMobile ? 0 : 4);

  // Live market data for data-driven canvas (Wave 9)
  let stocksData = null;
  try { stocksData = useStocksData(); } catch (e) { /* MarketContext may not be available */ }
  const marketData = useMemo(() => stocksData ? { stocks: stocksData } : null, [stocksData]);

  // Live indices for sentiment strip (Wave 12)
  let indicesData = null;
  try { indicesData = useIndicesData(); } catch (e) { /* ok */ }

  // Compute market state for dynamic greeting (Wave 12)
  const marketState = useMemo(() => computeMarketState(indicesData), [indicesData]);

  // Determine canvas mood from conversation state + market data
  const mood = useMemo(() => {
    if (isStreaming) return 'volatile';
    if (messages.length > 0) return 'bullish';
    if (marketState.closed) return 'neutral'; // calm when market closed
    return marketState.mood || 'neutral';
  }, [isStreaming, messages.length, marketState]);

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

  // Three.js particle canvas — Wave 13B: higher count on desktop
  const desktopCount = marketState.closed ? 50 : 80;
  const mobileCount  = marketState.closed ? 25 : 40;
  const canvasRef = useParticleCanvas({
    mood,
    particleCount: isMobile ? mobileCount : desktopCount,
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

  // Placeholder cycling effect — cycles every 3 seconds, pauses on focus
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx(prev => (prev + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Listen for particle-prefill events (from HeaderSearchBar "Ask Particle" or TickerContextMenu)
  useEffect(() => {
    const handler = (e) => {
      const prefillQuery = e.detail;
      if (prefillQuery && typeof prefillQuery === 'string') {
        trackSearch(prefillQuery);
        send(prefillQuery);
        setQuery('');
      }
    };
    window.addEventListener('particle-prefill', handler);
    return () => window.removeEventListener('particle-prefill', handler);
  }, [send, trackSearch]);

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

  // Pull-to-refresh (Wave 12B) — in welcome state only
  const pullRef = useRef(null);
  const touchStartY = useRef(0);
  const [pullProgress, setPullProgress] = useState(0);

  const handleTouchStart = useCallback((e) => {
    if (inConversation) return;
    touchStartY.current = e.touches[0].clientY;
  }, [inConversation]);

  const handleTouchMove = useCallback((e) => {
    if (inConversation) return;
    const diff = e.touches[0].clientY - touchStartY.current;
    if (diff > 0 && diff < 120) {
      setPullProgress(Math.min(diff / 80, 1));
    }
  }, [inConversation]);

  const handleTouchEnd = useCallback(() => {
    if (pullProgress >= 1) {
      // Trigger refresh — clear conversation and let data re-fetch
      clear();
      setQuery('');
    }
    setPullProgress(0);
  }, [pullProgress, clear]);

  // Focus search bar on '/' key — only in welcome state (Wave 12B)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !inConversation && document.activeElement !== inputRef.current) {
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
  }, [isStreaming, stop, inConversation]);

  return (
    <div
      className="particle-screen"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {pullProgress > 0 && (
        <div className="particle-pull-indicator" style={{ opacity: pullProgress, transform: `translateY(${pullProgress * 30}px)` }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: `rotate(${pullProgress * 180}deg)` }}>
            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </div>
      )}

      {/* Three.js canvas */}
      <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />

      {/* ── Welcome state (no messages) ── */}
      {!inConversation && (
        <div className="particle-screen-content" ref={pullRef}>
          <ParticleLogo size={56} glow className="particle-screen-logo" />

          {/* Dynamic greeting (Wave 12A) */}
          <h1 className="particle-screen-greeting">{getDynamicGreeting(marketState)}</h1>
          <p className="particle-screen-subtitle">{getSubtitle(marketState)}</p>

          {/* Live sentiment strip (Wave 12A) */}
          <SentimentStrip indices={indicesData} />

          {/* Morning Brief moved to BriefNotification (App.jsx level) */}

          {/* Search bar */}
          <form className={`particle-search${focused ? ' particle-search--focused' : ''}`} onSubmit={handleSubmit}>
            <div className="particle-search-icon">
              <ParticleLogo size={16} />
            </div>
            <input
              ref={inputRef}
              className="particle-search-input"
              type="text"
              placeholder={PLACEHOLDERS[placeholderIdx]}
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

          {/* Market closed empty state (Wave 12A) */}
          {marketState.closed && !wireLatest && (
            <div className="particle-closed-state">
              <span className="particle-closed-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <span className="particle-closed-text">
                {marketState.nextOpen ? `Markets open ${marketState.nextOpen}` : 'Markets are closed'}
              </span>
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

      {/* Wave 13B: Desktop Wire overlay — translucent feed on the canvas */}
      {!isMobile && !inConversation && wireOverlayEntries.length > 0 && (
        <div className="particle-wire-overlay">
          <div className="particle-wire-overlay-header">
            <span className="particle-wire-overlay-badge">THE WIRE</span>
          </div>
          {wireOverlayEntries.map((entry, i) => (
            <div
              key={i}
              className="particle-wire-overlay-entry"
              onClick={() => send(`Tell me more about: ${entry.content.slice(0, 80)}`)}
            >
              <span className="particle-wire-overlay-text">{entry.content}</span>
              <span className="particle-wire-overlay-time">
                {entry.created_at || entry.timestamp ? formatWireTime(entry.created_at || entry.timestamp) : ''}
              </span>
            </div>
          ))}
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

// ── Wave 12A: Dynamic greeting — time + market-state aware ─────────────────
function getDynamicGreeting(ms) {
  const h = new Date().getHours();
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';

  if (ms.closed) return `Good ${time}`;
  if (ms.bigMove) return `Good ${time} — big moves`;
  if (ms.mood === 'volatile') return `Good ${time} — volatile session`;
  if (ms.mood === 'bullish') return `Good ${time} — markets up`;
  if (ms.mood === 'bearish') return `Good ${time} — markets under pressure`;
  return `Good ${time}`;
}

function getSubtitle(ms) {
  if (ms.closed) {
    return ms.overnightSummary || 'Markets are closed — ask about anything';
  }
  if (ms.bigMove) return 'Something\'s happening — ask Particle';
  return 'Ask anything about markets';
}

function computeMarketState(indices) {
  const now = new Date();
  const h = now.getUTCHours() - 4; // approximate ET
  const day = now.getDay();
  const isWeekend = day === 0 || day === 6;
  const isAfterHours = h < 4 || h >= 20; // extended hours window
  const closed = isWeekend || (h < 4 || h >= 20);
  const premarket = !isWeekend && h >= 4 && h < 9.5;

  let mood = 'neutral';
  let bigMove = false;
  let overnightSummary = '';
  let nextOpen = '';

  if (closed) {
    if (isWeekend) {
      nextOpen = day === 6 ? 'Monday 9:30 AM' : 'tomorrow 9:30 AM';
    } else if (h >= 20) {
      nextOpen = 'tomorrow 9:30 AM';
    } else {
      nextOpen = 'today at 9:30 AM';
    }
  }

  // Determine mood from indices
  if (indices) {
    const spyData = indices['SPY'] || indices['spy'];
    const vixData = indices['VIX'] || indices['vix'] || indices['^VIX'];

    if (spyData?.changePct != null) {
      const pct = spyData.changePct;
      if (Math.abs(pct) > 1.5) bigMove = true;
      if (pct > 0.3) mood = 'bullish';
      else if (pct < -0.3) mood = 'bearish';
    }
    if (vixData?.price != null) {
      if (vixData.price > 25) mood = 'volatile';
      if (vixData.price > 30) { mood = 'volatile'; bigMove = true; }
    }

    // Build overnight summary for closed state
    if (closed && spyData?.changePct != null) {
      const dir = spyData.changePct > 0 ? 'up' : 'down';
      overnightSummary = `S&P closed ${dir} ${Math.abs(spyData.changePct).toFixed(1)}% in the last session`;
    }
  }

  return { closed, premarket, mood, bigMove, overnightSummary, nextOpen };
}

// ── Wave 12A: Live sentiment strip — scrolling index + prediction bar ──────
function SentimentStrip({ indices }) {
  const items = useMemo(() => {
    if (!indices) return [];
    const TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];
    const LABELS  = { SPY: 'S&P 500', QQQ: 'Nasdaq', DIA: 'Dow', IWM: 'Russell', VIX: 'VIX' };
    return TICKERS
      .map(t => {
        const d = indices[t] || indices[t.toLowerCase()];
        if (!d || d.price == null) return null;
        return {
          label: LABELS[t] || t,
          price: d.price,
          pct: d.changePct ?? 0,
          ticker: t,
        };
      })
      .filter(Boolean);
  }, [indices]);

  if (items.length === 0) return null;

  return (
    <div className="particle-sentiment-strip">
      {items.map(it => (
        <span key={it.ticker} className={`particle-sentiment-item ${it.pct >= 0 ? 'up' : 'down'}`}>
          <span className="particle-sentiment-label">{it.label}</span>
          <span className="particle-sentiment-pct">{it.pct >= 0 ? '+' : ''}{it.pct.toFixed(1)}%</span>
        </span>
      ))}
    </div>
  );
}

// MorningBriefCard moved to BriefNotification.jsx (rendered at App.jsx level)

function formatWireTime(ts) {
  const d = new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
