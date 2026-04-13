/**
 * useWebSocket.js — Persistent WebSocket connection to the backend
 *
 * Features:
 *   - Exponential backoff reconnection (1.5s → 15s max)
 *   - Heartbeat ping/pong every 30s to detect stale connections
 *   - Message queue: buffers outgoing messages while disconnected, replays on reconnect
 *   - Connection state tracking (readyState exposed)
 *   - Custom event bridge: forwards ws:send events and emits ws:chat_message
 *
 * TODO(ws): Add binary message support for high-frequency tick data
 * TODO(ws): Add per-message acknowledgment for chat reliability
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { WS_URL } from '../utils/constants';

const HEARTBEAT_INTERVAL = 30_000;  // 30s between pings
const HEARTBEAT_TIMEOUT  = 10_000;  // 10s to receive pong before considering connection dead
const RECONNECT_INITIAL  = 1_500;
const RECONNECT_MAX      = 15_000;
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
        const reason = evt.code === 4000 ? 'heartbeat timeout' : `code ${evt.code}`;
        console.log(`[WS] Disconnected (${reason}). Reconnecting in ${delay.current}ms...`);
        reconnectTimer.current = setTimeout(() => {
          delay.current = Math.min(delay.current * 1.5, RECONNECT_MAX);
          connect();
        }, delay.current);
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
