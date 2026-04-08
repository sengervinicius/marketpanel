/**
 * EnergyScreen.jsx — S5.4 (enhanced from S4.2.B) + Phase 5
 * Deep Bloomberg-style Energy & Transition coverage screen.
 * 35 tickers with Mkt Cap + P/E for equity sections, spread analysis for futures.
 *
 * Phase 5 additions:
 *  - Linked ticker selection: clicking a row highlights the corresponding chart
 *  - Per-chart timeframe selectors on SectorChartPanel
 *  - Enhanced dividend yield display
 */
import { memo, useMemo, useState } from 'react';
import DeepScreenBase, { DeepSection, TickerCell, StatsLoadGate } from './DeepScreenBase';
import SectorChartStrip from './SectorChartStrip';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtB = (n) => {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(0) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
};

const INTEGRATED_MAJORS = ['XOM', 'CVX', 'SHEL', 'BP', 'TTE', 'COP'];
const OFS_MIDSTREAM     = ['SLB', 'HAL', 'BKR', 'ET', 'KMI', 'WMB'];
const CLEAN_ENERGY      = ['ENPH', 'FSLR', 'NEE', 'AES', 'PLUG', 'RUN', 'CCJ', 'UEC'];
const ALL_EQUITIES = [...INTEGRATED_MAJORS, ...OFS_MIDSTREAM, ...CLEAN_ENERGY];
const FUTURES = [
  { symbol: 'CL=F', label: 'WTI Crude' },
  { symbol: 'BZ=F', label: 'Brent Crude' },
  { symbol: 'NG=F', label: 'Natural Gas' },
  { symbol: 'RB=F', label: 'RBOB Gasoline' },
];
const ETF_SYMBOLS = ['XLE', 'XOP', 'ICLN', 'TAN', 'URA', 'LIT', 'OIH'];

// Sector-specific chart tickers — energy benchmarks + majors
const CHART_TICKERS = ['CL=F', 'BZ=F', 'NG=F', 'XOM', 'CVX', 'SHEL', 'NEE', 'ENPH'];

const LABELS = {
  XOM: 'Exxon Mobil', CVX: 'Chevron', SHEL: 'Shell', BP: 'BP', TTE: 'TotalEnergies', COP: 'ConocoPhillips',
  SLB: 'Schlumberger', HAL: 'Halliburton', BKR: 'Baker Hughes', ET: 'Energy Transfer', KMI: 'Kinder Morgan', WMB: 'Williams',
  ENPH: 'Enphase', FSLR: 'First Solar', NEE: 'NextEra', AES: 'AES Corp', PLUG: 'Plug Power', RUN: 'Sunrun', CCJ: 'Cameco', UEC: 'Uranium Energy',
};

function EnhancedEquityRow({ symbol, stats, onClick, isSelected }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  const divYield = stats?.dividend_yield;
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => onClick(symbol)}
      onTouchEnd={(e) => { e.preventDefault(); onClick(symbol); }}
      style={{
        background: isSelected ? 'rgba(102, 187, 106, 0.08)' : 'transparent',
        borderLeft: isSelected ? '3px solid var(--price-up, #66bb6a)' : '3px solid transparent',
        transition: 'background 0.15s ease',
      }}
    >
      <td className="ds-ticker-col" style={{ fontSize: 13, letterSpacing: '0.5px' }}>{symbol}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{LABELS[symbol] || <span className="ds-dash">—</span>}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? '$' + fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--price-up, #4caf50)', fontVariantNumeric: 'tabular-nums' }}>
        {divYield != null ? (parseFloat(divYield) * 100).toFixed(1) + '%' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

const EquitySection = memo(function EquitySection({ tickers, statsMap, selectedTicker, onSelectTicker }) {
  const openDetail = useOpenDetail();
  const handleRowClick = (symbol) => {
    onSelectTicker?.(symbol);
    openDetail(symbol, 'Energy & Oil');
  };

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th>
          <th>Mkt Cap</th>
          <th>P/E</th>
          <th>Div%</th>
        </tr>
      </thead>
      <tbody>
        {(Array.isArray(tickers) ? tickers : []).map(sym => (
          <EnhancedEquityRow
            key={sym}
            symbol={sym}
            stats={statsMap.get(sym)}
            onClick={handleRowClick}
            isSelected={selectedTicker === sym}
          />
        ))}
      </tbody>
    </table>
  );
});

