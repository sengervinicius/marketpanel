/**
 * CryptoScreen.jsx
 * Comprehensive Crypto Screen — separated from FX in FxCryptoScreen.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, InsiderActivity,
 * on-chain analytics for BTC & ETH, and crypto majors/equities/ETF coverage.
 */
import { memo, useMemo, useState } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import SectorPulse from './shared/SectorPulse';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import DeepScreenBase, { DeepSkeleton, DeepError, StatsLoadGate } from './DeepScreenBase';
import { apiFetch } from '../../utils/api';
import { KPIRibbon, TickerRibbon } from './shared/SectorUI';
import { CorrelationMatrix } from './shared/CorrelationMatrix';
import { EarningsCalendarStrip } from './shared/EarningsCalendarStrip';
import { AnalystActionsCard } from './shared/AnalystActionsCard';

/* ── Formatting utilities ──────────────────────────────────────────────────── */
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

/* ── Ticker universes ──────────────────────────────────────────────────────── */
const CRYPTO_MAJORS = ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:XRPUSD', 'X:BNBUSD', 'X:ADAUSD', 'X:AVAXUSD', 'X:DOTUSD', 'X:LINKUSD', 'X:MATICUSD'];
const CRYPTO_EQUITIES = ['MSTR', 'COIN', 'MARA', 'RIOT', 'HUT', 'BITF', 'CLSK'];
const CRYPTO_ETFS = ['IBIT', 'ETHE', 'ARKB', 'BITO', 'GBTC'];

const BANNER_TICKERS = [
  { ticker: 'X:BTCUSD', label: 'BTC' },
  { ticker: 'X:ETHUSD', label: 'ETH' },
  { ticker: 'X:SOLUSD', label: 'SOL' },
  { ticker: 'X:XRPUSD', label: 'XRP' },
  { ticker: 'X:BNBUSD', label: 'BNB' },
  { ticker: 'IBIT', label: 'IBIT' },
  { ticker: 'MSTR', label: 'MSTR' },
  { ticker: 'COIN', label: 'COIN' },
];

const CHART_TICKERS = ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN', 'IBIT'];

const CRYPTO_LABELS = {
  'X:BTCUSD': 'Bitcoin',
  'X:ETHUSD': 'Ethereum',
  'X:SOLUSD': 'Solana',
  'X:XRPUSD': 'XRP',
  'X:BNBUSD': 'BNB',
  'X:ADAUSD': 'Cardano',
  'X:AVAXUSD': 'Avalanche',
  'X:DOTUSD': 'Polkadot',
  'X:LINKUSD': 'Chainlink',
  'X:MATICUSD': 'Polygon',
};

const EQUITY_LABELS = {
  'MSTR': 'MicroStrategy',
  'COIN': 'Coinbase',
  'MARA': 'Marathon Digital',
  'RIOT': 'Riot Platforms',
  'HUT': 'Hut 8 Mining',
  'BITF': 'Bitfarms',
  'CLSK': 'CleanSpark',
};

const ETF_LABELS = {
  'IBIT': 'iShares Bitcoin ETF',
  'ETHE': 'Grayscale Ethereum Mini Trust',
  'ARKB': 'ARK 21Shares Bitcoin',
  'BITO': 'ProShares Bitcoin Futures',
  'GBTC': 'Grayscale Bitcoin Mini Trust',
};

/* ── Data-Depth Component Tickers ──────────────────────────────────────── */
const EARNINGS_TICKERS = ['MSTR', 'COIN', 'MARA', 'RIOT', 'HUT', 'BITF', 'CLSK'];
const OWNERSHIP_TICKERS = ['MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK'];
const SIGNALS_TICKERS = ['MSTR', 'COIN', 'MARA', 'RIOT', 'HUT', 'BITF', 'CLSK'];
const ANALYST_TICKERS = ['MSTR', 'COIN', 'MARA', 'RIOT'];

/* ── Wrapper Components for Data-Depth Sections ──────────────────────── */
const EarningsSection = memo(function EarningsSection() {
  return <EarningsCalendarStrip tickers={EARNINGS_TICKERS} accentColor="#f7931a" />;
});

const AnalystSection = memo(function AnalystSection() {
  return <AnalystActionsCard tickers={ANALYST_TICKERS} accentColor="#f7931a" />;
});

/* ── Crypto Major Row Component ────────────────────────────────────────────── */
function CryptoMajorRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  const displaySym = symbol.replace('X:', '');
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => onClick(symbol, 'Crypto & Digital Assets')}
      onTouchEnd={(e) => { e.preventDefault(); onClick(symbol, 'Crypto & Digital Assets'); }}
    >
      <td className="ds-ticker-col">{displaySym}</td>
      <td>{label || <span className="ds-dash">—</span>}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q.price, displaySym === 'BTC' ? 0 : 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

