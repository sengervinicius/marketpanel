/**
 * personaDefaults.js — Persona-based default watchlists and preferences
 */

export const PERSONA_WATCHLISTS = {
  day_trader:      ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMZN'],
  swing_trader:    ['AAPL', 'MSFT', 'META', 'GOOGL', 'AMZN'],
  value_investor:  ['BRK-B', 'JNJ', 'KO', 'PG', 'V'],
  growth_investor: ['NVDA', 'TSLA', 'PLTR', 'CRWD', 'NFLX'],
  dividend_hunter: ['O', 'MAIN', 'T', 'VZ', 'PFE'],
  crypto_degen:    ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:XRPUSD', 'X:BNBUSD'],
  etf_builder:     ['VTI', 'VOO', 'QQQ', 'VXUS', 'BND'],
  macro_hawk:      ['DXY', 'TLT', 'GLD', 'SPY', 'FXE'],
  options_wizard:  ['SPY', 'QQQ', 'AAPL', 'NVDA', 'AMZN'],
  fixed_income:    ['TLT', 'LQD', 'HYG', 'BND', 'AGG'],
  quant:           ['SPY', 'QQQ', 'NVDA', 'MSFT', 'GOOGL'],
};

export const PERSONA_NEWS_CATEGORIES = {
  day_trader:      'market_movers',
  swing_trader:    'analysis',
  value_investor:  'earnings',
  growth_investor: 'technology',
  dividend_hunter: 'dividends',
  crypto_degen:    'crypto',
  etf_builder:     'etf',
  macro_hawk:      'macro',
  options_wizard:  'options',
  fixed_income:    'bonds',
  quant:           'technology',
};

export const PERSONA_AI_PROMPTS = {
  day_trader:      'You are helping an active day trader focused on momentum and short-term moves.',
  swing_trader:    'You are assisting a swing trader who holds positions for days to weeks.',
  value_investor:  'You are advising a value investor focused on fundamentals and margin of safety.',
  growth_investor: 'You are supporting a growth investor seeking high-growth companies.',
  dividend_hunter: 'You are helping a dividend-focused investor seeking income and yield.',
  crypto_degen:    'You are assisting a crypto enthusiast tracking digital assets and DeFi.',
  etf_builder:     'You are supporting an ETF-focused investor building diversified portfolios.',
  macro_hawk:      'You are advising a macro-focused trader tracking rates, currencies, and commodities.',
  options_wizard:  'You are helping an options trader with strategies, greeks, and volatility.',
  fixed_income:    'You are assisting a fixed income investor focused on bonds and credit.',
  quant:           'You are supporting a quantitative investor using data-driven strategies.',
};

/**
 * Get default watchlist for a persona
 */
export function getPersonaWatchlist(personaId) {
  return PERSONA_WATCHLISTS[personaId] || PERSONA_WATCHLISTS.swing_trader;
}

/**
 * Get preferred news category for a persona
 */
export function getPersonaNewsCategory(personaId) {
  return PERSONA_NEWS_CATEGORIES[personaId] || 'general';
}

/**
 * Get AI chat system prompt prefix for a persona
 */
export function getPersonaAIPrompt(personaId) {
  return PERSONA_AI_PROMPTS[personaId] || '';
}
