/**
 * useSettingsSync.js
 * Centralized hook for syncing UI state between localStorage and server.
 *
 * Pattern: localStorage is the fast cache, server is the source of truth.
 * - On mount: fetch server settings, merge with local, update both.
 * - On change: write local immediately, debounce server save.
 *
 * Usage:
 *   const [value, setValue] = useSettingsSync('panelVisible', {}, 'panelVisible_v1');
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { swallow } from '../utils/swallow';

const SYNC_DEBOUNCE_MS = 2000;

// ── Shared server settings cache (fetched once per session) ────────────
let _serverSettings = null;
let _serverFetchPromise = null;
const _pendingUpdates = {};
let _flushTimer = null;

async function fetchServerSettings() {
  if (_serverSettings) return _serverSettings;
  if (_serverFetchPromise) return _serverFetchPromise;

  _serverFetchPromise = (async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (!res.ok) return {};
      const data = await res.json();
      _serverSettings = data?.settings || {};
      return _serverSettings;
    } catch {
      return {};
    }
  })();

  return _serverFetchPromise;
}

function flushToServer() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(async () => {
    const updates = { ..._pendingUpdates };
    // Clear pending
    for (const k of Object.keys(_pendingUpdates)) delete _pendingUpdates[k];
    if (Object.keys(updates).length === 0) return;

    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(updates),
      });
      // Update local cache
      if (_serverSettings) Object.assign(_serverSettings, updates);
    } catch (err) {
      console.warn('[SettingsSync] Server save failed:', err.message);
    }
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Queue a setting update to be flushed to server (debounced, batched).
 * Can be called from outside React (e.g., in App.jsx effects).
 */
export function syncSettingToServer(serverKey, value) {
  _pendingUpdates[serverKey] = value;
  flushToServer();
}

/**
 * Load a setting: try localStorage first, then fall back to server value.
 * Returns the value synchronously from localStorage, then updates from server.
 */
export function useSettingsSync(serverKey, defaultValue, localStorageKey) {
  const lsKey = localStorageKey || `particle_${serverKey}`;

  // Load from localStorage
  const loadLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  }, [lsKey, defaultValue]);

  const [value, setValue] = useState(loadLocal);
  const hasSynced = useRef(false);

  // On mount: fetch server, merge
  useEffect(() => {
    if (hasSynced.current) return;
    hasSynced.current = true;

    fetchServerSettings().then(settings => {
      const serverVal = settings[serverKey];
      if (serverVal !== undefined && serverVal !== null) {
        setValue(serverVal);
        try { localStorage.setItem(lsKey, JSON.stringify(serverVal)); } catch (e) { swallow(e, 'hook.settingsSync.ls_set.server_merge'); }
      } else {
        // Server has nothing — push local value up
        const local = loadLocal();
        if (local !== defaultValue) {
          syncSettingToServer(serverKey, local);
        }
      }
    });
  }, [serverKey, lsKey, defaultValue, loadLocal]);

  // Setter: update local + queue server sync
  const set = useCallback((newVal) => {
    const resolved = typeof newVal === 'function' ? newVal(value) : newVal;
    setValue(resolved);
    try { localStorage.setItem(lsKey, JSON.stringify(resolved)); } catch (e) { swallow(e, 'hook.settingsSync.ls_set.local_write'); }
    syncSettingToServer(serverKey, resolved);
    return resolved;
  }, [value, lsKey, serverKey]);

  return [value, set];
}

export default useSettingsSync;
