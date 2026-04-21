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
import AnalysisCard from './AnalysisCard';
import useParticleCanvas from './useParticleCanvas';
import { useParticleChat } from '../../context/ParticleChatContext';
import { useAIChatWithContext } from '../../hooks/useAIChatWithContext';
import { useStocksData, useIndicesData } from '../../context/MarketContext';
import { useBehaviorTracker, useSmartChips } from '../../hooks/useBehavior';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePortfolio } from '../../context/PortfolioContext';
import { API_BASE, apiFetch } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import AIDisclaimer from '../common/AIDisclaimer';

const PLACEHOLDERS = [
  'Ask Particle anything...',
];

export default function ParticleScreen() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const isMobile = useIsMobile();

  const {
    messages, isStreaming, error, send, stop, clear,
    conversations, activeConversationId, convoLoading,
    loadConversation, loadConversationList, newConversation, deleteConversation, renameConversation,
  } = useParticleChat();

  // Load sidebar thread list on mount so users always see their recent chats.
  useEffect(() => { loadConversationList(); }, [loadConversationList]);
  const { buildContextualMessage } = useAIChatWithContext();

  // Wrap send to enrich messages with screen context
  const sendWithContext = useCallback((msg) => {
    if (!msg?.trim()) return;
    send(buildContextualMessage(msg.trim()));
  }, [send, buildContextualMessage]);

  // Behavior tracking + smart chips (Wave 10)
  const { trackSearch, trackChipClick } = useBehaviorTracker();
  const { chips: smartChips } = useSmartChips();

  // Brief moved to BriefNotification at App.jsx level

  // Portfolio context — drives watchlist-aware canvas particles
  let portfolioWatchlist = [];
  try {
    const { watchlist } = usePortfolio();
    portfolioWatchlist = watchlist || [];
  } catch (e) { /* PortfolioContext may not be ready */ }

  // Extract ticker mentions from conversation for canvas highlight
  const highlightTickers = useMemo(() => {
    const tickers = new Set();
    // From current query
    const qMatches = query.match(/\$([A-Z]{1,5})/g);
    if (qMatches) qMatches.forEach(m => tickers.add(m.slice(1)));
    // From last assistant message
    const lastMsg = messages.filter(m => m.role === 'assistant').pop();
    if (lastMsg?.content) {
      const mMatches = lastMsg.content.match(/\*\*([A-Z]{1,5})\*\*/g);
      if (mMatches) mMatches.forEach(m => tickers.add(m.replace(/\*/g, '')));
    }
    return [...tickers];
  }, [query, messages]);

  // Anomaly tickers — fetch periodically
  const { token } = useAuth();
  const [anomalyTickers, setAnomalyTickers] = useState([]);

  // Phase 4: Vault document count for differentiation badge
  const [vaultDocCount, setVaultDocCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch('/api/vault/documents')
      .then(r => r.ok ? r.json() : { documents: [] })
      .then(data => { if (!cancelled) setVaultDocCount((data.documents || []).length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);
  useEffect(() => {
    let cancelled = false;
    async function fetchAnomalies() {
      try {
        const res = await fetch(`${API_BASE}/api/anomalies`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.anomalies) {
          setAnomalyTickers(data.anomalies.map(a => a.symbol).filter(Boolean));
        }
      } catch { /* silent */ }
    }
    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 60000); // Refresh every 60s
    return () => { cancelled = true; clearInterval(interval); };
  }, [token]);

  // Live market data for data-driven canvas (Wave 9)
  let stocksData = null;
  try { stocksData = useStocksData(); } catch (e) { /* MarketContext may not be available */ }
  const marketData = useMemo(() => stocksData ? { stocks: stocksData } : null, [stocksData]);

  // Live indices for sentiment strip (Wave 12)
  let indicesData = null;
  try { indicesData = useIndicesData(); } catch (e) { /* ok */ }

  // Compute market state for dynamic greeting (Wave 12)
  const marketState = useMemo(() => computeMarketState(indicesData), [indicesData]);

  // Phase 2: Contextual greeting from API (live market data + portfolio)
  const [apiGreeting, setApiGreeting] = useState(null);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/brief/greeting`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.ok && data.greeting && !data.greeting.toLowerCase().includes('loading')) {
          setApiGreeting(data.greeting);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token]);

  // Determine canvas mood from conversation state + market data + portfolio performance
  const mood = useMemo(() => {
    if (isStreaming) return 'volatile';
    if (messages.length > 0) return 'bullish';
    if (marketState.closed) return 'neutral';

    // Portfolio-aware mood: aggregate portfolio positions' daily changes
    const stocks = stocksData || {};
    if (portfolioWatchlist.length > 0 && Object.keys(stocks).length > 0) {
      let greenCount = 0;
      let redCount = 0;
      let matched = 0;
      for (const sym of portfolioWatchlist) {
        const data = stocks[sym] || stocks[sym.toUpperCase()];
        if (data && data.changePct != null) {
          matched++;
          if (data.changePct > 0) greenCount++;
          else if (data.changePct < 0) redCount++;
        }
      }
      if (matched >= 2) {
        const greenRatio = greenCount / matched;
        const redRatio = redCount / matched;
        if (greenRatio >= 0.6) return 'bullish';
        if (redRatio >= 0.6) return 'bearish';
      }
    }

    return marketState.mood || 'neutral';
  }, [isStreaming, messages.length, marketState, portfolioWatchlist, stocksData]);

  // Tap-to-ask: when user taps a data particle, pre-fill search
  const handleParticleTap = useCallback((particle) => {
    if (particle.type === 'hero' || particle.type === 'entity') {
      const dir = (particle.changePct || 0) > 0 ? 'up' : 'down';
      const pct = Math.abs(particle.changePct || 0).toFixed(1);
      sendWithContext(`Tell me about $${particle.ticker} (${dir} ${pct}% today) — what's driving the move?`);
    } else if (particle.type === 'prediction') {
      sendWithContext(`Tell me about this prediction market: "${particle.title}" — currently at ${((particle.probability || 0.5) * 100).toFixed(0)}% probability.`);
    }
  }, [sendWithContext]);

  // Three.js particle canvas — Wave 14: larger, denser field
  const desktopCount = marketState.closed ? 80 : 120;
  const mobileCount  = marketState.closed ? 40 : 65;
  const canvasRef = useParticleCanvas({
    mood,
    particleCount: isMobile ? mobileCount : desktopCount,
    marketData,
    onParticleTap: handleParticleTap,
    watchlistTickers: portfolioWatchlist,
    highlightTickers,
    anomalyTickers,
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
        // Clear sessionStorage since we're handling it live
        try { sessionStorage.removeItem('particle-prefill'); } catch {}
        trackSearch(prefillQuery);
        sendWithContext(prefillQuery);
        setQuery('');
      }
    };
    window.addEventListener('particle-prefill', handler);
    return () => window.removeEventListener('particle-prefill', handler);
  }, [sendWithContext, trackSearch]);

  // On mount: check for pending prefill query from sessionStorage
  // (handles race condition when ParticleScreen wasn't mounted when event fired)
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('particle-prefill');
      if (pending) {
        sessionStorage.removeItem('particle-prefill');
        trackSearch(pending);
        sendWithContext(pending);
        setQuery('');
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;
    trackSearch(query.trim());
    sendWithContext(query.trim());
    setQuery('');
    inputRef.current?.blur();
  }, [query, isStreaming, sendWithContext, trackSearch]);

  const handleChipClick = useCallback((chipQuery) => {
    if (isStreaming) return;
    trackChipClick(chipQuery);
    sendWithContext(chipQuery);
    setQuery('');
  }, [isStreaming, sendWithContext]);

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

  // Thread sidebar collapsed state (persisted)
  const [threadsCollapsed, setThreadsCollapsed] = useState(() => {
    try { return localStorage.getItem('particle-threads-collapsed') === '1'; } catch { return false; }
  });
  const toggleThreads = useCallback(() => {
    setThreadsCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('particle-threads-collapsed', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  const handleLoadConversation = useCallback((id) => {
    if (id === activeConversationId) return;
    loadConversation(id);
  }, [activeConversationId, loadConversation]);

  const handleNewConversation = useCallback(() => {
    newConversation();
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [newConversation]);

  const handleDeleteConversation = useCallback((id, e) => {
    e?.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    deleteConversation(id);
  }, [deleteConversation]);

  const handleRenameConversation = useCallback((id, currentTitle, e) => {
    e?.stopPropagation();
    const next = prompt('Rename conversation:', currentTitle || '');
    if (next && next.trim() && next !== currentTitle) {
      renameConversation(id, next.trim());
    }
  }, [renameConversation]);

  return (
    <div
      className={`particle-screen-wrap${threadsCollapsed ? ' threads-collapsed' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Thread sidebar (desktop only, hidden on mobile via CSS) ── */}
      {!isMobile && (
        <aside className={`particle-threads${threadsCollapsed ? ' particle-threads--collapsed' : ''}`}>
          {threadsCollapsed ? (
            <button className="particle-threads-rail" onClick={toggleThreads} title="Open conversations">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="particle-threads-rail-label">CHATS</span>
            </button>
          ) : (
            <>
              <div className="particle-threads-header">
                <span className="particle-threads-title">Conversations</span>
                <div style={{ flex: 1 }} />
                <button className="particle-threads-btn" onClick={handleNewConversation} title="New conversation">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <button className="particle-threads-btn" onClick={toggleThreads} title="Collapse">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>

              <div className="particle-threads-list">
                {convoLoading && conversations.length === 0 && (
                  <div className="particle-threads-empty">Loading…</div>
                )}
                {!convoLoading && conversations.length === 0 && (
                  <div className="particle-threads-empty">
                    No conversations yet.<br />
                    Ask Particle anything to get started.
                  </div>
                )}
                {conversations.map(c => (
                  <div
                    key={c.id}
                    className={`particle-thread-item${c.id === activeConversationId ? ' active' : ''}`}
                    onClick={() => handleLoadConversation(c.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="particle-thread-item-row">
                      <div className="particle-thread-item-title">
                        {c.title || 'Untitled'}
                      </div>
                      <div className="particle-thread-item-actions">
                        <button
                          className="particle-thread-action"
                          onClick={(e) => handleRenameConversation(c.id, c.title, e)}
                          title="Rename"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </button>
                        <button
                          className="particle-thread-action particle-thread-action--danger"
                          onClick={(e) => handleDeleteConversation(c.id, e)}
                          title="Delete"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="particle-thread-item-meta">
                      <span className="particle-thread-item-count">
                        {c.messageCount || 0} msg{(c.messageCount || 0) === 1 ? '' : 's'}
                      </span>
                      <span className="particle-thread-item-time">{formatRelativeTime(c.lastMessageAt || c.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      )}

      {/* ── Main Particle screen column ── */}
      <div className="particle-screen">
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

          {/* Dynamic greeting (Phase 2: API-driven with local fallback) */}
          <h1 className="particle-screen-greeting">{apiGreeting || getDynamicGreeting(marketState)}</h1>
          <p className="particle-screen-subtitle">{getSubtitle(marketState)}</p>

          {/* Live sentiment strip (Wave 12A) */}
          <SentimentStrip indices={indicesData} />

          {/* Phase 4: Vault differentiation badge */}
          {vaultDocCount > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 20,
              background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)',
              fontSize: 10, fontWeight: 600, color: 'var(--color-vault-accent)',
              margin: '8px auto 0', letterSpacing: '0.2px',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
              {vaultDocCount} research document{vaultDocCount !== 1 ? 's' : ''} indexed — ask me about them
            </div>
          )}

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

          {/* Wire teaser removed — user requested clean welcome screen */}

          {/* Market closed empty state (Wave 12A) */}
          {marketState.closed && (
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
                    <>
                      {/* Render structured analysis card if available */}
                      {msg.structuredAnalysis ? (
                        <AnalysisCard data={msg.structuredAnalysis} />
                      ) : (
                        <ParticleMarkdown text={msg.content} />
                      )}
                    </>
                  )}
                  {/* Vault citation badges — deduplicated by source name */}
                  {msg.role === 'assistant' && msg.vaultSources && msg.vaultSources.length > 0 && !msg.streaming && (() => {
                    // Deduplicate: group by display name, merge tickers, keep best similarity
                    const seen = new Map();
                    for (const src of msg.vaultSources) {
                      const name = (src.source || src.filename || 'Unknown').trim();
                      if (seen.has(name)) {
                        const existing = seen.get(name);
                        // Merge tickers
                        const newTickers = Array.isArray(src.tickers) ? src.tickers : src.tickers ? [src.tickers] : [];
                        for (const t of newTickers) {
                          if (t && !existing.tickers.includes(t)) existing.tickers.push(t);
                        }
                        // Keep highest similarity
                        if (src.similarity && (!existing.similarity || src.similarity > existing.similarity)) {
                          existing.similarity = src.similarity;
                        }
                      } else {
                        seen.set(name, {
                          name,
                          tickers: Array.isArray(src.tickers) ? [...src.tickers] : src.tickers ? [src.tickers] : [],
                          similarity: src.similarity || null,
                          filename: src.filename || '',
                        });
                      }
                    }
                    const unique = [...seen.values()];
                    return (
                      <div className="particle-vault-citations">
                        <span className="particle-vault-citations-label">Vault</span>
                        {unique.map((src, si) => (
                          <span key={si} className="particle-vault-badge" title={`${src.filename || src.name}${src.similarity ? ` (${(src.similarity * 100).toFixed(0)}% match)` : ''}`}>
                            {src.name}
                            {src.tickers.length > 0 && (
                              <span className="particle-vault-badge-tickers"> {src.tickers.join(', ')}</span>
                            )}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  {/* Web citations from Perplexity */}
                  {msg.role === 'assistant' && msg.webCitations && msg.webCitations.length > 0 && !msg.streaming && (
                    <div className="particle-web-citations">
                      <span className="particle-web-citations-label">Sources</span>
                      <div className="particle-web-citations-list">
                        {msg.webCitations.slice(0, 6).map((url, ci) => {
                          let domain = '';
                          try { domain = new URL(url).hostname.replace('www.', ''); } catch { domain = url; }
                          return (
                            <a key={ci} className="particle-web-cite-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
                              <span className="particle-web-cite-num">{ci + 1}</span>
                              <span className="particle-web-cite-domain">{domain}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Context completeness indicator */}
                  {msg.role === 'assistant' && msg.contextMeta && msg.contextMeta.score < 70 && !msg.streaming && (
                    <div style={{ fontSize: 10, color: '#666', marginTop: 6, fontStyle: 'italic' }}>
                      Partial context ({msg.contextMeta.score}/100)
                    </div>
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
          <AIDisclaimer variant="foot" />
        </div>
      )}

      {/* Wire overlay removed */}
      </div>
    </div>
  );
}

// ── Relative time helper for thread list ──────────────────────────────────
function formatRelativeTime(ts) {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
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
  // Split on: **bold**, `code`, $TICKER, [action:TYPE:PARAMS], [N] citations,
  //           [sentiment:BULL/BEAR/NEUTRAL], [url:LINK](LABEL) patterns
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\[action:[a-z_]+(?::[^\]]+)?\]|\[\d{1,2}\]|\[sentiment:(?:bull|bear|neutral)\])/gi);
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
    // Citation marker: [1], [2], etc → styled superscript
    if (/^\[\d{1,2}\]$/.test(part)) {
      return <sup key={i} className="particle-md-cite">{part.slice(1, -1)}</sup>;
    }
    // Sentiment indicator: [sentiment:bull], [sentiment:bear], [sentiment:neutral]
    const sentMatch = part.match(/^\[sentiment:(bull|bear|neutral)\]$/i);
    if (sentMatch) {
      const mood = sentMatch[1].toLowerCase();
      const MOODS = {
        bull:    { emoji: '\u25B2', label: 'Bullish', cls: 'particle-md-sentiment--bull' },
        bear:    { emoji: '\u25BC', label: 'Bearish', cls: 'particle-md-sentiment--bear' },
        neutral: { emoji: '\u25CF', label: 'Neutral', cls: 'particle-md-sentiment--neutral' },
      };
      const m = MOODS[mood] || MOODS.neutral;
      return <span key={i} className={`particle-md-sentiment ${m.cls}`}>{m.emoji} {m.label}</span>;
    }
    // AI-to-Terminal action: [action:TYPE:PARAM]
    const actionMatch = part.match(/^\[action:([a-z_]+)(?::([^\]]+))?\]$/);
    if (actionMatch) {
      const type = actionMatch[1];
      const params = actionMatch[2] || '';
      return <ActionButton key={i} type={type} params={params} />;
    }
    return part;
  });
}

/** AI-suggested terminal action button */
function ActionButton({ type, params }) {
  const ACTIONS = {
    watchlist_add:     { label: '+ Watchlist',     icon: '\u2605', color: 'var(--color-vault-accent)' },
    alert_set:         { label: 'Set Alert',       icon: '\u26A0', color: 'var(--semantic-warn, #ff9800)' },
    chart_open:        { label: 'Open Chart',      icon: '\u25CF', color: 'var(--accent, #F97316)' },
    detail_open:       { label: 'Details',         icon: '\u2192', color: 'var(--accent, #F97316)' },
    // P2.1 — bulk alert actions the AI can suggest conversationally.
    delete_all_alerts: { label: 'Delete All',      icon: '\u2716', color: 'var(--semantic-err, #e53935)' },
    pause_alerts:      { label: 'Pause All',       icon: '\u23F8', color: 'var(--semantic-warn, #ff9800)' },
    enable_alerts:     { label: 'Resume All',      icon: '\u25B6', color: 'var(--semantic-ok, #4caf50)' },
  };
  const action = ACTIONS[type] || { label: type, icon: '\u2022', color: 'var(--text-secondary)' };
  const ticker = params.split(':')[0] || '';

  const handleClick = () => {
    // Dispatch action event — App.jsx or panels can listen and execute
    window.dispatchEvent(new CustomEvent('particle:action', {
      detail: { type, ticker, params },
    }));
  };

  return (
    <button
      className="particle-action-btn"
      onClick={handleClick}
      title={`${action.label}${ticker ? `: ${ticker}` : ''}`}
      style={{ '--action-color': action.color }}
    >
      <span className="particle-action-icon">{action.icon}</span>
      <span className="particle-action-label">{action.label}{ticker ? ` ${ticker}` : ''}</span>
    </button>
  );
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
