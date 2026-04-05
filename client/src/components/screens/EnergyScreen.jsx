/**
 * EnergyScreen.jsx — S4.2.B
 * Deep Bloomberg-style Energy & Transition coverage screen.
 * 35 tickers across 5 sections: Majors, OFS & Midstream, Clean Energy, Futures, ETFs
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const INTEGRATED_MAJORS = ['XOM', 'CVX', 'SHEL', 'BP', 'TTE', 'COP'];
const OFS_MIDSTREAM     = ['SLB', 'HAL', 'BKR', 'ET', 'KMI', 'WMB'];
const CLEAN_ENERGY      = ['ENPH', 'FSLR', 'NEE', 'AES', 'PLUG', 'RUN', 'CCJ', 'UEC'];
const FUTURES = [
  { symbol: 'CL=F', label: 'WTI Crude' },
  { symbol: 'BZ=F', label: 'Brent Crude' },
  { symbol: 'NG=F', label: 'Natural Gas' },
  { symbol: 'RB=F', label: 'RBOB Gasoline' },
];
const ETF_SYMBOLS = ['XLE', 'XOP', 'ICLN', 'TAN', 'URA', 'LIT', 'OIH'];

function EnergyRow({ symbol, label, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

const IntegratedMajorsSection = memo(function IntegratedMajorsSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {INTEGRATED_MAJORS.map(sym => <EnergyRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

const OfsAndMidstreamSection = memo(function OfsAndMidstreamSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {OFS_MIDSTREAM.map(sym => <EnergyRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

const CleanEnergySection = memo(function CleanEnergySection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {CLEAN_ENERGY.map(sym => <EnergyRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

const FuturesSection = memo(function FuturesSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Contract</th><th>Label</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {FUTURES.map(({ symbol, label }) => (
          <EnergyRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
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
  const sections = [
    { id: 'majors',  title: 'Integrated Majors',        component: IntegratedMajorsSection },
    { id: 'ofs',     title: 'OFS & Midstream',           component: OfsAndMidstreamSection },
    { id: 'clean',   title: 'Clean Energy & Transition',  component: CleanEnergySection },
    { id: 'futures', title: 'Energy Futures',              component: FuturesSection },
  ];

  return (
    <DeepScreenBase
      title="Energy & Transition"
      accentColor="#66bb6a"
      sections={sections}
      aiType="sector"
      aiContext={{
        sector: 'Energy & Transition',
        tickers: ['XOM', 'CVX', 'SLB', 'CL=F', 'ENPH', 'CCJ'],
      }}
      aiCacheKey="sector:energy"
    >
      <DeepSection title="Energy ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(EnergyScreenImpl);
