/**
 * BrazilScreen.jsx — Phase D1
 * Brazil & LatAm deep screen with B3 blue chips, FX, macro, and ETF strip.
 */

import { memo } from 'react';
import DeepScreenBase, { DeepSection, DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';
import { useSectionData } from '../../hooks/useSectionData';
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
const ETF_SYMBOLS = ['EWZ', 'FLBR', 'EWW', 'ARGT'];

/* ── B3 Blue Chips Table ────────────────────────────────────────────────── */
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

const BlueChipsSection = memo(function BlueChipsSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Name</th>
          <th>Price</th>
          <th>1D%</th>
        </tr>
      </thead>
      <tbody>
        {BLUE_CHIPS.map(sym => (
          <TickerRow key={sym} symbol={sym} label={NAMES[sym]} onClick={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

/* ── FX & Rates Section ────────────────────────────────────────────────── */
const FxRatesSection = memo(function FxRatesSection() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'brazil-macro',
    fetcher: async () => {
      const res = await apiFetch(`/api/macro/compare?countries=BR&indicators=policyRate,cpiYoY`);
      return res.ok ? await res.json() : null;
    },
  });

  if (loading) return <DeepSkeleton rows={4} />;
  if (error) return <DeepError message={error} />;

  const brData = data?.data?.find(row => row.country === 'BR') || {};
  const policyRate = brData.policyRate;
  const cpiYoY = brData.cpiYoY;

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Pair</th>
          <th>Spot</th>
          <th>1D%</th>
        </tr>
      </thead>
      <tbody>
        <TickerRow symbol="C:USDBRL" label="USD/BRL" onClick={openDetail} />
        <TickerRow symbol="C:EURBRL" label="EUR/BRL" onClick={openDetail} />
        <tr>
          <td colSpan="4" style={{ fontSize: 11, padding: '8px 4px', borderTop: '1px solid #ddd' }}>
            <strong>Selic:</strong> {policyRate != null ? fmtPct(policyRate) : '—'} | <strong>CPI YoY:</strong> {cpiYoY != null ? fmtPct(cpiYoY) : '—'}
          </td>
        </tr>
      </tbody>
    </table>
  );
});

/* ── LatAm Macro Section ────────────────────────────────────────────────── */
const LatamMacroSection = memo(function LatamMacroSection() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'latam-macro',
    fetcher: async () => {
      const res = await apiFetch(`/api/macro/compare?countries=BR,MX,AR,CL&indicators=policyRate,cpiYoY`);
      return res.ok ? await res.json() : null;
    },
  });

  if (loading) return <DeepSkeleton rows={5} />;
  if (error) return <DeepError message={error} />;

  const rows = data?.data || [];

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Country</th>
          <th>Policy Rate</th>
          <th>CPI YoY</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.country}>
            <td>{row.country}</td>
            <td>{fmtPct(row.policyRate)}</td>
            <td>{fmtPct(row.cpiYoY)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});

/* ── ETF Strip Section ────────────────────────────────────────────────── */
const EtfStripSection = memo(function EtfStripSection() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-etf-strip">
      {ETF_SYMBOLS.map(sym => {
        const q = useTickerPrice(sym);
        return (
          <TickerCell
            key={sym}
            symbol={sym}
            label={sym}
            price={q?.price}
            changePct={q?.changePct}
            onClick={openDetail}
          />
        );
      })}
    </div>
  );
});

/* ── Main Component ────────────────────────────────────────────────────── */
function BrazilScreen() {
  const sections = [
    { id: 'bluechips', title: 'B3 BLUE CHIPS', component: BlueChipsSection },
    { id: 'fxrates', title: 'FX & RATES', component: FxRatesSection },
    { id: 'latammacro', title: 'LATAM MACRO', component: LatamMacroSection },
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
