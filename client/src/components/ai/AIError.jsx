/**
 * AIError — quiet, muted treatment for AI insight failures.
 * Single line of subdued text + retry link. Never dominates the screen.
 */
export default function AIError({ message, onRetry, compact = false }) {
  return (
    <div className={`ai-card ai-card--error ${compact ? 'ai-card--compact' : ''}`}
         style={{ minHeight: 'auto', padding: compact ? '8px 10px' : '10px 12px' }}>
      <span style={{
        fontSize: '0.75rem',
        color: 'var(--color-insight-unavailable, rgba(255,255,255,0.30))',
        fontFamily: 'var(--font-ui)',
        letterSpacing: '0.02em',
      }}>
        AI insight unavailable
        {onRetry && (
          <>
            {' \u00b7 '}
            <span
              onClick={onRetry}
              style={{
                cursor: 'pointer',
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
                color: 'var(--color-text-secondary)',
              }}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && onRetry()}
            >
              retry
            </span>
          </>
        )}
      </span>
    </div>
  );
}
