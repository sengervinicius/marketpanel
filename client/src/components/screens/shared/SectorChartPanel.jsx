/**
 * SectorChartPanel.jsx — Sprint 5 Phase 5 refactor + Phase 7 mobile carousel
 * Multi-chart grid for sector-wide technical analysis.
 *
 * Phase 5 refactor:
 *  - Now uses SectorChartContainer (per-chart data fetching + timeframe)
 *  - Optional: Shared timeframe selector at top affects all charts
 *  - Each chart independently manages its data & per-chart timeframe selector
 *  - Supports linked ticker selection (highlight on table click)
 *
 * Phase 7 mobile improvements:
 *  - Mobile: swipeable chart carousel (one chart at a time)
 *  - Desktop: multi-column grid (2-4 charts per row)
 *
 * Sprint 5 fixes:
 *  - Task 3: Fixed chart blinking — serialize tickers for useEffect deps
 *  - Task 4: Added timeframe selector (1D/1W/1M/3M/6M/1Y)
 *  - Task 5: Updated visual styling to match home screen chart style
 */
import { useState, useMemo, memo, useCallback } from 'react';
import { SectorChartContainer } from './SectorChartContainer';
import { ChartCarousel } from './ChartCarousel';
import { useIsMobile } from '../../../hooks/useIsMobile';


/**
 * SectorChartPanel — Multi-chart grid with per-chart data & timeframe
 * Props:
 *   tickers: array of ticker strings (or { symbol, ... } objects)
 *   height: chart height in px (default 200)
 *   cols: number of columns (default 2)
 *   accentColor: CSS color for highlights (default #ff6b00)
 *   selectedTicker: currently selected ticker (for highlighting)
 *   onChartClick: callback when a chart is clicked
 */
export function SectorChartPanel({
  tickers = [],
  height = 200,
  cols = 2,
  accentColor,
  selectedTicker = null,
  onChartClick = null,
}) {
  const isMobile = useIsMobile();

  // Serialize tickers for stable comparison
  const tickerList = useMemo(() => {
    return tickers.map(t => typeof t === 'string' ? t : t.symbol).filter(Boolean);
  }, [tickers]);

  if (!tickerList || tickerList.length === 0) {
    return null;
  }

  // Mobile: use carousel, Desktop: use grid
  if (isMobile) {
    return (
      <ChartCarousel
        tickers={tickerList}
        height={height}
        accentColor={accentColor}
        selectedTicker={selectedTicker}
        onChartClick={onChartClick}
      />
    );
  }

  // Desktop: multi-column grid
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: '12px',
    }}>
      {tickerList.map((ticker, idx) => (
        <SectorChartContainer
          key={ticker}
          ticker={ticker}
          height={height}
          accentColor={accentColor}
          isHighlighted={selectedTicker === ticker}
          onChartClick={onChartClick}
          loadDelay={idx * 300}
        />
      ))}
    </div>
  );
}

export default SectorChartPanel;
