import React, { memo } from 'react';

const MobileMoreScreen = memo(({
  onNavigate,
  user,
  onSettings,
  onLogout,
  onBilling,
  isPaid,
  subscription
}) => {
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
          {(user?.username || user?.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="mm-user-info">
          <div className="mm-user-name">{user?.username || user?.name || 'User'}</div>
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
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
          label="Charts"
          onClick={() => onNavigate('charts')}
        />
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
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>}
          label="Chat"
          onClick={() => onNavigate('chat')}
        />
      </div>

      {/* Settings & account */}
      <div className="mm-section">
        <div className="m-section-label" style={{ padding: '0 16px' }}>ACCOUNT</div>
        <MenuItem
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>}
          label="Settings"
          onClick={onSettings}
        />
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

      {/* Version footer */}
      <div className="mm-footer">
        Senger Market v2.1
      </div>
    </div>
  );
});

function MenuItem({ icon, label, onClick, subtle }) {
  return (
    <button className="mm-item" onClick={onClick} data-subtle={subtle || undefined}>
      <span className="mm-item-icon">{icon}</span>
      <span className="mm-item-label">{label}</span>
      <svg className="mm-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

MobileMoreScreen.displayName = 'MobileMoreScreen';

export default MobileMoreScreen;
