import { useState, useEffect, useMemo } from 'react';
import { useAlerts } from '../../context/AlertsContext';
import { getMarketState as _getMarketState } from '../common/MarketStatus';
import ParticleLogo from '../ui/ParticleLogo';
import './ParticleNav.css';

// ── Mobile tab definitions (5 primary tabs inside Terminal mode) ─────────────
export const MOBILE_TABS = [
  { id: 'home',      label: 'Home' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Portfolio' },
  { id: 'search',    label: 'Search' },
  { id: 'more',      label: 'More' },
];

// Terminal sub-nav tabs (compact pills inside Terminal mode)
export const TERMINAL_TABS = [
  { id: 'home',      label: 'Home' },
  { id: 'charts',    label: 'Charts' },
  { id: 'watchlist', label: 'Portfolio' },
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

// ── NEW: 2-state Particle/Terminal bottom bar (Wave 12B polish) ──────────────
export function ParticleModeBar({ mode, onModeChange }) {
  return (
    <nav className="p-mode-bar">
      {/* Sliding highlight indicator */}
      <div className="p-mode-slider" data-mode={mode} />
      <button
        className="p-mode-btn"
        data-mode="particle"
        data-active={mode === 'particle'}
        onClick={() => onModeChange('particle')}
      >
        <span className="p-mode-btn-icon">
          <ParticleLogo size={20} />
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </span>
        Terminal
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

// ── Mobile local clock + city + market status ──
export const CITY_OVERRIDES = {
  'Sao Paulo': 'SP', 'New York': 'NY',
  'Los Angeles': 'LA', 'Ho Chi Minh': 'HCM',
  'Buenos Aires': 'BA', 'Mexico City': 'MX',
  'Hong Kong': 'HK', 'Kuala Lumpur': 'KL',
};

export function MobileClockCompact() {
  const [time, setTime] = useState('');
  const [city, setCity] = useState('');
  const [mkt, setMkt] = useState(() => _getMarketState());

  useEffect(() => {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) {}
    if (!tz) { setCity('UTC'); }
    else {
      const raw = tz.split('/').pop().replace(/_/g, ' ');
      setCity(CITY_OVERRIDES[raw] || raw);
    }
    const update = () => {
      const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
      if (tz) opts.timeZone = tz;
      try { setTime(new Date().toLocaleTimeString('en-GB', opts)); }
      catch (_) { setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })); }
      setMkt(_getMarketState());
    };
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, []);

  const mktOpen = mkt.status === 'open';
  return (
    <div className="m-clock-strip">
      <span className="m-clock-time">{city} {time}</span>
      <span className={`m-mkt-pill${mktOpen ? ' m-mkt-pill--open' : ''}`}>
        {mktOpen ? 'MKT OPEN' : 'MKT CLOSED'}
      </span>
    </div>
  );
}
