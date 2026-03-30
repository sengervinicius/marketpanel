/**
 * SuggestedScreens.jsx
 * Curated layout presets available from the Settings drawer.
 * Allows users to quickly switch between different workspace configurations
 * without resetting their onboarding or custom panels.
 *
 * Phase 4.2: Post-onboarding layout library.
 */

import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';

// ── Curated suggested screens ─────────────────────────────────────────────────
// Each entry defines a complete workspace reconfiguration.
// Keys match settings.panels shape so applyPreset can merge them.

const SUGGESTED_SCREENS = [
  {
    id:          'equity_dashboard',
    label:       'Equity Dashboard',
    description: 'US large-caps front and center with charts and news.',
    layout: {
      desktopRows: [
        ['charts',      'usEquities',  'globalIndices'],
        ['forex',       'commodities', 'crypto'],
        ['news',        'search',      'watchlist'],
      ],
    },
    panels: {
      usEquities:   { title: 'US Equities',   symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','V','MA'] },
      globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EEM','EFA','EWJ','FXI'] },
    },
    charts: { symbols: ['AAPL','MSFT','NVDA','GOOGL'] },
  },
  {
    id:          'etf_research_lab',
    label:       'ETF Research Lab',
    description: 'Broad market ETFs, sectors, and thematic plays.',
    layout: {
      desktopRows: [
        ['charts',       'usEquities',   'globalIndices'],
        ['commodities',  'debt',         'forex'],
        ['news',         'search',       'watchlist'],
      ],
    },
    panels: {
      usEquities:    { title: 'Sector ETFs',    symbols: ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','XLI','XLP','XLU','XLRE'] },
      globalIndices: { title: 'Global ETFs',    symbols: ['EEM','EFA','EWZ','EWJ','FXI','EWU','EWG','EWC','EWA','EWW'] },
      commodities:   { title: 'Commodity ETFs', symbols: ['GLD','SLV','USO','UNG','CORN','WEAT','SOYB','BHP','CPER','REMX'] },
    },
    charts: { symbols: ['SPY','QQQ','EEM','GLD'] },
  },
  {
    id:          'bond_curves_credit',
    label:       'Bond Curves & Credit',
    description: 'Yield curves, credit spreads, and fixed income monitors.',
    layout: {
      desktopRows: [
        ['debt',   'curves',  'charts'],
        ['forex',  'usEquities', 'news'],
        ['search', 'watchlist', 'commodities'],
      ],
    },
    panels: {
      usEquities: { title: 'Rate Sensitives', symbols: ['TLT','HYG','LQD','IEF','SHY','EMB','BND','BNDX'] },
    },
    charts: { symbols: ['TLT','HYG','SPY','GLD'] },
  },
  {
    id:          'rates_fx_monitor',
    label:       'Rates & FX Monitor',
    description: 'Central bank rates, FX crosses, and macro divergence.',
    layout: {
      desktopRows: [
        ['forex',       'charts',     'debt'],
        ['globalIndices','commodities','news'],
        ['search',      'watchlist',  'curves'],
      ],
    },
    panels: {
      forex: { title: 'FX / Rates', symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'] },
    },
    charts: { symbols: ['EURUSD','USDJPY','USDBRL','GBPUSD'] },
  },
  {
    id:          'macro_news_briefing',
    label:       'Macro & News Briefing',
    description: 'Economic calendar view with broad market snapshot.',
    layout: {
      desktopRows: [
        ['news',    'charts',     'sentiment'],
        ['usEquities','globalIndices','forex'],
        ['search',  'watchlist',  'commodities'],
      ],
    },
    panels: {
      usEquities:    { title: 'Macro Assets',  symbols: ['SPY','TLT','GLD','USO','UNG','EEM','EFA','DXY'] },
      globalIndices: { title: 'World Markets', symbols: ['SPY','QQQ','EWZ','EEM','EWJ','FXI','EWU','EWG'] },
    },
    charts: { symbols: ['SPY','TLT','GLD','DXY'] },
  },
  {
    id:          'crypto_terminal',
    label:       'Crypto Terminal',
    description: 'Digital assets, on-chain proxies, and macro correlations.',
    layout: {
      desktopRows: [
        ['charts',      'crypto',    'news'],
        ['usEquities',  'forex',     'sentiment'],
        ['watchlist',   'search',    'commodities'],
      ],
    },
    panels: {
      crypto:     { title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','ADAUSD'] },
      usEquities: { title: 'Crypto Equities', symbols: ['MSTR','COIN','NVDA','AMD','AAPL','GOOGL'] },
      forex:      { title: 'Crypto FX',     symbols: ['BTCUSD','ETHUSD','SOLUSD','EURUSD','USDBRL'] },
    },
    charts: { symbols: ['BTCUSD','ETHUSD','SOLUSD','MSTR'] },
  },
  {
    id:          'brazil_investor',
    label:       'Brazil Investor',
    description: 'B3 equities, Ibovespa, DI curve, and BRL crosses.',
    layout: {
      desktopRows: [
        ['brazilB3',    'charts',    'forex'],
        ['globalIndices','curves',   'commodities'],
        ['news',        'search',    'watchlist'],
      ],
    },
    panels: {
      brazilB3:      { title: 'Brazil B3',    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','BBAS3.SA','GGBR4.SA'] },
      globalIndices: { title: 'EM Monitor',   symbols: ['EWZ','EEM','EWJ','FXI','EWW'] },
      forex:         { title: 'BRL Monitor',  symbols: ['USDBRL','EURBRL','GBPBRL','USDARS','USDMXN'] },
    },
    charts: { symbols: ['VALE3.SA','PETR4.SA','EWZ','USDBRL'] },
  },
  {
    id:          'multi_asset_trader',
    label:       'Multi-Asset Trader',
    description: 'All asset classes at once for rapid cross-market scanning.',
    layout: {
      desktopRows: [
        ['charts',       'usEquities',  'forex'],
        ['globalIndices', 'crypto',     'commodities'],
        ['debt',          'news',       'watchlist'],
      ],
    },
    panels: {
      usEquities:    { title: 'US Equities',  symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB'] },
      globalIndices: { title: 'Global Indexes', symbols: ['SPY','EWZ','EEM','EWJ','FXI','EWU','EWG'] },
      forex:         { title: 'FX / Rates',   symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN'] },
      crypto:        { title: 'Crypto',       symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
    },
    charts: { symbols: ['SPY','BTCUSD','EURUSD','GLD'] },
  },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function SuggestedScreens({ onApply }) {
  const { updateSettings } = useSettings();
  const [applying, setApplying] = useState(null);
  const [applied,  setApplied]  = useState(null);

  const handleApply = async (screen) => {
    if (applying) return;
    setApplying(screen.id);
    try {
      const patch = {};
      if (screen.layout)  patch.layout  = screen.layout;
      if (screen.panels)  patch.panels  = screen.panels;
      if (screen.charts)  patch.charts  = screen.charts;
      await updateSettings(patch);
      setApplied(screen.id);
      setTimeout(() => setApplied(null), 3000);
      onApply?.();
    } catch (e) {
      console.error('[SuggestedScreens] apply failed:', e.message);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div>
      {SUGGESTED_SCREENS.map(screen => {
        const isApplying = applying === screen.id;
        const wasApplied = applied  === screen.id;
        return (
          <div
            key={screen.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', borderBottom: '1px solid #141414',
              cursor: applying ? 'wait' : 'default',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#141414'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div>
              <div style={{ color: '#ccc', fontSize: 9, fontWeight: 600, letterSpacing: '0.4px' }}>{screen.label}</div>
              <div style={{ color: '#444', fontSize: 8, marginTop: 1, letterSpacing: '0.2px' }}>{screen.description}</div>
            </div>
            <button
              onClick={() => handleApply(screen)}
              disabled={!!applying}
              style={{
                background: wasApplied ? '#1a3a1a' : 'none',
                border:  wasApplied ? '1px solid #00cc66' : '1px solid #2a2a2a',
                color:   wasApplied ? '#00cc66' : isApplying ? '#ff6600' : '#555',
                fontSize: 8, padding: '2px 6px', cursor: applying ? 'wait' : 'pointer',
                fontFamily: 'inherit', borderRadius: 2, letterSpacing: '0.3px',
                minWidth: 48, flexShrink: 0,
              }}
            >
              {wasApplied ? '✓ APPLIED' : isApplying ? 'LOADING…' : 'APPLY →'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export { SUGGESTED_SCREENS };
