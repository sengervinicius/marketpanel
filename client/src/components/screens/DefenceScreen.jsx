/**
 * DefenceScreen.jsx — S4.2.A
 * Deep Bloomberg-style Defence & Aerospace coverage screen.
 * 34 tickers across 5 sections: Primes, EU Defence, Supply Chain, Space & Cyber, ETFs
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const US_PRIMES   = ['LMT', 'NOC', 'RTX', 'BA', 'GD', 'LHX'];
const EU_DEFENCE  = [
  { symbol: 'BAESY', name: 'BAE Systems' },
  { symbol: 'RNMBY', name: 'Rheinmetall' },
  { symbol: 'EADSY', name: 'Airbus Defence' },
  { symbol: 'SAABF', name: 'Saab' },
  { symbol: 'FINMY', name: 'Leonardo' },
  { symbol: 'THLEF', name: 'Thales' },
];
const SUPPLY_CHAIN = ['LDOS', 'BWXT', 'HII', 'MRCY', 'AXON', 'TDG'];
const SPACE_CYBER  = ['RKLB', 'PLTR', 'KTOS', 'SPR', 'IRDM'];
const ETF_SYMBOLS  = ['ITA', 'XAR', 'PPA', 'DFEN', 'UFO'];

/* ── Generic row ──────────────────────────────────────────────────────── */
function DefenceRow({ symbol, label, openDetail }) {
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

/* ── US Primes ─────────────────────────────────────────────────────────── */
const PrimesSection = memo(function PrimesSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {US_PRIMES.map(sym => <DefenceRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

/* ── EU Defence (ADRs) ─────────────────────────────────────────────────── */
const EuDefenceSection = memo(function EuDefenceSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {EU_DEFENCE.map(({ symbol, name }) => (
          <DefenceRow key={symbol} symbol={symbol} label={name} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

/* ── Supply Chain & Tech ───────────────────────────────────────────────── */
const SupplyChainSection = memo(function SupplyChainSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {SUPPLY_CHAIN.map(sym => <DefenceRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

/* ── Space & Cyber ─────────────────────────────────────────────────────── */
const SpaceCyberSection = memo(function SpaceCyberSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D %</th></tr></thead>
      <tbody>
        {SPACE_CYBER.map(sym => <DefenceRow key={sym} symbol={sym} openDetail={openDetail} />)}
      </tbody>
    </table>
  );
});

/* ── ETF Strip ─────────────────────────────────────────────────────────── */
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

/* ── Main Screen ───────────────────────────────────────────────────────── */
function DefenceScreenImpl() {
  const sections = [
    { id: 'primes',      title: 'US Defence Primes', component: PrimesSection },
    { id: 'eu-defence',  title: 'EU Defence (ADRs)',  component: EuDefenceSection },
    { id: 'supply',      title: 'Supply Chain & Tech', component: SupplyChainSection },
    { id: 'space-cyber', title: 'Space & Cyber',       component: SpaceCyberSection },
  ];

  return (
    <DeepScreenBase
      title="Defence & Aerospace"
      accentColor="#ef5350"
      sections={sections}
      aiType="sector"
      aiContext={{
        sector: 'Defence & Aerospace',
        tickers: ['LMT', 'NOC', 'RTX', 'BA', 'GD', 'BAESY', 'RNMBY'],
      }}
      aiCacheKey="sector:defence"
    >
      <DeepSection title="Sector ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(DefenceScreenImpl);
