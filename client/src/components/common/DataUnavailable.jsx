import { memo } from 'react';

function DataUnavailable({ reason = 'Loading data...', onRetry }) {
  return (
    <div style={{
      padding: '16px 12px',
      textAlign: 'center',
      color: '#888',
      fontSize: 11,
      fontFamily: 'monospace',
    }}>
      <div style={{ color: '#888', marginBottom: 4 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle',marginRight:2,display:'inline-block',animation:'spin 2s linear infinite'}}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>
      <div>{reason}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 8,
            padding: '4px 12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            color: '#aaa',
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