/* ── Crypto Equity Row Component ───────────────────────────────────────────── */
function CryptoEquityRow({ symbol, label, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const mktCap = stats?.market_capitalization;
  const pe = stats?.pe_ratio;

  return (
    <tr
      className="ds-row-clickable"
      onClick={() => onClick(symbol, 'Crypto & Digital Assets')}
      onTouchEnd={(e) => { e.preventDefault(); onClick(symbol, 'Crypto & Digital Assets'); }}
    >
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || <span className="ds-dash">—</span>}</td>
      <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        {q?.price != null ? fmt(q.price, 2) : <span className="ds-dash">—</span>}
      </td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {q?.changePct != null ? fmtPct(q?.changePct) : <span className="ds-dash">—</span>}
      </td>
      <td>
        {fmtB(mktCap) || <span className="ds-dash">—</span>}
      </td>
      <td>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : <span className="ds-dash">—</span>}
      </td>
    </tr>
  );
}

/* ── Crypto ETF Row Component ──────────────────────────────────────────────── */
function CryptoEtfRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr
      className="ds-row-clickable"
      onClick={() => onClick(symbol, 'Crypto & Digital Assets')}
      onTouchEnd={(e) => { e.preventDefault(); onClick(symbol, 'Crypto & Digital Assets'); }}
    >
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, 2) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-up' : 'ds-down'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ── Sector Charts Section ─────────────────────────────────────────────────── */
const ChartsSection = memo(function ChartsSection({ selectedTicker, onChartClick }) {
  return (
    <SectorChartPanel
      tickers={CHART_TICKERS}
      height={200}
      cols={3}
      selectedTicker={selectedTicker}
      onChartClick={onChartClick}
    />
  );
});

