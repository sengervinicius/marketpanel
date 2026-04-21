import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useAlerts } from '../../context/AlertsContext';
import { PANEL_DEFINITIONS, DEFAULT_LAYOUT } from '../../config/panels';
import UserAvatar from '../common/UserAvatar';
import VaultPanel from './VaultPanel';

// ── Settings Drawer Constants ────────────────────────────────────────────────
// Settings surfaces toggleable grid panels only — NOT sector screens.
// Sector screens (defenceScreen, brazilScreen, energyScreen, etc.) are
// navigated to from the screens menu, not shown/hidden from the grid.
// Surfacing them in Panel Visibility is what produced the duplicate
// "Commodities / Commodities+", "Brazil / Brazil B3", "Macro / Macro"
// rows users were seeing.
//
// Legacy panel IDs still exist in PANEL_DEFINITIONS so saved layouts
// keep working; we just don't expose them as new toggles.
const SETTINGS_PANEL_IDS = [
  'charts',
  'usEquities',
  'brazilB3',
  'globalIndices',
  'forex',
  'crypto',
  'commodities',
  'debt',         // canonical rates/yields panel — deprecates `curves` and `rates`
  'watchlist',
  'alerts',
  'news',
  'sentiment',
  'chat',
  'etf',
  'screener',
  'macro',
  'calendar',
  'heatmap',
  'predictions',
  'optionsFlow',
];

export const PANEL_DEFS = SETTINGS_PANEL_IDS
  .map(id => PANEL_DEFINITIONS[id])
  .filter(Boolean)
  .map(def => ({ id: def.id, label: def.label }));

export const START_TAB_OPTIONS = [
  { value: 'home',      label: 'HOME' },
  { value: 'charts',    label: 'CHARTS' },
  { value: 'watchlist', label: 'PORTFOLIO' },
  { value: 'search',    label: 'SEARCH' },
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
export function SettingsDrawer({ panelVisible, togglePanel, onClose, mobile }) {
  const { settings, updateSettings, resetTour } = useSettings();
  const [resettingLayout, setResettingLayout] = useState(false);

  // Default Start Tab only makes sense when tab navigation is actually used.
  // On desktop the app uses a panel grid, not bottom tabs, so those buttons
  // were dead-ends. Detect mobile either from the explicit prop or via a
  // narrow-viewport heuristic so the setting appears in every mobile
  // context without us threading the prop through every call site.
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 768px)');
    const h = (e) => setIsNarrow(e.matches);
    // addEventListener is the modern API; fall back to addListener for older browsers.
    if (mql.addEventListener) mql.addEventListener('change', h);
    else if (mql.addListener) mql.addListener(h);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', h);
      else if (mql.removeListener) mql.removeListener(h);
    };
  }, []);
  const showStartTab = mobile === true || isNarrow;

  const defaultStartTab = settings?.defaultStartTab || 'home';
  const theme = settings?.theme || 'dark';

  const handleStartTab = (val) => { updateSettings({ defaultStartTab: val }); };
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {/* ── Default Start Tab (mobile-only — desktop uses grid layout) ── */}
      {showStartTab && (
        <>
          <SettingsSection label="DEFAULT START TAB" />
          {START_TAB_OPTIONS.map(({ value, label }) => (
            <div
              key={value}
              role="button"
              tabIndex={0}
              style={rowStyle}
              {...makeRowClickable(() => handleStartTab(value))}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              aria-label={`Set default start tab to ${label}`}
              aria-pressed={defaultStartTab === value}
            >
              <span style={{ color: defaultStartTab === value ? 'var(--accent)' : 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>{label}</span>
              <span style={{ color: defaultStartTab === value ? 'var(--accent)' : 'var(--border-strong)' }}>{defaultStartTab === value ? '●' : '○'}</span>
            </div>
          ))}
        </>
      )}

      {/* ── Morning Brief delivery (Phase 10.7) ───────────────────────── */}
      <SettingsSection label="MORNING BRIEF" />
      {(() => {
        // Default both channels ON unless explicitly set false. Matches the
        // server-side dispatcher's `settings.morningBriefEmail !== false`.
        const emailOn = settings?.morningBriefEmail !== false;
        const inboxOn = settings?.morningBriefInbox !== false;
        const briefTime = settings?.morningBriefTime || '06:30';
        return (
          <>
            <div
              role="button"
              tabIndex={0}
              style={rowStyle}
              {...makeRowClickable(() => updateSettings({ morningBriefEmail: !emailOn }))}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              aria-pressed={emailOn}
              aria-label={`Email delivery: ${emailOn ? 'on' : 'off'}. Click to toggle`}
            >
              <span style={{ color: emailOn ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: 9, letterSpacing: '0.5px' }}>EMAIL DELIVERY</span>
              <span style={{ color: emailOn ? 'var(--price-up)' : 'var(--text-faint)', fontSize: 9, fontWeight: 700 }}>
                {emailOn ? '● ON' : '○ OFF'}
              </span>
            </div>
            <div
              role="button"
              tabIndex={0}
              style={rowStyle}
              {...makeRowClickable(() => updateSettings({ morningBriefInbox: !inboxOn }))}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              aria-pressed={inboxOn}
              aria-label={`In-app inbox: ${inboxOn ? 'on' : 'off'}. Click to toggle`}
            >
              <span style={{ color: inboxOn ? 'var(--text-primary)' : 'var(--text-faint)', fontSize: 9, letterSpacing: '0.5px' }}>IN-APP INBOX</span>
              <span style={{ color: inboxOn ? 'var(--price-up)' : 'var(--text-faint)', fontSize: 9, fontWeight: 700 }}>
                {inboxOn ? '● ON' : '○ OFF'}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={{ color: 'var(--text-muted)', fontSize: 9, letterSpacing: '0.5px' }}>SEND TIME (LOCAL)</span>
              <input
                type="time"
                value={briefTime}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^\d{2}:\d{2}$/.test(v)) updateSettings({ morningBriefTime: v });
                }}
                style={{
                  background: 'var(--bg-surface, #181818)',
                  color: 'var(--text-primary, #fff)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 3,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              />
            </div>
          </>
        );
      })()}

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
        <span className="app-text-muted-small">{theme === 'dark' ? '◑ DARK MODE' : 'LIGHT MODE'}</span>
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
          : <span className="app-text-faint-small">RESET</span>}
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

      {/* ── Particle Memory (P2.2) ── */}
      {/*
        Particle AI extracts persistent facts from your conversations (your
        positions, theses, preferences) and injects them back into the system
        prompt on future turns. Until this panel existed the user had no way
        to see, edit, or forget what the model remembered — a trust hole.
      */}
      <SettingsSection label="PARTICLE MEMORY" />
      <ParticleMemoryPanel />

      {/* ── Knowledge Vault ── */}
      <SettingsSection label="KNOWLEDGE VAULT" />
      <VaultPanel />

      {/* ── Inbound Email → Personal Vault (P4) ── */}
      <SettingsSection label="EMAIL → PERSONAL VAULT" />
      <InboundEmailRow />

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

