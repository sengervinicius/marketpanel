/**
 * CommoditiesScreen.jsx — S4.2.D
 * Deep Bloomberg-style Commodities coverage screen.
 * 32 tickers: Benchmarks (8 futures), Producers (10), Agriculture (4 futures), ETFs (10)
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const BENCHMARKS = [
  { symbol: 'CL=F', label: 'WTI Crude' },
  { symbol: 'BZ=F', label: 'Brent Crude' },
  { symbol: 'GC=F', label: 'Gold' },
  { symbol: 'SI=F', label: 'Silver' },
  { symbol: 'HG=F', label: 'Copper' },
  { symbol: 'NG=F', label: 'Natural Gas' },
  { symbol: 'ZW=F', label: 'Wheat' },
  { symbol: 'ZC=F', label: 'Corn' },
];

const PRODUCERS = ['XOM', 'CVX', 'VALE', 'BHP', 'RIO', 'FCX', 'NEM', 'GOLD', 'AA', 'ADM'];

const AG_SOFT = [
  { symbol: 'ZS=F', label: 'Soybeans' },
  { symbol: 'KC=F', label: 'Coffee' },
  { symbol: 'SB=F', label: 'Sugar' },
  { symbol: 'CT=F', label: 'Cotton' },
];

const ETF_SYMBOLS = ['DBC', 'USO', 'GLD', 'SLV', 'PDBC', 'CPER', 'UNG', 'CORN', 'WEAT', 'SOYB'];

function CommodityRow({ symbol, label, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{label || symbol}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

function CompanyRow({ symbol, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

const BenchmarksSection = memo(function BenchmarksSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Commodity</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {BENCHMARKS.map(({ symbol, label }) => (
          <CommodityRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

const ProducersSection = memo(function ProducersSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Company</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {PRODUCERS.map(sym => <CompanyRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

const AgSoftSection = memo(function AgSoftSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Commodity</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {AG_SOFT.map(({ symbol, label }) => (
          <CommodityRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
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

function CommoditiesScreenImpl() {
  const sections = [
    { id: 'benchmarks', title: 'Benchmarks',              component: BenchmarksSection },
    { id: 'producers',  title: 'Producers & Miners',       component: ProducersSection },
    { id: 'agsoft',     title: 'Agriculture & Soft Commodities', component: AgSoftSection },
  ];

  return (
    <DeepScreenBase
      title="Commodities & Resources"
      accentColor="#ffb74d"
      sections={sections}
      aiType="commodity"
      aiContext={{
        commodity: 'broad',
        symbols: ['CL=F', 'GC=F', 'SI=F', 'BZ=F', 'NG=F', 'HG=F', 'ZS=F'],
      }}
      aiCacheKey="commodity:broad"
    >
      <DeepSection title="Commodity ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(CommoditiesScreenImpl);
