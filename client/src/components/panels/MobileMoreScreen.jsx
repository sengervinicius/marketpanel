import React, { memo, useState, useCallback, useMemo, useEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { getTemplatesGrouped, getTemplate } from '../../config/templates';
import UserAvatar from '../common/UserAvatar';
import { getPersona } from '../../config/avatars';

function MenuItem({ icon, label, onClick, subtle, danger }) {
  return (
    <button className="mm-item" onClick={onClick} data-subtle={subtle || undefined} data-danger={danger || undefined}>
      <span className="mm-item-icon">{icon}</span>
      <span className="mm-item-label">{label}</span>
      <svg className="mm-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

const MobileMoreScreen = memo(({
  onNavigate,
  user,
  onSettings,
  onLogout,
  onBilling,
  isPaid,
  subscription
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0); // 0=initial, 1=confirming, 2=deleting
  const [deleteError, setDeleteError] = useState(null);

  const handleDeleteAccount = useCallback(async () => {
    setDeleteStep(2);
    setDeleteError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete account');
      }
      // Clear local state and log out
      localStorage.clear();
      window.location.reload();
    } catch (e) {
      setDeleteError(e.message);
      setDeleteStep(1);
    }
  }, []);

  const getTrialStatus = () => {
    if (!subscription) return null;
    const status = subscription.status?.toUpperCase() || 'TRIAL';
    let daysRemaining = null;
    if (subscription.trialEndsAt) {
      const endDate = new Date(subscription.trialEndsAt);
      const today = new Date();
      const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
      daysRemaining = Math.max(0, daysLeft);
    }
    return { status, daysRemaining };
  };

  const trialInfo = getTrialStatus();
  const subscriptionStatus = trialInfo?.status || 'TRIAL';
  const daysRemaining = trialInfo?.daysRemaining;

  return (
    <div className="mm-screen">
      {/* User card */}
      <div className="mm-user-card">
        <div className="mm-avatar">
          <UserAvatar user={user} size="large" interactive />
        </div>
        <div className="mm-user-info">
          <div className="mm-user-name">{user?.username || user?.name || 'User'}</div>
          {user?.persona?.type && (
            <div className="mm-persona-label">{getPersona(user.persona.type)?.label}</div>
          )}
          <div className="mm-user-meta">
            <span className="mm-badge">{subscriptionStatus}</span>
            {daysRemaining !== null && subscriptionStatus === 'TRIAL' && (
              <span className="mm-days-left">{daysRemaining} days left</span>
            )}
          </div>
        </div>
      </div>


      {/* Primary navigation */}
      <div className="mm-section">
        <div className="m-section-label" style={{ padding: '0 16px' }}>TOOLS</div>
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>}
          label="News Feed"
          onClick={() => onNavigate('news')}
        />
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
          label="ETF Screener"
          onClick={() => onNavigate('etf')}
        />
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>}
          label="Sector Screens"
          onClick={() => onNavigate('sectors')}
        />
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>}
          label="Notification Settings"
          onClick={() => onNavigate('notification-prefs')}
        />

      </div>

      {/* Workspace switcher */}
      <MobileWorkspaceSection />

      {/* Settings & account */}
      <div className="mm-section">
        <div className="m-section-label" style={{ padding: '0 16px' }}>ACCOUNT</div>
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
          label="Settings"
          onClick={onSettings}
        />
        <MobileRestartTour />
        {isPaid && (
          <MenuItem
            icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>}
            label="Manage Subscription"
            onClick={onBilling}
          />
        )}
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>}
          label="Log Out"
          onClick={onLogout}
          subtle
        />
      </div>

      {/* Community & Discord */}
      <MobileDiscordSection />

      {/* Danger zone */}
      <div className="mm-section">
        <div className="m-section-label" style={{ padding: '0 16px', color: 'var(--price-down, #e74c3c)' }}>DANGER ZONE</div>
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>}
          label="Delete Account"
          onClick={() => { setShowDeleteConfirm(true); setDeleteStep(0); setDeleteError(null); }}
          danger
        />
      </div>

      {/* Version footer */}
      <div className="mm-footer">
        <span className="mm-footer-brand">SENGER MARKET v2.1</span>
        <span className="mm-footer-sub">Terminal</span>
      </div>

      {/* Delete account confirmation modal */}
      {showDeleteConfirm && (
        <div className="mm-overlay" onClick={() => deleteStep < 2 && setShowDeleteConfirm(false)}>
          <div className="mm-modal" onClick={e => e.stopPropagation()}>
            <div className="mm-modal-title">Delete Account</div>
            {deleteStep === 0 && (
              <>
                <p className="mm-modal-text">
                  This will permanently delete your account and all associated data including your portfolio, alerts, and settings.
                </p>
                <p className="mm-modal-text" style={{ fontWeight: 600, color: 'var(--price-down, #e74c3c)' }}>
                  This action cannot be undone.
                </p>
                <div className="mm-modal-actions">
                  <button className="mm-modal-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  <button className="mm-modal-btn mm-modal-btn-danger" onClick={() => setDeleteStep(1)}>
                    Continue
                  </button>
                </div>
              </>
            )}
            {deleteStep === 1 && (
              <>
                <p className="mm-modal-text">
                  Are you absolutely sure? Type your username <strong>{user?.username || 'your username'}</strong> mentally and confirm.
                </p>
                {deleteError && (
                  <p className="mm-modal-text" style={{ color: 'var(--price-down, #e74c3c)' }}>{deleteError}</p>
                )}
                <div className="mm-modal-actions">
                  <button className="mm-modal-btn" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  <button className="mm-modal-btn mm-modal-btn-danger" onClick={handleDeleteAccount}>
                    Delete My Account
                  </button>
                </div>
              </>
            )}
            {deleteStep === 2 && (
              <p className="mm-modal-text">Deleting your account...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Mobile Workspace Section ────────────────────────────────────────────────
function MobileWorkspaceSection() {
  const { settings, applyTemplate } = useSettings();
  const [applying, setApplying] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const grouped = useMemo(() => getTemplatesGrouped(null), []);
  const activeId = settings?.activeTemplate || null;

  const handleApply = async (templateId) => {
    if (applying) return;
    setApplying(templateId);
    try { await applyTemplate(templateId, 'full'); } catch {}
    setApplying(null);
  };

  const activeTemplate = activeId ? getTemplate(activeId) : null;
  const activeLabel = activeTemplate ? activeTemplate.label : 'Default';

  return (
    <div className="mm-section">
      <div className="m-section-label" style={{ padding: '0 16px' }}>WORKSPACE</div>
      <button className="mm-item" onClick={() => setExpanded(s => !s)}>
        <span className="mm-item-icon" style={{ fontSize: 14 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        </span>
        <span className="mm-item-label">
          {activeLabel}
        </span>
        <svg className="mm-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {expanded && (
        <div style={{ padding: '0 0 4px' }}>
          {Object.entries(grouped).map(([groupName, templates]) => (
            <div key={groupName}>
              <div style={{
                padding: '6px 20px 2px',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.8px',
                color: 'var(--text-faint)',
              }}>
                {groupName.toUpperCase()}
              </div>
              {templates.map(t => {
                const isActive = activeId === t.id;
                const isApplying = applying === t.id;
                return (
                  <button
                    key={t.id}
                    className="mm-item"
                    onClick={() => handleApply(t.id)}
                    disabled={isApplying}
                    style={{ opacity: isApplying ? 0.5 : 1 }}
                  >
                    <span style={{
                      flex: 1, fontSize: 12, fontWeight: 500,
                      color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                      paddingLeft: 8,
                    }}>
                      {isActive && <span style={{ marginRight: 4 }}>●</span>}
                      {t.label}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.3px',
                      color: isApplying ? 'var(--accent)' : isActive ? 'var(--accent)' : 'var(--text-faint)',
                    }}>
                      {isApplying ? '...' : isActive ? 'ACTIVE' : 'APPLY'}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Restart tour button ─────────────────────────────────────────────────────
function MobileRestartTour() {
  const { resetTour } = useSettings();
  return (
    <button className="mm-item" onClick={resetTour}>
      <span className="mm-item-icon" style={{ fontSize: 14 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
      </span>
      <span className="mm-item-label">Restart Onboarding Tour</span>
      <svg className="mm-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
    </button>
  );
}

// ── Mobile Discord Section ──────────────────────────────────────────────────
function MobileDiscordSection() {
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

  if (loading || !status?.configured) return null;

  const handleLink = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/discord/link', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  };

  return (
    <div className="mm-section">
      <div className="m-section-label" style={{ padding: '0 16px' }}>COMMUNITY</div>
      {status.linked ? (
        <div className="mm-item" style={{ pointerEvents: 'none' }}>
          <span className="mm-item-icon" style={{ color: '#5865F2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          </span>
          <span className="mm-item-label">Discord: {status.discordUsername}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#4caf50', letterSpacing: '0.3px' }}>LINKED</span>
        </div>
      ) : (
        <button className="mm-item" onClick={handleLink}>
          <span className="mm-item-icon" style={{ color: '#5865F2' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          </span>
          <span className="mm-item-label">Join our Discord</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#5865F2', letterSpacing: '0.3px' }}>CONNECT</span>
        </button>
      )}
    </div>
  );
}

MobileMoreScreen.displayName = 'MobileMoreScreen';

export default MobileMoreScreen;
