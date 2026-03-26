/**
 * HomePanelMobile.jsx
 *
 * Mobile home panel component with market overview, FX, crypto, and top movers.
 * Dark theme trading terminal interface.
 */

import { useState, useEffect } from 'react';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useWatchlist } from '../../context/WatchlistContext';
import { WORLD_INDEXES, FOREX_PAIRS, CRYPTO_PAIRS } from '../../utils/constants';

// Formatting helpers
function fmtPct(v) {
  return v == null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function fmtPrice(v, dec = 2) {
  return v == null ? '--' : v.toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

// World clock component
function WorldClock() {
  const [times, setTimes] = useState({});

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimes({
        ny: new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })),
        sp: new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })),
        ldn: new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' })),
      });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const fmt = (d) => {
    if (!d || isNaN(d.getTime())) return '--:--';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };

  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      justifyContent: 'center',
      fontSize: '9px',
      color: '#666',
      letterSpacing: '0.1em',
      marginBottom: '12px',
      fontFamily: 'monospace',
    }}>
      <div>NY: {fmt(times.ny)}</div>
      <div>SP: {fmt(times.sp)}</div>
      <div>LDN: {fmt(times.ldn)}</div>
    </div>
  );
}

/**
 * HomePanelMobile
 * @param {Object} props
 * @param {Function} props.onOpenDetail - Callback to open detail view for a symbol
 */
export default function HomePanelMobile({ onOpenDetail }) {
  const stocksData = useStocksData();
  const forexData = useForexData();
  const cryptoData = useCryptoData();
  const { watchlist } = useWatchlist?.() || { watchlist: [] };

  const [moversTab, setMoversTab] = useState('gainers');

  // Compute top gainers and losers
  const gainers = Object.entries(stocksData)
    .filter(([_, d]) => d.price != null && d.changePct != null)
    .sort(([_a, a], [_b, b]) => (b.changePct ?? 0) - (a.changePct ?? 0))
    .slice(0, 5);

  const losers = Object.entries(stocksData)
    .filter(([_, d]) => d.price != null && d.changePct != null)
    .sort(([_a, a], [_b, b]) => (a.changePct ?? 0) - (b.changePct ?? 0))
    .slice(0, 5);

  const containerStyle = {
    backgroundColor: '#0a0a0a',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    padding: '12px',
    minHeight: '100vh',
  };

  const cardStyle = {
    backgroundColor: '#0d0d0d',
    border: '1px solid #1e1e1e',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px',
  };

  const titleStyle = {
    color: '#ff6600',
    fontSize: '8px',
    letterSpacing: '1.5px',
    marginBottom: '8px',
    fontWeight: 'bold',
  };

  const tileStyle = {
    flex: '1 1 auto',
    minWidth: '80px',
    backgroundColor: '#111',
    borderRadius: '4px',
    padding: '8px 10px',
    border: '1px solid #1a1a1a',
    cursor: 'pointer',
    textAlign: 'center',
  };

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #1a1a1a',
    fontSize: '11px',
    cursor: 'pointer',
    alignItems: 'center',
  };

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '9px', color: '#ff6600', letterSpacing: '0.25em', fontWeight: 'bold' }}>
          ARC CAPITAL
        </div>
        <div style={{ fontSize: '10px', color: '#e8e8e8', marginBottom: '4px' }}>
          MARKET SCREEN
        </div>
        <WorldClock />
      </div>

      {/* Market Overview */}
      <div style={cardStyle}>
        <div style={titleStyle}>MARKET OVERVIEW</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {['SPY', 'QQQ', 'DIA'].map((sym) => {
            const data = stocksData[sym];
            const price = data?.price ?? null;
            const changePct = data?.changePct ?? null;
            const color = changePct >= 0 ? '#00cc66' : '#ff4444';
            return (
              <div
                key={sym}
                style={tileStyle}
                onClick={() => onOpenDetail(sym)}
              >
                <div style={{ color: '#888', fontSize: '9px', marginBottom: '4px' }}>{sym}</div>
                <div style={{ color: '#fff', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtPrice(price)}
                </div>
                <div style={{ color, fontSize: '11px', marginTop: '4px' }}>
                  {fmtPct(changePct)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FX Overview */}
      <div style={cardStyle}>
        <div style={titleStyle}>FX OVERVIEW</div>
        {['EURUSD', 'GBPUSD', 'USDBRL'].map((sym) => {
          const data = forexData[sym];
          const price = data?.price ?? null;
          const changePct = data?.changePct ?? null;
          const color = changePct >= 0 ? '#00cc66' : '#ff4444';
          const label = sym.slice(0, 3) + '/' + sym.slice(3);
          return (
            <div
              key={sym}
              style={rowStyle}
              onClick={() => onOpenDetail('C:' + sym)}
            >
              <span>{label}</span>
              <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                {fmtPrice(price, 5)}
              </span>
              <span style={{ color, minWidth: '50px', textAlign: 'right' }}>
                {fmtPct(changePct)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Crypto */}
      <div style={cardStyle}>
        <div style={titleStyle}>CRYPTO</div>
        {['BTCUSD', 'ETHUSD', 'SOLUSD'].map((sym) => {
          const data = cryptoData[sym];
          const price = data?.price ?? null;
          const changePct = data?.changePct ?? null;
          const color = changePct >= 0 ? '#00cc66' : '#ff4444';
          const label = sym.slice(0, -3);
          return (
            <div
              key={sym}
              style={rowStyle}
              onClick={() => onOpenDetail('X:' + sym)}
            >
              <span>{label}</span>
              <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                {fmtPrice(price, 2)}
              </span>
              <span style={{ color, minWidth: '50px', textAlign: 'right' }}>
                {fmtPct(changePct)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Today's Movers */}
      <div style={cardStyle}>
        <div style={titleStyle}>TODAY'S MOVERS</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          {['gainers', 'losers'].map((tab) => (
            <button
              key={tab}
              onClick={() => setMoversTab(tab)}
              style={{
                padding: '4px 8px',
                fontSize: '9px',
                backgroundColor: moversTab === tab ? '#ff6600' : '#1a1a1a',
                color: moversTab === tab ? '#000' : '#666',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                letterSpacing: '0.1em',
                fontWeight: 'bold',
              }}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
        {(moversTab === 'gainers' ? gainers : losers).map(([sym, data]) => {
          const changePct = data.changePct ?? null;
          const color = changePct >= 0 ? '#00cc66' : '#ff4444';
          return (
            <div
              key={sym}
              style={rowStyle}
              onClick={() => onOpenDetail(sym)}
            >
              <span>{sym}</span>
              <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                {fmtPrice(data.price, 2)}
              </span>
              <span style={{ color, minWidth: '50px', textAlign: 'right' }}>
                {fmtPct(changePct)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
