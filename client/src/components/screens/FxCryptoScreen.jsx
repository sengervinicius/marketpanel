/**
 * FxCryptoScreen.jsx — S5.4 (enhanced from S4.2.E)
 * FX & Crypto deep screen — 30 instruments across 4 sections.
 * G10 FX, EM FX, Crypto Majors (with BTC dominance), Crypto Infra (with Mkt Cap/P/E)
 */
import { memo, useMemo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell, StatsLoadGate } from './DeepScreenBase';
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

const CHART_TICKERS = ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDBRL', 'X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'COIN'];

const G10_FX = ['C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:AUDUSD', 'C:USDCAD', 'C:USDCHF', 'C:NZDUSD'];
const EM_FX  = ['C:USDBRL', 'C:USDMXN', 'C:USDINR', 'C:USDZAR', 'C:USDTRY', 'C:USDCNY'];
const CRYPTO_MAJORS = ['X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:BNBUSD', 'X:XRPUSD', 'X:DOGEUSD'];
const CRYPTO_INFRA  = ['MSTR', 'COIN', 'MARA', 'RIOT', 'IBIT', 'ETHE', 'ARKB'];

const FX_LABELS = {
  'C:EURUSD': 'EUR/USD', 'C:USDJPY': 'USD/JPY', 'C:GBPUSD': 'GBP/USD',
  'C:AUDUSD': 'AUD/USD', 'C:USDCAD': 'USD/CAD', 'C:USDCHF': 'USD/CHF',
  'C:NZDUSD': 'NZD/USD', 'C:USDBRL': 'USD/BRL', 'C:USDMXN': 'USD/MXN',
  'C:USDINR': 'USD/INR', 'C:USDZAR': 'USD/ZAR', 'C:USDTRY': 'USD/TRY',
  'C:USDCNY': 'USD/CNY',
};
const CRYPTO_LABELS = {
  'X:BTCUSD': 'Bitcoin', 'X:ETHUSD': 'Ethereum', 'X:SOLUSD': 'Solana',
  'X:BNBUSD': 'BNB', 'X:XRPUSD': 'XRP', 'X:DOGEUSD': 'Dogecoin',
};
const INFRA_LABELS = {
  'MSTR': 'MicroStrategy', 'COIN': 'Coinbase', 'MARA': 'Marathon',
  'RIOT': 'Riot Platforms', 'IBIT': 'iShares Bitcoin', 'ETHE': 'Grayscale ETH',
  'ARKB': 'ARK 21Shares BTC',
};

function FxRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol.replace('C:', '')}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, 4) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

function CryptoRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol.replace('X:', '')}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, 2) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

function InfraRow({ symbol, stats, onClick }) {
  const q = useTickerPrice(symbol);
  const mktCap = stats?.market_capitalization;
  const pe = stats?.pe_ratio;
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td className="ds-ticker-col">{symbol}</td>
      <td>{INFRA_LABELS[symbol] || '—'}</td>
      <td>{q?.price != null ? fmt(q.price) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#888' }}>{fmtB(mktCap)}</td>
      <td style={{ fontFamily: 'monospace', fontSize: 10, color: '#ccc' }}>{pe != null ? parseFloat(pe).toFixed(1) + 'x' : '—'}</td>
    </tr>
  );
}

const G10FxSection = memo(function G10FxSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Pair</th><th>Label</th><th>Spot</th><th>1D%</th></tr></thead>
      <tbody>{G10_FX.map(sym => <FxRow key={sym} symbol={sym} label={FX_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const EmFxSection = memo(function EmFxSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Pair</th><th>Label</th><th>Spot</th><th>1D%</th></tr></thead>
      <tbody>{EM_FX.map(sym => <FxRow key={sym} symbol={sym} label={FX_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const CryptoMajorsSection = memo(function CryptoMajorsSection() {
  const openDetail = useOpenDetail();
  const btc = useTickerPrice('X:BTCUSD');
  const eth = useTickerPrice('X:ETHUSD');
  const ethBtcRatio = (eth?.price != null && btc?.price != null && btc.price > 0) ? (eth.price / btc.price) : null;

  return (
    <>
      <table className="ds-table">
        <thead><tr><th>Asset</th><th>Label</th><th>Price</th><th>1D%</th></tr></thead>
        <tbody>{CRYPTO_MAJORS.map(sym => <CryptoRow key={sym} symbol={sym} label={CRYPTO_LABELS[sym]} onClick={openDetail} />)}</tbody>
      </table>
      {ethBtcRatio != null && (
        <div style={{ fontSize: 10, color: '#ce93d8', padding: '6px 4px 2px', borderTop: '1px solid #1a1a1a' }}>
          ETH/BTC Ratio: {ethBtcRatio.toFixed(4)}
        </div>
      )}
    </>
  );
});

const CryptoInfraSection = memo(function CryptoInfraSection({ statsMap }) {
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
      <tbody>{CRYPTO_INFRA.map(sym => <InfraRow key={sym} symbol={sym} stats={statsMap.get(sym)} onClick={openDetail} />)}</tbody>
    </table>
  );
});

function FxCryptoScreen() {
  const { data: statsMap, loading: statsLoading, error: statsError, refresh: statsRefresh } = useDeepScreenData(CRYPTO_INFRA);

  const sections = useMemo(() => [
    { id: 'g10fx',        title: 'G10 FX PAIRS',                  component: G10FxSection },
    { id: 'emfx',         title: 'EM FX',                          component: EmFxSection },
    { id: 'cryptomajors', title: 'CRYPTO MAJORS',                  component: CryptoMajorsSection },
    { id: 'cryptoinfra',  title: 'CRYPTO INFRASTRUCTURE & DeFi',   component: () => <StatsLoadGate statsMap={statsMap} loading={statsLoading} error={statsError} refresh={statsRefresh}><CryptoInfraSection statsMap={statsMap} /></StatsLoadGate> },
  ], [statsMap, statsLoading, statsError, statsRefresh]);

  return (
    <DeepScreenBase
      title="FX & Crypto"
      accentColor="#ce93d8"
      sections={sections}
      aiType="cross-asset"
      aiContext={{ assets: ['FX', 'Crypto'], theme: 'FX & Digital Assets' }}
      aiCacheKey="cross:fxcrypto"
    >
      <SectorChartStrip tickers={CHART_TICKERS} title="FX & CRYPTO CHARTS" />
    </DeepScreenBase>
  );
}

export default memo(FxCryptoScreen);
