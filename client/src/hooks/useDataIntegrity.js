/**
 * useDataIntegrity — lightweight hook for polling data integrity status.
 *
 * Polls /api/data-integrity every 5 minutes. Returns per-domain verdicts
 * that any panel can check. Zero cost when data is clean (no re-renders).
 *
 * Usage:
 *   const { getStatus } = useDataIntegrity();
 *   const yieldStatus = getStatus('yield-curves');
 *   if (yieldStatus && !yieldStatus.valid) { show warning }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 min

let _sharedState = null;   // singleton — shared across all panel instances
let _listeners = new Set();
let _pollTimer = null;

async function fetchIntegrity() {
  try {
    const res = await apiFetch('/api/data-integrity');
    if (!res.ok) return;
    const data = await res.json();
    _sharedState = data;
    _listeners.forEach(fn => fn(data));
  } catch {
    // Non-fatal — integrity check is best-effort
  }
}

function startPolling() {
  if (_pollTimer) return;
  fetchIntegrity();
  _pollTimer = setInterval(fetchIntegrity, POLL_INTERVAL);
}

function stopPolling() {
  if (_listeners.size > 0) return; // still has subscribers
  clearInterval(_pollTimer);
  _pollTimer = null;
}

export function useDataIntegrity() {
  const [state, setState] = useState(_sharedState);
  const stateRef = useRef(state);

  useEffect(() => {
    const listener = (data) => {
      stateRef.current = data;
      setState(data);
    };
    _listeners.add(listener);
    startPolling();

    // If shared state already exists, use it immediately
    if (_sharedState && !stateRef.current) {
      setState(_sharedState);
    }

    return () => {
      _listeners.delete(listener);
      stopPolling();
    };
  }, []);

  const getStatus = useCallback((domain) => {
    if (!state) return null;
    const domainData = state[domain];
    if (!domainData || domainData.source === 'none') return null;
    return domainData;
  }, [state]);

  const hasAnyIssues = useCallback(() => {
    if (!state) return false;
    return Object.values(state).some(d => d && d.valid === false);
  }, [state]);

  return { getStatus, hasAnyIssues, raw: state };
}
