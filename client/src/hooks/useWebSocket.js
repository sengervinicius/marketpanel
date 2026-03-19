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
    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return ws;
}
