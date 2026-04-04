/**
 * AiIdeaCard.jsx
 * AI-powered trading idea card for market screens.
 * Shows a short AI-generated idea based on the current screen's thesis/context.
 * Tappable to refresh. Appears at the top of the desktop workspace or mobile home.
 */

import { useState, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './AiIdeaCard.css';

function AiIdeaCard({ screen }) {
  const [idea, setIdea] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const hasContext = screen?.aiIdeaContext && screen?.thesis;
  const screenLabel = screen?.visualLabel || screen?.label || 'Market';

  const fetchIdea = useCallback(() => {
    if (loading || !hasContext) return;
    setIdea(null);
    setError(null);
    setLoading(true);

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
    })
      .then(r => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data?.summary) {
          setIdea(data.summary);
        } else if (data?.error) {
          setError(data.error);
        } else {
          setError('No response');
        }
      })
      .catch(err => setError(err.message || 'Failed'))
      .finally(() => setLoading(false));
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

      {!idea && !loading && !error && (
        <div className="aic-prompt">
          <span className="aic-prompt-icon">✦</span>
          <span>Tap for an AI-generated trading idea based on this screen</span>
        </div>
      )}

      {loading && (
        <div className="aic-loading">
          <span className="aic-pulse"></span>
          Analyzing {screenLabel.toLowerCase()} thesis...
        </div>
      )}

      {error && !loading && (
        <div className="aic-error">
          <span>{error}</span>
          <span className="aic-retry">Tap to retry</span>
        </div>
      )}

      {idea && !loading && (
        <div className="aic-idea">{idea}</div>
      )}

      {screen.thesis && !idea && !loading && !error && (
        <div className="aic-thesis">{screen.thesis}</div>
      )}
    </div>
  );
}

export default memo(AiIdeaCard);
