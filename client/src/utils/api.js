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

  // Return in-flight request if one exists
  if (_inflight.has(key)) {
    return _inflight.get(key);
  }

  const token = localStorage.getItem(LS_TOKEN);
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...options, signal: controller.signal, headers });
      return res;
    } catch (e) {
      if (e.name === 'AbortError') {
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
