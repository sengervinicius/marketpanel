/**
 * CryptoScreen.jsx
 * Comprehensive Crypto Screen — separated from FX in FxCryptoScreen.
 * Integrates FullPageScreenLayout, FundamentalsTable, SectorChartPanel, InsiderActivity,
 * on-chain analytics for BTC & ETH, and crypto majors/equities/ETF coverage.
 */
import { memo, useMemo, useState, useEffect } from 'react';
import FullPageScreenLayout from './shared/FullPageScreenLayout';
import { FundamentalsTable } from './shared/FundamentalsTable';
import { SectorChartPanel } from './shared/SectorChartPanel';
import { InsiderActivity } from './shared/InsiderActivity';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';
import { useDeepScreenData } from '../../hooks/useDeepScreenData';
import { useSectionData } from '../../hooks/useSectionData';
import DeepScreenBase, { TickerCell, DeepSkeleton, DeepError } from './DeepScreenBase';
import { apiFetch } from '../../utils/api';

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

/* ── Crypto Major Row Component ────────────────────────────────────────────── */
function CryptoMajorRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  const displaySym = symbol.replace('X:', '');
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{displaySym}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, displaySym === 'BTC' ? 0 : 2) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {fmtPct(q?.changePct)}
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
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, 2) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {fmtPct(q?.changePct)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>
        {fmtB(mktCap)}
      </td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>
        {pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}
      </td>
    </tr>
  );
}

/* ── Crypto ETF Row Component ──────────────────────────────────────────────── */
function CryptoEtfRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, 2) : '—'}</td>
      <td className={q?.changePct != null && q.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>
        {fmtPct(q?.changePct)}
      </td>
    </tr>
  );
}

