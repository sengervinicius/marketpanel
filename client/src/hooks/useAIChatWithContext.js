import { useCallback } from 'react';
import { useScreenContext } from '../context/ScreenContext';

/**
 * useAIChatWithContext — Hook to build AI chat context from the current screen.
 * Prepends screen information to user messages for context-aware AI responses.
 *
 * Returns a function that enriches a user message with current screen context.
 */
export function useAIChatWithContext() {
  const { currentScreen, currentTicker, visibleTickers, sectorName } = useScreenContext();

  const buildContextualMessage = useCallback((userMessage) => {
    const parts = [];

    // Add current screen context
    if (sectorName && visibleTickers.length > 0) {
      parts.push(`User is currently viewing the ${sectorName} sector screen with tickers: ${visibleTickers.join(', ')}.`);
    } else if (currentScreen && currentScreen !== 'home') {
      parts.push(`User is currently viewing: ${currentScreen.replace(/-/g, ' ')}.`);
    }

    // Add selected ticker context if available
    if (currentTicker) {
      parts.push(`The selected ticker is ${currentTicker}.`);
    }

    // Combine with user message
    if (parts.length > 0) {
      return `${parts.join(' ')} They are asking: ${userMessage}`;
    }

    return userMessage;
  }, [currentScreen, currentTicker, visibleTickers, sectorName]);

  return { buildContextualMessage };
}

export default useAIChatWithContext;
