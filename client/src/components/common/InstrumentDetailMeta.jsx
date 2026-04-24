/**
 * InstrumentDetailMeta.jsx — #253 P3.1 extract from InstrumentDetail.jsx.
 *
 * Static lookup tables and the small memoized RelatedTickerChip used by the
 * "Also In <sector>" strip. These have no parent-state closures, so they can
 * live outside the monster InstrumentDetail component safely.
 *
 *   - NO_DATA_EXCHANGES: exchanges that should show a no-data placeholder
 *   - RELATED_NAMES:     ticker → display-name overrides (e.g. LMT → Lockheed)
 *   - SECTOR_TICKER_MAP: sector → peer-ticker list for the related strip
 *   - RelatedTickerChip: mini chip component (memoized) for the related strip
 */

import { memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { sanitizeTicker } from '../../utils/ticker';

// ── NO_DATA exchanges — now driven by providerMatrix ──
export const NO_DATA_EXCHANGES = new Set([]);

// ── Name overrides for display ──
export const RELATED_NAMES = {
  LMT:'Lockheed', RTX:'Raytheon', BA:'Boeing', NOC:'Northrop', GD:'Gen Dynamics', BAESY:'BAE', PLTR:'Palantir', RKLB:'Rocket Lab', KTOS:'Kratos',
  NVDA:'NVIDIA', MSFT:'Microsoft', AAPL:'Apple', GOOGL:'Alphabet', META:'Meta', AMZN:'Amazon', TSM:'TSMC', AMD:'AMD', AVGO:'Broadcom',
  XOM:'Exxon', CVX:'Chevron', SHEL:'Shell', COP:'Conoco', SLB:'Schlumberger', NEE:'NextEra', ENPH:'Enphase', FSLR:'First Solar',
  EWZ:'Brazil ETF', MELI:'MercadoLibre', NU:'Nu Holdings', VALE:'Vale ADR',
  TLT:'20Y Treasury', IEF:'7-10Y Treasury', SHY:'1-3Y Treasury', AGG:'US Agg Bond', HYG:'High Yield', LQD:'IG Corporate', EMB:'EM Bonds', TIP:'TIPS',
  SPY:'S&P 500', QQQ:'Nasdaq 100', DIA:'Dow Jones', IWM:'Russell 2000', GLD:'Gold', USO:'Oil',
  MSTR:'MicroStrategy', COIN:'Coinbase', IBIT:'iShares BTC',
  BABA:'Alibaba', TM:'Toyota', SONY:'Sony', HDB:'HDFC Bank', INFY:'Infosys', TCEHY:'Tencent',
  SAP:'SAP', AZN:'AstraZeneca', NVO:'Novo Nordisk', LVMUY:'LVMH', HSBC:'HSBC', TTE:'TotalEnergies',
  WMT:'Walmart', COST:'Costco', TGT:'Target', HD:'Home Depot', NKE:'Nike', SBUX:'Starbucks',
};

// ── Sector → peer-ticker list (used by the "Also In <sector>" strip) ──
export const SECTOR_TICKER_MAP = {
  'Defence & Aerospace': ['LMT', 'RTX', 'BA', 'NOC', 'GD', 'BAESY', 'PLTR', 'RKLB', 'KTOS'],
  'Technology & AI': ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'META', 'AMZN', 'TSM', 'AMD', 'AVGO'],
  'Energy & Commodities': ['XOM', 'CVX', 'SHEL', 'COP', 'SLB', 'NEE', 'ENPH', 'FSLR'],
  'Brazil & EM': ['EWZ', 'MELI', 'NU', 'VALE', 'PETR4.SA', 'VALE3.SA', 'ITUB4.SA'],
  'Fixed Income': ['TLT', 'IEF', 'SHY', 'AGG', 'HYG', 'LQD', 'EMB', 'TIP'],
  'Global Macro': ['SPY', 'QQQ', 'DIA', 'IWM', 'GLD', 'USO', 'VIX'],
  'FX & Crypto': ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN'],
  'Crypto': ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN', 'IBIT'],
  'Asian Markets': ['BABA', 'TM', 'SONY', 'HDB', 'TSM', 'INFY', 'TCEHY'],
  'European Markets': ['SAP', 'AZN', 'NVO', 'SHEL', 'LVMUY', 'HSBC', 'TTE'],
  'Global Retail': ['AMZN', 'WMT', 'COST', 'TGT', 'HD', 'NKE', 'SBUX'],
};

// ── Related Ticker Chip (mini component for "Also In" section) ──
export const RelatedTickerChip = memo(function RelatedTickerChip({ ticker, onOpen, sectorContext }) {
  const priceData = useTickerPrice(ticker);
  const displayTk = sanitizeTicker(ticker || '').replace('.SA', '').replace('=F', '');
  const name = RELATED_NAMES[ticker] || RELATED_NAMES[displayTk] || displayTk;
  const price = priceData?.price;
  const changePct = priceData?.changePct;
  const isUp = changePct != null ? changePct >= 0 : true;

  return (
    <div
      className="id-related-chip"
      onClick={() => onOpen(ticker, sectorContext)}
      onTouchEnd={(e) => { e.preventDefault(); onOpen(ticker, sectorContext); }}
    >
      <span className="id-related-chip-ticker">{displayTk}</span>
      <span className="id-related-chip-name">{name}</span>
      {price != null && (
        <span className="id-related-chip-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {changePct != null && (
        <span className={`id-related-chip-chg ${isUp ? 'up' : 'down'}`}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});
