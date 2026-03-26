/**
 * AuthContext.jsx
 * Manages user authentication state. Provides login/register/logout + subscription info.
 *
 * Session persistence: On mount, reads the stored token and calls /api/auth/me to
 * validate it. If valid, restores user + subscription without requiring re-login.
 * If invalid/expired, clears storage and shows the login screen.
 *
 * authReady: boolean — true once the initial /api/auth/me check completes (or there
 * was no token to check). Use this to avoid flashing login screen on refresh.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../utils/api';

const LS_USER  = 'arc_user';
const LS_TOKEN = 'arc_token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [token,        setToken]        = useState(null);
  const [subscription, setSubscription] = useState(null);
  // authReady: false until we've completed the initial token validation check
  const [authReady,    setAuthReady]    = useState(false);

  // ── On mount: validate stored token ──────────────────────────────────────
  useEffect(() => {
    const storedToken = localStorage.getItem(LS_TOKEN);
    if (!storedToken) {
      setAuthReady(true);
      return;
    }

    // Validate token by calling /api/auth/me
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('token invalid');
        const data = await res.json();
        // Token is valid — restore user + subscription
        const restoredUser = { id: data.user.id, username: data.user.username };
        setUser(restoredUser);
        setToken(storedToken);
        setSubscription(data.subscription || null);
        // Keep localStorage in sync with server-fresh user object
        localStorage.setItem(LS_USER, JSON.stringify(restoredUser));
      })
      .catch(() => {
        // Token invalid or expired — clear everything
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_TOKEN);
        setUser(null);
        setToken(null);
        setSubscription(null);
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []); // runs once on mount

  // ── Persist helper ────────────────────────────────────────────────────────
  const _persist = useCallback((userObj, tok, sub) => {
    setUser(userObj);
    setToken(tok);
    setSubscription(sub || null);
    localStorage.setItem(LS_USER,  JSON.stringify(userObj));
    localStorage.setItem(LS_TOKEN, tok);
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    const res  = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, [_persist]);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (username, password) => {
    const res  = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, [_persist]);

  // ── Login with Apple ──────────────────────────────────────────────────────
  const loginWithApple = useCallback(async (identityToken, authorizationCode, appleUser) => {
    const res = await fetch(`${API_BASE}/api/auth/apple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken, authorizationCode, user: appleUser }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Apple Sign In failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, [_persist]);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setSubscription(null);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_TOKEN);
  }, []);

  // ── Start checkout ────────────────────────────────────────────────────────
  const startCheckout = useCallback(async () => {
    const tok = localStorage.getItem(LS_TOKEN);
    try {
      const res  = await fetch(`${API_BASE}/api/billing/create-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        alert('Subscription checkout is not yet configured. Please contact support.');
      }
    } catch {
      alert('Could not initiate checkout. Please try again later.');
    }
  }, []);

  // ── Open Stripe billing portal (manage saved cards, invoices, cancel) ─────
  const openBillingPortal = useCallback(async () => {
    const tok = localStorage.getItem(LS_TOKEN);
    try {
      const res  = await fetch(`${API_BASE}/api/billing/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      });
      const data = await res.json();
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
      } else {
        alert('Billing portal not yet configured. Contact vinicius@arccapital.com.br');
      }
    } catch {
      alert('Could not open billing portal. Please try again later.');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, subscription, authReady, login, register, loginWithApple, logout, startCheckout, openBillingPortal }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
