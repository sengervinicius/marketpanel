/**
 * FxCryptoScreen.jsx — S4.2.E
 * FX & Crypto deep screen — 30 instruments across 4 sections.
 * G10 FX, EM FX, Crypto Majors, Crypto Infrastructure & DeFi
 */
import { memo } from 'react';
import DeepScreenBase, { DeepSection, TickerCell } from './DeepScreenBase';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { useTickerPrice } from '../../context/PriceContext';

const fmt = (n, d = 2) => n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

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

function TickerRow({ symbol, label, onClick }) {
  const q = useTickerPrice(symbol);
  return (
    <tr className="ds-row-clickable" onClick={() => onClick(symbol)}>
      <td>{symbol.replace('C:', '').replace('X:', '')}</td>
      <td>{label || '—'}</td>
      <td>{q?.price != null ? fmt(q.price, symbol.startsWith('C:') ? 4 : 2) : '—'}</td>
      <td className={q?.changePct >= 0 ? 'ds-val-pos' : 'ds-val-neg'}>{q?.changePct != null ? fmtPct(q.changePct) : '—'}</td>
    </tr>
  );
}

const G10FxSection = memo(function G10FxSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Pair</th><th>Label</th><th>Spot</th><th>1D%</th></tr></thead>
      <tbody>{G10_FX.map(sym => <TickerRow key={sym} symbol={sym} label={FX_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const EmFxSection = memo(function EmFxSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Pair</th><th>Label</th><th>Spot</th><th>1D%</th></tr></thead>
      <tbody>{EM_FX.map(sym => <TickerRow key={sym} symbol={sym} label={FX_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const CryptoMajorsSection = memo(function CryptoMajorsSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Asset</th><th>Label</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>{CRYPTO_MAJORS.map(sym => <TickerRow key={sym} symbol={sym} label={CRYPTO_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

const CryptoInfraSection = memo(function CryptoInfraSection() {
  const openDetail = useOpenDetail();
  return (
    <table className="ds-table">
      <thead><tr><th>Ticker</th><th>Name</th><th>Price</th><th>1D%</th></tr></thead>
      <tbody>{CRYPTO_INFRA.map(sym => <TickerRow key={sym} symbol={sym} label={INFRA_LABELS[sym]} onClick={openDetail} />)}</tbody>
    </table>
  );
});

function FxCryptoScreen() {
  const sections = [
    { id: 'g10fx',        title: 'G10 FX PAIRS',                  component: G10FxSection },
    { id: 'emfx',         title: 'EM FX',                          component: EmFxSection },
    { id: 'cryptomajors', title: 'CRYPTO MAJORS',                  component: CryptoMajorsSection },
    { id: 'cryptoinfra',  title: 'CRYPTO INFRASTRUCTURE & DeFi',   component: CryptoInfraSection },
  ];

  return (
    <DeepScreenBase
      title="FX & Crypto"
      accentColor="#ce93d8"
      sections={sections}
      aiType="cross-asset"
      aiContext={{ assets: ['FX', 'Crypto'], theme: 'FX & Digital Assets' }}
      aiCacheKey="cross:fxcrypto"
    />
  );
}

export default memo(FxCryptoScreen);
