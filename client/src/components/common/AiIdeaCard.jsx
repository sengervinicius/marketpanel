/**
 * AiIdeaCard.jsx
 * AI-powered trading idea card for market screens.
 * Shows the screen thesis by default; user taps to request an AI idea.
 * Never auto-fetches. Gracefully handles errors (no raw server messages).
 * Includes a 10-second timeout guard.
 */

import { useState, useCallback, useRef, memo } from 'react';
import { apiFetch } from '../../utils/api';
import { checkAIAvailable } from '../../hooks/useAIInsight';
import './AiIdeaCard.css';

const FETCH_TIMEOUT_MS = 10000;

function AiIdeaCard({ screen }) {
  const [idea, setIdea] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false); // true = last attempt failed (no raw msg shown)
  const abortRef = useRef(null);

  const hasContext = screen?.aiIdeaContext && screen?.thesis;
  const screenLabel = screen?.visualLabel || screen?.label || 'Market';

  const fetchIdea = useCallback(() => {
    if (loading || !hasContext) return;

    // If AI is known to be unavailable, don't even try
    if (!checkAIAvailable()) {
      setFailed(true);
      return;
    }

    setIdea(null);
    setFailed(false);
    setLoading(true);

    // Abort previous request if any
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Timeout guard — abort after 10s
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const prompt = [
      `You are a senior market strategist. Give ONE concise, actionable trading idea (2-3 sentences max) for this market screen.`,
      `Screen: ${screen.label}`,
      `Thesis: ${screen.thesis}`,
      `Context: ${screen.aiIdeaContext}`,
      `Key symbols: ${(screen.heroSymbols || []).join(', ')}`,
      `Be specific about direction, timeframe, and catalyst. Use professional but accessible language.`,
    ].join('\n');

    apiFetch('/api/search/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: prompt }),
      signal: controller.signal,
    })
      .then(r => {
        if (!r.ok) throw new Error('unavailable');
        return r.json();
      })
      .then(data => {
        if (data?.summary) {
          setIdea(data.summary);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        // Graceful: never show raw error messages
        setFailed(true);
      })
      .finally(() => {
        clearTimeout(timer);
        setLoading(false);
      });
  }, [loading, hasContext, screen]);

  if (!hasContext) return null;

  return (
    <div className="aic-card" onClick={fetchIdea} role="button" tabIndex={0}>
      <div className="aic-header">
        <span className="aic-badge">AI IDEA</span>
        <span className="aic-screen-label">{screenLabel.toUpperCase()}</span>
        <span className="aic-refresh" title="Generate new idea">
          {loading ? '...' : '↻'}
        </span>
      </div>

      {/* Default state: show thesis + tap prompt */}
      {!idea && !loading && !failed && (
        <>
          <div className="aic-thesis">{screen.thesis}</div>
          <div className="aic-prompt">
            <span className="aic-prompt-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg></span>
            <span>Tap for AI analysis</span>
          </div>
        </>
      )}

      {loading && (
        <div className="aic-loading">
          <span className="aic-pulse"></span>
          Analyzing {screenLabel.toLowerCase()} thesis...
        </div>
      )}

      {/* Failure: show thesis with muted retry prompt — never a raw error */}
      {failed && !loading && (
        <>
          <div className="aic-thesis">{screen.thesis}</div>
          <div className="aic-prompt aic-prompt--muted">
            <span>AI unavailable — tap to retry</span>
          </div>
        </>
      )}

      {idea && !loading && (
        <div className="aic-idea">{idea}</div>
      )}
    </div>
  );
}

export default memo(AiIdeaCard);
