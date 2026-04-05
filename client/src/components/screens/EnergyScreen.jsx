/**
 * EnergyScreen.jsx — Phase D2
 * Deep Bloomberg-style Energy & Transition coverage screen.
 * Sections: Integrated Majors, OFS & Midstream, Futures, ETF Strip, AI Energy Brief
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────────── */
/* INTEGRATED MAJORS */
/* ─────────────────────────────────────────────────────────────────────────── */
function IntegratedMajorsSection() {
  const openDetail = useOpenDetail();
  const majors = ['XOM', 'CVX', 'SHEL', 'BP', 'TTE'];

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
        {majors.map((symbol) => (
          <EnergyRow key={symbol} symbol={symbol} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

function EnergyRow({ symbol, openDetail }) {
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
/* OFS & MIDSTREAM */
/* ─────────────────────────────────────────────────────────────────────────── */
function OfsAndMidstreamSection() {
  const openDetail = useOpenDetail();
  const ofs = ['SLB', 'HAL', 'BKR', 'ET', 'KMI', 'WMB'];

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
        {ofs.map((symbol) => (
          <EnergyRow key={symbol} symbol={symbol} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* FUTURES */
/* ─────────────────────────────────────────────────────────────────────────── */
function FuturesSection() {
  const openDetail = useOpenDetail();
  const futures = [
    { symbol: 'CL=F', label: 'WTI' },
    { symbol: 'BZ=F', label: 'Brent' },
    { symbol: 'NG=F', label: 'NatGas' },
  ];

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Future</th>
          <th>Price</th>
          <th>1D %</th>
        </tr>
      </thead>
      <tbody>
        {futures.map(({ symbol, label }) => (
          <tr key={symbol} onClick={() => openDetail(symbol)}>
            <td className="ds-ticker-col">{label}</td>
            <td>{fmt(useTickerPrice(symbol)?.price, 2)}</td>
            <td className={useTickerPrice(symbol)?.changePct != null && useTickerPrice(symbol)?.changePct >= 0 ? 'ds-up' : 'ds-down'}>
              {fmtPct(useTickerPrice(symbol)?.changePct)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ETF STRIP */
/* ─────────────────────────────────────────────────────────────────────────── */
function EtfStripSection() {
  const openDetail = useOpenDetail();
  const etfs = ['XLE', 'XOP', 'OIH', 'VDE', 'AMLP'];

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
function EnergyScreenImpl() {
  const sections = [
    { id: 'majors', title: 'Integrated Majors', component: IntegratedMajorsSection },
    { id: 'ofs', title: 'OFS & Midstream', component: OfsAndMidstreamSection },
    { id: 'futures', title: 'Futures', component: FuturesSection },
  ];

  return (
    <DeepScreenBase
      title="Energy & Transition"
      accentColor="#66bb6a"
      sections={sections}
      aiType="sector"
      aiContext={{
        sector: 'Energy & Transition',
        tickers: ['XOM', 'CVX', 'SLB', 'CL=F'],
      }}
      aiCacheKey="sector:energy"
    >
      <div className="ds-section">
        <div className="ds-section-head">
          <span className="ds-section-title">Sector ETFs</span>
        </div>
        <div className="ds-section-body">
          <EtfStripSection />
        </div>
      </div>
    </DeepScreenBase>
  );
}

export default memo(EnergyScreenImpl);
