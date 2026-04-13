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
      <div style={{ color: '#ff9800', marginBottom: 4 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{verticalAlign:'middle',marginRight:2,display:'inline-block'}}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
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
