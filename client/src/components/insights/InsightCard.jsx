/**
 * InsightCard.jsx — Phase 7: Proactive Insight Card
 *
 * Renders a single market event insight with severity indicator,
 * narrative text, timestamp, dismiss button, and latent question chips.
 *
 * Props:
 *   id        — unique insight ID
 *   type      — event type string (price_move, vix_spike, etc.)
 *   ticker    — ticker symbol (nullable for macro/factor events)
 *   narrative — one-sentence description from Haiku
 *   severity  — 'low' | 'medium' | 'high'
 *   timestamp — ISO 8601 detected_at
 *   questions — array of latent follow-up questions
 *   onDismiss — callback(id) when user dismisses
 *   onAskAI   — callback(question) when user clicks a question chip
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import './InsightCard.css';

// Event type → icon (small Unicode, no emoji per project rules)
const TYPE_ICONS = {
  price_move:       '\u25B2', // triangle up
  high_low_break:   '\u2195', // up-down arrow
  unusual_volume:   '\u2593', // dark shade block
  sector_divergence:'\u21C4', // rightwards over leftwards arrows
  factor_move:      '\u2261', // identical to sign (triple bar)
  prediction_shift: '\u2248', // almost equal
  vix_spike:        '\u26A0', // warning
  rate_move:        '\u2234', // therefore
  dxy_move:         '\u0024', // dollar sign
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

export default function InsightCard({
  id, type, ticker, narrative, severity = 'low', timestamp,
  questions = [], onDismiss, onAskAI,
}) {
  const [dismissing, setDismissing] = useState(false);
  const [entering, setEntering] = useState(true);
  const cardRef = useRef(null);

  // Slide-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setEntering(false), 20);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissing(true);
    // Wait for fade-out animation then remove
    setTimeout(() => onDismiss?.(id), 150);
  }, [id, onDismiss]);

  const handleQuestionClick = useCallback((q) => {
    onAskAI?.(q);
  }, [onAskAI]);

  const icon = TYPE_ICONS[type] || '\u2022';

  return (
    <div
      ref={cardRef}
      className={`insight-card insight-card--${severity}${dismissing ? ' insight-card--dismissing' : ''}${entering ? ' insight-card--entering' : ''}`}
    >
      <div className="insight-card-main">
        <div className="insight-card-left">
          <span className="insight-card-icon">{icon}</span>
        </div>
        <div className="insight-card-center">
          <span className="insight-card-narrative">{narrative}</span>
        </div>
        <div className="insight-card-right">
          <span className="insight-card-time">{timeAgo(timestamp)}</span>
          <button className="insight-card-dismiss" onClick={handleDismiss} title="Dismiss">
            x
          </button>
        </div>
      </div>
      {questions.length > 0 && (
        <div className="insight-card-questions">
          {questions.map((q, i) => (
            <button
              key={i}
              className="insight-question-chip"
              onClick={() => handleQuestionClick(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
