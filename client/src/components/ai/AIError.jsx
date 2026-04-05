/**
 * AIError — consistent error treatment for AI insight failures.
 */
export default function AIError({ message, onRetry, compact = false }) {
  return (
    <div className={`ai-card ai-card--error ${compact ? 'ai-card--compact' : ''}`}>
      <div className="ai-card__header">
        <span className="ai-card__badge ai-card__badge--error">AI</span>
        <span className="ai-card__title ai-card__title--error">Insight Unavailable</span>
      </div>
      <p className="ai-card__error-text">
        {message || 'AI insight unavailable right now.'}
      </p>
      {onRetry && (
        <button className="ai-card__retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
