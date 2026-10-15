/**
 * api.js
 * Auth-aware fetch helper.
 *
 * DUAL AUTH STRATEGY:
 * - Sends httpOnly cookies (`credentials: 'include'`) for same-origin/CORS compat
 * - ALSO sends `Authorization: Bearer <token>` header as fallback
 *
 * WHY BOTH?  Mobile Safari (iOS) blocks third-party cookies via ITP when the
 * client (the-particle.com) and server (senger-server.onrender.com) are on
 * different domains. The cookie silently never arrives → every request gets 401.
 * By sending the token in the Authorization header, auth works regardless of
 * cookie policies. The server's requireAuth middleware already prefers cookies
 * but falls back to the header.
 */

export const API_BASE = import.meta.env.VITE_API_URL || '';

// Best-effort settings flush for pagehide/unmount. Uses fetch keepalive so the
// request survives the page being torn down — this is what stops a layout /
// watchlist / resize edit made moments before a reload from being lost.
export function beaconSettings(partial) {
  try {
    return fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(partial),
    }).catch(() => {});
  } catch { return undefined; }
}

// ── In-memory token store ───────────────────────────────────────────────────
// Set by AuthContext on login/refresh/restore. Read by apiFetch for every request.
let _accessToken = null;

/** Called by AuthContext whenever a new access token is obtained. */
export function setAuthToken(token) {
  _accessToken = token || null;
}

/** Returns the current in-memory access token (if any). */
export function getAuthToken() {
  return _accessToken;
}

/** Clears the in-memory token (called on logout). */
export function clearAuthToken() {
  _accessToken = null;
}

// In-flight request deduplication — prevents duplicate concurrent fetches
const _inflight = new Map();

function dedupeKey(path, options) {
  return `${options?.method || 'GET'}:${path}`;
}

// #292 W3-D5 — single-flight refresh. Was a boolean: a second request that
// 401'd while a refresh was in progress skipped the refresh and handed the
// raw 401 back to its caller. Now every concurrent 401 awaits the SAME
// refresh promise and retries once it settles.
let _refreshPromise = null;

/**
 * Run (or join) the token-refresh sequence. Resolves to true if a new
 * access token was obtained, false if the refresh token is dead (caller
 * should surface the 401), and rethrows nothing — transient failures just
 * resolve false after the retry schedule is exhausted.
 */
function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const RETRY_DELAYS = [500, 2000, 8000];
    for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));

      const refreshHeaders = { 'Content-Type': 'application/json' };
      if (_accessToken) refreshHeaders['Authorization'] = `Bearer ${_accessToken}`;
      // ITP/Safari parity with AuthContext.refreshTokenFn: when the cookie is
      // blocked, the stored refresh token in the body is the only credential.
      let storedRefresh = null;
      try { storedRefresh = localStorage.getItem('arc_refresh'); } catch (_) { /* storage may be disabled */ }

      let refreshRes;
      try {
        refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: refreshHeaders,
          body: JSON.stringify({ refreshToken: storedRefresh }),
          credentials: 'include',
        });
      } catch (netErr) {
        console.warn(`[apiFetch] Refresh attempt ${attempt + 1} network error:`, netErr.message);
        continue;
      }

      if (refreshRes.ok) {
        const data = await refreshRes.json().catch(() => ({}));
        if (data.token) {
          _accessToken = data.token;
          try { localStorage.setItem('arc_token', data.token); } catch (_) { /* ignore */ }
        }
        if (data.refreshToken) {
          try { localStorage.setItem('arc_refresh', data.refreshToken); } catch (_) { /* ignore */ }
        }
        return true;
      }
      if (refreshRes.status === 401 || refreshRes.status === 403) {
        // Refresh token is genuinely dead. Tell AuthContext NOW rather than
        // letting the app sit on failing requests until its 13-min poll.
        console.warn('[apiFetch] Refresh token invalid — giving up');
        _accessToken = null;
        try { window.dispatchEvent(new CustomEvent('particle:auth-expired')); } catch (_) { /* SSR/no window */ }
        return false;
      }
      console.warn(`[apiFetch] Refresh attempt ${attempt + 1} returned ${refreshRes.status}, will retry`);
    }
    return false;
  })().finally(() => { _refreshPromise = null; });
  return _refreshPromise;
}

/**
 * Build headers including Authorization if we have a token.
 */
function buildHeaders(extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }
  return headers;
}

export async function apiFetch(path, options = {}) {
  const key = dedupeKey(path, options);

  // Return cloned response for deduplicated requests so each caller
  // gets its own body stream (prevents "body stream already read" errors)
  if (_inflight.has(key)) {
    return _inflight.get(key).then(r => r.clone());
  }

  const headers = buildHeaders(options.headers);

  // Support external AbortSignal (e.g. from component unmount) alongside timeout
  // 35s timeout — Render free-tier cold-starts take ~30s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  // If caller provides a signal, abort our controller when it fires
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const promise = (async () => {
    try {
      let res = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers,
        credentials: 'include',
      });

      // #291 Wave 1.1 / #292 W3-D5 — on 401, join the single-flight refresh
      // and retry the original request once if it succeeded.
      if (res.status === 401 && path !== '/api/auth/refresh') {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const retryHeaders = buildHeaders(options.headers);
          res = await fetch(`${API_BASE}${path}`, {
            ...options,
            signal: controller.signal,
            headers: retryHeaders,
            credentials: 'include',
          });
        }
      }

      return res;
    } catch (e) {
      if (e.name === 'AbortError') {
        // Distinguish between external abort (unmount) and timeout
        if (externalSignal?.aborted) {
          throw e; // Re-throw raw AbortError so callers can identify it
        }
        throw new Error('Request timed out. Please check your connection.');
      }
      throw e;
    } finally {
      clearTimeout(timeout);
      _inflight.delete(key);
    }
  })();

  _inflight.set(key, promise);
  return promise;
}

export async function apiJSON(path, options = {}) {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, code: err.code });
  }
  return res.json();
}
