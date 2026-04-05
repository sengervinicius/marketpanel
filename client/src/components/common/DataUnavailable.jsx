import { memo } from 'react';

function DataUnavailable({ reason = 'Data temporarily unavailable', onRetry }) {
  return (
    <div style={{
      padding: '16px 12px',
      textAlign: 'center',
      color: '#666',
      fontSize: 11,
      fontFamily: 'monospace',
    }}>
      <div style={{ color: '#ff9800', marginBottom: 4 }}>⚠</div>
      <div>{reason}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 8,
            padding: '4px 12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            color: '#ff9800',
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
