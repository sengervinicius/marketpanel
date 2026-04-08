import { useMemo } from 'react';
import { useAIInsight } from '../../hooks/useAIInsight';
import AIError from './AIError';
import './AIInsightCard.css';

/**
 * AIInsightCard — universal AI insight display component.
 * Wraps useAIInsight and renders loading, error, or insight content.
 *
 * @param {Object} props
 * @param {string} props.type - AI insight type
 * @param {Object} props.context - Request context/body
 * @param {string} props.cacheKey - Cache key
 * @param {number} [props.ttlMs] - Cache TTL
 * @param {boolean} [props.autoFetch=false] - Auto-fetch on mount
 * @param {string} [props.title] - Override title
 * @param {boolean} [props.compact=false] - Compact mode for smaller spaces
 */
export default function AIInsightCard({ type, context, cacheKey, ttlMs, autoFetch = false, title: titleOverride, compact = false }) {
  const { loading, error, insight, refresh, available } = useAIInsight({
    type,
    context,
    cacheKey,
    ttlMs,
    autoFetch,
  });

  const displayTitle = titleOverride || insight?.title || 'AI INSIGHT';

  // Format timestamp
  const timeLabel = useMemo(() => {
    if (!insight?.generatedAt) return null;
    try {
      const d = new Date(insight.generatedAt);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
    } catch {
      return null;
    }
  }, [insight?.generatedAt]);

  // AI unavailable — clean empty state, no spinner/error/retry
  if (!available && !insight) {
    return (
      <div className={`ai-card ai-card--empty ${compact ? 'ai-card--compact' : ''}`}>
        <div className="ai-card__header">
          <span className="ai-card__badge" style={{ opacity: 0.5 }}>AI</span>
          <span className="ai-card__title" style={{ opacity: 0.5 }}>{displayTitle}</span>
        </div>
        <p className="ai-card__text" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>AI insights coming soon</p>
      </div>
    );
  }

  // Not yet fetched — show trigger button
  if (!loading && !error && !insight) {
    return (
      <div className={`ai-card ai-card--empty ${compact ? 'ai-card--compact' : ''}`}>
        <button className="ai-card__trigger" onClick={refresh}>
          <span className="ai-card__trigger-icon">AI</span>
          <span className="ai-card__trigger-text">Generate {displayTitle}</span>
        </button>
      </div>
    );
  }

  // Loading skeleton
  if (loading && !insight) {
    return (
      <div className={`ai-card ai-card--loading ${compact ? 'ai-card--compact' : ''}`}>
        <div className="ai-card__header">
          <span className="ai-card__badge">AI</span>
          <span className="ai-card__title">{displayTitle}</span>
        </div>
        <div className="ai-card__skeleton">
          <div className="ai-card__skeleton-line ai-card__skeleton-line--long" />
          <div className="ai-card__skeleton-line ai-card__skeleton-line--medium" />
          <div className="ai-card__skeleton-line ai-card__skeleton-line--short" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !insight) {
    return <AIError message={error} onRetry={refresh} compact={compact} />;
  }

  // Success — render insight
  return (
    <div className={`ai-card ai-card--loaded ${compact ? 'ai-card--compact' : ''}`}>
      <div className="ai-card__header">
        <span className="ai-card__badge">AI</span>
        <span className="ai-card__title">{displayTitle}</span>
        <div className="ai-card__actions">
          {timeLabel && <span className="ai-card__time">{timeLabel}</span>}
          <button
            className="ai-card__refresh"
            onClick={refresh}
            disabled={loading}
            title="Refresh insight"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>
      <div className="ai-card__body">
        {insight.body && <p className="ai-card__text">{insight.body}</p>}
        {insight.bullets && insight.bullets.length > 0 && (
          <ul className="ai-card__bullets">
            {insight.bullets.map((b, i) => (
              <li key={i} className="ai-card__bullet">{b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