// ── Inbound Email Row (P4 per-user vault address) ───────────────────────────
//
// Shows the user their personal `vault-<token>@the-particle.com` address so
// they can forward research into their own vault the same way the CIO pipes
// things into the central one. UX decisions:
//   • Token IS the credential → treat it like a password (monospace, copy
//     button, warning banner on first display).
//   • Lazy-mint on load so the feature is discoverable without an explicit
//     "create address" button.
//   • Rotate + Disable are separate actions: rotate invalidates the old
//     token AND issues a new one in the same DB transaction; disable just
//     kills the current one.
//   • We do NOT try to hide the token — the user has to be able to copy it
//     out to their mail client. Masking it and revealing on click added a
//     step without meaningfully reducing shoulder-surf risk in the
//     scenarios we care about (their own laptop).
export function InboundEmailRow() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [busy, setBusy] = useState(null); // 'rotate' | 'disable' | 'enable' | null
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/settings/vault-inbound', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e.message, data: null });
    }
  };

  useEffect(() => { load(); }, []);

  const post = async (path) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/settings/vault-inbound${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const handleRotate = async () => {
    // Confirm — rotation invalidates the existing address. Anything sent
    // to the old one after this click lands in the dead-letter log.
    if (!window.confirm('Rotate your inbound address?\n\nAny forwards still using the old address will stop working immediately.')) return;
    setBusy('rotate');
    try {
      const d = await post('/rotate');
      setState({ loading: false, error: null, data: d });
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Disable inbound email?\n\nYour current address will stop accepting mail. You can re-enable later.')) return;
    setBusy('disable');
    try {
      await post('/disable');
      setState({ loading: false, error: null, data: { enabled: false } });
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setBusy(null);
    }
  };

  // Re-enable simply hits GET — the server lazy-mints.
  const handleEnable = async () => {
    setBusy('enable');
    try {
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!state.data || !state.data.address) return;
    try {
      await navigator.clipboard.writeText(state.data.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) { /* clipboard permission denied — user can still select manually */ }
  };

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', transition: 'background 150ms',
  };

  if (state.loading) {
    return (
      <div style={rowStyle}>
        <span className="app-text-muted-small">Loading…</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <span style={{ color: 'var(--price-down)', fontSize: 9 }}>Error: {state.error}</span>
        <span
          role="button" tabIndex={0}
          style={{ color: 'var(--accent)', fontSize: 9, cursor: 'pointer' }}
          onClick={load}
        >RETRY</span>
      </div>
    );
  }

  if (!state.data || !state.data.enabled) {
    return (
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <span className="app-text-muted-small">Inbound email is disabled.</span>
        <span
          role="button" tabIndex={0}
          style={{ color: 'var(--accent)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
          onClick={handleEnable}
          aria-label="Enable inbound email"
        >{busy === 'enable' ? 'ENABLING…' : 'ENABLE'}</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9, color: 'var(--text-faint)', lineHeight: 1.4 }}>
        Forward emails (with PDF/DOCX attachments, or research notes in the body) to your personal address below. Anything you send lands in your private vault — nobody else on Particle sees it.
      </div>
      <div style={{
        fontFamily: 'Menlo, Monaco, "SF Mono", monospace',
        fontSize: 11, color: 'var(--text-primary)',
        padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 4,
        wordBreak: 'break-all', userSelect: 'all',
      }}>
        {state.data.address}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span
          role="button" tabIndex={0}
          onClick={handleCopy}
          style={{ color: copied ? 'var(--price-up)' : 'var(--accent)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
          aria-label="Copy inbound email address to clipboard"
        >{copied ? '✓ COPIED' : 'COPY ADDRESS'}</span>
        <span style={{ display: 'flex', gap: 12 }}>
          <span
            role="button" tabIndex={0}
            onClick={handleRotate}
            style={{ color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
            aria-label="Rotate inbound token"
          >{busy === 'rotate' ? 'ROTATING…' : 'ROTATE'}</span>
          <span
            role="button" tabIndex={0}
            onClick={handleDisable}
            style={{ color: 'var(--price-down)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
            aria-label="Disable inbound email"
          >{busy === 'disable' ? 'DISABLING…' : 'DISABLE'}</span>
        </span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-faint)', lineHeight: 1.3 }}>
        ⚠ Treat this address like a password. Anyone who knows it can drop files into your vault — rotate immediately if it leaks.
      </div>
    </div>
  );
}

// ── Particle Memory Panel (P2.2) ────────────────────────────────────────────
//
// Lists every persistent fact Particle AI currently retains for the signed-in
// user and lets them edit the content, correct it, or forget it outright.
// memoryManager.js writes into user_memories whenever it spots a durable
// fact in chat (a position, a thesis, a preference); those rows get
// re-injected into the system prompt on future turns. This panel is the
// user-facing correction surface — you see it, you own it, you can burn it.
//
// UX decisions:
//   • Inline edit on click — mirrors how the chat message action buttons
//     feel. No modal to pop and dismiss.
//   • Type badge + reference count give quick signal on which facts the
//     model leans on most. Rows are already ordered reference-DESC
//     server-side.
//   • Forget-all is a distinct, styled-red row separated from the list
//     and double-gated by window.confirm. Destructive, irreversible,
//     not one-click.
//   • If Postgres is disconnected (dev mode / DB down) the GET returns
//     { connected:false } and we render a benign "nothing retained yet"
//     state rather than an error banner — same graceful-degrade pattern
//     as memoryManager itself.
export function ParticleMemoryPanel() {
  const [state, setState] = useState({ loading: true, error: null, memories: [], connected: true });
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(null); // id being saved/deleted, or 'forget-all'

  const load = async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/memory', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load memories');
      setState({
        loading: false,
        error: null,
        memories: Array.isArray(data.data) ? data.data : [],
        connected: data.connected !== false,
      });
    } catch (e) {
      setState({ loading: false, error: e.message, memories: [], connected: false });
    }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (m) => {
    setEditingId(m.id);
    setDraft(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const saveEdit = async (id) => {
    const trimmed = (draft || '').trim();
    if (!trimmed) { cancelEdit(); return; }
    setBusy(id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/memory/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setState(s => ({
        ...s,
        memories: s.memories.map(m => m.id === id ? { ...m, ...data.data } : m),
      }));
      cancelEdit();
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setBusy(null);
    }
  };

  const deleteOne = async (id) => {
    if (!window.confirm('Forget this memory?\n\nParticle will no longer reference this fact in future replies.')) return;
    setBusy(id);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/memory/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Delete failed');
      }
      setState(s => ({ ...s, memories: s.memories.filter(m => m.id !== id) }));
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setBusy(null);
    }
  };

  const forgetAll = async () => {
    if (!window.confirm('Forget EVERYTHING Particle remembers about you?\n\nThis cannot be undone. The model will start fresh on your next turn.')) return;
    setBusy('forget-all');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Forget-all failed');
      }
      setState(s => ({ ...s, memories: [] }));
    } catch (e) {
      setState(s => ({ ...s, error: e.message }));
    } finally {
      setBusy(null);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, padding: '6px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    transition: 'background-color 100ms ease-out',
  };

  if (state.loading) {
    return (
      <div style={rowStyle}>
        <span className="app-text-muted-small">Loading…</span>
      </div>
    );
  }

  if (state.memories.length === 0) {
    return (
      <>
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span style={{ color: 'var(--text-faint)', fontSize: 9, lineHeight: 1.3 }}>
            Nothing retained yet. As you talk with Particle, it will note the positions, theses, and preferences that recur — they will appear here so you can correct or delete them.
          </span>
          {state.error && (
            <span style={{ color: 'var(--price-down)', fontSize: 9 }}>Error: {state.error}</span>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {state.error && (
        <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span style={{ color: 'var(--price-down)', fontSize: 9 }}>Error: {state.error}</span>
        </div>
      )}
      {state.memories.map(m => {
        const isEditing = editingId === m.id;
        const lowConf = Number(m.confidence) <= 0.3;
        return (
          <div
            key={m.id}
            style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 8, letterSpacing: '0.4px', fontWeight: 700,
                color: lowConf ? 'var(--text-faint)' : 'var(--accent)',
                border: '1px solid var(--border-subtle)', borderRadius: 2,
                padding: '1px 4px', textTransform: 'uppercase',
              }}>{m.type || 'fact'}</span>
              {m.referenceCount > 0 && (
                <span style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.3px' }}>
                  ×{m.referenceCount}
                </span>
              )}
              {lowConf && (
                <span
                  title="Low-confidence; the model suppresses this at inference time but keeps the row so you can still see and delete it"
                  style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '0.3px' }}
                >LOW CONF</span>
              )}
              <span style={{ flex: 1 }} />
              {!isEditing && (
                <>
                  <span
                    role="button" tabIndex={0}
                    onClick={() => startEdit(m)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(m); } }}
                    style={{ color: 'var(--text-muted)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
                    aria-label={`Edit memory ${m.id}`}
                  >EDIT</span>
                  <span
                    role="button" tabIndex={0}
                    onClick={() => deleteOne(m.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); deleteOne(m.id); } }}
                    style={{ color: 'var(--price-down)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
                    aria-label={`Forget memory ${m.id}`}
                  >{busy === m.id ? '…' : 'FORGET'}</span>
                </>
              )}
            </div>
            {isEditing ? (
              <>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  maxLength={500}
                  style={{
                    width: '100%',
                    background: 'var(--bg-surface, #181818)',
                    color: 'var(--text-primary, #fff)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 3,
                    padding: '4px 6px',
                    fontSize: 10,
                    fontFamily: 'var(--font-mono, monospace)',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <span
                    role="button" tabIndex={0}
                    onClick={cancelEdit}
                    style={{ color: 'var(--text-faint)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px' }}
                  >CANCEL</span>
                  <span
                    role="button" tabIndex={0}
                    onClick={() => saveEdit(m.id)}
                    style={{ color: 'var(--accent)', fontSize: 9, cursor: 'pointer', letterSpacing: '0.3px', fontWeight: 700 }}
                  >{busy === m.id ? 'SAVING…' : 'SAVE'}</span>
                </div>
              </>
            ) : (
              <span style={{
                color: lowConf ? 'var(--text-faint)' : 'var(--text-primary)',
                fontSize: 10, lineHeight: 1.4, fontFamily: 'var(--font-mono, monospace)',
              }}>{m.content}</span>
            )}
          </div>
        );
      })}
      <div
        role="button" tabIndex={0}
        style={{
          ...rowStyle, cursor: 'pointer',
          borderTop: '1px solid var(--border-subtle)', marginTop: 4,
        }}
        onClick={forgetAll}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); forgetAll(); } }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        aria-label="Forget everything Particle remembers"
      >
        <span style={{ color: 'var(--price-down)', fontSize: 9, letterSpacing: '0.3px', fontWeight: 700 }}>
          ✕ FORGET EVERYTHING
        </span>
        <span style={{ color: 'var(--text-faint)', fontSize: 8 }}>
          {busy === 'forget-all' ? 'FORGETTING…' : 'irreversible'}
        </span>
      </div>
    </>
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
        <span style={{ color: open ? 'var(--accent)' : 'var(--text-faint)', fontSize: 8 }}>v</span>
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
              onClick={(e) => { e.stopPropagation(); setOpen(false); onBilling(); }}
              onMouseDown={(e) => e.stopPropagation()}
              className="app-dropdown-item app-text-muted"
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--price-up)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              role="button"
              tabIndex={0}
              aria-label="View billing and subscription details"
            >BILLING</div>
          )}
          <div
            onClick={(e) => { e.stopPropagation(); setOpen(false); onSettings(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="app-dropdown-item"
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            role="button"
            tabIndex={0}
            aria-label="Open settings"
          ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> SETTINGS</div>
          <div
            onClick={(e) => { e.stopPropagation(); setOpen(false); onLogout(); }}
            onMouseDown={(e) => e.stopPropagation()}
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
