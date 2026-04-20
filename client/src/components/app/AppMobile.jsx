import { useState, useEffect, useMemo } from 'react';
import { useAlerts } from '../../context/AlertsContext';
import ParticleLogo from '../ui/ParticleLogo';
import TerminalLogo from '../ui/TerminalLogo';
import VaultLogo from '../ui/VaultLogo';
import './ParticleNav.css';

// ── Mobile tab definitions (5 primary tabs inside Terminal mode) ─────────────
// Phase 9.7: "Portfolio" → "Watchlist" per Phase 9.2 unification
export const MOBILE_TABS = [
  { id: 'home',      label: 'Home' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'search',    label: 'Search' },
  { id: 'more',      label: 'More' },
];

// Terminal sub-nav tabs (compact pills inside Terminal mode)
export const TERMINAL_TABS = [
  { id: 'home',      label: 'Home' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'search',    label: 'Search' },
  { id: 'more',      label: 'More' },
];

// SVG tab icons (24x24, stroke-based) — color driven by CSS class via currentColor
export function TabIcon({ id, active }) {
  const sw = active ? 2 : 1.5;
  const s = { width: 22, height: 22, display: 'block' };
  switch (id) {
    case 'home': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" /><polyline points="9 21 9 14 15 14 15 21" />
      </svg>
    );
    case 'charts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
    case 'search': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    );
    case 'watchlist': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2" /><line x1="2" y1="9" x2="22" y2="9" /><line x1="12" y1="9" x2="12" y2="21" />
      </svg>
    );
    case 'alerts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
    case 'more': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
    default: return null;
  }
}

// Small 16×16 icons for the compact sub-nav
function SubNavIcon({ id }) {
  const s = { width: 16, height: 16, display: 'block' };
  switch (id) {
    case 'home': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" /><polyline points="9 21 9 14 15 14 15 21" />
      </svg>
    );
    case 'charts': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
    case 'watchlist': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="18" rx="2" /><line x1="2" y1="9" x2="22" y2="9" /><line x1="12" y1="9" x2="12" y2="21" />
      </svg>
    );
    case 'search': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    );
    case 'more': return (
      <svg style={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
    default: return null;
  }
}

// Badge component for tab bar alert count
export function TabBadge({ count }) {
  if (!count || count <= 0) return null;
  return (
    <span className="m-tab-badge">{count > 9 ? '9+' : count}</span>
  );
}

