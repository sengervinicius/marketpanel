/**
 * DefenceScreen.jsx — S5.4 (enhanced from S4.2.A)
 * Deep Bloomberg-style Defence & Aerospace coverage screen.
 * 34 tickers with Mkt Cap + P/E fundamentals from Twelve Data.
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

const LABELS = {
  LMT: 'Lockheed Martin', NOC: 'Northrop Grumman', RTX: 'RTX Corp', BA: 'Boeing', GD: 'General Dynamics', LHX: 'L3Harris',
  LDOS: 'Leidos', BWXT: 'BWX Tech', HII: 'Huntington Ingalls', MRCY: 'Mercury Systems', AXON: 'Axon Enterprise', TDG: 'TransDigm',
  RKLB: 'Rocket Lab', PLTR: 'Palantir', KTOS: 'Kratos Defense', SPR: 'Spirit Aero', IRDM: 'Iridium',
};

const ALL_EQUITIES = [...US_PRIMES, ...EU_DEFENCE.map(e => e.symbol), ...SUPPLY_CHAIN, ...SPACE_CYBER];

function EnhancedRow({ symbol, label, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || LABELS[symbol] || '—'}</td>
      <td>{fmt(q?.price, 2)}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>{fmtPct(q?.changePct)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>{pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}</td>
    </tr>
  );
}

const SectionTable = memo(function SectionTable({ tickers, statsMap, labels }) {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th>
          <th style={{ fontSize: 9 }}>Mkt Cap</th>
          <th style={{ fontSize: 9 }}>P/E</th>
        </tr>
      </thead>
      <tbody>
        {tickers.map(t => {
          const sym = typeof t === 'string' ? t : t.symbol;
          const name = typeof t === 'string' ? undefined : t.name;
          return <EnhancedRow key={sym} symbol={sym} label={name} stats={statsMap.get(sym)} onClick={openDetail} />;
        })}
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

function DefenceScreenImpl() {
  const statsMap = useDeepScreenData(ALL_EQUITIES);

  const sections = useMemo(() => [
    { id: 'primes',      title: 'US Defence Primes',  component: () => <SectionTable tickers={US_PRIMES} statsMap={statsMap} /> },
    { id: 'eu-defence',  title: 'EU Defence (ADRs)',   component: () => <SectionTable tickers={EU_DEFENCE} statsMap={statsMap} /> },
    { id: 'supply',      title: 'Supply Chain & Tech', component: () => <SectionTable tickers={SUPPLY_CHAIN} statsMap={statsMap} /> },
    { id: 'space-cyber', title: 'Space & Cyber',       component: () => <SectionTable tickers={SPACE_CYBER} statsMap={statsMap} /> },
  ], [statsMap]);

  return (
    <DeepScreenBase
      title="Defence & Aerospace"
      accentColor="#ef5350"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Defence & Aerospace', tickers: ['LMT', 'NOC', 'RTX', 'BA', 'GD', 'BAESY', 'RNMBY'] }}
      aiCacheKey="sector:defence"
    >
      <DeepSection title="Sector ETFs">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(DefenceScreenImpl);
