/**
 * HomePanelMobile.jsx
 *
 * Mobile home panel with Bloomberg-like "My Boxes" interface.
 * - Prominent search bar at top (navigates to search tab when tapped)
 * - "My Boxes" section with customizable market data boxes
 * - Each box shows a group of instruments with live prices
 * - Default boxes: Market Overview, FX, B3, Crypto
 * - "Today's Movers" section at bottom
 * Dark theme trading terminal interface.
 */

import { useState, useEffect, memo, useCallback } from 'react';
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
      marginBottom: '8px',
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

// Default boxes configuration
const DEFAULT_BOXES = [
  {
    id: 'market-overview',
    title: 'MARKET OVERVIEW',
    symbols: ['SPY', 'QQQ', 'DIA', 'IWM'],
  },
  {
    id: 'fx',
    title: 'FX MAJORS',
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDBRL'],
  },
  {
    id: 'b3',
    title: 'B3 (BOVESPA)',
    symbols: ['VALE3.SA', 'PETR4.SA', 'ITUB4.SA', 'ABEV3.SA'],
  },
  {
    id: 'crypto',
    title: 'CRYPTO',
    symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'BNBUSD'],
  },
];

/**
 * HomePanelMobile
 * @param {Object} props
 * @param {Function} props.onOpenDetail - Callback to open detail view for a symbol
 * @param {Function} props.onSearchClick - Callback when search bar is tapped
 */
