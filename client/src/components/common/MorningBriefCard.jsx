/**
 * MorningBriefCard.jsx — Phase 5: Multi-Stage Morning Brief Display
 *
 * Features:
 *   - Collapsed default: "Morning Brief [date] - N items relevant to you"
 *   - Expanded: the 3-section brief text rendered with ParticleMarkdown
 *   - Action chips below: "Ask about [ticker]", "Analyze [event]"
 *   - Personalized badge
 *   - Refresh / retry UI
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiJSON } from '../../utils/api';
import ParticleMarkdown from './ParticleMarkdown';
import AIDisclaimer from './AIDisclaimer';
import './MorningBriefCard.css';

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${hours}h ago`;
}

export default function MorningBriefCard({ className = '', onActionChip }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Fetch today's brief
  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJSON('/api/brief/today');
      setBrief(data.data);
    } catch (e) {
      console.error('Failed to fetch brief:', e);
      setError(e.message || 'Failed to load morning brief');
    } finally {
      setLoading(false);
    }
  }, []);

  // Force regenerate brief
  const handleRegenerateBrief = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const data = await apiJSON('/api/brief/generate', { method: 'POST' });
      setBrief(data.data);
    } catch (e) {
      console.error('Failed to regenerate brief:', e);
      setError(e.message || 'Failed to regenerate brief');
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Handle action chip click
  const handleChipClick = useCallback((chip) => {
    if (onActionChip) {
      onActionChip(chip.action);
    }
  }, [onActionChip]);

  // Initial load
  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  if (error && !brief) {
    return (
      <div className={`morning-brief-card morning-brief-card--error ${className}`}>
        <div className="morning-brief-card__header">
          <div className="morning-brief-card__title">Morning Brief</div>
        </div>
        <div className="morning-brief-card__error-message">
          {error}
        </div>
        <button
          className="morning-brief-card__btn-retry"
          onClick={fetchBrief}
          disabled={loading}
        >
          Try Again
        </button>
      </div>
    );
  }

  if (loading && !brief) {
    return (
      <div className={`morning-brief-card morning-brief-card--loading ${className}`}>
        <div className="morning-brief-card__header">
          <div className="morning-brief-card__title">Morning Brief</div>
        </div>
        <div className="morning-brief-card__loading">
          <div className="morning-brief-card__spinner" />
          Generating your brief...
        </div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className={`morning-brief-card morning-brief-card--empty ${className}`}>
        <div className="morning-brief-card__header">
          <div className="morning-brief-card__title">Morning Brief</div>
        </div>
        <div className="morning-brief-card__empty">
          No brief available yet. Check back soon!
        </div>
      </div>
    );
  }

  const relevantCount = brief.relevantCount || 0;
  const actionChips = brief.actionChips || [];

  return (
    <div className={`morning-brief-card ${expanded ? 'morning-brief-card--expanded' : ''} ${className}`}>
      {/* Collapsed / expandable header */}
      <div
        className="morning-brief-card__header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <div className="morning-brief-card__title-row">
          <div className="morning-brief-card__title">
            Morning Brief
            {brief.date && (
              <span className="morning-brief-card__date">{brief.date}</span>
            )}
            {relevantCount > 0 && (
              <span className="morning-brief-card__relevance">
                {relevantCount} item{relevantCount !== 1 ? 's' : ''} relevant to you
              </span>
            )}
          </div>
          <div className="morning-brief-card__header-actions">
            {brief.timestamp && (
              <span className="morning-brief-card__meta">
                {formatTimeAgo(brief.timestamp)}
              </span>
            )}
            <span className="morning-brief-card__chevron">
              {expanded ? '\u25B4' : '\u25BE'}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          <div className="morning-brief-card__content">
            {brief.content ? (
              <ParticleMarkdown content={brief.content} />
            ) : (
              <div className="morning-brief-card__no-content">
                Brief content unavailable
              </div>
            )}
          </div>

          {/* Action chips */}
          {actionChips.length > 0 && (
            <div className="morning-brief-card__chips">
              {actionChips.map((chip, i) => (
                <button
                  key={i}
                  className="morning-brief-card__chip"
                  onClick={(e) => { e.stopPropagation(); handleChipClick(chip); }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}

          {/* Footer: personalization badge + refresh */}
          <div className="morning-brief-card__footer">
            {brief.personalized && (
              <div className="morning-brief-card__personalized-badge">
                Personalized for you
              </div>
            )}
            <button
              className="morning-brief-card__btn-refresh"
              onClick={(e) => { e.stopPropagation(); handleRegenerateBrief(); }}
              disabled={isGenerating}
              title="Refresh brief"
            >
              {isGenerating ? 'Generating...' : 'Refresh'}
            </button>
          </div>
          <AIDisclaimer variant="foot" />
        </>
      )}
    </div>
  );
}
