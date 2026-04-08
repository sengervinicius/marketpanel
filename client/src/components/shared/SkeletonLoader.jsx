/**
 * SkeletonLoader — Configurable loading skeleton component
 *
 * Types: 'chart', 'table', 'card', 'text', 'row'
 * Features:
 * - Shimmer animation
 * - Customizable dimensions
 * - Multiple rows/columns
 */

import React from 'react';
import './SkeletonLoader.css';

export default function SkeletonLoader({
  type = 'card',
  width = '100%',
  height = '200px',
  rows = 5,
  columns = 3,
  className = '',
}) {
  const containerStyle = {
    width,
    height,
  };

  if (type === 'chart') {
    return (
      <div className={`sk-container sk-chart ${className}`} style={containerStyle}>
        <div className="sk-skeleton sk-chart-skeleton" />
      </div>
    );
  }

  if (type === 'table') {
    return (
      <div className={`sk-container sk-table ${className}`} style={{ width }}>
        {/* Header row */}
        <div className="sk-table-row sk-table-header">
          {Array.from({ length: columns }).map((_, idx) => (
            <div key={idx} className="sk-table-cell sk-table-header-cell" />
          ))}
        </div>

        {/* Body rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="sk-table-row">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <div key={colIdx} className="sk-table-cell" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (type === 'card') {
    return (
      <div className={`sk-container sk-card ${className}`} style={containerStyle}>
        {/* Header line (wider) */}
        <div className="sk-skeleton sk-line sk-line-header" />

        {/* Content lines (varying widths) */}
        <div className="sk-skeleton sk-line" style={{ width: '95%' }} />
        <div className="sk-skeleton sk-line" style={{ width: '88%' }} />
        <div className="sk-skeleton sk-line" style={{ width: '92%' }} />
      </div>
    );
  }

  if (type === 'text') {
    return (
      <div className={`sk-container sk-text ${className}`} style={containerStyle}>
        {/* Lines of varying widths */}
        <div className="sk-skeleton sk-line" style={{ width: '100%' }} />
        <div className="sk-skeleton sk-line" style={{ width: '92%' }} />
        <div className="sk-skeleton sk-line" style={{ width: '85%' }} />
        <div className="sk-skeleton sk-line" style={{ width: '95%' }} />
      </div>
    );
  }

  if (type === 'row') {
    return (
      <div className={`sk-container sk-row ${className}`} style={{ width }}>
        {/* Horizontal row skeleton */}
        {Array.from({ length: columns }).map((_, idx) => (
          <div key={idx} className="sk-skeleton sk-row-cell" />
        ))}
      </div>
    );
  }

  // Default: card
  return (
    <div className={`sk-container sk-card ${className}`} style={containerStyle}>
      <div className="sk-skeleton sk-line sk-line-header" />
      <div className="sk-skeleton sk-line" style={{ width: '95%' }} />
      <div className="sk-skeleton sk-line" style={{ width: '88%' }} />
    </div>
  );
}
