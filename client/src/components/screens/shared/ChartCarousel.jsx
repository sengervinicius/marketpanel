/**
 * ChartCarousel.jsx — Phase 7: Mobile chart carousel
 * Swipeable single-chart display for mobile (<768px)
 *
 * Features:
 * - One chart at a time on mobile, swipeable left/right
 * - Dot indicators showing current position
 * - Per-chart timeframe selector below dots
 * - Touch events for swipe detection
 * - 200px height on mobile
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import { SectorChartContainer } from './SectorChartContainer';
import { useIsMobile } from '../../../hooks/useIsMobile';
import './ChartCarousel.css';

/**
 * ChartCarousel — Swipeable chart carousel for mobile
 * Props:
 *   tickers: array of ticker strings
 *   height: chart height in px (default 200)
 *   accentColor: CSS color for highlights
 *   selectedTicker: currently selected ticker
 *   onChartClick: callback when a chart is clicked
 */
export function ChartCarousel({
  tickers = [],
  height = 200,
  accentColor,
  selectedTicker = null,
  onChartClick = null,
}) {
  const isMobile = useIsMobile();
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const tickerList = useMemo(() => {
    return tickers.map(t => typeof t === 'string' ? t : t.symbol).filter(Boolean);
  }, [tickers]);

  if (!tickerList || tickerList.length === 0) {
    return null;
  }

  // On desktop, don't use carousel — let parent handle multi-column grid
  if (!isMobile) {
    return null;
  }

  const currentTicker = tickerList[currentIndex];

  // Touch event handlers for swipe detection
  const handleTouchStart = useCallback((e) => {
    touchStartX.current = e.changedTouches[0].screenX;
  }, []);

  const handleTouchMove = useCallback((e) => {
    touchEndX.current = e.changedTouches[0].screenX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartX.current || !touchEndX.current) return;

    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50; // pixels to trigger swipe

    if (diff > threshold) {
      // Swiped left — next chart
      setCurrentIndex(i => (i + 1) % tickerList.length);
    } else if (diff < -threshold) {
      // Swiped right — previous chart
      setCurrentIndex(i => (i - 1 + tickerList.length) % tickerList.length);
    }

    touchStartX.current = 0;
    touchEndX.current = 0;
  }, [tickerList.length]);

  const handlePrevClick = (e) => {
    e.stopPropagation();
    setCurrentIndex(i => (i - 1 + tickerList.length) % tickerList.length);
  };

  const handleNextClick = (e) => {
    e.stopPropagation();
    setCurrentIndex(i => (i + 1) % tickerList.length);
  };

  const handleDotClick = (index) => {
    setCurrentIndex(index);
  };

  return (
    <div
      className="chart-carousel"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Chart container */}
      <div className="chart-carousel-chart">
        <SectorChartContainer
          ticker={currentTicker}
          height={height}
          accentColor={accentColor}
          isHighlighted={selectedTicker === currentTicker}
          onChartClick={onChartClick}
        />
      </div>

      {/* Navigation buttons */}
      <div className="chart-carousel-nav">
        <button
          className="chart-carousel-btn chart-carousel-btn--prev"
          onClick={handlePrevClick}
          aria-label="Previous chart"
          onTouchEnd={(e) => { e.preventDefault(); handlePrevClick(e); }}
        >
          ‹
        </button>
        <button
          className="chart-carousel-btn chart-carousel-btn--next"
          onClick={handleNextClick}
          aria-label="Next chart"
          onTouchEnd={(e) => { e.preventDefault(); handleNextClick(e); }}
        >
          ›
        </button>
      </div>

      {/* Dot indicators */}
      <div className="chart-carousel-dots">
        {tickerList.map((_, i) => (
          <button
            key={i}
            className={`chart-carousel-dot ${i === currentIndex ? 'chart-carousel-dot--active' : ''}`}
            onClick={() => handleDotClick(i)}
            onTouchEnd={(e) => { e.preventDefault(); handleDotClick(i); }}
            aria-label={`Go to chart ${i + 1} of ${tickerList.length}`}
            aria-current={i === currentIndex}
          />
        ))}
      </div>

      {/* Position indicator */}
      <div className="chart-carousel-position">
        {currentIndex + 1} / {tickerList.length}
      </div>
    </div>
  );
}

export default ChartCarousel;
