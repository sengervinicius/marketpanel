/**
 * useWebSocket
 * Connects to the backend WS, handles reconnection, and calls onMessage on each tick.
 */

import { useEffect, useRef, useCallback } from 'react';
import { WS_URL } from '../utils/constants';

export function useWebSocket(onMessage) {
  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const delay = useRef(1500);
  const mounted = useRef(true);

  const connect = useCallback(() => {
    if (!mounted.current) return;

    try {
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        console.log('[WS] Connected to terminal server');
        delay.current = 1500;
      };

      ws.current.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          onMessage(data);
          // Emit custom events for specialized message types
          if (data.type === 'chat_message') {
            window.dispatchEvent(new CustomEvent('ws:chat_message', { detail: data.detail }));
          }
        } catch (e) {
          console.warn('[WS] Parse error:', e);
        }
      };

      ws.current.onclose = () => {
        if (!mounted.current) return;
        console.log(`[WS] Disconnected. Reconnecting in ${delay.current}ms...`);
        reconnectTimer.current = setTimeout(() => {
          delay.current = Math.min(delay.current * 1.5, 15000);
          connect();
        }, delay.current);
      };

      ws.current.onerror = (err) => {
        console.error('[WS] Error:', err);
        ws.current?.close();
      };
    } catch (e) {
      console.error('[WS] Connection failed:', e);
    }
  }, [onMessage]);

  useEffect(() => {
    mounted.current = true;
    connect();

    // Listen for outgoing chat messages to forward to server
    const handleWsSend = (evt) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(evt.detail));
      }
    };
    window.addEventListener('ws:send', handleWsSend);

    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
      window.removeEventListener('ws:send', handleWsSend);
    };
  }, [connect]);

  return ws;
}