/* ── Crypto Majors Table Section ───────────────────────────────────────────── */
const CryptoMajorsSection = memo(function CryptoMajorsSection() {
  const openDetail = useOpenDetail();
  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th>Coin</th>
            <th>Name</th>
            <th>Price</th>
            <th>1D%</th>
          </tr>
        </thead>
        <tbody>
          {CRYPTO_MAJORS.map(sym => (
            <CryptoMajorRow
              key={sym}
              symbol={sym}
              label={CRYPTO_LABELS[sym]}
              onClick={openDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Crypto Equities Table Section ─────────────────────────────────────────── */
const CryptoEquitiesSection = memo(function CryptoEquitiesSection({ statsMap }) {
  const openDetail = useOpenDetail();
  return (
    <div style={{ overflow: 'auto' }}>
      <table className="ds-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Ticker</th>
            <th style={{ textAlign: 'left' }}>Name</th>
            <th>Price</th>
            <th>1D%</th>
            <th>Mkt Cap</th>
            <th>P/E</th>
          </tr>
        </thead>
        <tbody>
          {CRYPTO_EQUITIES.map(sym => (
            <CryptoEquityRow
              key={sym}
              symbol={sym}
              label={EQUITY_LABELS[sym]}
              stats={statsMap.get(sym)}
              onClick={openDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── Crypto ETFs Table Section ─────────────────────────────────────────────── */
const CryptoEtfsSection = memo(function CryptoEtfsSection() {
  const openDetail = useOpenDetail();
  return (
    <div style={{ overflow: 'auto' }}>
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
          {CRYPTO_ETFS.map(sym => (
            <CryptoEtfRow
              key={sym}
              symbol={sym}
              label={ETF_LABELS[sym]}
              onClick={openDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

/* ── On-Chain Card Helper ──────────────────────────────────────────────────── */
function OnChainCard({ label, value, unit, loading, error }) {
  if (loading) {
    return (
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: 4,
        padding: '12px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 10,
      }}>
        <div style={{ color: 'var(--text-faint)', marginBottom: 6 }}>{label}</div>
        <div style={{ height: 20, background: 'var(--bg-hover)', borderRadius: 2 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-default)',
        borderRadius: 4,
        padding: '12px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: 10,
      }}>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 9 }}>—</div>
      </div>
    );
  }
  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-default)',
      borderRadius: 4,
      padding: '12px',
      textAlign: 'center',
    }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 9, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>
        {value || '—'}
      </div>
      {unit && <div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 4 }}>{unit}</div>}
    </div>
  );
}

/* ── Bitcoin On-Chain Section ──────────────────────────────────────────────── */
function BitcoinOnChainSection() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'crypto-onchain-bitcoin',
    fetcher: async () => {
      const res = await apiFetch('/api/market/crypto-extended/bitcoin');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || null;
    },
  });

  const onChain = data?.onChain || {};
  const volume = data?.volume || {};
  const mktData = data?.mktData || {};

  if (error && !data) {
    return <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>Coming soon</div>;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
      padding: '8px',
    }}>
      <OnChainCard
        label="Active Addresses"
        value={onChain.active_addresses ? (onChain.active_addresses / 1e6).toFixed(1) : null}
        unit="Million"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="Transaction Volume"
        value={onChain.transaction_volume ? (onChain.transaction_volume / 1e9).toFixed(2) : null}
        unit="Billions"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="Hash Rate"
        value={onChain.hash_rate ? (onChain.hash_rate / 1e9).toFixed(1) : null}
        unit="EH/s"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="Mkt Cap Dominance"
        value={mktData.btc_dominance ? mktData.btc_dominance.toFixed(1) : null}
        unit="%"
        loading={loading}
        error={false}
      />
    </div>
  );
}

/* ── Ethereum On-Chain Section ─────────────────────────────────────────────── */
function EthereumOnChainSection() {
  const { data, loading, error } = useSectionData({
    cacheKey: 'crypto-onchain-ethereum',
    fetcher: async () => {
      const res = await apiFetch('/api/market/crypto-extended/ethereum');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data || null;
    },
  });

  const onChain = data?.onChain || {};
  const defi = data?.defi || {};

  if (error && !data) {
    return <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 10, textAlign: 'center' }}>Coming soon</div>;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
      padding: '8px',
    }}>
      <OnChainCard
        label="Staking Ratio"
        value={onChain.staking_ratio ? (onChain.staking_ratio * 100).toFixed(1) : null}
        unit="%"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="Gas Price (Gwei)"
        value={onChain.avg_gas_price ? onChain.avg_gas_price.toFixed(1) : null}
        unit="Gwei"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="Active Addresses"
        value={onChain.active_addresses ? (onChain.active_addresses / 1e6).toFixed(1) : null}
        unit="Million"
        loading={loading}
        error={false}
      />
      <OnChainCard
        label="DeFi TVL"
        value={defi.total_value_locked ? (defi.total_value_locked / 1e9).toFixed(1) : null}
        unit="Billions"
        loading={loading}
        error={false}
      />
    </div>
  );
}

/* ── BTC Dominance & ETH/BTC Ratio Section ─────────────────────────────────── */
function CryptoDominanceSection() {
  const btc = useTickerPrice('X:BTCUSD');
  const eth = useTickerPrice('X:ETHUSD');

  const ethBtcRatio = (eth?.price != null && btc?.price != null && btc.price > 0)
    ? (eth.price / btc.price)
    : null;

  // BTC dominance requires a dedicated on-chain data endpoint (not yet implemented).
  // Show null gracefully instead of crashing via useSectionData with no fetcher.
  const btcDominance = null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: '12px',
      padding: '8px',
    }}>
      <OnChainCard
        label="BTC Dominance"
        value={btcDominance ? btcDominance.toFixed(1) : null}
        unit="%"
        loading={false}
        error={false}
      />
      <OnChainCard
        label="ETH/BTC Ratio"
        value={ethBtcRatio ? ethBtcRatio.toFixed(4) : null}
        unit="ETH per BTC"
        loading={false}
        error={false}
      />
    </div>
  );
}

/* ── Crypto ETF Cell Component ────────────────────────────────────────────── */
function CryptoEtfCell({ sym, onClick }) {
  const q = useTickerPrice(sym);
  return (
    <TickerCell
      key={sym}
      symbol={sym}
      price={q?.price}
      changePct={q?.changePct}
      onClick={onClick}
    />
  );
}

/* ── TickerRibbon Component ───────────────────────────────────────────────────── */
const TickerRibbonComponent = memo(function TickerRibbonComponent() {
  const openDetail = useOpenDetail();
  return (
    <TickerRibbon
      tickers={CRYPTO_ETFS}
      onTickerClick={(sym) => openDetail(sym, 'Crypto & Digital Assets')}
    />
  );
});


