/**
 * TechAIScreen.jsx — S4.2.C
 * Tech & AI deep screen — 32 tickers across 4 sections.
 * Mega-Cap Tech, Semiconductors, AI & Cloud Software, ETFs
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const MEGA_CAP  = ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA', 'NFLX'];
const SEMIS     = ['NVDA', 'AMD', 'AVGO', 'TSM', 'QCOM', 'MRVL', 'MU', 'AMAT'];
const AI_CLOUD  = ['CRM', 'SNOW', 'PLTR', 'AI', 'PATH', 'NOW', 'DDOG', 'SMCI'];
const ETF_SYMBOLS = ['QQQ', 'XLK', 'SOXX', 'SMH', 'AIQ', 'BOTZ', 'ROBO', 'IGV', 'ARKK'];

const LABELS = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', META: 'Meta', AMZN: 'Amazon',
  TSLA: 'Tesla', NFLX: 'Netflix', NVDA: 'NVIDIA', AMD: 'AMD', AVGO: 'Broadcom',
  TSM: 'TSMC', QCOM: 'Qualcomm', MRVL: 'Marvell', MU: 'Micron', AMAT: 'Applied Materials',
  CRM: 'Salesforce', SNOW: 'Snowflake', PLTR: 'Palantir', AI: 'C3.ai', PATH: 'UiPath',
  NOW: 'ServiceNow', DDOG: 'Datadog', SMCI: 'Super Micro',
};

function TickerRow({ symbol, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol}</td>
      <td>{LABELS[symbol] || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

const MegaCapSection = memo(function MegaCapSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>{MEGA_CAP.map(sym => <TickerRow key={sym} symbol={sym} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const SemiconductorsSection = memo(function SemiconductorsSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>{SEMIS.map(sym => <TickerRow key={sym} symbol={sym} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const AiCloudSection = memo(function AiCloudSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>{AI_CLOUD.map(sym => <TickerRow key={sym} symbol={sym} onClick={openDetail} />)}</tbody>
    </table>
  );
});

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

function TechAIScreen() {
  const sections = [
    { id: 'megacap',  title: 'MEGA-CAP TECH',       component: MegaCapSection },
    { id: 'semis',    title: 'SEMICONDUCTORS',       component: SemiconductorsSection },
    { id: 'aicloud',  title: 'AI & CLOUD SOFTWARE',  component: AiCloudSection },
  ];

  return (
    <DeepScreenBase
      title="Tech & AI"
      accentColor="#4fc3f7"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Technology & AI', tickers: ['NVDA', 'MSFT', 'GOOGL', 'AAPL', 'AMZN', 'TSM', 'AVGO'] }}
      aiCacheKey="sector:tech-ai"
    >
      <DeepSection title="TECH & AI ETF STRIP">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(TechAIScreen);
