import { useState, useEffect } from 'react';

// ── Feed Status Bar ──────────────────────────────────────────────────────────
export function FeedStatusBar({ feedStatus }) {
  const feeds = [
    { key: 'stocks', label: 'STOCKS' },
    { key: 'forex',  label: 'FX' },
    { key: 'crypto', label: 'CRYPTO' },
  ];
  const getLevel = (val) => {
    if (!val) return 'connecting';
    if (typeof val === 'string') return val;
    return val.level || 'connecting';
  };
  const getLatencyText = (val) => {
    if (!val || typeof val === 'string') return null;
    const ms = val.latencyMs;
    if (ms == null) return null;
    if (ms < 1000) return '<1s';
    if (ms < 5000) return `~${Math.round(ms / 1000)}s`;
    return `>${Math.round(ms / 1000)}s`;
  };
  const color = (level) => {
    if (level === 'live')      return '#00cc66';
    if (level === 'degraded')  return '#ff9900';
    if (level === 'delayed')   return '#ffcc00';
    if (level === 'closed')    return '#666';
    if (level === 'error')     return '#ff3333';
    return '#444';
  };
  const dot = (level) => {
    if (level === 'live')     return '●';
    if (level === 'degraded') return '◐';
    if (level === 'delayed')  return '◑';
    if (level === 'closed')   return '⊙';
    if (level === 'error')    return '✕';
    return '○';
  };
  return (
    <div style={{
      height: 20, flexShrink: 0,
      background: '#060606', borderTop: '1px solid #1a1a1a',
      padding: '0 12px', gap: 20,
      position: 'fixed', bottom: 0, left: 0, right: 0,
      zIndex: 50,
    }} className="flex-row">
      <span style={{ color: '#282828', fontSize: 8, letterSpacing: '1px' }}>FEED</span>
      {feeds.map(({ key, label }) => {
        const val = feedStatus?.[key];
        const level = getLevel(val);
        const latency = getLatencyText(val);
        return (
          <span key={key} className="flex-row gap-4">
            <span style={{ color: color(level), fontSize: 9 }}>{dot(level)}</span>
            <span style={{ color: '#3a3a3a', fontSize: 8, letterSpacing: '0.8px' }}>{label}</span>
            <span style={{ color: color(level), fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', opacity: 0.9 }}>
              {level.toUpperCase()}
            </span>
            {latency && (
              <span style={{ color: '#555', fontSize: 7, letterSpacing: '0.3px' }}>{latency}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Data Error Banner — shown when all market feeds are down ─────────────────
// This surfaces HTTP 402/403/401/network errors that were previously invisible,
// causing users to see blank panels with no explanation.
export function DataErrorBanner({ error, endpointErrors }) {
  if (!error) return null;
  // Subscription expired is already handled by SubscriptionExpiredScreen + TrialBanner
  if (error === 'subscription_required') return null;

  let msg, detail;
  if (error === 'api_key_invalid') {
    msg    = 'MARKET DATA UNAVAILABLE';
    detail = 'Server API key not configured (HTTP 403). Contact support or check POLYGON_API_KEY env var.';
  } else if (error === 'auth_required') {
    msg    = 'SESSION EXPIRED';
    detail = 'Your session is no longer valid (HTTP 401). Please log out and log in again.';
  } else if (error === 'Data endpoints unreachable') {
    msg    = 'FEED UNREACHABLE';
    detail = 'Cannot connect to market data server. Check your network or server status.';
  } else if (error === 'ratelimit') {
    msg    = 'RATE LIMITED';
    detail = 'Upstream provider is rate limiting requests. Serving cached data where possible.';
  } else if (error === 'timeout') {
    msg    = 'DATA DELAYED';
    detail = 'Upstream provider did not respond in time. Charts and snapshots may be stale.';
  } else {
    // Generic: show the raw error string (includes endpoint path + HTTP status)
    msg    = 'MARKET DATA ERROR';
    detail = error;
  }

  // Also show which individual feeds are failing (non-null entries)
  const failingFeeds = Object.entries(endpointErrors || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join('  |  ');

  return (
    <div className="flex-row" style={{
      background: '#1a0000', borderBottom: '1px solid #ff333344',
      gap: 10,
      padding: '4px 12px', flexShrink: 0, flexWrap: 'wrap',
    }}>
      <span className="app-alert-label">⚠ {msg}</span>
      <span className="app-alert-detail">{detail}</span>
      {failingFeeds && (
        <span className="app-alert-count">{failingFeeds}</span>
      )}
    </div>
  );
}

// ── Trial / Subscription banner ──────────────────────────────────────────────
export function TrialBanner({ subscription, onUpgrade, onManageBilling, billingState }) {
  if (!subscription) return null;
  if (subscription.status === 'active' && !billingState?.showSuccess) return null;

  const days = subscription.trialDaysRemaining ?? 0;
  if (subscription.status === 'trial' && days <= 0) return null;

  const isExpired = subscription.status === 'expired';
  const isPaid = subscription.status === 'active';
  const isLoading = billingState?.isLoading;
  const showSuccess = billingState?.showSuccess;
  const checkoutError = billingState?.error;

  let msg, bg, clr;
  if (showSuccess) {
    msg = 'Verifying your subscription...';
    bg = '#003300';
    clr = '#44ff44';
  } else if (isExpired) {
    msg = 'TRIAL EXPIRED — Subscribe to continue';
    bg = '#3a0000';
    clr = '#ff4444';
  } else if (isPaid) {
    msg = 'ACTIVE SUBSCRIPTION';
    bg = '#003300';
    clr = '#44ff44';
  } else {
    msg = `FREE TRIAL: ${days} day${days !== 1 ? 's' : ''} remaining`;
    bg = '#1a1000';
    clr = '#ff9900';
  }

  return (
    <div className="flex-row" style={{
      background: bg, borderBottom: `1px solid ${clr}44`,
      justifyContent: 'center', gap: 12,
      padding: '3px 12px', flexShrink: 0, flexWrap: 'wrap',
    }}>
      {checkoutError && (
        <span style={{ color: '#ff4444', fontSize: 8, letterSpacing: '0.5px', fontWeight: 600 }}>
          Error: {checkoutError}
        </span>
      )}
      {!checkoutError && (
        <>
          <span style={{ color: clr, fontSize: 8, letterSpacing: '0.8px', fontWeight: 700 }}>{msg}</span>
          {isLoading ? (
            <span style={{ color: clr, fontSize: 8, fontWeight: 600 }}>Setting up...</span>
          ) : (
            <>
              {!isPaid && !showSuccess && (
                <button className="btn"
                  onClick={onUpgrade}
                  style={{
                    background: 'var(--color-particle, #F97316)', border: 'none', color: '#000',
                    fontWeight: 700 }}
                >UPGRADE →</button>
              )}
              {isPaid && onManageBilling && (
                <button className="btn"
                  onClick={onManageBilling}
                  style={{
                    background: 'transparent', border: `1px solid ${clr}`, color: clr,
                    fontWeight: 700 }}
                >MANAGE BILLING</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Subscription Expired Screen ──────────────────────────────────────────────
export function SubscriptionExpiredScreen({ onUpgrade, onLogout, onManageBilling, checkoutState, subscription, onRestore, billingPlatform }) {
  const [isLoading, setIsLoading] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState(null);
  const isLoadingCheckout = checkoutState?.isLoading || isLoading;
  const checkoutError = checkoutState?.error;
  const hasStripeCustomerId = subscription?.stripeCustomerId;
  const isApple = billingPlatform === 'apple';

  const handleUpgrade = async () => {
    setIsLoading(true);
    try {
      await onUpgrade();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-col app-error-state" style={{
      flex: 1, background: '#0a0a0a',
    }}>
      <div className="app-error-icon">⊘</div>
      <div className="app-error-title">
        SUBSCRIPTION REQUIRED
      </div>
      <div className="app-error-message">
        Your free trial has ended. Subscribe to Particle to continue accessing real-time data.
      </div>
      {checkoutError && (
        <div className="app-error-detail">
          Error: {checkoutError}
        </div>
      )}
      <div className="flex-row app-button-group">
        <button className="btn"
          onClick={handleUpgrade}
          disabled={isLoadingCheckout}
          style={{
            background: isLoadingCheckout ? '#aa4400' : 'var(--color-particle, #F97316)',
            border: 'none', color: '#000',
            fontWeight: 700, padding: '8px 20px', cursor: isLoadingCheckout ? 'not-allowed' : 'pointer', opacity: isLoadingCheckout ? 0.7 : 1,
          }}
        >{isLoadingCheckout ? 'Setting up...' : 'SUBSCRIBE NOW →'}</button>
        {hasStripeCustomerId && onManageBilling && !isApple && (
          <button className="btn app-btn-secondary"
            onClick={onManageBilling}
          >MANAGE BILLING</button>
        )}
        {isApple && onRestore && (
          <button className="btn app-btn-secondary"
            onClick={async () => {
              setRestoreMsg(null);
              const result = await onRestore();
              setRestoreMsg(result.restored ? 'Subscription restored!' : 'No previous purchases found.');
            }}
          >RESTORE PURCHASES</button>
        )}
        <button className="btn"
          onClick={onLogout}
          style={{
            background: 'none', border: '1px solid #2a2a2a', color: '#444',
            padding: '8px 14px',
          }}
        >LOG OUT</button>
      </div>
      {restoreMsg && (
        <div style={{ color: '#888', marginTop: 8 }}>{restoreMsg}</div>
      )}
    </div>
  );
}

// ── Welcome Subscription Modal (shown on first login) ────────────────────────
// Offers "Subscribe" or "Start Free Trial" after a user's first login.
const LS_WELCOME_SHOWN = 'particle_welcome_sub_shown';

export function WelcomeSubscriptionModal({ subscription, onUpgrade, onDismiss }) {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Migrate legacy key
    try { const v = localStorage.getItem('senger_welcome_sub_shown'); if (v !== null) { localStorage.setItem('particle_welcome_sub_shown', v); localStorage.removeItem('senger_welcome_sub_shown'); } } catch {}
    // Only show once, only for trial users who haven't seen it
    if (!subscription) return;
    if (subscription.status === 'active') return; // already subscribed
    if (localStorage.getItem(LS_WELCOME_SHOWN) === '1') return;
    // Delay slightly so the app finishes loading first
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, [subscription]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(LS_WELCOME_SHOWN, '1');
    setVisible(false);
    onDismiss?.();
  };

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    localStorage.setItem(LS_WELCOME_SHOWN, '1');
    try {
      await onUpgrade();
    } catch (err) {
      setError(err?.message || 'Could not start checkout.');
      setLoading(false);
    }
  };

  const days = subscription?.trialDaysRemaining ?? 7;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(4px)',
    }} onClick={dismiss}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0c0c0f', border: '1px solid #1a1a1a',
        borderRadius: 12, padding: '36px 32px', maxWidth: 380, width: '90%',
        textAlign: 'center', color: '#e0e0e0',
        fontFamily: 'var(--font-ui, -apple-system, sans-serif)',
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6)',
      }}>
        <div style={{ fontSize: 32, color: '#F97316', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 8 }}>
          PARTICLE
        </div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 28, lineHeight: 1.6 }}>
          Real-time market data, AI insights, and deep sector analysis — all in one terminal.
        </div>

        {/* Error message */}
        {error && (
          <div style={{ color: '#ff6666', fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {/* Subscribe button */}
        <button
          onClick={handleSubscribe}
          disabled={loading}
          style={{
            width: '100%', padding: '13px 20px', marginBottom: 10,
            background: loading ? '#aa4400' : 'linear-gradient(180deg, #F97316 0%, #e55a00 100%)',
            color: '#000', border: 'none', borderRadius: 8,
            fontWeight: 700, fontSize: 12, letterSpacing: '0.1em',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {loading ? 'SETTING UP...' : 'SUBSCRIBE NOW'}
        </button>

        {/* Free trial button */}
        <button
          onClick={dismiss}
          style={{
            width: '100%', padding: '11px 20px', marginBottom: 0,
            background: 'transparent', color: '#666',
            border: '1px solid #1a1a1a', borderRadius: 8,
            fontWeight: 600, fontSize: 11, letterSpacing: '0.08em',
            cursor: 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          START FREE TRIAL ({days} DAYS)
        </button>

        <div style={{ marginTop: 16, fontSize: 9, color: '#333', letterSpacing: '0.05em' }}>
          Cancel anytime. No commitment.
        </div>
      </div>
    </div>
  );
}
