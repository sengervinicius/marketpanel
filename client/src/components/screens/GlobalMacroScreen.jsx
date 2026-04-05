/**
 * GlobalMacroScreen.jsx — Phase D2
 * Deep Bloomberg-style Global Macro coverage screen.
 * Sections: Global Snapshot, FX & Yield Linkage, Key Indexes, AI Macro Insight
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';
import useSectionData from '../../hooks/useSectionData';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';

const fmt = (n, d = 2) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

/* ─────────────────────────────────────────────────────────────────────────── */
/* GLOBAL SNAPSHOT */
/* ─────────────────────────────────────────────────────────────────────────── */
function GlobalSnapshot() {
  const openDetail = useOpenDetail();
  const { data, loading, error } = useSectionData({
    cacheKey: 'screen:macro:snapshot',
    fetcher: async () => {
      const res = await apiFetch('/api/macro/compare?countries=US,EU,DE,FR,IT,GB,JP,CN,BR,MX,IN,ZA&indicators=policyRate,cpiYoY,gdpGrowth,unemploymentRate');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  if (loading) return <DeepSkeleton rows={8} />;
  if (error) return <DeepError message={error} />;
  if (!data || !Array.isArray(data)) return <DeepError message="No data" />;

  const getCpiColor = (val) => {
    if (val == null) return '';
    if (val > 4) return '#d32f2f'; // red
    if (val > 3) return '#f57c00'; // orange
    if (val > 2) return '#388e3c'; // green
    return '';
  };

  const getUneColor = (val) => {
    if (val == null) return '';
    if (val < 3.5) return '#388e3c'; // green
    if (val < 4.5) return '#f57c00'; // orange
    return '#d32f2f'; // red
  };

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Country</th>
          <th title="Central Bank Policy Rate">Rate (%)</th>
          <th title="Consumer Price Index YoY">CPI YoY (%)</th>
          <th title="GDP Growth">GDP Gr. (%)</th>
          <th title="Unemployment Rate">Unemp. (%)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.country || row.code}>
            <td className="ds-ticker-col" onClick={() => openDetail(row.country)}>
              {row.country || row.code}
            </td>
            <td>{fmt(row.policyRate, 2)}</td>
            <td style={{ color: getCpiColor(row.cpiYoY) }}>{fmt(row.cpiYoY, 2)}</td>
            <td>{fmt(row.gdpGrowth, 2)}</td>
            <td style={{ color: getUneColor(row.unemploymentRate) }}>{fmt(row.unemploymentRate, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* FX & YIELD LINKAGE */
/* ─────────────────────────────────────────────────────────────────────────── */
function FxYieldSection() {
  const openDetail = useOpenDetail();
  const fxPairs = ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDCNY', 'C:USDBRL', 'C:USDINR', 'C:USDZAR'];

  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Pair</th>
          <th>Spot</th>
          <th>1D %</th>
        </tr>
      </thead>
      <tbody>
        {fxPairs.map((pair) => (
          <FxRow key={pair} pair={pair} openDetail={openDetail} />
        ))}
      </tbody>
    </table>
  );
}

function FxRow({ pair, openDetail }) {
  const q = useTickerPrice(pair);
  const displayPair = pair.replace(/^C:/, '');
  return (
    <tr onClick={() => openDetail(pair)}>
      <td className="ds-ticker-col">{displayPair}</td>
      <td>{q?.price != null ? fmt(q.price, 4) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* KEY INDEXES */
/* ─────────────────────────────────────────────────────────────────────────── */
function KeyIndexes() {
  const openDetail = useOpenDetail();
  const indexes = ['SPY', 'QQQ', 'EWZ', 'EEM', 'EFA', 'FXI'];

  return (
    <div className="ds-strip">
      {indexes.map((symbol) => (
        <IndexCell key={symbol} symbol={symbol} openDetail={openDetail} />
      ))}
    </div>
  );
}

function IndexCell({ symbol, openDetail }) {
  const q = useTickerPrice(symbol);
  return (
    <TickerCell
      symbol={symbol}
      price={q?.price}
      changePct={q?.changePct}
      onClick={openDetail}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MAIN SCREEN */
/* ─────────────────────────────────────────────────────────────────────────── */
function GlobalMacroScreenImpl() {
  const sections = [
    { id: 'snapshot', title: 'Global Snapshot', component: GlobalSnapshot },
    { id: 'fx', title: 'FX & Yield Linkage', component: FxYieldSection },
  ];

  return (
    <DeepScreenBase
      title="Global Macro"
      accentColor="#4fc3f7"
      sections={sections}
      aiType="macro"
      aiContext={{
        countries: ['US', 'EU', 'JP', 'CN', 'BR'],
        indicators: ['policyRate', 'cpiYoY', 'gdpGrowth'],
      }}
      aiCacheKey="macro:global"
    >
      <div className="ds-section">
        <div className="ds-section-head">
          <span className="ds-section-title">Key Indexes</span>
        </div>
        <div className="ds-section-body">
          <KeyIndexes />
        </div>
      </div>
    </DeepScreenBase>
  );
}

export default memo(GlobalMacroScreenImpl);
