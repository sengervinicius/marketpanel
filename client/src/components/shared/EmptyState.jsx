/**
 * EmptyState — For failed/empty data sections
 *
 * Features:
 * - Centered message display
 * - Optional icon
 * - Retry button with callback
 * - Accent color theming
 */

import React from 'react';
import './EmptyState.css';

export default function EmptyState({
  message = 'No data available',
  onRetry = null,
  icon = null,
  className = '',
}) {
  return (
    <div className={`es-container ${className}`}>
      {icon && (
        <div className="es-icon">
          {icon}
        </div>
      )}

      <p className="es-message">
        {message}
      </p>

      {onRetry && (
        <button
          className="es-retry-button"
          onClick={onRetry}
          title="Retry loading"
        >
          Retry
        </button>
      )}
    </div>
  );
}