/* ── KPI Ribbon ────────────────────────────────────────────────────────── */
function CryptoKPIRibbon() {
  const btc  = useTickerPrice('X:BTCUSD');
  const eth  = useTickerPrice('X:ETHUSD');
  const sol  = useTickerPrice('X:SOLUSD');
  const ibit = useTickerPrice('IBIT');

  // ETH/BTC ratio — key metric for crypto traders
  const ethBtcRatio = (eth?.price != null && btc?.price != null && btc.price > 0)
    ? eth.price / btc.price : null;

  const items = [
    { label: 'BITCOIN',   value: btc?.price != null ? '$' + fmt(btc.price, 0) : '—', change: btc?.changePct },
    { label: 'ETHEREUM',  value: eth?.price != null ? '$' + fmt(eth.price, 0) : '—', change: eth?.changePct },
    { label: 'ETH/BTC',   value: ethBtcRatio != null ? ethBtcRatio.toFixed(4) : '—' },
    { label: 'SOLANA',    value: sol?.price != null ? '$' + fmt(sol.price) : '—', change: sol?.changePct },
    { label: 'IBIT ETF',  value: ibit?.price != null ? '$' + fmt(ibit.price) : '—', change: ibit?.changePct },
  ];
  return <KPIRibbon items={items} accentColor="#f7931a" />;
}

/* ── Main CryptoScreen Implementation ───────────────────────────────────────── */
function CryptoScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(CRYPTO_EQUITIES);
  const [selectedTicker, setSelectedTicker] = useState(null);

  /* ── Build section definitions ────────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'kpi',
      title: 'KEY METRICS',
      span: 'full',
      component: CryptoKPIRibbon,
    },
    {
      id: 'charts',
      title: 'Sector Charts',
      span: 'full',
      component: () => <ChartsSection selectedTicker={selectedTicker} onChartClick={setSelectedTicker} />,
    },
    {
      id: 'crypto-majors',
      title: 'Crypto Majors',
      component: CryptoMajorsSection,
    },
    {
      id: 'crypto-equities',
      title: 'Crypto Equities & Infrastructure',
      component: () => (
        <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh} rows={7}>
          <CryptoEquitiesSection statsMap={statsMap} />
        </StatsLoadGate>
      ),
    },
    {
      id: 'crypto-etfs',
      title: 'Crypto ETFs',
      component: CryptoEtfsSection,
    },
    {
      id: 'btc-onchain',
      title: 'Bitcoin On-Chain Analytics',
      component: BitcoinOnChainSection,
    },
    {
      id: 'eth-onchain',
      title: 'Ethereum On-Chain Analytics',
      component: EthereumOnChainSection,
    },
    {
      id: 'dominance',
      title: 'Market Dominance & Ratios',
      component: CryptoDominanceSection,
    },
    {
      id: 'correlation',
      title: 'Crypto Correlation Matrix (60D)',
      component: () => (
        <CorrelationMatrix
          tickers={['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'MSTR', 'COIN', 'IBIT']}
          labels={{ 'X:BTCUSD': 'BTC', 'X:ETHUSD': 'ETH', 'X:SOLUSD': 'SOL' }}
          title="Crypto 60-Day Return Correlations"
          accentColor="#f7931a"
          days={60}
        />
      ),
    },
    {
      id: 'fundamentals',
      title: 'Crypto Equities - Fundamentals Comparison',
      span: 'full',
      component: () => (
        <FundamentalsTable
          tickers={CRYPTO_EQUITIES}
          metrics={['pe', 'marketCap', 'revenue', 'grossMargins', 'operatingMargins', 'profitMargins']}
          title="All Crypto Equities - Key Metrics"
          onTickerClick={(symbol) => openDetail(symbol, 'Crypto & Digital Assets')}
          statsMap={statsMap}
        />
      ),
    },
    {
      id: 'earnings-calendar',
      title: 'Upcoming Earnings',
      component: EarningsSection,
    },
    {
      id: 'analyst-actions',
      title: 'Analyst Actions',
      component: AnalystSection,
    },
  ], [statsMap, statsLoading, statsError, statsRefresh, openDetail]);

  return (
    <FullPageScreenLayout
      title="CRYPTO"
      subtitle="Digital assets, on-chain analytics, crypto equities, and ETF flows"
      accentColor="#f7931a"
      vaultSector="crypto"
      sections={sections}
      tickerBanner={BANNER_TICKERS}
      lastUpdated={new Date()}
      aiType="sector"
      aiContext={{ sector: 'Crypto & Digital Assets', tickers: ['BTC', 'ETH', 'SOL', 'XRP'] }}
      aiCacheKey="sector:crypto"
    >
      <SectorPulse
        etfTicker="BITO"
        etfLabel="BITO"
        accentColor="#f7931a"
      />
    </FullPageScreenLayout>
  );
}

export default memo(CryptoScreenImpl);
