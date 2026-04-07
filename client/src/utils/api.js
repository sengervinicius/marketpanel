/**
 * api.js
 * Auth-aware fetch helper. Reads token from localStorage and attaches to requests.
 */

const LS_TOKEN   = 'arc_token';
export const API_BASE = import.meta.env.VITE_API_URL || '';

// In-flight request deduplication — prevents duplicate concurrent fetches
const _inflight = new Map();

function dedupeKey(path, options) {
  return `${options?.method || 'GET'}:${path}`;
}

export async function apiFetch(path, options = {}) {
  const key = dedupeKey(path, options);

  // Return cloned response for deduplicated requests so each caller
  // gets its own body stream (prevents "body stream already read" errors)
  if (_inflight.has(key)) {
    return _inflight.get(key).then(r => r.clone());
  }

  const token = localStorage.getItem(LS_TOKEN);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers,
      });
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
