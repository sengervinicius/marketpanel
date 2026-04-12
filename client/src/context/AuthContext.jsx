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

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { API_BASE } from '../utils/api';
import { isIOS } from '../services/platform';
import { purchase, restorePurchases, IAP_PRODUCTS } from '../services/iap';

const LS_USER  = 'arc_user';

const AuthContext = createContext(null);

/**
 * Normalize the raw subscription object from the server into the shape
 * that App.jsx components (TrialBanner, SubscriptionExpiredScreen) expect.
 *
 * Server returns: { isPaid, subscriptionActive, trialEndsAt }
 * Normalized:     { ...raw, status, trialDaysRemaining }
 *
 * status: 'active' | 'trial' | 'expired'
 */
function normalizeSubscription(raw) {
  if (!raw) return null;
  const now = Date.now();
  const trialEndsAt = raw.trialEndsAt ?? null;
  const trialDaysRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt - now) / 86400000))
    : 0;

  let status;
  if (raw.isPaid && raw.subscriptionActive) {
    status = 'active';
  } else if (trialEndsAt && now < trialEndsAt) {
    status = 'trial';
  } else {
    status = 'expired';
  }

  return { ...raw, status, trialDaysRemaining };
}

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [token,        setToken]        = useState(null);
  const [subscription, setSubscription] = useState(null);
  // authReady: false until we've completed the initial token validation check
  const [authReady,    setAuthReady]    = useState(false);

  // ── Automatic token refresh ──────────────────────────────────────────────────
  const refreshInterval = useRef(null);

  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        // Refresh failed — session expired
        setUser(null);
        setToken(null);
        setSubscription(null);
        localStorage.removeItem(LS_USER);
        return;
      }
      const data = await res.json();
      setToken(data.token); // Update in-memory token for WS
      if (data.user) {
        setUser({ id: data.user.id, username: data.user.username, persona: data.user.persona || null });
      }
    } catch (e) {
      console.error('[AuthContext] Token refresh failed:', e);
    }
  }, []);

  // ── On mount: validate session via httpOnly cookie ─────────────────────────
  useEffect(() => {
    // Validate session via httpOnly cookie (sent automatically)
    fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('session invalid');
        const data = await res.json();
        // Session is valid — restore user + subscription
        const restoredUser = { id: data.user.id, username: data.user.username, persona: data.user.persona || null };
        setUser(restoredUser);
        // Token comes from server response for WebSocket use
        setToken(data.token || null);
        setSubscription(normalizeSubscription(data.subscription));
        // Keep localStorage in sync with server-fresh user object
        localStorage.setItem(LS_USER, JSON.stringify(restoredUser));
      })
      .catch(() => {
        // Session invalid or expired — clear everything
        localStorage.removeItem(LS_USER);
        setUser(null);
        setToken(null);
        setSubscription(null);
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, []); // runs once on mount

  // ── Refresh access token every 13 minutes (token expires at 15m) ────────────
  useEffect(() => {
    if (user) {
      refreshInterval.current = setInterval(refreshToken, 13 * 60 * 1000);
      return () => clearInterval(refreshInterval.current);
    }
  }, [user, refreshToken]);

  // ── Check for billing URL params on mount ─────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingStatus = params.get('billing');

    if (billingStatus === 'success') {
      // User successfully completed checkout
      // Delay the refresh slightly to allow server-side updates to settle
      setTimeout(() => {
        refreshSubscription();
      }, 1000);
      // Clean up URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (billingStatus === 'cancelled') {
      // User cancelled checkout
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []); // runs once on mount

  // ── Refresh subscription status ───────────────────────────────────────────
  const refreshSubscription = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/status`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to refresh subscription');
      const data = await res.json();
      setSubscription(normalizeSubscription(data));
    } catch (err) {
      console.error('Error refreshing subscription:', err);
    }
  }, []);

  // ── Persist helper ────────────────────────────────────────────────────────
  const _persist = useCallback((userObj, tok, sub) => {
    setUser(userObj);
    setToken(tok);  // Keep in memory for WebSocket
    setSubscription(normalizeSubscription(sub));
    // User info kept in localStorage for quick UI restore (non-sensitive)
    localStorage.setItem(LS_USER, JSON.stringify(userObj));
    // Token is now in httpOnly cookie — no longer stored in localStorage
  }, []);

  // ── Auth response helper ─────────────────────────────────────────────────
  // Validates that the server returned a well-formed auth response.
  // Throws a user-friendly message when the server is unreachable or the
  // client is pointing at the wrong URL (e.g. VITE_API_URL not set).
  function _extractUser(data, res, fallbackMsg) {
    if (!res.ok) throw new Error(data?.error || fallbackMsg);
    if (!data?.user?.id) {
      // Server returned 200 but no user — likely a misconfigured API URL
      // (e.g. request hit the static host instead of the Express server).
      throw new Error(
        'Server returned an unexpected response. ' +
        'Make sure VITE_API_URL is set to the backend URL in your Render environment.'
      );
    }
    return data;
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    const res  = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    _extractUser(data, res, 'Login failed');
    _persist({ id: data.user.id, username: data.user.username, persona: data.user.persona || null }, data.token, data.subscription);
    return data;
  }, [_persist]);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (username, password, email) => {
    const res  = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email }),
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    _extractUser(data, res, 'Registration failed');
    _persist({ id: data.user.id, username: data.user.username, persona: data.user.persona || null }, data.token, data.subscription);
    return data;
  }, [_persist]);

  // ── Login with Apple ──────────────────────────────────────────────────────
  const loginWithApple = useCallback(async (identityToken, authorizationCode, appleUser) => {
    const res = await fetch(`${API_BASE}/api/auth/apple`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken, authorizationCode, user: appleUser }),
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    _extractUser(data, res, 'Apple Sign In failed');
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription);
    return data;
  }, [_persist]);


  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) { /* best-effort */ }
    setUser(null);
    setToken(null);
    setSubscription(null);
    localStorage.removeItem(LS_USER);
  }, []);

  // ── Platform-aware checkout ────────────────────────────────────────────────
  const startCheckout = useCallback(async (productId) => {
    // iOS native → Apple IAP
    if (isIOS()) {
      const result = await purchase(productId || IAP_PRODUCTS.MONTHLY);
      if (result.ok) {
        await refreshSubscription();
      } else {
        alert(result.error || 'Purchase failed. Please try again.');
      }
      return;
    }

    // Web / Android → Stripe
    const res  = await fetch(`${API_BASE}/api/billing/create-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await res.json();

    if (!res.ok || !data.checkoutUrl) {
      // Surface error via throw — UI components handle it via billingState
      const msg = data?.configured === false
        ? 'Subscription setup is not yet available. We will notify you when it is ready.'
        : data?.error || 'Could not start checkout. Please try again later.';
      throw new Error(msg);
    }

    window.location.href = data.checkoutUrl;
  }, []);

  // ── Open Stripe billing portal (manage saved cards, invoices, cancel) ─────
  const openBillingPortal = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });
    const data = await res.json();
    if (data.portalUrl) {
      window.location.href = data.portalUrl;
    } else {
      throw new Error('Billing portal is not yet available.');
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, token, subscription, authReady, login, register, loginWithApple, logout, startCheckout, openBillingPortal, refreshSubscription, restorePurchases, billingPlatform: isIOS() ? 'apple' : 'stripe' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
