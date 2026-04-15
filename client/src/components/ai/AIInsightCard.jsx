import { useMemo } from 'react';
import { useAIInsight } from '../../hooks/useAIInsight';
import AIError from './AIError';
import './AIInsightCard.css';

/**
 * Simple markdown-to-JSX renderer for AI insight text.
 * Handles: **bold**, *italic*, ## headers, [n] footnotes, newlines, bullet lists.
 */
function renderMarkdown(text) {
  if (!text) return null;

  // Split into lines and process
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    // Headers: ##, ###, ####
    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const content = formatInline(headerMatch[2]);
      const fontSize = level <= 2 ? '12px' : '11px';
      elements.push(
        <div key={key++} style={{
          fontSize,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginTop: elements.length > 0 ? '10px' : '0',
          marginBottom: '4px',
          letterSpacing: '0.3px',
          textTransform: level <= 2 ? 'uppercase' : 'none',
        }}>
          {content}
        </div>
      );
      continue;
    }

    // Bullet points: - or *
    if (line.match(/^[-*]\s+/)) {
      const content = formatInline(line.replace(/^[-*]\s+/, ''));
      elements.push(
        <div key={key++} style={{
          display: 'flex',
          gap: '6px',
          marginBottom: '3px',
          fontSize: '11px',
          lineHeight: '1.5',
        }}>
          <span style={{ color: 'var(--color-ai)', flexShrink: 0 }}>•</span>
          <span style={{ color: 'var(--text-secondary)' }}>{content}</span>
        </div>
      );
      continue;
    }

    // Numbered items: 1) or 1.
    if (line.match(/^\d+[.)]\s+/)) {
      const num = line.match(/^(\d+)[.)]/)[1];
      const content = formatInline(line.replace(/^\d+[.)]\s+/, ''));
      elements.push(
        <div key={key++} style={{
          display: 'flex',
          gap: '6px',
          marginBottom: '3px',
          fontSize: '11px',
          lineHeight: '1.5',
        }}>
          <span style={{ color: 'var(--color-ai)', flexShrink: 0, fontWeight: 600 }}>{num}.</span>
          <span style={{ color: 'var(--text-secondary)' }}>{content}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} style={{
        fontSize: '11px',
        lineHeight: '1.5',
        color: 'var(--text-secondary)',
        marginBottom: '4px',
      }}>
        {formatInline(line)}
      </p>
    );
  }

  return elements;
}

/**
 * Format inline markdown: **bold**, *italic*, [n] footnotes
 */
function formatInline(text) {
  if (!text) return text;

  // Remove footnote references like [1], [2], [1][2]
  let clean = text.replace(/\[\d+\]/g, '');

  // Split on **bold** and *italic* patterns
  const parts = [];
  let remaining = clean;
  let partKey = 0;

  while (remaining.length > 0) {
    // Match **bold**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Match *italic*
    const italicMatch = remaining.match(/\*(.+?)\*/);

    // Find earliest match
    let match = null;
    let type = null;

    if (boldMatch && (!italicMatch || boldMatch.index <= italicMatch.index)) {
      match = boldMatch;
      type = 'bold';
    } else if (italicMatch) {
      match = italicMatch;
      type = 'italic';
    }

    if (!match) {
      parts.push(remaining);
      break;
    }

    // Add text before the match
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }

    // Add formatted text
    if (type === 'bold') {
      parts.push(
        <strong key={`b${partKey++}`} style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {match[1]}
        </strong>
      );
    } else {
      parts.push(
        <em key={`i${partKey++}`} style={{ color: 'var(--text-primary)' }}>
          {match[1]}
        </em>
      );
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

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
        {insight.body && (
          <div className="ai-card__text">
            {renderMarkdown(insight.body)}
          </div>
        )}
        {insight.bullets && insight.bullets.length > 0 && (
          <ul className="ai-card__bullets">
            {insight.bullets.map((b, i) => (
              <li key={i} className="ai-card__bullet">{typeof b === 'string' ? formatInline(b) : b}</li>
            ))}
          </ul>
        )}
        <div className="ai-card__disclaimer">
          AI-generated analysis. Not investment advice.
        </div>
      </div>
    </div>
  );
}
