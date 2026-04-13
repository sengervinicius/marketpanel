import { useCallback } from 'react';
import { useScreenContext } from '../context/ScreenContext';

/**
 * useAIChatWithContext — Hook to build AI chat context from the current screen.
 * Prepends screen information to user messages for context-aware AI responses.
 *
 * Returns a function that enriches a user message with current screen context.
 */

const SCREEN_DESCRIPTIONS = {
  home: 'The home dashboard showing major index performance (S&P 500, Dow Jones, Nasdaq, Russell 2000), top movers, sector heat-map, portfolio summary, watchlist, market status, and The Wire (AI market commentary feed).',
  defence: 'Defence & Aerospace sector screen with defence stocks and ETFs.',
  technology: 'Technology sector screen with tech stocks and ETFs.',
  energy: 'Energy sector screen with oil, gas, renewables, and energy ETFs.',
  healthcare: 'Healthcare & Biotech sector screen with pharma and health stocks.',
  finance: 'Financial Services sector screen with banks, insurance, and fintech.',
  crypto: 'Cryptocurrency screen with Bitcoin, Ethereum, altcoins, and crypto-related equities.',
  commodities: 'Commodities screen with gold, silver, oil, agricultural futures.',
  'fixed-income': 'Fixed Income screen with treasury yields, bond ETFs, and credit spreads.',
  forex: 'Forex screen with major and emerging-market currency pairs.',
  'prediction-markets': 'Prediction Markets screen with Kalshi and Polymarket contracts.',
  brazil: 'Brazil & LatAm market screen with B3-listed equities.',
  asia: 'Asia-Pacific markets screen.',
  europe: 'European markets screen.',
};

export function useAIChatWithContext() {
  const { currentScreen, currentTicker, visibleTickers, sectorName } = useScreenContext();

  const buildContextualMessage = useCallback((userMessage) => {
    const parts = [];

    // Add rich screen context
    if (sectorName && visibleTickers.length > 0) {
      parts.push(`[SCREEN CONTEXT] User is viewing the ${sectorName} sector screen. Visible tickers: ${visibleTickers.slice(0, 15).join(', ')}.`);
    } else if (currentScreen) {
      const desc = SCREEN_DESCRIPTIONS[currentScreen] || `the "${currentScreen.replace(/-/g, ' ')}" screen`;
      parts.push(`[SCREEN CONTEXT] User is viewing: ${desc}`);
    }

    // Add selected ticker context if available
    if (currentTicker) {
      parts.push(`The user has ${currentTicker} selected/open in detail view.`);
    }

    // Combine with user message
    if (parts.length > 0) {
      return `${parts.join(' ')}\n\nUser question: ${userMessage}`;
    }

    return userMessage;
  }, [currentScreen, currentTicker, visibleTickers, sectorName]);

  return { buildContextualMessage };
}

export default useAIChatWithContext;
