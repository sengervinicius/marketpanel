/**
 * CommoditiesScreen.jsx — Phase D2
 * Deep Bloomberg-style Commodities coverage screen.
 * Sections: Benchmarks, Producers & Miners, ETF Strip, AI Commodity Brief
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────────── */
/* BENCHMARKS */
/* ─────────────────────────────────────────────────────────────────────────── */
function BenchmarksSection() {
  const openDetail = useOpenDetail();
  const commodities = [
    { symbol: 'CL=F', label: 'WTI' },
    { symbol: 'BZ=F', label: 'Brent' },
    { symbol: 'GC=F', label: 'Gold' },
    { symbol: 'SI=F', label: 'Silver' },
    { symbol: 'HG=F', label: 'Copper' },
    { symbol: 'NG=F', label: 'NatGas' },
    { symbol: 'ZW=F', label: 'Wheat' },
  ];

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Commodity</th>
          <th>Price</th>
          <th>1D %</th>
        </tr>
      </thead>
      <tbody>
        {commodities.map(({ symbol, label }) => (
          <CommodityRow key={symbol} symbol={symbol} label={label} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

function CommodityRow({ symbol, label, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{label}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* PRODUCERS & MINERS */
/* ─────────────────────────────────────────────────────────────────────────── */
function ProducersSection() {
  const openDetail = useOpenDetail();
  const producers = ['XOM', 'CVX', 'VALE', 'BHP', 'RIO', 'FCX', 'NEM', 'GOLD', 'AA'];

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Price</th>
          <th>1D %</th>
        </tr>
      </thead>
      <tbody>
        {producers.map((symbol) => (
          <CompanyRow key={symbol} symbol={symbol} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

function CompanyRow({ symbol, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <tr onClick={() => openDetail(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ETF STRIP */
/* ─────────────────────────────────────────────────────────────────────────── */
function EtfStripSection() {
  const openDetail = useOpenDetail();
  const etfs = ['DBC', 'USO', 'GLD', 'SLV', 'PDBC', 'CPER', 'UNG', 'CORN', 'WEAT', 'SOYB'];

  return (
    <div className="ds-strip">
      {etfs.map((symbol) => (
        <TickerCell
          key={symbol}
          symbol={symbol}
          price={useTickerPrice(symbol)?.price}
          changePct={useTickerPrice(symbol)?.changePct}
          onClick={openDetail}
        />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MAIN SCREEN */
/* ─────────────────────────────────────────────────────────────────────────── */
function CommoditiesScreenImpl() {
  const sections = [
    { id: 'benchmarks', title: 'Benchmarks', component: BenchmarksSection },
    { id: 'producers', title: 'Producers & Miners', component: ProducersSection },
  ];

  return (
    <DeepScreenBase
      title="Commodities & Resources"
      accentColor="#ffb74d"
      sections={sections}
      aiType="commodity"
      aiContext={{
        commodity: 'broad',
        symbols: ['CL=F', 'GC=F', 'SI=F', 'BZ=F', 'NG=F'],
      }}
      aiCacheKey="commodity:broad"
    >
      <div className="ds-section">
        <div className="ds-section-head">
          <span className="ds-section-title">ETF Strip</span>
        </div>
        <div className="ds-section-body">
          <EtfStripSection />
        </div>
      </div>
    </DeepScreenBase>
  );
}

export default memo(CommoditiesScreenImpl);
