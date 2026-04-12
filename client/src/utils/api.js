/**
 * api.js
 * Auth-aware fetch helper. Uses httpOnly cookies for authentication.
 * Credentials are sent automatically with each request.
 */

export const API_BASE = import.meta.env.VITE_API_URL || '';

// In-flight request deduplication — prevents duplicate concurrent fetches
const _inflight = new Map();

function dedupeKey(path, options) {
  return `${options?.method || 'GET'}:${path}`;
}

let _refreshing = false;

export async function apiFetch(path, options = {}) {
  const key = dedupeKey(path, options);

  // Return cloned response for deduplicated requests so each caller
  // gets its own body stream (prevents "body stream already read" errors)
  if (_inflight.has(key)) {
    return _inflight.get(key).then(r => r.clone());
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

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
          const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
          });

          if (refreshRes.ok) {
            // Refresh succeeded, retry original request
            res = await fetch(`${API_BASE}${path}`, {
              ...options,
              signal: controller.signal,
              headers,
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