function HomePanelMobile({ onOpenDetail, onSearchClick }) {
  const stocksData = useStocksData();
  const forexData = useForexData();
  const cryptoData = useCryptoData();
  const { settings } = useSettings();

  const [moversTab, setMoversTab] = useState('gainers');
  const [boxes, setBoxes] = useState(DEFAULT_BOXES);

  // Compute top gainers and losers from stocks data
  const gainers = Object.entries(stocksData)
    .filter(([_, d]) => d.price != null && d.changePct != null)
    .sort(([_a, a], [_b, b]) => (b.changePct ?? 0) - (a.changePct ?? 0))
    .slice(0, 5);

  const losers = Object.entries(stocksData)
    .filter(([_, d]) => d.price != null && d.changePct != null)
    .sort(([_a, a], [_b, b]) => (a.changePct ?? 0) - (b.changePct ?? 0))
    .slice(0, 5);

  const handleAddBox = useCallback(() => {
    const newBoxId = `custom-${Date.now()}`;
    setBoxes([...boxes, {
      id: newBoxId,
      title: 'NEW BOX',
      symbols: [],
    }]);
  }, [boxes]);

  const containerStyle = {
    backgroundColor: '#0a0a0a',
    color: '#e0e0e0',
    fontFamily: 'monospace',
    padding: '12px',
    paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
    minHeight: '100vh',
    WebkitOverflowScrolling: 'touch',
    overflowY: 'auto',
  };

  const clockStyle = {
    textAlign: 'center',
    marginBottom: '8px',
  };

  const searchBarStyle = {
    padding: '0 0 12px',
    marginBottom: '12px',
  };

  const searchInputStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: '#0d0d0d',
    border: '2px solid #ff6600',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontSize: '14px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const sectionTitleStyle = {
    color: '#ff6600',
    fontSize: '9px',
    letterSpacing: '0.15em',
    fontWeight: 'bold',
    marginBottom: '8px',
    marginTop: '12px',
    textTransform: 'uppercase',
  };

  const boxStyle = {
    backgroundColor: '#0d0d0d',
    border: '1px solid #1e1e1e',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '12px',
    overflow: 'hidden',
  };

  const boxTitleStyle = {
    color: '#ccc',
    fontSize: '9px',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    marginBottom: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const marketStatusStyle = {
    fontSize: '7px',
    color: '#666',
    letterSpacing: '0.05em',
  };

  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #1a1a1a',
    fontSize: '11px',
    cursor: 'pointer',
    alignItems: 'center',
    minHeight: '40px',
    WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.15)',
  };

  const rowSymbolStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  };

  const rowPriceStyle = {
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    minWidth: '60px',
    textAlign: 'right',
  };

  const rowChangeStyle = (changePct) => ({
    color: changePct >= 0 ? '#00cc66' : '#ff4444',
    minWidth: '55px',
    textAlign: 'right',
    fontSize: '11px',
    fontVariantNumeric: 'tabular-nums',
  });

  const addButtonStyle = {
    background: 'none',
    border: 'none',
    color: '#666',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '4px 6px',
    flexShrink: 0,
    minHeight: '32px',
    minWidth: '32px',
  };

  const moversHeaderStyle = {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  };

  const tabButtonStyle = (isActive) => ({
    padding: '4px 8px',
    fontSize: '9px',
    backgroundColor: isActive ? '#ff6600' : '#1a1a1a',
    color: isActive ? '#000' : '#666',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    letterSpacing: '0.1em',
    fontWeight: 'bold',
    fontFamily: 'monospace',
  });

  return (
    <div style={containerStyle}>
      {/* World Clock */}
      <div style={clockStyle}>
        <WorldClock />
      </div>

      {/* Search Bar */}
      <div style={searchBarStyle}>
        <input
          type="text"
          placeholder="Search instruments..."
          style={searchInputStyle}
          onClick={onSearchClick}
          readOnly
        />
      </div>

      {/* My Boxes Section */}
      <div style={{ marginBottom: '12px' }}>
        <div style={sectionTitleStyle}>MY BOXES</div>

        {boxes.map((box) => (
          <div key={box.id} style={boxStyle}>
            <div style={boxTitleStyle}>
              <span>{box.title}</span>
              <span style={marketStatusStyle}>LIVE</span>
            </div>

            {box.symbols.length === 0 ? (
              <div style={{ color: '#333', fontSize: '10px', padding: '12px', textAlign: 'center' }}>
                No instruments in this box
              </div>
            ) : (
              box.symbols.map((sym) => {
                const data = getPrice(sym, stocksData, forexData, cryptoData);
                const price = data?.price ?? null;
                const changePct = data?.changePct ?? null;

                return (
                  <div
                    key={sym}
                    style={rowStyle}
                    onClick={() => onOpenDetail?.(sym)}
                  >
                    <div style={rowSymbolStyle}>
                      <span>{displaySymbol(sym)}</span>
                    </div>
                    <div style={rowPriceStyle}>
                      {fmtPrice(price, sym.includes('USD') || sym.includes('/') ? 4 : 2)}
                    </div>
                    <div style={rowChangeStyle(changePct)}>
                      {fmtPct(changePct)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      style={addButtonStyle}
                      title="Add to watchlist"
                    >
                      +
                    </button>
                  </div>
                );
              })
            )}
          </div>
        ))}

        {/* Add Box Button */}
        <button
          onClick={handleAddBox}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#0d0d0d',
            border: '1px dashed #1e1e1e',
            borderRadius: '6px',
            color: '#ff6600',
            fontSize: '11px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontFamily: 'monospace',
            letterSpacing: '0.1em',
            minHeight: '44px',
          }}
        >
          + ADD BOX
        </button>
      </div>

      {/* Today's Movers */}
      <div style={boxStyle}>
        <div style={boxTitleStyle}>
          <span>TODAY'S MOVERS</span>
        </div>

        <div style={moversHeaderStyle}>
          {['gainers', 'losers'].map((tab) => (
            <button
              key={tab}
              onClick={() => setMoversTab(tab)}
              style={tabButtonStyle(moversTab === tab)}
            >
              {tab === 'gainers' ? 'GAINERS' : 'LOSERS'}
            </button>
          ))}
        </div>

        {(moversTab === 'gainers' ? gainers : losers).map(([sym, data]) => {
          const changePct = data.changePct ?? null;

          return (
            <div
              key={sym}
              style={rowStyle}
              onClick={() => onOpenDetail?.(sym)}
            >
              <div style={rowSymbolStyle}>
                <span>{sym}</span>
              </div>
              <div style={rowPriceStyle}>
                {fmtPrice(data.price, 2)}
              </div>
              <div style={rowChangeStyle(changePct)}>
                {fmtPct(changePct)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default memo(HomePanelMobile);
