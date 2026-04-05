/**
 * CommoditiesScreen.jsx — S5.4 (enhanced from S4.2.D)
 * Deep Bloomberg-style Commodities coverage screen.
 * 32 tickers: Benchmarks, Producers (with Mkt Cap/P/E/Div%), Agriculture, ETFs
 */
import { memo, useMemo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import SectorChartStrip from './SectorChartStrip';
import DataUnavailable from '../common/DataUnavailable';
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

const CHART_TICKERS = ['GC=F', 'SI=F', 'CL=F', 'HG=F', 'NG=F', 'NEM', 'FCX', 'BHP'];

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

const LABELS = {
  XOM: 'Exxon Mobil', CVX: 'Chevron', VALE: 'Vale', BHP: 'BHP Group', RIO: 'Rio Tinto',
  FCX: 'Freeport-McMoRan', NEM: 'Newmont', GOLD: 'Barrick Gold', AA: 'Alcoa', ADM: 'Archer-Daniels',
};

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

function ProducerRow({ symbol, stats, openDetail }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  const divYield = stats?.dividend_yield;
  return (
    <tr className="ds-row-clickable" onClick={() => openDetail(symbol)}>
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

const BenchmarksSection = memo(function BenchmarksSection() {
  const openDetail = useOpenDetail();
  const gold = useTickerPrice('GC=F');
  const silver = useTickerPrice('SI=F');
  const gsRatio = (gold?.price != null && silver?.price != null && silver.price > 0) ? (gold.price / silver.price) : null;

  return (
    <>
      <table className="ds-table">
        <thead><tr><th>Commodity</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {BENCHMARKS.map(({ symbol, label }) => (
            <CommodityRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
          ))}
        </tbody>
      </table>
      {gsRatio != null && (
        <div style={{ fontSize: 10, color: '#ff9800', padding: '6px 4px 2px', borderTop: '1px solid #1a1a1a' }}>
          Gold/Silver Ratio: {gsRatio.toFixed(1)}x
        </div>
      )}
    </>
  );
});

const ProducersSection = memo(function ProducersSection({ statsMap, loading, error, onRetry }) {
  const openDetail = useOpenDetail();

  if (loading && statsMap.size === 0) {
    return <div style={{ padding: 16, textAlign: 'center', color: '#666', fontSize: 11 }}>Loading statistics...</div>;
  }

  if (error && statsMap.size === 0) {
    return <DataUnavailable reason={error} onRetry={onRetry} />;
  }

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
        {PRODUCERS.map(sym => <ProducerRow key={sym} symbol={sym} stats={statsMap.get(sym)} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

const AgSoftSection = memo(function AgSoftSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Commodity</th><th>Price</th><th>1D%</th></tr></thead>
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
  const { data: statsMap, loading, error, refresh } = useDeepScreenData(PRODUCERS);

  const sections = useMemo(() => [
    { id: 'benchmarks', title: 'Benchmarks',                    component: BenchmarksSection },
    { id: 'producers',  title: 'Producers & Miners',            component: () => <ProducersSection statsMap={statsMap} loading={loading} error={error} onRetry={refresh} /> },
    { id: 'agsoft',     title: 'Agriculture & Soft Commodities', component: AgSoftSection },
  ], [statsMap, loading, error, refresh]);

  return (
    <DeepScreenBase
      title="Commodities & Resources"
      accentColor="#ffb74d"
      sections={sections}
      aiType="commodity"
      aiContext={{ commodity: 'broad', symbols: ['CL=F', 'GC=F', 'SI=F', 'BZ=F', 'NG=F', 'HG=F', 'ZS=F'] }}
      aiCacheKey="commodity:broad"
    >
      <SectorChartStrip tickers={CHART_TICKERS} title="COMMODITY CHARTS" />
      <DeepSection title="Commodity ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(CommoditiesScreenImpl);
