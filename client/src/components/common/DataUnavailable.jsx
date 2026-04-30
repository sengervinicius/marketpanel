import { memo } from 'react';

/**
 * DataUnavailable — generic empty-state for panels.
 *
 * #285d — added `kind` prop so panels can distinguish:
 *
 *   loading      (default) — spinner + neutral copy. Used during fetch.
 *   unavailable  — provider unconfigured / offline. Static icon, copy
 *                  invites the user to talk to their admin instead of
 *                  thinking the market was quiet.
 *   error        — request failed (network, 5xx, parse). Same as
 *                  unavailable visually but copy is about retry.
 *   empty        — provider responded normally with zero rows. Real
 *                  signal, not a bug.
 *
 * Pair with utils/providerStatus.js to derive `kind` from a server
 * response that may use the `source: 'unavailable'` graceful-empty
 * pattern.
 */
function DataUnavailable({ reason, kind = 'loading', onRetry }) {
  const isLoading = kind === 'loading';
  const isUnavailable = kind === 'unavailable';
  const defaultReason =
    kind === 'loading'     ? 'Loading data…' :
    kind === 'unavailable' ? 'This data source is not currently configured.' :
    kind === 'error'       ? 'Request failed. Try again shortly.' :
    /* empty */              'No data.';
  return (
    <div
      role={kind === 'loading' ? 'status' : 'alert'}
      style={{
        padding: '16px 12px',
        textAlign: 'center',
        color: 'var(--text-secondary, #888)',
        fontSize: 11,
        fontFamily: 'monospace',
      }}
    >
      <div style={{ color: 'var(--text-secondary, #888)', marginBottom: 4 }}>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            verticalAlign: 'middle', marginRight: 2, display: 'inline-block',
            animation: isLoading ? 'spin 2s linear infinite' : 'none',
          }}
          aria-hidden="true"
        >
          {/* Loading spokes when isLoading; static info circle otherwise */}
          {isLoading ? (
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          ) : (
            <>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </>
          )}
        </svg>
      </div>
      <div>{reason || defaultReason}</div>
      {isUnavailable && (
        <div
          style={{
            marginTop: 6, fontSize: 10,
            color: 'var(--text-faint, #666)',
            maxWidth: 260, marginInline: 'auto', lineHeight: 1.4,
          }}
        >
          The market data team has been notified — this is a configuration
          gap, not stale data.
        </div>
      )}
      {onRetry && !isUnavailable && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 8,
            padding: '4px 12px',
            background: 'var(--bg-panel, #1a1a1a)',
            border: '1px solid var(--border-strong, #333)',
            color: 'var(--text-secondary, #aaa)',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'monospace',
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default memo(DataUnavailable);
