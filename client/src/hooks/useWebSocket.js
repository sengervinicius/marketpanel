/**
 * useWebSocket.js — Persistent WebSocket connection to the backend
 *
 * Features:
 *   - Exponential backoff reconnection (1.5s → 15s max)
 *   - Heartbeat ping/pong every 30s to detect stale connections
 *   - Message queue: buffers outgoing messages while disconnected, replays on reconnect
 *   - Connection state tracking (readyState exposed)
 *   - Custom event bridge: forwards ws:send events and emits ws:chat_message
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { WS_URL } from '../utils/constants';

const HEARTBEAT_INTERVAL = 30_000;  // 30s between pings
const HEARTBEAT_TIMEOUT  = 10_000;  // 10s to receive pong before considering connection dead
const RECONNECT_INITIAL  = 1_500;
const RECONNECT_MAX      = 15_000;
// W1.8: when the server kicks us for backpressure (1008) or over-capacity
// (1008 with "too many"), back off an order of magnitude so we do not
// immediately retry into the same condition.
const RECONNECT_BACKPRESSURE_INITIAL = 15_000;
const RECONNECT_BACKPRESSURE_MAX     = 120_000;
const JITTER_FRAC                    = 0.25; // ±25% randomization per attempt
const QUEUE_MAX          = 50;       // max buffered outgoing messages

/**
 * Build the WebSocket URL with auth token.
 * Cross-origin WebSocket connections (client on the-particle.com → server on senger-server.onrender.com)
 * do NOT send cookies automatically. The token must be passed via URL query parameter.
 * The server accepts both cookie and query param auth — cookie takes priority when available.
 */
function buildWsUrl(token) {
  if (!WS_URL) return null;
  if (!token) return WS_URL;
  const sep = WS_URL.includes('?') ? '&' : '?';
  return `${WS_URL}${sep}token=${encodeURIComponent(token)}`;
}

