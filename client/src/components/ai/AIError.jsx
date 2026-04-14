/**
 * AIError — muted error treatment for AI insight failures.
 * Uses grey tones instead of red to avoid alarming users on a paid feature.
 */
export default function AIError({ message, onRetry, compact = false }) {
  return (
    <div className={`ai-card ai-card--error ${compact ? 'ai-card--compact' : ''}`}>
      <div className="ai-card__header">
        <span className="ai-card__badge ai-card__badge--error">AI</span>
        <span className="ai-card__title ai-card__title--error">Loading Analysis...</span>
      </div>
      <p className="ai-card__error-text">
        {message || 'AI analysis is temporarily loading. This usually resolves in a few seconds.'}
      </p>
      {onRetry && (
        <button className="ai-card__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
