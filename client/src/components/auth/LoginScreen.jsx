/**
 * LoginScreen.jsx
 *
 * Phase 2: Cinematic landing page + authentication.
 * Minimal, mysterious, dark. Video background with hero copy,
 * outlined CTA, video modal shell, barely-visible footer.
 * Auth form appears as overlay when user clicks "Enter" or "Sign in".
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../utils/api';
import { isIOS, isNative } from '../../services/platform';
import './LoginScreen.css';

// ── Helpers ─────────────────────────────────────────────────────────────────
function isNetworkError(msg) {
  return /load failed|failed to fetch|networkerror|timed out|network request failed/i.test(msg);
}

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

// ── Video Modal ──────────────────────────────────────────────────────────────
function VideoModal({ onClose }) {
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="lp-video-modal" onClick={onClose}>
      <div className="lp-video-modal-inner" onClick={(e) => e.stopPropagation()}>
        <button className="lp-video-modal-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        <div className="lp-video-modal-placeholder">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.2 }}>
            <circle cx="24" cy="24" r="23" stroke="white" strokeWidth="1" />
            <path d="M20 16l14 8-14 8V16z" fill="white" />
          </svg>
          <span className="lp-video-modal-text">Demo reel — coming soon</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LoginScreen({ children }) {
  const { user, login, register, loginWithApple } = useAuth?.() || {};

  // Landing vs auth form state
  const [showAuth, setShowAuth] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);

  // Auth form state
  const [mode,     setMode]     = useState('login');
  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [shake,    setShake]    = useState(false);

  const [serverReady, setServerReady] = useState(false);
  const [warmingUp,   setWarmingUp]  = useState(false);

  // Hero entrance animation
  const [heroReady, setHeroReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHeroReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  // ── On mount: ping server to wake it (Render cold-start) + load Apple SDK ──
  useEffect(() => {
    loadAppleSDK();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(40000) });
        if (!cancelled && res.ok) setServerReady(true);
      } catch {
        // Server still cold — login retry loop will handle it
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (user) return children;

  const triggerShake = (msg) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const openAuth = () => {
    setShowAuth(true);
    setError('');
  };

  const closeAuth = () => {
    setShowAuth(false);
    setError('');
    setUsername('');
    setPassword('');
    setEmail('');
    setMode('login');
  };

  // ── Username / password submit — with automatic retry on cold-start ────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const MAX_RETRIES = 3;
    const BACKOFF = [0, 3000, 5000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          setWarmingUp(true);
          setError(`Server is waking up... attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
          await new Promise(r => setTimeout(r, BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)]));
        }

        if (mode === 'login') {
          await login(username, password);
        } else {
          await register(username, password, email);
        }

        setWarmingUp(false);
        return;
      } catch (err) {
        const msg = err.message || (mode === 'login' ? 'Login failed' : 'Registration failed');

        if (!isNetworkError(msg) || attempt === MAX_RETRIES) {
          setWarmingUp(false);
          triggerShake(
            isNetworkError(msg) ? 'Server is unreachable. Please check your connection and try again.' : msg
          );
          break;
        }
      }
    }

    setLoading(false);
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
            clientId: import.meta.env.VITE_APPLE_CLIENT_ID || 'com.particle.market',
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
    <div className="lp-root">
      {/* ── Video background ─────────────────────────────────────────────── */}
      <video
        className="lp-video-bg"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster=""
      >
        <source src="/video.mp4" type="video/mp4" />
      </video>
      <div className="lp-video-overlay" />

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <nav className="lp-topbar">
        <div className="lp-topbar-logo">PARTICLE</div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <main className={`lp-hero ${heroReady ? 'lp-hero--visible' : ''}`}>
        <h1 className="lp-headline">
          cutting through market chaos.
        </h1>
        <p className="lp-subline">
          AI-Powered Market Terminal - built to disturb consensus
        </p>
        <div className="lp-hero-actions">
          <button className="lp-enter-btn" onClick={openAuth} type="button">
            Enter
          </button>
          <button className="lp-watch-btn" onClick={() => setShowVideoModal(true)} type="button">
            Understand Particle
            <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" style={{ marginLeft: 6 }}>
              <path d="M0 0l10 6-10 6V0z" />
            </svg>
          </button>
        </div>
      </main>

      {/* ── Auth overlay ─────────────────────────────────────────────────── */}
      {showAuth && (
        <div className="lp-auth-backdrop" onClick={closeAuth}>
          <div className={`lp-auth-card ${shake ? 'ls-shake' : ''}`} onClick={(e) => e.stopPropagation()}>
            <button className="lp-auth-back" onClick={closeAuth} type="button" aria-label="Back to landing">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 2L4 7l5 5" />
              </svg>
            </button>

            <div className="lp-auth-logo">PARTICLE</div>

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
                  ? (warmingUp ? 'CONNECTING TO SERVER...' : (isLogin ? 'SIGNING IN...' : 'CREATING ACCOUNT...'))
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
      )}

      {/* ── Video modal ──────────────────────────────────────────────────── */}
      {showVideoModal && <VideoModal onClose={() => setShowVideoModal(false)} />}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <span className="lp-footer-copy">&copy; 2026 Particle</span>
        <div className="lp-footer-links">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="https://status.particle.investments" target="_blank" rel="noopener noreferrer">Status</a>
          <a href="https://roadmap.particle.investments" target="_blank" rel="noopener noreferrer">Roadmap</a>
        </div>
      </footer>
    </div>
  );
}
