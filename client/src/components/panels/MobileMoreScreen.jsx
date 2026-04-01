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
  // Calculate trial days remaining if applicable
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

  // Menu item component
  const MenuItem = ({ icon, label, onClick }) => (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: '56px',
        width: '100%',
        padding: '0 16px',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255,102,0,0.08)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span style={{
        fontSize: '20px',
        color: '#666',
        marginRight: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
      }}>
        {icon}
      </span>
      <span style={{
        fontSize: '13px',
        color: '#ccc',
        fontFamily: 'inherit',
        fontWeight: '500',
        flex: 1,
        textAlign: 'left',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '18px',
        color: '#333',
        marginLeft: '8px',
      }}>
        ›
      </span>
    </button>
  );

  // Section divider
  const Divider = () => (
    <div style={{
      height: '1px',
      backgroundColor: '#1a1a1a',
      margin: '8px 0',
    }} />
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#060606',
      color: '#ccc',
      fontFamily: 'inherit',
      overflow: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      {/* User Section */}
      <div style={{
        padding: '16px',
        minHeight: '80px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <div style={{
          fontSize: '16px',
          fontWeight: '600',
          color: '#fff',
          marginBottom: '8px',
        }}>
          {user?.username || user?.name || 'User'}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            display: 'inline-block',
            padding: '4px 10px',
            backgroundColor: '#1a1a1a',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600',
            color: '#ff6600',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {subscriptionStatus}
          </span>
          {daysRemaining !== null && subscriptionStatus === 'TRIAL' && (
            <span style={{
              fontSize: '12px',
              color: '#999',
            }}>
              {daysRemaining} days left
            </span>
          )}
        </div>
      </div>

      {/* Main Menu Section */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
      }}>
        <MenuItem
          icon="🔍"
          label="Search & Discover"
          onClick={() => onNavigate('search')}
        />
        <MenuItem
          icon="📰"
          label="News Feed"
          onClick={() => onNavigate('news')}
        />
        <MenuItem
          icon="⊞"
          label="ETF Screener"
          onClick={() => onNavigate('etf')}
        />
        <MenuItem
          icon="💬"
          label="Chat"
          onClick={() => onNavigate('chat')}
        />
        <MenuItem
          icon="⚙"
          label="Settings"
          onClick={onSettings}
        />
      </div>

      <Divider />

      {/* Account Section */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 0',
        borderBottom: '1px solid #1a1a1a',
      }}>
        {isPaid && (
          <MenuItem
            icon="💳"
            label="Manage Subscription"
            onClick={onBilling}
          />
        )}
        <MenuItem
          icon="→"
          label="Log Out"
          onClick={onLogout}
        />
      </div>

      {/* Version Footer */}
      <div style={{
        padding: '16px',
        textAlign: 'center',
        fontSize: '10px',
        color: '#555',
        fontFamily: 'inherit',
      }}>
        Senger v2.0
      </div>
    </div>
  );
});

MobileMoreScreen.displayName = 'MobileMoreScreen';

export default MobileMoreScreen;
