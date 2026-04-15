/**
 * SectionHeader — Unified section headers across all screens
 *
 * Features:
 * - Customizable accent color
 * - Subtitle support
 * - Right-side action slots
 * - Consistent styling across app
 */

import React from 'react';
import './SectionHeader.css';

export default function SectionHeader({
  title = '',
  subtitle = '',
  accentColor = 'var(--color-section-header)',
  children = null,
  className = '',
}) {
  return (
    <div className={`sh-container ${className}`}>
      <div className="sh-left">
        <h2 className="sh-title" style={{ color: accentColor }}>
          {title}
        </h2>
        {subtitle && (
          <p className="sh-subtitle">{subtitle}</p>
        )}
      </div>

      {children && (
        <div className="sh-right">
          {children}
        </div>
      )}
    </div>
  );
}
