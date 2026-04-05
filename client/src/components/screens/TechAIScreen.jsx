/**
 * TechAIScreen.jsx — S5.4 (enhanced from S4.2.C)
 * Tech & AI deep screen — 32 tickers across 4 sections.
 * Now with Mkt Cap, P/E, and YTD columns from Twelve Data.
 */
import { memo, useMemo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import SectorChartStrip from './SectorChartStrip';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtB = (n) => {
  if (n == null || isNaN(n)) return '—';
  const v = parseFloat(n);
  if (v >= 1e12) return '$' + (v/1e12).toFixed(1) + 'T';
  if (v >= 1e9)  return '$' + (v/1e9).toFixed(0) + 'B';
  if (v >= 1e6)  return '$' + (v/1e6).toFixed(0) + 'M';
  return '$' + v.toFixed(0);
};

const MEGA_CAP  = ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN', 'TSLA', 'NFLX'];
const SEMIS     = ['NVDA', 'AMD', 'AVGO', 'TSM', 'QCOM', 'MRVL', 'MU', 'AMAT'];
const AI_CLOUD  = ['CRM', 'SNOW', 'PLTR', 'AI', 'PATH', 'NOW', 'DDOG', 'SMCI'];
const ETF_SYMBOLS = ['QQQ', 'XLK', 'SOXX', 'SMH', 'AIQ', 'BOTZ', 'ROBO', 'IGV', 'ARKK'];

// Sector-specific chart tickers — curated for Tech & AI coverage
const CHART_TICKERS = ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'TSM', 'AVGO', 'META', 'AMZN'];

const LABELS = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', META: 'Meta', AMZN: 'Amazon',
  TSLA: 'Tesla', NFLX: 'Netflix', NVDA: 'NVIDIA', AMD: 'AMD', AVGO: 'Broadcom',
  TSM: 'TSMC', QCOM: 'Qualcomm', MRVL: 'Marvell', MU: 'Micron', AMAT: 'Applied Materials',
  CRM: 'Salesforce', SNOW: 'Snowflake', PLTR: 'Palantir', AI: 'C3.ai', PATH: 'UiPath',
  NOW: 'ServiceNow', DDOG: 'Datadog', SMCI: 'Super Micro',
};

const ALL_STOCKS = [...MEGA_CAP, ...SEMIS, ...AI_CLOUD];

function EnhancedRow({ symbol, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const pe = stats?.pe_ratio;
  const mktCap = stats?.market_capitalization;
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{LABELS[symbol] || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: pe != null && parseFloat(pe) < 25 ? '#66bb6a' : pe != null && parseFloat(pe) > 50 ? '#ef5350' : '#ccc' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}
      </td>
    </tr>
  );
}

const SectionTable = memo(function SectionTable({ tickers, statsMap }) {
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
        {tickers.map(sym => (
          <EnhancedRow key={sym} symbol={sym} stats={statsMap.get(sym)} onClick={openDetail} />
        ))}
      </tbody>
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
  const statsMap = useDeepScreenData(ALL_STOCKS);

  const sections = useMemo(() => [
    { id: 'megacap',  title: 'MEGA-CAP TECH',       component: () => <SectionTable tickers={MEGA_CAP} statsMap={statsMap} /> },
    { id: 'semis',    title: 'SEMICONDUCTORS',       component: () => <SectionTable tickers={SEMIS} statsMap={statsMap} /> },
    { id: 'aicloud',  title: 'AI & CLOUD SOFTWARE',  component: () => <SectionTable tickers={AI_CLOUD} statsMap={statsMap} /> },
  ], [statsMap]);

  return (
    <DeepScreenBase
      title="Tech & AI"
      accentColor="#4fc3f7"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Technology & AI', tickers: ['NVDA', 'MSFT', 'GOOGL', 'AAPL', 'AMZN', 'TSM', 'AVGO'] }}
      aiCacheKey="sector:tech-ai"
    >
      <SectorChartStrip tickers={CHART_TICKERS} title="TECH & AI CHARTS" />
      <DeepSection title="TECH & AI ETF STRIP">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(TechAIScreen);
