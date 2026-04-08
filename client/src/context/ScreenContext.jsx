import { createContext, useContext, useState, useCallback } from 'react';

/**
 * ScreenContext — Tracks the current screen view and visible tickers.
 * Used for context-aware AI chat and inline AI features.
 *
 * Provides:
 * - currentScreen: 'home' | screen key like 'defence', 'technology', etc.
 * - currentTicker: Selected ticker (if InstrumentDetail is open)
 * - visibleTickers: Array of tickers currently visible on screen
 * - sectorName: Human-readable name of the current sector
 */

const ScreenContext = createContext(null);

export function ScreenProvider({ children }) {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [currentTicker, setCurrentTicker] = useState(null);
  const [visibleTickers, setVisibleTickers] = useState([]);
  const [sectorName, setSectorName] = useState(null);

  const updateScreen = useCallback((screenKey, displayName, tickers = []) => {
    setCurrentScreen(screenKey);
    setSectorName(displayName);
    setVisibleTickers(tickers);
    setCurrentTicker(null); // Clear selected ticker when navigating
  }, []);

  const updateSelectedTicker = useCallback((ticker) => {
    setCurrentTicker(ticker);
  }, []);

  const value = {
    currentScreen,
    currentTicker,
    visibleTickers,
    sectorName,
    updateScreen,
    updateSelectedTicker,
  };

  return (
    <ScreenContext.Provider value={value}>
      {children}
    </ScreenContext.Provider>
  );
}

export function useScreenContext() {
  const context = useContext(ScreenContext);
  if (!context) {
    // Return default values if provider not found
    return {
      currentScreen: 'home',
      currentTicker: null,
      visibleTickers: [],
      sectorName: null,
      updateScreen: () => {},
      updateSelectedTicker: () => {},
    };
  }
  return context;
}

export default ScreenContext;
