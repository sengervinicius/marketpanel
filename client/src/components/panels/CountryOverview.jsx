/**
 * CountryOverview.jsx — the non-Brazil "In-Depth Country" view.
 *
 * CIO-oriented country read, built from data the backend reliably exposes:
 *   • Macro scorecard — /api/macro/country/:code — the signals CIOs watch:
 *       REAL RATE (policy − CPI), policy rate, CPI, GDP, unemployment,
 *       current account %GDP, debt %GDP. Colour-coded (carry / external
 *       balance / debt burden). 'est.' when a country's prints are modelled.
 *   • Market strip   — index ETF + USD FX (live), and for the US the Treasury
 *       10Y + 2s10s (/api/debt/sovereign/US), market mood + sector leaders.
 *   • Names          — an expanded, scrollable list of liquid ADRs/holdings.
 * Everything degrades gracefully where a country lacks a feed.
 */
import { useState, useEffect, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import PanelShell from '../common/PanelShell';
import EditablePanelHeader from '../common/EditablePanelHeader';
import { PriceRow } from '../common/PriceRow';
import { COLS_STANDARD } from '../../utils/panelColumns';
import { openDetailWindow } from '../../utils/detailWindow';
import './CountryOverview.css';

export const COUNTRY_CONFIG = {
  US: { flag: '🇺🇸', label: 'United States', etf: 'SPY', fx: null,        tickers: ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','JPM','XOM','LLY','V','WMT','UNH'] },
  MX: { flag: '🇲🇽', label: 'Mexico',        etf: 'EWW', fx: 'USDMXN=X', tickers: ['AMX','FMX','CX','KOF','BSMX','TV'] },
  JP: { flag: '🇯🇵', label: 'Japan',         etf: 'EWJ', fx: 'USDJPY=X', tickers: ['TM','SONY','MUFG','HMC','MFG','NMR','MTU'] },
  DE: { flag: '🇩🇪', label: 'Germany',       etf: 'EWG', fx: 'EURUSD=X', tickers: ['SAP','DB','BAYRY','SIEGY','ALIZY','DTEGY'] },
  GB: { flag: '🇬🇧', label: 'United Kingdom',etf: 'EWU', fx: 'GBPUSD=X', tickers: ['HSBC','SHEL','BP','GSK','AZN','UL','BCS','RIO'] },
  CN: { flag: '🇨🇳', label: 'China',         etf: 'MCHI',fx: 'USDCNH=X', tickers: ['BABA','PDD','JD','BIDU','NIO','LI','TCEHY','NTES'] },
  IN: { flag: '🇮🇳', label: 'India',         etf: 'INDA',fx: 'USDINR=X', tickers: ['INFY','HDB','IBN','WIT','RDY','TTM'] },
  CA: { flag: '🇨🇦', label: 'Canada',        etf: 'EWC', fx: 'USDCAD=X', tickers: ['RY','TD','ENB','CNQ','SHOP','BNS','CP','SU'] },
  AU: { flag: '🇦🇺', label: 'Australia',     etf: 'EWA', fx: 'AUDUSD=X', tickers: ['BHP','RIO','WDS','CODI'] },
};

export const COUNTRY_OPTIONS = [
  ['BR', '🇧🇷 Brazil'], ['US', '🇺🇸 United States'], ['MX', '🇲🇽 Mexico'],
  ['JP', '🇯🇵 Japan'], ['DE', '🇩🇪 Germany'], ['GB', '🇬🇧 United Kingdom'],
  ['CN', '🇨🇳 China'], ['IN', '🇮🇳 India'], ['CA', '🇨🇦 Canada'], ['AU', '🇦🇺 Australia'],
];

const UP = 'var(--color-up)', DOWN = 'var(--color-down)', AMBER = '#e0a030', DIM = 'var(--text-primary)';
const pct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : `${(v * 100).toFixed(d)}%`;
const signed = (v, d = 1) => (v == null || isNaN(v)) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

function Tile({ label, value, color, title }) {
  return (
    <div className="co-tile" title={title || ''}>
      <span className="co-tile-label">{label}</span>
      <span className="co-tile-val" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function TapeCell({ label, ticker, isFx, staticVal, valColor }) {
  const q = useTickerPrice(ticker || null);
  const price = staticVal != null ? staticVal : (q?.price != null ? Number(q.price) : null);
  const chg = ticker ? q?.changePct : null;
  return (
    <div className="co-tape-cell">
      <span className="co-tape-label">{label}</span>
      <span className="co-tape-val" style={valColor ? { color: valColor } : undefined}>
        {price != null ? (isFx ? price.toFixed(4) : price.toFixed(2)) : '—'}
      </span>
      {chg != null && (
        <span className="co-tape-chg" style={{ color: chg >= 0 ? UP : DOWN }}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
      )}
    </div>
  );
}

function CountryRow({ sym, onTickerClick }) {
  const q = useTickerPrice(sym);
  return (
    <PriceRow symbol={sym} name={q?.name || ''} price={q?.price != null ? Number(q.price) : null}
      changePct={q?.changePct ?? null} decimals={2} columns={COLS_STANDARD}
      onClick={() => onTickerClick?.(sym)} onDoubleClick={() => openDetailWindow(sym, 'Country')} />
  );
}

function CountryOverview({ country, countrySelect, onTickerClick }) {
  const conf = COUNTRY_CONFIG[country] || COUNTRY_CONFIG.US;
  const [macro, setMacro] = useState(null);
  const [curve, setCurve] = useState(null);
  const [mood, setMood] = useState(null);
  const [sectors, setSectors] = useState(null);
  const isUS = country === 'US';

  useEffect(() => {
    let alive = true;
    setMacro(null); setCurve(null); setMood(null); setSectors(null);
    apiFetch(`/api/macro/country/${country}`).then(r => r.ok ? r.json() : null).then(j => { if (alive) setMacro(j?.data || null); }).catch(() => {});
    apiFetch(`/api/debt/sovereign/${country}`).then(r => r.ok ? r.json() : null).then(j => { if (alive) setCurve(Array.isArray(j?.points) ? j.points : null); }).catch(() => {});
    if (country === 'US') {
      apiFetch('/api/market/mood').then(r => r.ok ? r.json() : null).then(j => { if (alive) setMood(j || null); }).catch(() => {});
      apiFetch('/api/market/sector-performance').then(r => r.ok ? r.json() : null).then(j => { if (alive) setSectors(Array.isArray(j?.data) ? j.data : null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [country]);

  const y = (t) => curve?.find(p => p.tenor === t)?.yield;
  const y10 = y('10Y'), y2 = y('2Y');
  const spread = (y10 != null && y2 != null) ? Math.round((y10 - y2) * 100) : null;

  // Real rate = policy − CPI (the CIO carry signal)
  const realRate = (macro?.policyRate != null && macro?.cpiYoY != null) ? macro.policyRate - macro.cpiYoY : null;
  const realColor = realRate == null ? null : realRate > 0.005 ? UP : realRate < 0 ? DOWN : DIM;
  const ca = macro?.currentAcctGDP;
  const caColor = ca == null ? null : ca >= 0 ? UP : ca <= -0.03 ? DOWN : AMBER;
  const debt = macro?.debtGDP;
  const debtColor = debt == null ? null : debt > 1.2 ? DOWN : debt > 0.9 ? AMBER : DIM;

  let moodLabel = null, moodVal = null, secBest = null, secWorst = null;
  if (isUS) {
    moodLabel = mood?.label; moodVal = mood?.composite;
    if (Array.isArray(sectors) && sectors.length) {
      const w = sectors.map(s => ({ name: s.name || s.symbol, p: s.perf?.['1D'] })).filter(s => s.p != null);
      if (w.length) { const s = [...w].sort((a, b) => b.p - a.p); secBest = s[0]; secWorst = s[s.length - 1]; }
    }
  }

  return (
    <PanelShell>
      <EditablePanelHeader title={`${conf.flag} ${conf.label}`} source="Multi-source">
        {countrySelect}
      </EditablePanelHeader>

      <div className="co-sec-row">
        <span className="co-sec">MACRO</span>
        {macro?.stub && <span className="co-est" title={`Estimated · ${macro?.source || ''}`}>est.</span>}
      </div>
      <div className="co-macro">
        <Tile label="REAL RATE" value={signed(realRate, 2)} color={realColor} title="Policy rate minus CPI — real carry" />
        <Tile label="POLICY" value={pct(macro?.policyRate, 2)} title="Policy / base rate" />
        <Tile label="CPI YoY" value={pct(macro?.cpiYoY)} title="Headline inflation, YoY" />
        <Tile label="GDP YoY" value={pct(macro?.gdpGrowthYoY)} title="Real GDP growth, YoY" />
        <Tile label="UNEMP" value={pct(macro?.unemploymentRate)} title="Unemployment rate" />
        <Tile label="C/A %GDP" value={signed(ca)} color={caColor} title="Current account balance, % of GDP" />
        <Tile label="DEBT %GDP" value={pct(debt, 0)} color={debtColor} title="Government debt, % of GDP" />
      </div>

      <div className="co-sec-row"><span className="co-sec">MARKET</span></div>
      <div className="co-tape">
        <TapeCell label={`${country} INDEX`} ticker={conf.etf} />
        {conf.fx && <TapeCell label="USD FX" ticker={conf.fx} isFx />}
        {y10 != null && <TapeCell label="10Y" staticVal={y10} />}
        {spread != null && (
          <div className="co-tape-cell">
            <span className="co-tape-label">2s10s</span>
            <span className="co-tape-val" style={{ color: spread < 0 ? DOWN : DIM }}>{spread > 0 ? '+' : ''}{spread}bp</span>
          </div>
        )}
      </div>

      {isUS && (moodLabel || secBest) && (
        <div className="co-intl">
          {moodLabel && (<span className="co-intl-item"><span className="co-intl-k">MOOD</span>
            <span className="co-intl-v" style={{ color: moodVal >= 55 ? UP : moodVal <= 45 ? DOWN : 'var(--text-secondary)' }}>{moodLabel}{moodVal != null ? ` ${Math.round(moodVal)}` : ''}</span></span>)}
          {secBest && (<span className="co-intl-item" title="Best / worst sector today"><span className="co-intl-k">SECTORS</span>
            <span className="co-intl-v" style={{ color: UP }}>▲ {secBest.name}</span>
            <span className="co-intl-v" style={{ color: DOWN }}>▼ {secWorst.name}</span></span>)}
        </div>
      )}

      <div className="co-sec-row"><span className="co-sec">NAMES</span><span className="co-sec-n">{conf.tickers.length}</span></div>
      <div className="co-list">
        {conf.tickers.map(sym => <CountryRow key={sym} sym={sym} onTickerClick={onTickerClick} />)}
      </div>
    </PanelShell>
  );
}

export default memo(CountryOverview);
