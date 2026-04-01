/**
 * Header — top bar with:
 *  - Senger Market Terminal branding
 *  - Multi-timezone clocks
 *  - Market status indicator
 *  - Theme toggle (dark / light)
 *  - Scrolling ticker tape
 */

import { useState, useEffect, memo } from 'react';
import { CLOCKS } from '../utils/constants';
import { fmtPrice, fmtPct } from '../utils/format';
import { useTheme } from '../context/ThemeContext';
import { useFeedStatus } from '../context/FeedStatusContext';

const Clock = memo(function Clock({ label, tz }) {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    function update() {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' }));
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [tz]);

  return (
    <div style={{ textAlign: 'center', minWidth: 90, borderRight: '1px solid #1a1a1a', padding: '0 10px' }}>
      <div style={{ color: '#555', fontSize: 7, fontWeight: 400, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#ccc', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>{time}</div>
      <div style={{ color: '#555', fontSize: 7 }}>{date}</div>
    </div>
  );
});

function TickerTape({ stocks, indexes }) {
  const allSymbols = [...Object.values(indexes), ...Object.values(stocks)];
  const limitedSymbols = allSymbols.slice(0, 20);
  if (limitedSymbols.length === 0) return null;

  const items = limitedSymbols.filter(s => s.price).map(s => ({
    sym: s.symbol,
    price: s.price,
    pct: s.changePct,
  }));

  const content = [...items, ...items].map((item, i) => (
    <span key={i} style={{ marginRight: 32, whiteSpace: 'nowrap' }}>
      <span style={{ color: '#e8a020', fontWeight: 500, marginRight: 5, fontSize: 9 }}>{item.sym}</span>
      <span style={{ color: '#ccc', marginRight: 4, fontSize: 9 }}>{fmtPrice(item.price)}</span>
      <span style={{ color: (item.pct ?? 0) >= 0 ? '#00c853' : '#f44336', fontSize: 9 }}>
        {fmtPct(item.pct)}
      </span>
    </span>
  ));

  return (
    <div style={{ overflow: 'hidden', background: '#0a0a0f', borderBottom: '1px solid #1a1a1a', padding: '3px 0' }}>
      <div style={{ display: 'inline-block', animation: 'ticker 80s linear infinite', whiteSpace: 'nowrap' }}>
        {content}
      </div>
      <style>{`
        @keyframes ticker {
          0%   { transform: translateX(100vw); }
          100% { transform: translateX(-100%); }
        }
        @keyframes senger-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

export function Header({ connected, stocks, forex, marketStatus, onChatOpen, chatUnread }) {
  const statusColor = connected ? '#00c853' : '#f44336';
  const statusLabel = connected ? 'LIVE' : 'OFFLINE';
  const mktOpen = marketStatus?.market === 'open';

  // Theme toggle from ThemeContext
  const themeCtx = useTheme();
  const theme = themeCtx?.theme ?? 'dark';
  const toggleTheme = themeCtx?.toggleTheme ?? null;

  // Feed status indicator
  const { getOverallStatus } = useFeedStatus();
  const feedStatus = getOverallStatus();
  const statusDotColor = feedStatus === 'live' ? '#00c853' : feedStatus === 'degraded' ? '#ff9900' : feedStatus === 'connecting' ? '#ffb74d' : '#ff3333';

  return (
    <div style={{ background: '#0a0a0f', borderBottom: '1px solid #e55a00', flexShrink: 0, fontFamily: 'var(--font-ui)' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'stretch', height: 46 }}>
        {/* Branding */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 14px', borderRight: '1px solid #1a1a1a', minWidth: 200 }}>
          <div style={{ color: '#e55a00', fontWeight: 700, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', animation: 'senger-pulse 3s ease-in-out infinite' }}>SENGER MARKET SCREEN</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDotColor, display: 'inline-block' }} title={`Feed: ${feedStatus}`} />
              <span style={{ color: '#666', fontSize: 7, letterSpacing: '0.2em', textTransform: 'uppercase' }}>REAL-TIME</span>
            </span>
            <span style={{ background: statusColor, color: '#fff', fontSize: 7, padding: '2px 5px', fontWeight: 600, borderRadius: 1 }}>{statusLabel}</span>
            {mktOpen !== undefined && (
              <span style={{ color: mktOpen ? '#00c853' : '#888', fontSize: 7, letterSpacing: '0.05em' }}>
                {mktOpen ? '● MKT OPEN' : '● MKT CLOSED'}
              </span>
            )}
          </div>
        </div>

        {/* Clocks */}
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, paddingLeft: 4, overflowX: 'hidden' }}>
          {CLOCKS.map((c) => <Clock key={c.tz} {...c} />)}
        </div>

        {/* Quick FX + theme toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', borderLeft: '1px solid #1a1a1a' }}>
          {['EURUSD', 'USDBRL', 'USDJPY'].map((sym) => {
            const d = forex[sym];
            return d ? (
              <div key={sym} style={{ textAlign: 'center' }}>
                <div style={{ color: '#555', fontSize: 7, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{sym.slice(0,3)}/{sym.slice(3)}</div>
                <div style={{ color: '#ccc', fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {(d.mid || d.price || 0).toFixed(4)}
                </div>
                <div style={{ color: (d.changePct ?? 0) >= 0 ? '#00c853' : '#f44336', fontSize: 8 }}>
                  {fmtPct(d.changePct)}
                </div>
              </div>
            ) : null;
          })}


          {/* Chat icon */}
          {onChatOpen && (
            <button
              onClick={onChatOpen}
              className="chat-icon-btn"
              title="Messages"
              style={{ marginRight: 4 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {chatUnread > 0 && <span className="chat-icon-badge">{chatUnread}</span>}
            </button>
          )}
          {/* Theme toggle */}
          {toggleTheme && (
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                background: 'none', border: '1px solid #2a2a2a', color: '#555',
                fontSize: 12, padding: '3px 6px', cursor: 'pointer',
                fontFamily: 'inherit', borderRadius: 2, lineHeight: 1,
                display: 'flex', alignItems: 'center',
              }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          )}
        </div>
      </div>

      {/* Ticker tape */}
      <TickerTape stocks={stocks} indexes={{}} />
    </div>
  );
}
