/**
 * BrazilScreen.jsx — S4.2.F + S4.7
 * Brazil & LatAm deep screen — 35+ instruments across 6 sections.
 * B3 Blue Chips, ADRs & Global Access, DI Futures Curve, FX & Rates, LatAm Macro, ETFs
 */
import { memo, useMemo } from 'react';
import DeepScreenBase, { DeepSection, DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const BLUE_CHIPS = ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'BBAS3.SA', 'ABEV3.SA', 'WEGE3.SA', 'RENT3.SA', 'SUZB3.SA', 'EMBR3.SA'];
const NAMES = {
  'PETR4.SA': 'Petrobras', 'VALE3.SA': 'Vale', 'ITUB4.SA': 'Itaú', 'BBDC4.SA': 'Bradesco',
  'BBAS3.SA': 'Banco Brasil', 'ABEV3.SA': 'Ambev', 'WEGE3.SA': 'WEG', 'RENT3.SA': 'Localiza',
  'SUZB3.SA': 'Suzano', 'EMBR3.SA': 'Embraer',
};

// S4.7.B — ADR pairs (B3 ↔ US ADR)
const ADR_PAIRS = [
  { b3: 'PETR4.SA', adr: 'PBR', name: 'Petrobras' },
  { b3: 'VALE3.SA', adr: 'VALE', name: 'Vale' },
  { b3: 'ITUB4.SA', adr: 'ITUB', name: 'Itaú' },
  { b3: 'BBDC4.SA', adr: 'BBD', name: 'Bradesco' },
  { b3: 'ABEV3.SA', adr: 'ABEV', name: 'Ambev' },
];

// S4.7.C — LatAm peers
const LATAM_PEERS = ['MELI', 'NU', 'SQM', 'GLOB', 'BSAC', 'STNE'];

const ETF_SYMBOLS = ['EWZ', 'FLBR', 'EWW', 'ARGT'];

/* ── TickerRow ─────────────────────────────────────────────────────────── */
function TickerRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol.replace('.SA', '').replace('=F', '')}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

/* ── B3 Blue Chips ─────────────────────────────────────────────────────── */
const BlueChipsSection = memo(function BlueChipsSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>
        {BLUE_CHIPS.map(sym => <TickerRow key={sym} symbol={sym} label={NAMES[sym]} onClick={openDetail} />)}
      </tbody>
    </table>
  );
});

