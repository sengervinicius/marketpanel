/**
 * CountryOverview.jsx — the non-Brazil rendering of the "In-Depth Country" box.
 *
 * Rich, per-country view built from data the backend already exposes:
 *   • Macro tiles     — /api/macro/country/:code (policy rate, CPI, GDP, unemp)
 *   • Rates tape      — /api/debt/sovereign/:code (10Y + 2s10s)
 *   • Index + FX      — useTickerPrice (ETF proxy + USD pair)
 *   • US internals    — /api/market/mood + /api/market/sector-performance
 *   • Names           — curated US-listed ADR/ETF rows (Polygon-priced)
 * Everything degrades gracefully (— / hidden) when a country lacks a feed.
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
  US: { flag: '🇺🇸', label: 'United States', etf: 'SPY', fx: null,        exch: 'US', tickers: ['AAPL','MSFT','NVDA','AMZN','GOOGL','JPM'] },
  MX: { flag: '🇲🇽', label: 'Mexico',        etf: 'EWW', fx: 'USDMXN=X', exch: null, tickers: ['AMX','FMX','CX','KOF'] },
  JP: { flag: '🇯🇵', label: 'Japan',         etf: 'EWJ', fx: 'USDJPY=X', exch: null, tickers: ['TM','SONY','MUFG','HMC','MFG'] },
  DE: { flag: '🇩🇪', label: 'Germany',       etf: 'EWG', fx: 'EURUSD=X', exch: null, tickers: ['SAP','DB'] },
  GB: { flag: '🇬🇧', label: 'United Kingdom',etf: 'EWU', fx: 'GBPUSD=X', exch: null, tickers: ['HSBC','SHEL','BP','GSK','BCS'] },
  CN: { flag: '🇨🇳', label: 'China',         etf: 'MCHI',fx: 'USDCNH=X', exch: null, tickers: ['BABA','PDD','JD','BIDU'] },
  IN: { flag: '🇮🇳', label: 'India',         etf: 'INDA',fx: 'USDINR=X', exch: null, tickers: ['INFY','HDB','IBN','WIT'] },
  CA: { flag: '🇨🇦', label: 'Canada',        etf: 'EWC', fx: 'USDCAD=X', exch: null, tickers: ['RY','TD','ENB','CNQ','SHOP'] },
  AU: { flag: '🇦🇺', label: 'Australia',     etf: 'EWA', fx: 'AUDUSD=X', exch: null, tickers: ['BHP','RIO','WBK'] },
};

export const COUNTRY_OPTIONS = [
  ['BR', '🇧🇷 Brazil'], ['US', '🇺🇸 United States'], ['MX', '🇲🇽 Mexico'],
  ['JP', '🇯🇵 Japan'], ['DE', '🇩🇪 Germany'], ['GB', '🇬🇧 United Kingdom'],
  ['CN', '🇨🇳 China'], ['IN', '🇮🇳 India'], ['CA', '🇨🇦 Canada'], ['AU', '🇦🇺 Australia'],
];

const pct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : `${(v * 100).toFixed(d)}%`;

function MacroTile({ label, value, title }) {
  return (
    <div className="co-tile" title={title || ''}>
      <span className="co-tile-label">{label}</span>
      <span className="co-tile-val">{value}</span>
    </div>
  );
}

function TapeCell({ label, ticker, isFx, staticVal, color }) {
  const q = useTickerPrice(isFx || ticker ? ticker : null);
  const price = staticVal != null ? staticVal : (q?.price != null ? Number(q.price) : null);
  const chg = ticker ? q?.changePct : null;
  return (
    <div className="co-tape-cell">
      <span className="co-tape-label">{label}</span>
      <span className="co-tape-val" style={color ? { color } : undefined}>
        {price != null ? (isFx ? price.toFixed(4) : price.toFixed(2)) : '—'}
      </span>
      {chg != null && (
        <span className="co-tape-chg" style={{ color: chg >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
        </span>
      )}
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
      onDoubleClick={() => openDetailWindow(sym, 'Country')}
    />
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
    apiFetch(`/api/macro/country/${country}`).then(r => r.ok ? r.json() : null)
      .then(j => { if (alive) setMacro(j?.data || null); }).catch(() => {});
    apiFetch(`/api/debt/sovereign/${country}`).then(r => r.ok ? r.json() : null)
      .then(j => { if (alive) setCurve(Array.isArray(j?.points) ? j.points : null); }).catch(() => {});
    if (country === 'US') {
      apiFetch('/api/market/mood').then(r => r.ok ? r.json() : null)
        .then(j => { if (alive) setMood(j || null); }).catch(() => {});
      apiFetch('/api/market/sector-performance').then(r => r.ok ? r.json() : null)
        .then(j => { if (alive) setSectors(Array.isArray(j?.data) ? j.data : null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [country]);

  const y = (t) => curve?.find(p => p.tenor === t)?.yield;
  const y10 = y('10Y'), y2 = y('2Y');
  const spread = (y10 != null && y2 != null) ? Math.round((y10 - y2) * 100) : null;

  // US internals: mood + best/worst sector on the day
  let moodLabel = null, moodVal = null, secBest = null, secWorst = null;
  if (isUS) {
    moodLabel = mood?.label; moodVal = mood?.composite;
    if (Array.isArray(sectors) && sectors.length) {
      const withPerf = sectors.map(s => ({ name: s.name || s.symbol, p: s.perf?.['1D'] })).filter(s => s.p != null);
      if (withPerf.length) {
        const sorted = [...withPerf].sort((a, b) => b.p - a.p);
        secBest = sorted[0]; secWorst = sorted[sorted.length - 1];
      }
    }
  }

  return (
    <PanelShell>
      <EditablePanelHeader title={`${conf.flag} ${conf.label}`} source="Multi-source">
        {countrySelect}
      </EditablePanelHeader>

      {/* Macro tiles */}
      <div className="co-macro">
        <MacroTile label="POLICY" value={pct(macro?.policyRate, 2)} title="Policy / base rate" />
        <MacroTile label="CPI YoY" value={pct(macro?.cpiYoY)} title="Headline inflation, YoY" />
        <MacroTile label="GDP YoY" value={pct(macro?.gdpGrowthYoY)} title="Real GDP growth, YoY" />
        <MacroTile label="UNEMP" value={pct(macro?.unemploymentRate)} title="Unemployment rate" />
        {macro?.stub && <span className="co-est" title={`Estimated · ${macro?.source || ''}`}>est.</span>}
      </div>

      {/* Rates + market tape */}
      <div className="co-tape">
        <TapeCell label={`${country} INDEX`} ticker={conf.etf} />
        {conf.fx && <TapeCell label="USD FX" ticker={conf.fx} isFx />}
        {y10 != null && <TapeCell label="10Y" staticVal={y10} />}
        {spread != null && (
          <div className="co-tape-cell">
            <span className="co-tape-label">2s10s</span>
            <span className="co-tape-val" style={{ color: spread < 0 ? 'var(--color-down)' : 'var(--text-primary)' }}>
              {spread > 0 ? '+' : ''}{spread}bp
            </span>
          </div>
        )}
      </div>

      {/* US internals */}
      {isUS && (moodLabel || secBest) && (
        <div className="co-intl">
          {moodLabel && (
            <span className="co-intl-item">
              <span className="co-intl-k">MOOD</span>
              <span className="co-intl-v" style={{ color: moodVal >= 55 ? 'var(--color-up)' : moodVal <= 45 ? 'var(--color-down)' : 'var(--text-secondary)' }}>
                {moodLabel}{moodVal != null ? ` ${Math.round(moodVal)}` : ''}
              </span>
            </span>
          )}
          {secBest && (
            <span className="co-intl-item" title="Best / worst sector today">
              <span className="co-intl-k">SECTORS</span>
              <span className="co-intl-v" style={{ color: 'var(--color-up)' }}>▲ {secBest.name}</span>
              <span className="co-intl-v" style={{ color: 'var(--color-down)' }}>▼ {secWorst.name}</span>
            </span>
          )}
        </div>
      )}

      {/* Names */}
      <div className="co-list">
        {conf.tickers.map(sym => <CountryRow key={sym} sym={sym} onTickerClick={onTickerClick} />)}
      </div>
    </PanelShell>
  );
}

export default memo(CountryOverview);