function FuturesRow({ symbol, label, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => openDetail(symbol, 'Energy & Oil')}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(symbol, 'Energy & Oil'); }}
    >
      <td className="ds-ticker-col" style={{ fontSize: 13 }}>{symbol.replace('=F', '')}</td>
      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.price != null ? fmt(q?.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'} style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

const FuturesSection = memo(function FuturesSection() {
  const openDetail = useOpenDetail();
  const wti = useTickerPrice('CL=F');
  const brent = useTickerPrice('BZ=F');
  const spread = (brent?.price != null && wti?.price != null) ? (brent.price - wti.price) : null;

  return (
    <>
      <table className="ds-table">
        <thead><tr><th>Contract</th><th>Label</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {(Array.isArray(FUTURES) ? FUTURES : []).map(({ symbol, label }) => (
            <FuturesRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
      {spread != null && (
        <div style={{ fontSize: 10, color: 'var(--semantic-warn)', padding: '6px 4px 2px', borderTop: '1px solid var(--border-default)' }}>
          Brent-WTI Spread: ${spread.toFixed(2)} / bbl
        </div>
      )}
    </>
  );
});

function EtfCell({ sym, onClick }) {
  const q = useTickerPrice(sym);
  return (
    <TickerCell
      key={sym}
      symbol={sym}
      price={q?.price}
      changePct={q?.changePct}
      onClick={onClick}
    />
  );
}

const EtfStripSection = memo(function EtfStripSection() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-strip">
      {(Array.isArray(ETF_SYMBOLS) ? ETF_SYMBOLS : []).map(sym => (
        <EtfCell key={sym} sym={sym} onClick={(sym) => openDetail(sym, 'Energy & Oil')} />
      ))}
    </div>
  );
});

function EnergyScreenImpl() {
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(ALL_EQUITIES);
  const [selectedTicker, setSelectedTicker] = useState(null);

  const sections = useMemo(() => [
    { id: 'majors', title: 'Integrated Majors',         component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><EquitySection tickers={INTEGRATED_MAJORS} statsMap={statsMap} selectedTicker={selectedTicker} onSelectTicker={setSelectedTicker} /></StatsLoadGate> },
    { id: 'ofs',    title: 'OFS & Midstream',            component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><EquitySection tickers={OFS_MIDSTREAM} statsMap={statsMap} selectedTicker={selectedTicker} onSelectTicker={setSelectedTicker} /></StatsLoadGate> },
    { id: 'clean',  title: 'Clean Energy & Transition',  component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><EquitySection tickers={CLEAN_ENERGY} statsMap={statsMap} selectedTicker={selectedTicker} onSelectTicker={setSelectedTicker} /></StatsLoadGate> },
    { id: 'futures', title: 'Energy Futures & Spreads',  component: FuturesSection },
  ], [statsMap, statsLoading, statsError, statsRefresh, selectedTicker]);

  return (
    <DeepScreenBase
      title="Energy & Transition"
      accentColor="#66bb6a"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Energy & Transition', tickers: ['XOM', 'CVX', 'SLB', 'CL=F', 'ENPH', 'CCJ'] }}
      aiCacheKey="sector:energy"
    >
      <SectorChartStrip tickers={CHART_TICKERS} title="ENERGY CHARTS" sectorName="Energy & Oil" />
      <DeepSection title="Energy ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(EnergyScreenImpl);
