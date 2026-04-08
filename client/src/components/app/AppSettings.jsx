import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useAlerts } from '../../context/AlertsContext';
import { PANEL_DEFINITIONS, DEFAULT_LAYOUT } from '../../config/panels';
import UserAvatar from '../common/UserAvatar';

// ── Settings Drawer Constants ────────────────────────────────────────────────
// Convert PANEL_DEFINITIONS to array of { id, label }
export const PANEL_DEFS = Object.values(PANEL_DEFINITIONS).map(def => ({
  id: def.id,
  label: def.label,
}));

export const START_PAGE_OPTIONS = [
  { value: '/',          label: 'HOME' },
  { value: '/charts',    label: 'CHARTS' },
  { value: '/watchlist', label: 'PORTFOLIO' },
  { value: '/search',    label: 'SEARCH' },
  { value: '/news',      label: 'NEWS' },
];

// ── SettingsSection ──────────────────────────────────────────────────────────
export function SettingsSection({ label }) {
  return (
    <div className="app-settings-header">
      <span className="app-text-accent-header">{label}</span>
    </div>
  );
}

// ── Settings Drawer ─────────────────────────────────────────────────────────
export function SettingsDrawer({ panelVisible, togglePanel, onClose }) {
  const { settings, updateSettings, resetTour } = useSettings();
  const [resettingLayout, setResettingLayout] = useState(false);

  const defaultStartPage = settings?.defaultStartPage || '/';
  const theme = settings?.theme || 'dark';

  const handleStartPage = (val) => { updateSettings({ defaultStartPage: val }); };
  const handleTheme = () => { updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' }); };
  const handleResetLayout = async () => {
    setResettingLayout(true);
    try {
      await updateSettings({ layout: DEFAULT_LAYOUT });
    } finally {
      setResettingLayout(false);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '5px 12px', borderBottom: '1px solid var(--border-subtle)',
    transition: 'background-color 100ms ease-out',
  };

  const makeRowClickable = (handler) => ({
    onClick: handler,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    },
  });

  return (
    <div className="app-settings-overlay">
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(12px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>

      {/* Drawer header */}
      <div className="flex-row app-settings-row-header">
        <span className="app-text-accent-bold">SETTINGS</span>
        <button className="btn app-btn-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      {/* ── Default Start Page ── */}
      <SettingsSection label="DEFAULT START PAGE" />
      {START_PAGE_OPTIONS.map(({ value, label }) => (
        <div
          key={value}
          role="button"
          tabIndex={0}
          style={rowStyle}
          {...makeRowClickable(() => handleStartPage(value))}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          aria-label={`Set default start page to ${label}`}
          aria-pressed={defaultStartPage === value}
        >
          <span style={{ color: defaultStartPage === value ? 'var(--accent)' : 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
          <span style={{ color: defaultStartPage === value ? 'var(--accent)' : 'var(--border-strong)' }}>{defaultStartPage === value ? '●' : '○'}</span>
        </div>
      ))}

      {/* ── Theme ── */}
      <SettingsSection label="APPEARANCE" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleTheme)}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        aria-label={`Toggle theme. Current: ${theme === 'dark' ? 'Dark mode' : 'Light mode'}`}
        aria-pressed={theme === 'dark'}
      >
        <span className="app-text-muted-small">{theme === 'dark' ? '◑ DARK MODE' : '☀ LIGHT MODE'}</span>
        <span className="app-text-accent-bold-small">TOGGLE</span>
      </div>

      {/* ── Reset Layout ── */}
      <SettingsSection label="LAYOUT" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(handleResetLayout)}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        aria-label="Reset layout to default"
      >
        <span className="app-text-muted-small">Reset to Default</span>
        {resettingLayout
          ? <span className="app-text-accent-small">RESETTING…</span>
          : <span className="app-text-faint-small">↻ RESET</span>}
      </div>

      {/* ── Panel Visibility ── */}
      <SettingsSection label="PANEL VISIBILITY" />
      {PANEL_DEFS.map(({ id, label }) => {
        const visible = panelVisible[id] ?? true;
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            style={rowStyle}
            {...makeRowClickable(() => togglePanel(id))}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            aria-pressed={visible}
            aria-label={`${label}: ${visible ? 'on' : 'off'}. Click to toggle`}
          >
            <span style={{ color: visible ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
            <span style={{ color: visible ? 'var(--price-up)' : 'var(--text-faint)', fontSize: 9, fontWeight: 700 }}>
              {visible ? '● ON' : '○ OFF'}
            </span>
          </div>
        );
      })}

      {/* ── Help ── */}
      <SettingsSection label="HELP" />
      <div
        role="button"
        tabIndex={0}
        style={rowStyle}
        {...makeRowClickable(() => { resetTour(); onClose(); })}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        aria-label="Restart onboarding tour"
      >
        <span className="app-text-muted-small">Restart Onboarding Tour</span>
        <span className="app-text-faint-small">&#8635; RESTART</span>
      </div>

      {/* ── Community & Discord ── */}
      <SettingsSection label="COMMUNITY" />
      <DiscordLinkRow />

    </div>
  );
}

// ── Discord Link Row (settings drawer + mobile) ─────────────────────────────
export function DiscordLinkRow() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    fetch('/api/discord/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setStatus(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!status?.configured) return null;

  const handleLink = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/discord/link', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  };

  const handleUnlink = async () => {
    const token = localStorage.getItem('token');
    await fetch('/api/discord/unlink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    setStatus(s => ({ ...s, linked: false, discordUsername: null }));
  };

  const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', transition: 'background 150ms' };

  if (status.linked) {
    return (
      <div style={rowStyle}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <span className="app-text-muted-small">Discord: {status.discordUsername}</span>
        <span className="app-text-faint-small" style={{ cursor: 'pointer' }} onClick={handleUnlink}>UNLINK</span>
      </div>
    );
  }

  return (
    <div role="button" tabIndex={0} style={rowStyle}
      onClick={handleLink}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      aria-label="Connect to our Discord community"
    >
      <span className="app-text-muted-small">Join our Discord</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#5865F2', letterSpacing: '0.3px' }}>CONNECT</span>
    </div>
  );
}

// ── User Dropdown (header avatar menu) ───────────────────────────────────────
export function UserDropdown({ user, onSettings, onLogout, onBilling, isPaid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn flex-row gap-2"
        onClick={() => setOpen(s => !s)}
        style={{
          padding: '2px 8px', gap: 5,
        }}
        aria-label={`User menu for ${user.username}`}
        aria-expanded={open}
      >
        <UserAvatar user={user} size="small" interactive />
        <span style={{ color: open ? 'var(--accent)' : 'var(--text-faint)', fontSize: 8 }}>▼</span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span>{user.username?.toUpperCase()}</span>
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', right: 0, zIndex: 2000,
          background: 'var(--bg-overlay)', border: '1px solid var(--border-strong)',
          width: 150, boxShadow: 'var(--shadow-dropdown)',
          }}>
          {isPaid && onBilling && (
            <div
              onClick={() => { setOpen(false); onBilling(); }}
              className="app-dropdown-item app-text-muted"
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-up)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              role="button"
              tabIndex={0}
              aria-label="View billing and subscription details"
            >💳 BILLING</div>
          )}
          <div
            onClick={() => { setOpen(false); onSettings(); }}
            className="app-dropdown-item"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            role="button"
            tabIndex={0}
            aria-label="Open settings"
          >⚙ SETTINGS</div>
          <div
            onClick={() => { setOpen(false); onLogout(); }}
            className="app-dropdown-item-last"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-down)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            role="button"
            tabIndex={0}
            aria-label="Log out of your account"
          >→ LOG OUT</div>
        </div>
      )}
    </div>
  );
}

// ── Alert Badge (header bell icon with unread count) ────────────────────────
export function AlertBadge() {
  let triggeredCount = 0;
  try {
    const { triggeredAlerts } = useAlerts();
    triggeredCount = triggeredAlerts?.length || 0;
  } catch {
    // AlertsProvider might not be ready yet
    return null;
  }
  if (triggeredCount === 0) return (
    <span title="No triggered alerts" style={{ color: 'var(--text-faint)', fontSize: 11, cursor: 'default', display: 'inline-flex' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
  );
  return (
    <span title={`${triggeredCount} triggered alert${triggeredCount > 1 ? 's' : ''}`} style={{ position: 'relative', fontSize: 11, display: 'inline-flex' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span style={{
        position: 'absolute', top: -4, right: -6,
        background: 'var(--price-down)', color: '#fff',
        fontSize: 7, fontWeight: 700, borderRadius: '50%',
        width: 12, height: 12, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}>{triggeredCount > 9 ? '9+' : triggeredCount}</span>
    </span>
  );
}
