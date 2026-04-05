/**
 * EnergyScreen.jsx — S5.4 (enhanced from S4.2.B)
 * Deep Bloomberg-style Energy & Transition coverage screen.
 * 35 tickers with Mkt Cap + P/E for equity sections, spread analysis for futures.
 */
import { memo, useMemo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
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

const LABELS = {
  XOM: 'Exxon Mobil', CVX: 'Chevron', SHEL: 'Shell', BP: 'BP', TTE: 'TotalEnergies', COP: 'ConocoPhillips',
  SLB: 'Schlumberger', HAL: 'Halliburton', BKR: 'Baker Hughes', ET: 'Energy Transfer', KMI: 'Kinder Morgan', WMB: 'Williams',
  ENPH: 'Enphase', FSLR: 'First Solar', NEE: 'NextEra', AES: 'AES Corp', PLUG: 'Plug Power', RUN: 'Sunrun', CCJ: 'Cameco', UEC: 'Uranium Energy',
};

function EnhancedEquityRow({ symbol, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  const divYield = stats?.dividend_yield;
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{LABELS[symbol] || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>{fmtPct(q?.changePct)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>{pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#66bb6a' }}>
        {divYield != null ? (parseFloat(divYield) * 100).toFixed(1) + '%' : '—'}
      </td>
    </tr>
  );
}

const EquitySection = memo(function EquitySection({ tickers, statsMap }) {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th>
          <th style={{ fontSize: 9 }}>Mkt Cap</th>
          <th style={{ fontSize: 9 }}>P/E</th>
          <th style={{ fontSize: 9 }}>Div%</th>
        </tr>
      </thead>
      <tbody>
        {tickers.map(sym => <EnhancedEquityRow key={sym} symbol={sym} stats={statsMap.get(sym)} onClick={openDetail} />)}
      </tbody>
    </table>
  );
});

function FuturesRow({ symbol, label, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{symbol.replace('=F', '')}</td>
      <td>{label}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>{fmtPct(q?.changePct)}</td>
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
          {FUTURES.map(({ symbol, label }) => (
            <FuturesRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
      {spread != null && (
        <div style={{ fontSize: 10, color: '#ff9800', padding: '6px 4px 2px', borderTop: '1px solid #1a1a1a' }}>
          Brent-WTI Spread: ${spread.toFixed(2)} / bbl
        </div>
      )}
    </>
  );
});

const EtfStripSection = memo(function EtfStripSection() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-strip">
      {ETF_SYMBOLS.map(sym => (
        <TickerCell key={sym} symbol={sym} price={useTickerPrice(sym)?.price} changePct={useTickerPrice(sym)?.changePct} onClick={openDetail} />
      ))}
    </div>
  );
});

function EnergyScreenImpl() {
  const statsMap = useDeepScreenData(ALL_EQUITIES);

  const sections = useMemo(() => [
    { id: 'majors', title: 'Integrated Majors',         component: () => <EquitySection tickers={INTEGRATED_MAJORS} statsMap={statsMap} /> },
    { id: 'ofs',    title: 'OFS & Midstream',            component: () => <EquitySection tickers={OFS_MIDSTREAM} statsMap={statsMap} /> },
    { id: 'clean',  title: 'Clean Energy & Transition',  component: () => <EquitySection tickers={CLEAN_ENERGY} statsMap={statsMap} /> },
    { id: 'futures', title: 'Energy Futures & Spreads',  component: FuturesSection },
  ], [statsMap]);

  return (
    <DeepScreenBase
      title="Energy & Transition"
      accentColor="#66bb6a"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Energy & Transition', tickers: ['XOM', 'CVX', 'SLB', 'CL=F', 'ENPH', 'CCJ'] }}
      aiCacheKey="sector:energy"
    >
      <DeepSection title="Energy ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(EnergyScreenImpl);
