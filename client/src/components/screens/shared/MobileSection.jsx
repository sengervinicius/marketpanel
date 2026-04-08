/**
 * MobileSection.jsx — Phase 7: Collapsible sections for mobile
 *
 * Features:
 * - Tappable section headers
 * - First section expanded by default, rest collapsed
 * - Shows: "▶ SECTION NAME (N items)" / "▼ SECTION NAME" when expanded
 * - Smooth max-height transition animation
 * - Reduces scroll fatigue on content-heavy screens
 */

import { useState, useRef } from 'react';
import './MobileSection.css';

export function MobileSection({
  title,
  itemCount = null,
  children,
  defaultExpanded = false,
  onExpandChange = null,
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const contentRef = useRef(null);

  const handleToggle = (e) => {
    e.preventDefault();
    const newState = !isExpanded;
    setIsExpanded(newState);
    if (onExpandChange) onExpandChange(newState);
  };

  return (
    <div className="mobile-section">
      {/* Header */}
      <button
        className="mobile-section-header"
        onClick={handleToggle}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleToggle(e);
        }}
        aria-expanded={isExpanded}
        role="button"
      >
        <span className="mobile-section-icon">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="mobile-section-title">{title}</span>
        {itemCount != null && (
          <span className="mobile-section-count">({itemCount})</span>
        )}
      </button>

      {/* Content */}
      <div
        className={`mobile-section-content ${isExpanded ? 'mobile-section-content--open' : ''}`}
        ref={contentRef}
        style={{
          maxHeight: isExpanded ? (contentRef.current?.scrollHeight ?? 'auto') : '0',
        }}
      >
        <div className="mobile-section-body">
          {children}
        </div>
      </div>
    </div>
  );
}

export default MobileSection;
