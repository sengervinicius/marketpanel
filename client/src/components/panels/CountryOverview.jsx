/**
 * CountryOverview.jsx — the non-Brazil rendering of the "In-Depth Country" box.
 *
 * Brazil keeps its bespoke rich panel (BrazilPanel); when the user selects any
 * other country this self-contained view renders instead. It reuses proven
 * primitives only (PriceRow + snapshot via useTickerPrice, PanelConfigModal),
 * so it can't break the Brazil path. Tickers are US-listed ETFs/ADRs so they
 * price through Polygon like every other box. Per-country ticker lists persist
 * under panelCfg.countrySymbols[country]; the config modal edits them.
 */
import { useState, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useTickerPrice } from '../../context/PriceContext';
import PanelShell from '../common/PanelShell';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelConfigModal from '../common/PanelConfigModal';
import { PriceRow } from '../common/PriceRow';
import { COLS_STANDARD } from '../../utils/panelColumns';
import { openDetailWindow } from '../../utils/detailWindow';
import './CountryOverview.css';

// Curated, US-listed (Polygon-priceable) defaults per country: an ETF proxy for
// the "index" cell, an FX pair vs USD, and a handful of large ADRs/holdings.
export const COUNTRY_CONFIG = {
  US: { flag: '🇺🇸', label: 'United States', etf: 'SPY', fx: null,          tickers: ['AAPL','MSFT','NVDA','AMZN','GOOGL','JPM'] },
  MX: { flag: '🇲🇽', label: 'Mexico',        etf: 'EWW', fx: 'USDMXN=X',   tickers: ['AMX','FMX','CX','KOF'] },
  JP: { flag: '🇯🇵', label: 'Japan',         etf: 'EWJ', fx: 'USDJPY=X',   tickers: ['TM','SONY','MUFG','HMC','MFG'] },
  DE: { flag: '🇩🇪', label: 'Germany',       etf: 'EWG', fx: 'EURUSD=X',   tickers: ['SAP','DB'] },
  GB: { flag: '🇬🇧', label: 'United Kingdom',etf: 'EWU', fx: 'GBPUSD=X',   tickers: ['HSBC','SHEL','BP','GSK','BCS'] },
  CN: { flag: '🇨🇳', label: 'China',         etf: 'MCHI',fx: 'USDCNH=X',   tickers: ['BABA','PDD','JD','BIDU'] },
  IN: { flag: '🇮🇳', label: 'India',         etf: 'INDA',fx: 'USDINR=X',   tickers: ['INFY','HDB','IBN','WIT'] },
  CA: { flag: '🇨🇦', label: 'Canada',        etf: 'EWC', fx: 'USDCAD=X',   tickers: ['RY','TD','ENB','CNQ','SHOP'] },
  AU: { flag: '🇦🇺', label: 'Australia',     etf: 'EWA', fx: 'AUDUSD=X',   tickers: ['BHP','RIO','WBK'] },
};

// Countries offered in the picker (BR handled by the rich Brazil panel).
export const COUNTRY_OPTIONS = [
  ['BR', '🇧🇷 Brazil'], ['US', '🇺🇸 United States'], ['MX', '🇲🇽 Mexico'],
  ['JP', '🇯🇵 Japan'], ['DE', '🇩🇪 Germany'], ['GB', '🇬🇧 United Kingdom'],
  ['CN', '🇨🇳 China'], ['IN', '🇮🇳 India'], ['CA', '🇨🇦 Canada'], ['AU', '🇦🇺 Australia'],
];

function TapeCell({ label, ticker, isFx }) {
  const q = useTickerPrice(ticker);
  const chg = q?.changePct;
  return (
    <div className="co-tape-cell">
      <span className="co-tape-label">{label}</span>
      <span className="co-tape-val">{q?.price != null ? Number(q.price).toFixed(isFx ? 4 : 2) : '—'}</span>
      <span className="co-tape-chg" style={{ color: chg == null ? 'var(--text-faint)' : chg >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
        {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : ''}
      </span>
    </div>
  );
}

function CountryRow({ sym, onTickerClick }) {
  const q = useTickerPrice(sym);
  return (
    <PriceRow
      symbol={sym}
      name={q?.name || ''}
      price={q?.price != null ? Number(q.price) : null}
      changePct={q?.changePct ?? null}
      decimals={2}
      columns={COLS_STANDARD}
      onClick={() => onTickerClick?.(sym)}
      onDoubleClick={() => openDetailWindow(sym, COUNTRY_CONFIG[sym] ? 'Country' : 'In-Depth Country')}
    />
  );
}

function CountryOverview({ country, countrySelect, onTickerClick }) {
  const { settings, updatePanelConfig } = useSettings();
  const [configOpen, setConfigOpen] = useState(false);
  const cfg = settings?.panels?.brazilB3 || {};
  const conf = COUNTRY_CONFIG[country] || COUNTRY_CONFIG.US;
  const stored = cfg.countrySymbols?.[country];
  const symbols = Array.isArray(stored) && stored.length ? stored : conf.tickers;

  const saveSymbols = (next) => {
    const countrySymbols = { ...(cfg.countrySymbols || {}), [country]: next };
    updatePanelConfig('brazilB3', { ...cfg, countrySymbols });
  };

  return (
    <PanelShell>
      <EditablePanelHeader
        title={`${conf.flag} ${conf.label}`}
        onConfigOpen={() => setConfigOpen(true)}
        source="Polygon"
      >
        {countrySelect}
      </EditablePanelHeader>

      <div className="co-tape">
        <TapeCell label={`${country} INDEX`} ticker={conf.etf} />
        {conf.fx && <TapeCell label="FX" ticker={conf.fx} isFx />}
      </div>

      <div className="co-list">
        {symbols.map(sym => <CountryRow key={sym} sym={sym} onTickerClick={onTickerClick} />)}
      </div>

      {configOpen && (
        <PanelConfigModal
          panelId="brazilB3"
          currentTitle={`${conf.flag} ${conf.label}`}
          currentSymbols={symbols}
          onSave={({ symbols: next }) => { saveSymbols(next); setConfigOpen(false); }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </PanelShell>
  );
}

export default memo(CountryOverview);
