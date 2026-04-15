/**
 * AuthContext.jsx
 * Manages user authentication state. Provides login/register/logout + subscription info.
 *
 * DUAL AUTH STRATEGY:
 * - Sets httpOnly cookies via `credentials: 'include'` (works when cookies aren't blocked)
 * - Stores token in memory and sends via Authorization header (works on mobile Safari/ITP)
 * - Both are sent on every request; server accepts whichever arrives first
 *
 * Session persistence: On mount, reads the stored token and calls /api/auth/me to
 * validate it. If valid, restores user + subscription without requiring re-login.
 * If invalid/expired, clears storage and shows the login screen.
 *
 * authReady: boolean — true once the initial /api/auth/me check completes (or there
 * was no token to check). Use this to avoid flashing login screen on refresh.
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { API_BASE, setAuthToken, clearAuthToken } from '../utils/api';
import { isIOS } from '../services/platform';
import { purchase, restorePurchases, IAP_PRODUCTS } from '../services/iap';

const LS_USER    = 'arc_user';
const LS_TOKEN   = 'arc_token';   // Stored for session restore across page reloads
const LS_REFRESH = 'arc_refresh'; // Refresh token for mobile Safari where cookies are blocked

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

  return { ...raw, status, trialDaysRemaining, tier: raw.tier || null, tierLabel: raw.tierLabel || null, limits: raw.limits || null };
}

/**
 * Helper: build headers with Authorization if we have a token.
 */