/* ── Sector Charts Section ─────────────────────────────────────────────────── */
const ChartsSection = memo(function ChartsSection() {
  return (
    <SectorChartPanel
      tickers={CHART_TICKERS}
      height={200}
      cols={3}
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
            <th>Ticker</th>
            <th>Name</th>
            <th>Price</th>
            <th>1D%</th>
            <th style={{ fontSize: 9 }}>Mkt Cap</th>
            <th style={{ fontSize: 9 }}>P/E</th>
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
        background: '#0a0a0a',
        border: '1px solid #1e1e1e',
        borderRadius: 4,
        padding: '12px',
        textAlign: 'center',
        color: '#666',
        fontSize: 10,
      }}>
        <div style={{ color: '#888', marginBottom: 6 }}>{label}</div>
        <div style={{ height: 20, background: '#1a1a1a', borderRadius: 2 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #1e1e1e',
        borderRadius: 4,
        padding: '12px',
        textAlign: 'center',
        color: '#666',
        fontSize: 10,
      }}>
        <div style={{ color: '#999', marginBottom: 6 }}>{label}</div>
        <div style={{ color: '#666', fontSize: 9 }}>—</div>
      </div>
    );
  }
  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #1e1e1e',
      borderRadius: 4,
      padding: '12px',
      textAlign: 'center',
    }}>
      <div style={{ color: '#999', fontSize: 9, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: '#e0e0e0', fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>
        {value || '—'}
      </div>
      {unit && <div style={{ color: '#666', fontSize: 8, marginTop: 4 }}>{unit}</div>}
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

  if (error) {
    return <DeepError message={`Error loading BTC on-chain data: ${error}`} />;
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
        error={error}
      />
      <OnChainCard
        label="Transaction Volume"
        value={onChain.transaction_volume ? (onChain.transaction_volume / 1e9).toFixed(2) : null}
        unit="Billions"
        loading={loading}
        error={error}
      />
      <OnChainCard
        label="Hash Rate"
        value={onChain.hash_rate ? (onChain.hash_rate / 1e9).toFixed(1) : null}
        unit="EH/s"
        loading={loading}
        error={error}
      />
      <OnChainCard
        label="Mkt Cap Dominance"
        value={mktData.btc_dominance ? mktData.btc_dominance.toFixed(1) : null}
        unit="%"
        loading={loading}
        error={error}
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

  if (error) {
    return <DeepError message={`Error loading ETH on-chain data: ${error}`} />;
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
        error={error}
      />
      <OnChainCard
        label="Gas Price (Gwei)"
        value={onChain.avg_gas_price ? onChain.avg_gas_price.toFixed(1) : null}
        unit="Gwei"
        loading={loading}
        error={error}
      />
      <OnChainCard
        label="Active Addresses"
        value={onChain.active_addresses ? (onChain.active_addresses / 1e6).toFixed(1) : null}
        unit="Million"
        loading={loading}
        error={error}
      />
      <OnChainCard
        label="DeFi TVL"
        value={defi.total_value_locked ? (defi.total_value_locked / 1e9).toFixed(1) : null}
        unit="Billions"
        loading={loading}
        error={error}
      />
    </div>
  );
}

/* ── BTC Dominance & ETH/BTC Ratio Section ─────────────────────────────────── */
function CryptoDominanceSection() {
  const btc = useTickerPrice('X:BTCUSD');
  const eth = useTickerPrice('X:ETHUSD');
  const { data: btcOnChain } = useSectionData('bitcoin');

  const ethBtcRatio = (eth?.price != null && btc?.price != null && btc.price > 0)
    ? (eth.price / btc.price)
    : null;

  const btcDominance = btcOnChain?.mktData?.btc_dominance || null;

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

/* ── ETF Strip Component ───────────────────────────────────────────────────── */
const EtfStrip = memo(function EtfStrip() {
  const openDetail = useOpenDetail();
  return (
    <div className="ds-strip" style={{ display: 'flex', gap: 0, borderTop: '1px solid #1e1e1e' }}>
      {CRYPTO_ETFS.map(sym => (
        <CryptoEtfCell key={sym} sym={sym} onClick={openDetail} />
      ))}
    </div>
  );
});

/* ── Main CryptoScreen Implementation ───────────────────────────────────────── */
function CryptoScreenImpl() {
  const openDetail = useOpenDetail();
  const { data: statsMap } = useDeepScreenData(CRYPTO_EQUITIES);

  /* ── Build section definitions ────────────────────────────────────────── */
  const sections = useMemo(() => [
    {
      id: 'charts',
      title: 'Sector Charts',
      span: 'full',
      component: ChartsSection,
    },
    {
      id: 'crypto-majors',
      title: 'Crypto Majors',
      component: CryptoMajorsSection,
    },
    {
      id: 'crypto-equities',
      title: 'Crypto Equities & Infrastructure',
      component: () => <CryptoEquitiesSection statsMap={statsMap} />,
    },
    {
      id: 'crypto-etfs',
      title: 'Crypto ETFs',
      component: CryptoEtfsSection,
    },
    {
      id: 'btc-onchain',
      title: 'Bitcoin On-Chain Analytics',
      span: 'full',
      component: BitcoinOnChainSection,
    },
    {
      id: 'eth-onchain',
      title: 'Ethereum On-Chain Analytics',
      span: 'full',
      component: EthereumOnChainSection,
    },
    {
      id: 'dominance',
      title: 'Market Dominance & Ratios',
      span: 'full',
      component: CryptoDominanceSection,
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
          onTickerClick={openDetail}
        />
      ),
    },
    {
      id: 'insider',
      title: 'Insider Activity (Crypto Equities)',
      span: 'full',
      component: () => (
        <InsiderActivity
          tickers={CRYPTO_EQUITIES}
          limit={10}
          onTickerClick={openDetail}
        />
      ),
    },
  ], [statsMap, openDetail]);

  return (
    <FullPageScreenLayout
      title="CRYPTO"
      subtitle="Digital assets, on-chain analytics, crypto equities, and ETF flows"
      accentColor="#f7931a"
      sections={sections}
      lastUpdated={new Date()}
    >
      <div style={{ padding: '12px', borderTop: '1px solid #1e1e1e' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          CRYPTO ETFs
        </div>
        <EtfStrip />
      </div>
    </FullPageScreenLayout>
  );
}

export default memo(CryptoScreenImpl);