/* ── S4.7.B — ADR Cross-References ─────────────────────────────────────── */
const AdrSection = memo(function AdrSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Company</th><th>B3</th><th>B3 Price</th><th>ADR</th><th>ADR Price</th></tr></thead>
      <tbody>
        {ADR_PAIRS.map(({ b3, adr, name }) => (
          <AdrPairRow key={b3} b3={b3} adr={adr} name={name} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

function AdrPairRow({ b3, adr, name, openDetail }) {
  const qB3  = useTickerPrice(b3);
  const qAdr = useTickerPrice(adr);
  return (
    <tr>
      <td className="ds-ticker-col">{name}</td>
      <td className="ds-row-clickable" onClick={() => openDetail(b3)} style={{ cursor: 'pointer' }}>
        {b3.replace('.SA', '')} <span style={{ color: '#888' }}>{qB3?.price != null ? fmt(qB3.price) : '—'}</span>
      </td>
      <td>{qB3?.price != null ? fmt(qB3.price) : '—'}</td>
      <td className="ds-row-clickable" onClick={() => openDetail(adr)} style={{ cursor: 'pointer' }}>
        {adr} <span style={{ color: '#888' }}>{qAdr?.price != null ? fmt(qAdr.price) : '—'}</span>
      </td>
      <td>{qAdr?.price != null ? fmt(qAdr.price) : '—'}</td>
    </tr>
  );
}

/* ── S4.7.A — DI Futures Curve (inline) ────────────────────────────────── */
const DiCurveSection = memo(function DiCurveSection() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'brazil-di-curve',
    fetcher: async () => {
      const res = await apiFetch('/api/market/di-curve');
      return res.ok ? await res.json() : null;
    },
    refreshMs: 120000,
  });

  if (loading) return <DeepSkeleton rows={6} />;
  if (error) return <DeepError message={error} />;

  const curve = data?.curve || data?.data || [];
  if (!curve.length) return <div style={{ color: '#888', padding: 8 }}>DI curve data unavailable</div>;

  return (
    <table className="ds-table">
      <thead><tr><th>Tenor</th><th>Rate (%)</th><th>1D Chg (bp)</th></tr></thead>
      <tbody>
        {curve.slice(0, 12).map((point, i) => (
          <tr key={point.tenor || i}>
            <td>{point.tenor || point.label || `DI${i + 1}`}</td>
            <td>{fmt(point.rate || point.value, 2)}</td>
            <td className={point.change >= 0 ? 'ds-up' : 'ds-down'}>
              {point.change != null ? (point.change >= 0 ? '+' : '') + point.change.toFixed(0) + 'bp' : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

/* ── FX & Rates + Macro Data ───────────────────────────────────────────── */
const FxRatesSection = memo(function FxRatesSection() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'brazil-macro',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=BR&indicators=policyRate,cpiYoY');
      return res.ok ? await res.json() : null;
    },
  });

  if (loading) return <DeepSkeleton rows={4} />;
  if (error) return <DeepError message={error} />;

  const brData = data?.data?.find(row => row.country === 'BR') || {};

  return (
    <table className="ds-table">
      <thead><tr><th>Pair</th><th>Label</th><th>Spot</th><th>1D%</th></tr></thead>
      <tbody>
        <TickerRow symbol="C:USDBRL" label="USD/BRL" onClick={openDetail} />
        <TickerRow symbol="C:EURBRL" label="EUR/BRL" onClick={openDetail} />
        <tr>
          <td colSpan="4" style={{ fontSize: 11, padding: '8px 4px', borderTop: '1px solid #333' }}>
            <strong>Selic:</strong> {brData.policyRate != null ? fmtPct(brData.policyRate) : '—'} | <strong>CPI YoY:</strong> {brData.cpiYoY != null ? fmtPct(brData.cpiYoY) : '—'}
          </td>
        </tr>
      </tbody>
    </table>
  );
});

/* ── S4.7.C — LatAm Peers + Macro ─────────────────────────────────────── */
const LatamPeersSection = memo(function LatamPeersSection() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'latam-macro',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=BR,MX,AR,CL&indicators=policyRate,cpiYoY');
      return res.ok ? await res.json() : null;
    },
  });

  return (
    <>
      <table className="ds-table">
        <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>
          {LATAM_PEERS.map(sym => <TickerRow key={sym} symbol={sym} label={sym} onClick={openDetail} />)}
        </tbody>
      </table>
      {loading && <DeepSkeleton rows={4} />}
      {!loading && !error && data?.data && (
        <table className="ds-table" style={{ marginTop: 8 }}>
          <thead><tr><th>Country</th><th>Policy Rate</th><th>CPI YoY</th></tr></thead>
          <tbody>
            {data.data.map(row => (
              <tr key={row.country}>
                <td>{row.country}</td>
                <td>{fmtPct(row.policyRate)}</td>
                <td>{fmtPct(row.cpiYoY)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
});

/* ── ETF Strip ─────────────────────────────────────────────────────────── */
const EtfStripSection = memo(function EtfStripSection() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-etf-strip">
      {ETF_SYMBOLS.map(sym => {
        const q = useTickerPrice(sym);
        return <TickerCell key={sym} symbol={sym} label={sym} price={q?.price} changePct={q?.changePct} onClick={openDetail} />;
      })}
    </div>
  );
});

/* ── Main Component ────────────────────────────────────────────────────── */
function BrazilScreen() {
  const sections = [
    { id: 'bluechips',  title: 'B3 BLUE CHIPS',           component: BlueChipsSection },
    { id: 'adr',        title: 'ADRs & GLOBAL ACCESS',     component: AdrSection },
    { id: 'dicurve',    title: 'DI FUTURES CURVE',          component: DiCurveSection },
    { id: 'fxrates',    title: 'FX & RATES',                component: FxRatesSection },
    { id: 'latam',      title: 'LATAM PEERS & MACRO',       component: LatamPeersSection },
  ];

  return (
    <DeepScreenBase
      title="Brazil & LatAm"
      accentColor="#66bb6a"
      sections={sections}
      aiType="em-country"
      aiContext={{ country: 'Brazil' }}
      aiCacheKey="em:brazil"
    >
      <DeepSection title="BRAZIL ETF STRIP">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(BrazilScreen);
