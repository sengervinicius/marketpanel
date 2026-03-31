/**
 * LoginScreen.jsx
 *
 * Full-screen sign-in / create account screen.
 *
 * Auth options:
 *   1. Continue with Apple  (Sign in with Apple — requires APPLE_CLIENT_ID on server)
 *   2. Username + password  (LOG IN)
 *   3. Username + password  (CREATE ACCOUNT)
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

// ── Apple Sign In SDK loader ─────────────────────────────────────────────────
// Apple's official JS library. Loaded only once, lazily.
function loadAppleSDK() {
  return new Promise((resolve) => {
    if (window.AppleID) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    s.onload = resolve;
    s.onerror = resolve; // fail silently — Apple button will show error state
    document.head.appendChild(s);
  });
}

// ── Apple logo SVG ────────────────────────────────────────────────────────────
function AppleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 814 1000" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.8 134.4-318 266.5-318 69.4 0 126.4 45.7 170 45.7 42.8 0 109.3-48.7 188.8-48.7 25.6 0 108.2 2.9 149.4 113.7zM549.8 119.1c-40.6 47.9-91.9 83.5-152.9 83.5-8.3 0-16.7-.6-25-1.9a6.9 6.9 0 01-.9-1.3c0-55.7 34-107.6 70.5-143.9 46.4-45.7 106-74.7 163.5-77.7 1 7.4 1.6 14.8 1.6 22.2 0 52.5-23.4 105-56.8 119.1z"/>
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LoginScreen({ children }) {
  const { user, login, register, loginWithApple } = useAuth?.() || {};

  const [mode,     setMode]     = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [shake,    setShake]    = useState(false);

  // Pre-load Apple SDK on mount so the button is ready
  useEffect(() => { loadAppleSDK(); }, []);

  if (user) return children;

  const triggerShake = (msg) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  // ── Username / password submit ─────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password, email);
      }
    } catch (err) {
      triggerShake(err.message || (mode === 'login' ? 'Login failed' : 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  // ── Apple Sign In ──────────────────────────────────────────────────────────
  const handleApple = async () => {
    setError('');
    setAppleLoading(true);
    try {
      await loadAppleSDK();

      if (!window.AppleID) {
        throw new Error('Apple Sign In is not available. Please try username/password login.');
      }

      const clientId   = import.meta.env.VITE_APPLE_CLIENT_ID;
      const redirectURI = import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin;

      if (!clientId) {
        throw new Error('Apple Sign In is not configured for this environment.');
      }

      window.AppleID.auth.init({
        clientId,
        scope:       'name email',
        redirectURI,
        usePopup:    true,
      });

      const response = await window.AppleID.auth.signIn();
      const identityToken = response.authorization?.id_token;
      const authorizationCode = response.authorization?.code;
      const appleUser = response.user || null; // only provided on first sign-in

      if (!identityToken) {
        throw new Error('Apple did not return an identity token. Please try again.');
      }

      await loginWithApple(identityToken, authorizationCode, appleUser);
    } catch (err) {
      // Apple popup closed by user — don't show error
      if (err.error === 'popup_closed_by_user' || err.type === 'popup_closed_by_user') {
        setAppleLoading(false);
        return;
      }
      // User cancelled
      if (err.error === 'user_cancelled_authorize') {
        setAppleLoading(false);
        return;
      }
      console.error('[Apple Sign In]', err);
      triggerShake(err.message || 'Apple Sign In failed. Please try username/password login.');
    } finally {
      setAppleLoading(false);
    }
  };

  const switchMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login');
    setError('');
    setUsername('');
    setPassword('');
    setEmail('');
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const S = {
    overlay: {
      position: 'fixed', inset: 0,
      backgroundColor: '#0a0a0f',
      backgroundImage: `
        linear-gradient(90deg, rgba(255,102,0,0.07) 1px, transparent 1px),
        linear-gradient(0deg,  rgba(255,102,0,0.07) 1px, transparent 1px)
      `,
      backgroundSize: '40px 40px',
      color: '#e0e0e0',
      fontFamily: '"IBM Plex Mono","Courier New",monospace',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '24px 16px',
    },
    logo: {
      textAlign: 'center',
      marginBottom: 36,
    },
    logoTitle: {
      fontSize: 52,
      color: '#ff6600',
      fontWeight: 'bold',
      letterSpacing: '0.04em',
      lineHeight: 1,
      marginBottom: 6,
    },
    logoSub: {
      fontSize: 9,
      color: '#555',
      letterSpacing: '0.18em',
    },
    card: {
      width: '100%',
      maxWidth: 320,
      animation: shake ? 'shake 0.5s' : 'none',
    },
    // "Continue with Apple" button
    appleBtn: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: '#fff',
      color: '#000',
      border: 'none',
      borderRadius: 6,
      padding: '11px 16px',
      fontSize: 13,
      fontWeight: 600,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      cursor: appleLoading ? 'wait' : 'pointer',
      opacity: appleLoading ? 0.75 : 1,
      marginBottom: 16,
      letterSpacing: '0.01em',
    },
    divider: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      background: '#222',
    },
    dividerText: {
      color: '#333',
      fontSize: 9,
      letterSpacing: '0.15em',
    },
    modeLabel: {
      color: '#444',
      fontSize: 8,
      letterSpacing: '0.2em',
      marginBottom: 12,
      textAlign: 'center',
    },
    error: {
      color: '#ff4444',
      fontSize: 10,
      marginBottom: 8,
      minHeight: 16,
      textAlign: 'center',
    },
    input: {
      width: '100%',
      backgroundColor: '#0d0d0d',
      border: '1px solid #2a2a2a',
      color: '#e0e0e0',
      padding: '10px 12px',
      fontFamily: 'inherit',
      fontSize: 12,
      marginBottom: 10,
      boxSizing: 'border-box',
      outline: 'none',
      borderRadius: 3,
    },
    primaryBtn: {
      width: '100%',
      backgroundColor: '#ff6600',
      color: '#000',
      border: 'none',
      borderRadius: 4,
      padding: '11px',
      cursor: loading ? 'not-allowed' : 'pointer',
      fontSize: 11,
      letterSpacing: '0.12em',
      fontWeight: 'bold',
      fontFamily: 'inherit',
      opacity: loading ? 0.6 : 1,
      marginBottom: 10,
    },
    // CREATE ACCOUNT / BACK TO SIGN IN secondary button
    secondaryBtn: {
      width: '100%',
      backgroundColor: 'transparent',
      color: '#888',
      border: '1px solid #282828',
      borderRadius: 4,
      padding: '10px',
      cursor: 'pointer',
      fontSize: 10,
      letterSpacing: '0.1em',
      fontFamily: 'inherit',
      marginBottom: 0,
    },
  };

  const isLogin = mode === 'login';

  return (
    <div style={S.overlay}>
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          25%      { transform: translateX(-7px); }
          75%      { transform: translateX(7px); }
        }
        input:focus {
          outline: none !important;
          border-color: #ff6600 !important;
          background-color: #111 !important;
        }
      `}</style>

      {/* Logo */}
      <div style={S.logo}>
        <div style={S.logoTitle}>SENGER</div>
        <div style={S.logoSub}>PROFESSIONAL MARKET DATA TERMINAL</div>
      </div>

      <div style={S.card}>

        {/* ── Continue with Apple ── */}
        <button
          type="button"
          style={S.appleBtn}
          onClick={handleApple}
          disabled={appleLoading || loading}
        >
          <AppleLogo />
          {appleLoading ? 'Connecting...' : 'Continue with Apple'}
        </button>

        {/* ── OR divider ── */}
        <div style={S.divider}>
          <div style={S.dividerLine} />
          <span style={S.dividerText}>OR</span>
          <div style={S.dividerLine} />
        </div>

        {/* ── Mode label ── */}
        <div style={S.modeLabel}>
          {isLogin ? 'SIGN IN WITH USERNAME' : 'CREATE YOUR ACCOUNT'}
        </div>

        {/* ── Error ── */}
        <div style={S.error}>{error}</div>

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} autoComplete="on">
          <input
            type="text"
            placeholder="USERNAME"
            value={username}
            onChange={e => setUsername(e.target.value)}
            style={S.input}
            disabled={loading}
            autoComplete="username"
            autoFocus
          />
          {!isLogin && (
            <input
              type="email"
              placeholder="EMAIL"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={S.input}
              disabled={loading}
              autoComplete="email"
            />
          )}
          <input
            type="password"
            placeholder="PASSWORD"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={S.input}
            disabled={loading}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          <button type="submit" style={S.primaryBtn} disabled={loading}>
            {loading
              ? (isLogin ? 'SIGNING IN...' : 'CREATING ACCOUNT...')
              : (isLogin ? 'LOG IN' : 'CREATE ACCOUNT')
            }
          </button>
        </form>

        {/* ── Switch mode button ── */}
        <button type="button" style={S.secondaryBtn} onClick={switchMode} disabled={loading}>
          {isLogin ? 'CREATE NEW ACCOUNT' : 'BACK TO SIGN IN'}
        </button>

      </div>
    </div>
  );
}
