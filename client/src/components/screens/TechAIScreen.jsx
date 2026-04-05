/**
 * TechAIScreen.jsx — Phase D1
 * Tech & AI deep screen with mega-cap tech, AI infrastructure, software/cloud, and ETF strip.
 */

import { memo } from 'react';
import DeepScreenBase, { DeepSection, DeepSkeleton, DeepError, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

const MEGA_CAP = ['AAPL', 'MSFT', 'GOOGL', 'META', 'AMZN'];
const AI_INFRA = ['NVDA', 'AMD', 'AVGO', 'TSM', 'INTC'];
const AI_SOFTWARE = ['CRM', 'SNOW', 'PLTR', 'AI', 'PATH'];
const ETF_SYMBOLS = ['QQQ', 'XLK', 'SOXX', 'AIQ', 'BOTZ', 'ROBO'];

const MEGA_LABELS = {
  'AAPL': 'Apple', 'MSFT': 'Microsoft', 'GOOGL': 'Alphabet',
  'META': 'Meta', 'AMZN': 'Amazon',
};

const INFRA_LABELS = {
  'NVDA': 'NVIDIA', 'AMD': 'AMD', 'AVGO': 'Broadcom',
  'TSM': 'TSMC', 'INTC': 'Intel',
};

const SOFTWARE_LABELS = {
  'CRM': 'Salesforce', 'SNOW': 'Snowflake', 'PLTR': 'Palantir',
  'AI': 'C3.ai', 'PATH': 'UiPath',
};

/* ── Generic Ticker Row ────────────────────────────────────────────────── */
function TickerRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

/* ── Mega-Cap Tech Section ──────────────────────────────────────────────── */
const MegaCapSection = memo(function MegaCapSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Label</th>
          <th>Price</th>
          <th>1D%</th>
        </tr>
      </thead>
      <tbody>
        {MEGA_CAP.map(sym => (
          <TickerRow key={sym} symbol={sym} label={MEGA_LABELS[sym]} onClick={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

/* ── AI Infrastructure Section ──────────────────────────────────────────── */
const AiInfraSection = memo(function AiInfraSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Label</th>
          <th>Price</th>
          <th>1D%</th>
        </tr>
      </thead>
      <tbody>
        {AI_INFRA.map(sym => (
          <TickerRow key={sym} symbol={sym} label={INFRA_LABELS[sym]} onClick={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

/* ── AI Software & Cloud Section ────────────────────────────────────────── */
const AiSoftwareSection = memo(function AiSoftwareSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Label</th>
          <th>Price</th>
          <th>1D%</th>
        </tr>
      </thead>
      <tbody>
        {AI_SOFTWARE.map(sym => (
          <TickerRow key={sym} symbol={sym} label={SOFTWARE_LABELS[sym]} onClick={openDetail} />
        ))}
      </tbody>
    </table>
  );
});

/* ── ETF Strip Section ──────────────────────────────────────────────────── */
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
function TechAIScreen() {
  const sections = [
    { id: 'megacap', title: 'MEGA-CAP TECH', component: MegaCapSection },
    { id: 'aiinfra', title: 'AI INFRASTRUCTURE', component: AiInfraSection },
    { id: 'aisoftware', title: 'AI SOFTWARE & CLOUD', component: AiSoftwareSection },
  ];

  return (
    <DeepScreenBase
      title="Tech & AI"
      accentColor="#4fc3f7"
      sections={sections}
      aiType="sector"
      aiContext={{ sector: 'Technology & AI', tickers: ['NVDA', 'MSFT', 'GOOGL', 'AAPL', 'AMZN'] }}
      aiCacheKey="sector:tech-ai"
    >
      <DeepSection title="TECH & AI ETF STRIP">
        <EtfStripSection />
      </DeepSection>
    </DeepScreenBase>
  );
}

export default memo(TechAIScreen);