// ── Legacy Mobile tab bar (kept for backward compat, still used in old flow) ──
export function MobileTabBar({ activeTab, onTabChange }) {
  const { alerts } = useAlerts();
  const triggeredCount = useMemo(
    () => alerts.filter(a => a.triggeredAt && !a.dismissed).length,
    [alerts]
  );

  return (
    <nav className="m-tab-bar">
      {MOBILE_TABS.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button className="m-tab-btn"
            key={tab.id}
            data-active={isActive}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="m-tab-icon-wrap">
              <TabIcon id={tab.id} active={isActive} />
              {tab.id === 'alerts' && <TabBadge count={triggeredCount} />}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── 3-state Particle/Terminal/Vault bottom bar ──────────────────────────────
export function ParticleModeBar({ mode, onModeChange }) {
  const modes = ['particle', 'terminal', 'vault'];
  const activeIdx = modes.indexOf(mode);
  return (
    <nav className="p-mode-bar p-mode-bar--3">
      {/* Sliding highlight indicator */}
      <div className="p-mode-slider p-mode-slider--3" data-mode={mode} style={{
        width: 'calc(33.333% - 12px)',
        transform: `translateX(calc(${activeIdx} * (100% + 6px)))`,
      }} />
      <button
        className="p-mode-btn"
        data-mode="particle"
        data-active={mode === 'particle'}
        onClick={() => onModeChange('particle')}
      >
        <span className="p-mode-btn-icon">
          <ParticleLogo size={18} />
        </span>
        Particle
      </button>
      <button
        className="p-mode-btn"
        data-mode="terminal"
        data-active={mode === 'terminal'}
        onClick={() => onModeChange('terminal')}
      >
        <span className="p-mode-btn-icon">
          <TerminalLogo size={18} />
        </span>
        Terminal
      </button>
      <button
        className="p-mode-btn"
        data-mode="vault"
        data-active={mode === 'vault'}
        onClick={() => onModeChange('vault')}
      >
        <span className="p-mode-btn-icon">
          <VaultLogo size={18} />
        </span>
        Vault
      </button>
    </nav>
  );
}

// ── NEW: Compact sub-nav inside Terminal mode ────────────────────────────────
export function TerminalSubNav({ activeTab, onTabChange }) {
  return (
    <nav className="t-sub-nav">
      {TERMINAL_TABS.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            className={`t-sub-btn${tab.id === 'more' ? ' t-sub-btn--more' : ''}`}
            key={tab.id}
            data-active={isActive}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="t-sub-btn-icon">
              <SubNavIcon id={tab.id} />
            </span>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Mobile local clock + multi-exchange market status ──
// Detects the user's timezone and shows which major exchange is currently open.
// If none are open, shows the next exchange to open with countdown.

const MOBILE_EXCHANGES = [
  { code: 'NYSE',  label: 'US',  tz: 'America/New_York',    open: 570,  close: 960  }, // 9:30-16:00
  { code: 'LSE',   label: 'LDN', tz: 'Europe/London',       open: 480,  close: 990  }, // 8:00-16:30
  { code: 'XETR',  label: 'EU',  tz: 'Europe/Berlin',       open: 540,  close: 1050 }, // 9:00-17:30
  { code: 'TSE',   label: 'TKY', tz: 'Asia/Tokyo',          open: 540,  close: 930  }, // 9:00-15:30
  { code: 'HKEX',  label: 'HK',  tz: 'Asia/Hong_Kong',      open: 570,  close: 960  }, // 9:30-16:00
  { code: 'B3',    label: 'B3',  tz: 'America/Sao_Paulo',   open: 600,  close: 1075 }, // 10:00-17:55
];

function _isExchangeOpenNow(tz, openMin, closeMin) {
  try {
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    if (dayStr === 'Sat' || dayStr === 'Sun') return false;
    const h = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
    const m = parseInt(now.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' }), 10);
    if (isNaN(h) || isNaN(m)) return false;
    const mins = h * 60 + m;
    return mins >= openMin && mins < closeMin;
  } catch { return false; }
}

/** Returns { label, isOpen } for the most relevant exchange based on user timezone */
function _getLocalMarketStatus() {
  const openExchanges = MOBILE_EXCHANGES.filter(ex => _isExchangeOpenNow(ex.tz, ex.open, ex.close));
  if (openExchanges.length > 0) {
    // Priority: user's local exchange → US → first by global importance (array order)
    const userTz = _getUserTimezone();
    const local = openExchanges.find(ex => ex.tz === userTz);
    const us = openExchanges.find(ex => ex.code === 'NYSE');
    const match = local || us || openExchanges[0];
    return { label: match.label, isOpen: true, count: openExchanges.length };
  }
  return { label: '', isOpen: false, count: 0 };
}

function _getUserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
}

export function MobileClockCompact() {
  const [time, setTime] = useState('');
  const [mkt, setMkt] = useState(() => _getLocalMarketStatus());

  useEffect(() => {
    const tz = _getUserTimezone();
    const update = () => {
      const opts = { hour: '2-digit', minute: '2-digit', hour12: false };
      if (tz) opts.timeZone = tz;
      try { setTime(new Date().toLocaleTimeString('en-GB', opts)); }
      catch (_) { setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })); }
      setMkt(_getLocalMarketStatus());
    };
    update();
    const id = setInterval(update, 30_000); // 30s refresh is enough for market status
    return () => clearInterval(id);
  }, []);

  return (
    <div className="m-clock-strip">
      <span className="m-clock-time">{time}</span>
      <span className={`m-mkt-pill${mkt.isOpen ? ' m-mkt-pill--open' : ''}`}>
        {mkt.isOpen
          ? `${mkt.label}${mkt.count > 1 ? ` +${mkt.count - 1}` : ''} OPEN`
          : 'MKTS CLOSED'}
      </span>
    </div>
  );
}
