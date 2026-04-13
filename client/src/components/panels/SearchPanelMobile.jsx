/**
 * SearchPanelMobile.jsx — Phase 7: Full-screen mobile search
 *
 * Features:
 * - Full-screen overlay on mobile (<768px)
 * - 52px row height for touch friendliness
 * - Each result shows: sparkline, price, sector badge
 * - Close button or swipe-back to dismiss
 * - Integrates with existing SearchPanel data/logic
 */

import { useState, useRef, useCallback } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';
import Sparkline from '../shared/Sparkline';
import Badge from '../ui/Badge';
import './SearchPanelMobile.css';

/**
 * SearchResultRow — Single search result with touch-friendly sizing
 */
function SearchResultRow({
  item,
  sparklineData = null,
  sectorBadge = null,
  onSelect = null,
}) {
  const handleClick = (e) => {
    e.preventDefault();
    if (onSelect) onSelect(item);
  };

  return (
    <button
      className="search-mobile-result-row"
      onClick={handleClick}
      onTouchEnd={(e) => {
        e.preventDefault();
        handleClick(e);
      }}
    >
      {/* Sparkline */}
      {sparklineData && (
        <div className="search-mobile-row-sparkline">
          <Sparkline data={sparklineData} height={24} color="#F97316" />
        </div>
      )}

      {/* Ticker + Name + Price */}
      <div className="search-mobile-row-content">
        <div className="search-mobile-row-header">
          <span className="search-mobile-row-ticker">{item.symbol}</span>
          <span className="search-mobile-row-price">
            {item.price ? '$' + item.price.toFixed(2) : '—'}
          </span>
        </div>
        <div className="search-mobile-row-name">
          {item.name || item.company}
        </div>
      </div>

      {/* Sector badge */}
      {sectorBadge && (
        <div className="search-mobile-row-badge">
          {sectorBadge}
        </div>
      )}
    </button>
  );
}

/**
 * SearchPanelMobile — Full-screen search overlay on mobile
 */
export function SearchPanelMobile({
  isOpen = false,
  onClose = null,
  searchResults = [],
  onResultSelect = null,
  isLoading = false,
  searchQuery = '',
}) {
  const isMobile = useIsMobile();
  const scrollRef = useRef(null);

  if (!isMobile || !isOpen) {
    return null;
  }

  const handleBackClick = () => {
    if (onClose) onClose();
  };

  const handleResult = (item) => {
    if (onResultSelect) onResultSelect(item);
  };

  // Handle escape key to close modal
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onClose) onClose();
    }
  };

  // Handle backdrop click to close (click on the panel itself, not content)
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      if (onClose) onClose();
    }
  };

  return (
    <div
      className="search-panel-mobile"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      {/* Header */}
      <div className="search-panel-mobile-header">
        <button
          className="search-panel-mobile-back"
          onClick={handleBackClick}
          onTouchEnd={(e) => {
            e.preventDefault();
            handleBackClick();
          }}
          aria-label="Close search"
        >
          ‹ Back
        </button>
        <div className="search-panel-mobile-title">
          {searchQuery ? `Results for "${searchQuery}"` : 'Search'}
        </div>
        <div style={{ width: 60 }} /> {/* Spacer for alignment */}
      </div>

      {/* Results list */}
      <div
        className="search-panel-mobile-list"
        ref={scrollRef}
      >
        {isLoading ? (
          <div className="search-panel-mobile-loading">
            <div className="search-loading-spinner" />
            Loading...
          </div>
        ) : searchResults.length === 0 ? (
          <div className="search-panel-mobile-empty">
            {searchQuery ? 'No results found' : 'Start typing to search'}
          </div>
        ) : (
          searchResults.map((item, idx) => (
            <SearchResultRow
              key={idx}
              item={item}
              sparklineData={item.sparklineData || null}
              sectorBadge={item.sectorBadge || null}
              onSelect={handleResult}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default SearchPanelMobile;
