/**
 * LoginScreen.jsx
 *
 * Premium futuristic landing + auth screen.
 * Centered login with Apple ID, animated video background
 * with orange volumetric blobs, glassmorphism card, floating particles.
 */

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { isIOS, isNative } from '../../services/platform';
import './LoginScreen.css';

// ── Apple Sign In SDK loader ─────────────────────────────────────────────────
function loadAppleSDK() {
  if (isNative() && isIOS()) return Promise.resolve();
  return new Promise((resolve) => {
    if (window.AppleID) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    s.onload = resolve;
    s.onerror = resolve;
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

// ── Floating particles — soft glowing dots ───────────────────────────────────
function Particles() {
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const particles = [];
    const COUNT = 28;

    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('div');
      p.className = 'ls-particle';
      const size = 1 + Math.random() * 2.5;
      const x = Math.random() * 100;
      const duration = 14 + Math.random() * 22;
      const delay = Math.random() * duration;
      p.style.cssText = `
        left: ${x}%;
        bottom: -4px;
        width: ${size}px;
        height: ${size}px;
        animation-duration: ${duration}s;
        animation-delay: -${delay}s;
        opacity: ${0.15 + Math.random() * 0.35};
        box-shadow: 0 0 ${3 + size * 2}px rgba(255, 120, 40, ${0.15 + Math.random() * 0.2});
      `;
      el.appendChild(p);
      particles.push(p);
    }

    return () => particles.forEach(p => p.remove());
  }, []);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 3 }} />;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LoginScreen({ children }) {
  const { user, login, register, loginWithApple } = useAuth?.() || {};

  const [mode,     setMode]     = useState('login');
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [shake,    setShake]    = useState(false);

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
      let identityToken, authorizationCode, appleUser;

      if (isNative() && isIOS()) {
        try {
          const pluginId = '@capacitor-community' + '/apple-sign-in';
          const mod = await import(/* @vite-ignore */ pluginId);
          const SignInWithApple = mod.SignInWithApple || mod.default;
          const result = await SignInWithApple.authorize({
            clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.senger.market',
            redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin,
            scopes: 'email name',
          });
          identityToken = result.response?.identityToken;
          authorizationCode = result.response?.authorizationCode;
          appleUser = result.response?.givenName
            ? { name: { firstName: result.response.givenName, lastName: result.response.familyName }, email: result.response.email }
            : null;
        } catch (nativeErr) {
          console.warn('[Apple Sign In] Native plugin not available', nativeErr);
          throw new Error('Native Apple Sign In failed. Please try again.');
        }
      } else {
        if (!window.AppleID) {
          throw new Error('Apple Sign In is not available. Please try username/password login.');
        }
        const clientId = import.meta.env.VITE_APPLE_CLIENT_ID;
        const redirectURI = import.meta.env.VITE_APPLE_REDIRECT_URI || window.location.origin;
        if (!clientId) {
          throw new Error('Apple Sign In is not configured for this environment.');
        }
        window.AppleID.auth.init({ clientId, scope: 'name email', redirectURI, usePopup: true });
        const response = await window.AppleID.auth.signIn();
        identityToken = response.authorization?.id_token;
        authorizationCode = response.authorization?.code;
        appleUser = response.user || null;
      }

      if (!identityToken) {
        throw new Error('Apple did not return an identity token. Please try again.');
      }
      await loginWithApple(identityToken, authorizationCode, appleUser);
    } catch (err) {
      if (err.error === 'popup_closed_by_user' || err.type === 'popup_closed_by_user') { setAppleLoading(false); return; }
      if (err.error === 'user_cancelled_authorize') { setAppleLoading(false); return; }
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

  const isLogin = mode === 'login';

  return (
    <div className="ls-overlay">
      {/* Background video — orange volumetric blobs, visible and ambient */}
      <video
        className="ls-video-bg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster=""
      >
        <source src="/video.mp4" type="video/mp4" />
      </video>
      <div className="ls-video-overlay" />

      <Particles />

      <div className="ls-content">
        {/* Logo */}
        <div className="ls-logo">
          <div className="ls-logo-title">SENGER</div>
        </div>

        {/* Catchphrase */}
        <div className="ls-catchphrase">
          <div className="ls-catchphrase-main">
            <span className="ls-catchphrase-accent">Powerful tools, honest pricing.</span>
            <br />
            We're here to debunk the status quo.
          </div>
        </div>

        {/* Login card */}
        <div className={`ls-card ${shake ? 'ls-shake' : ''}`}>

          {/* Continue with Apple */}
          <button
            type="button"
            className="ls-apple-btn"
            onClick={handleApple}
            disabled={appleLoading || loading}
          >
            <AppleLogo />
            {appleLoading ? 'Connecting...' : 'Continue with Apple'}
          </button>

          {/* OR divider */}
          <div className="ls-divider">
            <div className="ls-divider-line" />
            <span className="ls-divider-text">OR</span>
            <div className="ls-divider-line" />
          </div>

          {/* Mode label */}
          <div className="ls-mode-label">
            {isLogin ? 'SIGN IN WITH USERNAME' : 'CREATE YOUR ACCOUNT'}
          </div>

          {/* Error */}
          {error && <div className="ls-error">{error}</div>}

          {/* Form */}
          <form onSubmit={handleSubmit} autoComplete="on">
            <input
              type="text"
              placeholder="USERNAME"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="ls-input"
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
                className="ls-input"
                disabled={loading}
                autoComplete="email"
              />
            )}
            <input
              type="password"
              placeholder="PASSWORD"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="ls-input"
              disabled={loading}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
            <button type="submit" className="ls-primary-btn" disabled={loading}>
              {loading
                ? (isLogin ? 'SIGNING IN...' : 'CREATING ACCOUNT...')
                : (isLogin ? 'LOG IN' : 'CREATE ACCOUNT')
              }
            </button>
          </form>

          {/* Switch mode */}
          <button type="button" className="ls-secondary-btn" onClick={switchMode} disabled={loading}>
            {isLogin ? 'CREATE NEW ACCOUNT' : 'BACK TO SIGN IN'}
          </button>
        </div>
      </div>
    </div>
  );
}