function authHeaders(token, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [token,        setToken]        = useState(() => {
    // Restore token from localStorage on mount for immediate header-based auth
    try { return localStorage.getItem(LS_TOKEN) || null; } catch { return null; }
  });
  const [subscription, setSubscription] = useState(null);
  // authReady: false until we've completed the initial token validation check
  const [authReady,    setAuthReady]    = useState(false);

  // Keep the api.js module token in sync with React state
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
    setAuthToken(token);
    // Persist token to localStorage for cross-reload restore
    try {
      if (token) localStorage.setItem(LS_TOKEN, token);
      else localStorage.removeItem(LS_TOKEN);
    } catch {}
  }, [token]);

  // ── Automatic token refresh ──────────────────────────────────────────────────
  const refreshInterval = useRef(null);

  const refreshTokenFn = useCallback(async () => {
    try {
      // Send stored refresh token in body (mobile Safari fallback where cookies are blocked)
      let storedRefresh = null;
      try { storedRefresh = localStorage.getItem(LS_REFRESH); } catch {}

      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: authHeaders(tokenRef.current),
        body: JSON.stringify({ refreshToken: storedRefresh }),
        credentials: 'include',
      });
      if (!res.ok) {
        // Only logout on 401 (session truly expired). 5xx, 429, etc. are transient — retry next cycle.
        if (res.status === 401) {
          setUser(null);
          setToken(null);
          setSubscription(null);
          localStorage.removeItem(LS_USER);
          localStorage.removeItem(LS_TOKEN);
          localStorage.removeItem(LS_REFRESH);
          clearAuthToken();
        } else {
          console.warn(`[AuthContext] Token refresh returned ${res.status}, will retry next cycle`);
        }
        return;
      }
      const data = await res.json();
      if (data.token) setToken(data.token);
      if (data.refreshToken) {
        try { localStorage.setItem(LS_REFRESH, data.refreshToken); } catch {}
      }
      if (data.user) {
        setUser({ id: data.user.id, username: data.user.username, persona: data.user.persona || null });
      }
      if (data.subscription) {
        setSubscription(normalizeSubscription(data.subscription));
      }
    } catch (e) {
      // Network error — don't logout, just log and retry next cycle
      console.warn('[AuthContext] Token refresh network error, will retry:', e.message);
    }
  }, []);

  // ── Helper: restore session from /me response ─────────────────────────────
  const restoreFromMe = useCallback((data) => {
    const restoredUser = { id: data.user.id, username: data.user.username, persona: data.user.persona || null };
    setUser(restoredUser);
    if (data.token) setToken(data.token);
    setSubscription(normalizeSubscription(data.subscription));
    localStorage.setItem(LS_USER, JSON.stringify(restoredUser));
  }, []);

  // ── On mount: validate session via httpOnly cookie OR stored token ────────
  // If the 15-min access token expired while the tab was closed, we attempt a
  // refresh (30-day cookie) before giving up. This prevents the annoying
  // "login again on every refresh" behaviour.
  useEffect(() => {
    (async () => {
      const storedToken = tokenRef.current;
      let storedRefresh = null;
      try { storedRefresh = localStorage.getItem(LS_REFRESH); } catch {}

      try {
        // 1. Try the access token (cookie + header)
        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: authHeaders(storedToken),
          credentials: 'include',
        });
        if (meRes.ok) {
          restoreFromMe(await meRes.json());
          return;
        }

        // 2. Access token expired — attempt refresh (30-day cookie + body fallback)
        const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: authHeaders(storedToken),
          body: JSON.stringify({ refreshToken: storedRefresh }),
          credentials: 'include',
        });
        if (!refreshRes.ok) throw new Error('refresh failed');

        const refreshData = await refreshRes.json();
        // Store the new tokens immediately
        if (refreshData.token) {
          setToken(refreshData.token);
          setAuthToken(refreshData.token);
        }
        if (refreshData.refreshToken) {
          try { localStorage.setItem(LS_REFRESH, refreshData.refreshToken); } catch {}
        }

        // 3. Refresh succeeded → retry /me with new token
        const retryRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: authHeaders(refreshData.token || storedToken),
          credentials: 'include',
        });
        if (!retryRes.ok) throw new Error('retry failed');
        restoreFromMe(await retryRes.json());
      } catch {
        // All attempts failed — clear everything, show login
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem(LS_REFRESH);
        setUser(null);
        setToken(null);
        clearAuthToken();
        setSubscription(null);
      } finally {
        setAuthReady(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs strictly once on mount — restoreFromMe is stable (useCallback with no deps)

  // ── Refresh access token every 13 minutes (token expires at 15m) ────────────
  useEffect(() => {
    if (user) {
      refreshInterval.current = setInterval(refreshTokenFn, 13 * 60 * 1000);
      return () => clearInterval(refreshInterval.current);
    }
  }, [user, refreshTokenFn]);

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
        headers: authHeaders(tokenRef.current),
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
  const _persist = useCallback((userObj, tok, sub, refresh) => {
    setUser(userObj);
    setToken(tok);  // Triggers useEffect → setAuthToken + localStorage
    setSubscription(normalizeSubscription(sub));
    // User info kept in localStorage for quick UI restore (non-sensitive)
    localStorage.setItem(LS_USER, JSON.stringify(userObj));
    // Refresh token stored in localStorage for mobile Safari where cookies are blocked
    if (refresh) {
      try { localStorage.setItem(LS_REFRESH, refresh); } catch {}
    }
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
    _persist({ id: data.user.id, username: data.user.username, persona: data.user.persona || null }, data.token, data.subscription, data.refreshToken);
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
    _persist({ id: data.user.id, username: data.user.username, persona: data.user.persona || null }, data.token, data.subscription, data.refreshToken);
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
    _persist({ id: data.user.id, username: data.user.username }, data.token, data.subscription, data.refreshToken);
    return data;
  }, [_persist]);


  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: authHeaders(tokenRef.current),
        credentials: 'include',
      });
    } catch (e) { /* best-effort */ }
    setUser(null);
    setToken(null);
    clearAuthToken();
    setSubscription(null);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_REFRESH);
  }, []);

  // ── Platform-aware checkout ────────────────────────────────────────────────
  // startCheckout(tier?, plan?) — tier: 'new_particle'|'dark_particle'|'nuclear_particle'
  //                                plan: 'monthly'|'annual'
  const startCheckout = useCallback(async (tier, plan) => {
    // iOS native → Apple IAP
    if (isIOS()) {
      const productId = plan === 'annual' ? IAP_PRODUCTS.YEARLY : IAP_PRODUCTS.MONTHLY;
      const result = await purchase(productId);
      if (result.ok) {
        await refreshSubscription();
      } else {
        alert(result.error || 'Purchase failed. Please try again.');
      }
      return;
    }

    // Web / Android → Stripe
    let res, data;
    try {
      res = await fetch(`${API_BASE}/api/billing/create-session`, {
        method: 'POST',
        headers: authHeaders(tokenRef.current),
        body: JSON.stringify({
          tier: tier || 'new_particle',
          plan: plan || 'monthly',
        }),
        credentials: 'include',
      });
      data = await res.json();
    } catch (networkErr) {
      console.error('[startCheckout] Network error:', networkErr);
      throw new Error('Network error — please check your connection and try again.');
    }

    if (!res.ok || !data.checkoutUrl) {
      const msg = data?.configured === false
        ? 'Subscription setup is not yet available. We will notify you when it is ready.'
        : data?.error || `Checkout failed (HTTP ${res.status}). Please try again.`;
      console.error('[startCheckout] Server error:', res.status, data);
      throw new Error(msg);
    }

    window.location.href = data.checkoutUrl;
  }, []);

  // ── Open Stripe billing portal (manage saved cards, invoices, cancel) ─────
  const openBillingPortal = useCallback(async () => {
    const res  = await fetch(`${API_BASE}/api/billing/portal`, {
      method: 'POST',
      headers: authHeaders(tokenRef.current),
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
