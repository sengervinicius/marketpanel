/**
 * HomePanelMobile.jsx
 *
 * Mobile home panel component with dynamic sections from settings.home.sections.
 * Renders market cards for each configured section, plus top movers at bottom.
 * Dark theme trading terminal interface.
 */

import { useState, useEffect } from 'react';
import { useStocksData, useForexData, useCryptoData } from '../../context/MarketContext';
import { useSettings } from '../../context/SettingsContext';

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
 * Helper to look up price data across all markets
 */
function getPrice(sym, stocksData, forexData, cryptoData) {
  return stocksData[sym] || forexData[sym] || cryptoData[sym] || null;
}

/**
 * Helper to determine symbol display format
 */
function displaySymbol(sym) {
  if (!sym) return '';
  if (sym.startsWith('C:')) return sym.slice(2, 5) + '/' + sym.slice(5);
  if (sym.startsWith('X:')) return sym.slice(2).replace('USD', '') + '/USD';
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  return sym;
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
  const { settings } = useSettings();

  const [moversTab, setMoversTab] = useState('gainers');

  // Get dynamic sections from settings
  const sections = settings?.home?.sections || [];

  // Compute top gainers and losers from stocks data
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
        <WorldClock />
      </div>

      {/* Dynamic Sections */}
      {sections.map((section) => (
        <div key={section.id} style={cardStyle}>
          <div style={titleStyle}>{section.title}</div>
          {(section.symbols || []).map((sym) => {
            const data = getPrice(sym, stocksData, forexData, cryptoData);
            const price = data?.price ?? null;
            const changePct = data?.changePct ?? null;
            const color = changePct >= 0 ? '#00cc66' : '#ff4444';
            return (
              <div
                key={sym}
                style={rowStyle}
                onClick={() => onOpenDetail(sym)}
              >
                <span>{displaySymbol(sym)}</span>
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
      ))}

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
