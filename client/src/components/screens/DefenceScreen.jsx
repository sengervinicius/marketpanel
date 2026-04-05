/**
 * DefenceScreen.jsx — Phase D2
 * Deep Bloomberg-style Defence & Aerospace coverage screen.
 * Sections: Primes, Supply Chain & Tech, ETF Strip, AI Defence Brief
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────────── */
/* PRIMES */
/* ─────────────────────────────────────────────────────────────────────────── */
function PrimesSection() {
  const openDetail = useOpenDetail();
  const primes = ['LMT', 'NOC', 'RTX', 'BA', 'GD', 'KTOS'];

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
        {primes.map((symbol) => (
          <DefenceRow key={symbol} symbol={symbol} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

function DefenceRow({ symbol, openDetail }) {
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
/* SUPPLY CHAIN & TECH */
/* ─────────────────────────────────────────────────────────────────────────── */
function SupplyChainSection() {
  const openDetail = useOpenDetail();
  const suppliers = ['LDOS', 'BWXT', 'HII', 'MRCY', 'AXON'];

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
        {suppliers.map((symbol) => (
          <DefenceRow key={symbol} symbol={symbol} openDetail={openDetail} />
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
  const etfs = ['ITA', 'XAR', 'PPA', 'DFEN'];

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
function DefenceScreenImpl() {
  const sections = [
    { id: 'primes', title: 'Defence Primes', component: PrimesSection },
    { id: 'supply', title: 'Supply Chain & Tech', component: SupplyChainSection },
  ];

  return (
    <DeepScreenBase
      title="Defence & Aerospace"
      accentColor="#ef5350"
      sections={sections}
      aiType="sector"
      aiContext={{
        sector: 'Defence & Aerospace',
        tickers: ['LMT', 'NOC', 'RTX', 'BA', 'GD'],
      }}
      aiCacheKey="sector:defence"
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

export default memo(DefenceScreenImpl);
