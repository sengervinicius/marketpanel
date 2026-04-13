/**
 * MorningBriefCard.jsx
 * Card component displaying the personalized morning brief.
 *
 * Features:
 *   - Displays brief sections with headers
 *   - Renders with ParticleMarkdown for rich formatting
 *   - Shows timestamp of when brief was generated
 *   - Refresh button to force-generate new brief
 *   - Loading state
 *   - Error handling with fallback
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiJSON } from '../../utils/api';
import ParticleMarkdown from './ParticleMarkdown';
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

export default function MorningBriefCard({ className = '' }) {
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

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

  return (
    <div className={`morning-brief-card ${className}`}>
      <div className="morning-brief-card__header">
        <div className="morning-brief-card__title">
          Morning Brief
          {brief.timestamp && (
            <span className="morning-brief-card__meta">
              {formatTimeAgo(brief.timestamp)}
            </span>
          )}
        </div>
        <button
          className="morning-brief-card__btn-refresh"
          onClick={handleRegenerateBrief}
          disabled={isGenerating}
          title="Refresh brief"
        >
          {isGenerating ? '⟳ Generating...' : '↻ Refresh'}
        </button>
      </div>

      <div className="morning-brief-card__content">
        {brief.content ? (
          <ParticleMarkdown content={brief.content} />
        ) : (
          <div className="morning-brief-card__no-content">
            Brief content unavailable
          </div>
        )}
      </div>

      {brief.personalized && (
        <div className="morning-brief-card__personalized-badge">
          Personalized for you
        </div>
      )}
    </div>
  );
}