export function useWebSocket(onMessage, token) {
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const heartbeatInterval = useRef(null);
  const heartbeatTimeout = useRef(null);
  const delay = useRef(RECONNECT_INITIAL);
  const mounted = useRef(true);
  const messageQueue = useRef([]);
  const connectCount = useRef(0);
  const [readyState, setReadyState] = useState(WebSocket.CLOSED);

  // Flush queued messages after reconnect
  const flushQueue = useCallback(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    while (messageQueue.current.length > 0) {
      const msg = messageQueue.current.shift();
      try {
        ws.current.send(JSON.stringify(msg));
      } catch (e) {
        console.warn('[WS] Failed to flush queued message:', e);
        break;
      }
    }
  }, []);

  // Start heartbeat cycle
  const startHeartbeat = useCallback(() => {
    clearInterval(heartbeatInterval.current);
    clearTimeout(heartbeatTimeout.current);
    heartbeatInterval.current = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        try {
          ws.current.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        } catch { /* connection may have closed between check and send */ }
        // If no pong received within timeout, force close to trigger reconnect
        heartbeatTimeout.current = setTimeout(() => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            console.warn('[WS] Heartbeat timeout — forcing reconnect');
            ws.current.close(4000, 'Heartbeat timeout');
          }
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, []);

  const stopHeartbeat = useCallback(() => {
    clearInterval(heartbeatInterval.current);
    clearTimeout(heartbeatTimeout.current);
  }, []);

  const connect = useCallback(() => {
    if (!mounted.current) return;

    const url = buildWsUrl(token);
    if (!url) {
      // No URL available — don't attempt WS connection
      console.warn('[WS] Skipping connection — no WS URL available.');
      reconnectTimer.current = setTimeout(() => {
        if (mounted.current) connect();
      }, RECONNECT_MAX); // Use max delay to avoid spamming
      return;
    }

    connectCount.current += 1;

    try {
      ws.current = new WebSocket(url);
      setReadyState(WebSocket.CONNECTING);

      ws.current.onopen = () => {
        console.log(`[WS] Connected (attempt #${connectCount.current})`);
        delay.current = RECONNECT_INITIAL;
        setReadyState(WebSocket.OPEN);
        startHeartbeat();
        flushQueue();
      };

      ws.current.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          // Handle pong — clear heartbeat timeout
          if (data.type === 'pong') {
            clearTimeout(heartbeatTimeout.current);
            return;
          }
          onMessage(data);
          // Emit custom events for specialized message types
          if (data.type === 'chat_message') {
            window.dispatchEvent(new CustomEvent('ws:chat_message', { detail: data.detail }));
          }
        } catch (e) {
          console.warn('[WS] Parse error:', e);
        }
      };

      ws.current.onclose = (evt) => {
        stopHeartbeat();
        setReadyState(WebSocket.CLOSED);
        if (!mounted.current) return;

        // W1.8: policy-close from server. 1008 is used by the backpressure
        // kicker and the per-user connection cap. In both cases the right
        // thing to do is back off far harder than the default so we don't
        // stampede the server.
        const isPolicyClose = evt.code === 1008;
        const max = isPolicyClose ? RECONNECT_BACKPRESSURE_MAX : RECONNECT_MAX;
        if (isPolicyClose) {
          delay.current = Math.max(delay.current, RECONNECT_BACKPRESSURE_INITIAL);
        }

        // #291 W1.2 — Auth-invalid close (server sends 4001 "Invalid
        // token" or "Authentication required" — see server/index.js
        // lines 847, 853). Previously we just reconnected with the
        // SAME stale token, which would fail again, producing an
        // infinite reconnect loop on every JWT-key rotation. Now: emit
        // ws:auth_invalid so AuthContext can refresh the token first,
        // then let the reconnect happen with the fresh token.
        if (evt.code === 4001) {
          console.warn('[WS] 4001 auth-invalid close — requesting token refresh');
          window.dispatchEvent(new CustomEvent('ws:auth_invalid', { detail: { reason: evt.reason } }));
          // Hold off reconnect for 3s to let AuthContext finish the
          // refresh. If the refresh succeeds, the token prop will
          // change and the useEffect will re-run, closing this stale
          // reconnect attempt and opening a fresh one with the new
          // token. If the refresh fails, AuthContext logs the user
          // out and we never reconnect — correct behavior.
          reconnectTimer.current = setTimeout(() => {
            if (mounted.current) connect();
          }, 3000);
          return;
        }

        // Apply jitter ±25% so N simultaneously-dropped clients don't
        // synchronize their reconnect storm.
        const jitter = 1 + (Math.random() * 2 - 1) * JITTER_FRAC;
        const waitMs = Math.max(250, Math.round(delay.current * jitter));

        const reasonText = evt.code === 4000
          ? 'heartbeat timeout'
          : evt.code === 1008
            ? `policy-close: ${evt.reason || 'server-enforced'}`
            : `code ${evt.code}`;
        console.log(`[WS] Disconnected (${reasonText}). Reconnecting in ${waitMs}ms...`);

        reconnectTimer.current = setTimeout(() => {
          delay.current = Math.min(delay.current * 1.5, max);
          connect();
        }, waitMs);
      };

      ws.current.onerror = () => {
        // onerror is always followed by onclose, so just close here
        ws.current?.close();
      };
    } catch (e) {
      console.error('[WS] Connection failed:', e);
      setReadyState(WebSocket.CLOSED);
    }
  }, [onMessage, token, startHeartbeat, stopHeartbeat, flushQueue]);

  useEffect(() => {
    mounted.current = true;
    connect();

    // Listen for outgoing messages — queue if disconnected, send if open
    const handleWsSend = (evt) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(evt.detail));
      } else {
        // Buffer message for replay on reconnect
        if (messageQueue.current.length < QUEUE_MAX) {
          messageQueue.current.push(evt.detail);
        }
      }
    };
    window.addEventListener('ws:send', handleWsSend);

    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      stopHeartbeat();
      ws.current?.close();
      window.removeEventListener('ws:send', handleWsSend);
    };
  }, [connect, stopHeartbeat]);

  return { ws, readyState };
}
