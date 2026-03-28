import { memo } from 'react';

function SkeletonLoader({ rows = 5, showHeader = true }) {
  return (
    <div className="skeleton-container">
      {showHeader && <div className="skeleton-header" />}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton-cell" style={{ width: '30%' }} />
          <div className="skeleton-cell" style={{ width: '20%' }} />
          <div className="skeleton-cell" style={{ width: '25%' }} />
        </div>
      ))}
    </div>
  );
}

export default memo(SkeletonLoader);
