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

let _refreshing = false;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

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

      // If 401 and not already refreshing, attempt a single refresh
      if (res.status === 401 && !_refreshing && path !== '/api/auth/refresh') {
        _refreshing = true;
        try {
          const refreshHeaders = { 'Content-Type': 'application/json' };
          if (_accessToken) refreshHeaders['Authorization'] = `Bearer ${_accessToken}`;

          const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: 'POST',
            headers: refreshHeaders,
            credentials: 'include',
          });

          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            // Update in-memory token from refresh response
            if (refreshData.token) {
              _accessToken = refreshData.token;
            }

            // Retry original request with the new token
            const retryHeaders = buildHeaders(options.headers);
            res = await fetch(`${API_BASE}${path}`, {
              ...options,
              signal: controller.signal,
              headers: retryHeaders,
              credentials: 'include',
            });
          }
        } catch (e) {
          // Refresh attempt failed, return original 401
          console.error('[apiFetch] Token refresh failed:', e);
        } finally {
          _refreshing = false;
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
