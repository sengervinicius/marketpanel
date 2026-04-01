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
import './Header.css';

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
    <div className="hdr-clock">
      <div className="hdr-clock-label">{label}</div>
      <div className="hdr-clock-time">{time}</div>
      <div className="hdr-clock-date">{date}</div>
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
    <span key={i} className="hdr-ticker-item">
      <span className="hdr-ticker-symbol">{item.sym}</span>
      <span className="hdr-ticker-price">{fmtPrice(item.price)}</span>
      <span className="hdr-ticker-change" style={{ color: (item.pct ?? 0) >= 0 ? '#00c853' : '#f44336' }}>
        {fmtPct(item.pct)}
      </span>
    </span>
  ));

  return (
    <div className="hdr-ticker-container">
      <div className="hdr-ticker-content">
        {content}
      </div>
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
    <div className="hdr-main">
      {/* Top bar */}
      <div className="flex-row hdr-top-bar">
        {/* Branding */}
        <div className="flex-col hdr-branding-col">
          <div className="hdr-title">SENGER MARKET SCREEN</div>
          <div className="flex-row hdr-status-row">
            <span className="flex-row hdr-feed-status">
              <span className="hdr-feed-dot" style={{ background: statusDotColor }} title={`Feed: ${feedStatus}`} />
              <span className="hdr-feed-label">REAL-TIME</span>
            </span>
            <span className="hdr-status-badge" style={{ background: statusColor }}>{statusLabel}</span>
            {mktOpen !== undefined && (
              <span className="hdr-market-status" style={{ color: mktOpen ? '#00c853' : '#888' }}>
                {mktOpen ? '● MKT OPEN' : '● MKT CLOSED'}
              </span>
            )}
          </div>
        </div>

        {/* Clocks */}
        <div className="flex-row hdr-clocks-container">
          {CLOCKS.map((c) => <Clock key={c.tz} {...c} />)}
        </div>

        {/* Quick FX + theme toggle */}
        <div className="flex-row hdr-quickfx-section">
          {['EURUSD', 'USDBRL', 'USDJPY'].map((sym) => {
            const d = forex[sym];
            return d ? (
              <div key={sym} className="hdr-fx-item">
                <div className="hdr-fx-label">{sym.slice(0,3)}/{sym.slice(3)}</div>
                <div className="hdr-fx-price">
                  {(d.mid || d.price || 0).toFixed(4)}
                </div>
                <div className="hdr-fx-change" style={{ color: (d.changePct ?? 0) >= 0 ? '#00c853' : '#f44336' }}>
                  {fmtPct(d.changePct)}
                </div>
              </div>
            ) : null;
          })}


          {/* Chat icon */}
          {onChatOpen && (
            <button className="btn chat-icon-btn hdr-chat-button"
              onClick={onChatOpen}
              title="Messages"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              {chatUnread > 0 && <span className="chat-icon-badge">{chatUnread}</span>}
            </button>
          )}
          {/* Theme toggle */}
          {toggleTheme && (
            <button className="btn flex-row hdr-theme-button"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
