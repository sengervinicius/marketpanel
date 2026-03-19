/**
 * useMarketData
 * Manages all market data state:
 *  - Loads REST snapshots on mount
 *  - Merges live WebSocket ticks
 *  - Maintains price history for sparklines
 *  - Tracks flash state for price change animations
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { SERVER_URL } from '../utils/constants';
import { useWebSocket } from './useWebSocket';

const MAX_HISTORY = 40; // sparkline data points

function mergeSnapshot(polygonResponse, category) {
  const out = {};
  const tickers = polygonResponse?.tickers || polygonResponse?.results || [];
  tickers.forEach((t) => {
    const sym = (t.ticker || t.symbol || '').replace('C:', '').replace('X:', '');
    const day = t.day || {};
    const prevDay = t.prevDay || {};
    const lastTrade = t.lastTrade || t.lastQuote || {};
    const price = lastTrade.p || lastTrade.P || day.c || 0;
    const prevClose = prevDay.c || 0;
    const change = prevClose ? price - prevClose : 0;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;

    out[sym] = {
      symbol: sym,
      price,
      change,
      changePct,
      open: day.o || 0,
      high: day.h || 0,
      low: day.l || 0,
      volume: day.v || 0,
      prevClose,
      bid: t.lastQuote?.P || 0,
      ask: t.lastQuote?.p || 0,
    };
  });
  return out;
}

export function useMarketData() {
  const [stocks, setStocks]   = useState({});
  const [forex, setForex]     = useState({});
  const [crypto, setCrypto]   = useState({});
  const [news, setNews]       = useState([]);
  const [connected, setConnected] = useState(false);
  const [marketStatus, setMarketStatus] = useState(null);

  // Sparkline history: { [symbol]: [price, price, ...] }
  const history = useRef({});
  // Flash cells: { [category-symbol]: 'up' | 'down' }
  const [flashes, setFlashes] = useState({});
  const flashTimers = useRef({});

  // ── Helper: add to history ────────────────────────────────────────────────
  function pushHistory(sym, price) {
    if (!history.current[sym]) history.current[sym] = [];
    history.current[sym] = [...history.current[sym].slice(-(MAX_HISTORY - 1)), price];
  }

  function flash(key, direction) {
    if (flashTimers.current[key]) clearTimeout(flashTimers.current[key]);
    setFlashes((f) => ({ ...f, [key]: direction }));
    flashTimers.current[key] = setTimeout(() => {
      setFlashes((f) => { const n = { ...f }; delete n[key]; return n; });
    }, 600);
  }

  // ── Process WS messages ───────────────────────────────────────────────────
  const handleMessage = useCallback((msg) => {
    if (msg.type === 'snapshot') {
      const { data } = msg;
      if (data.stocks) setStocks((prev) => ({ ...prev, ...data.stocks }));
      if (data.forex)  setForex((prev)  => ({ ...prev, ...data.forex  }));
      if (data.crypto) setCrypto((prev) => ({ ...prev, ...data.crypto }));
      setConnected(true);
      return;
    }

    if (msg.type === 'tick' || msg.type === 'quote') {
      const { category, symbol, data } = msg;
      const key = `${category}-${symbol}`;

      if (category === 'stocks') {
        setStocks((prev) => {
          const existing = prev[symbol] || {};
          const price = data.price || existing.price;
          const prevPrice = existing.price;
          if (price && prevPrice && price !== prevPrice) {
            flash(key, price > prevPrice ? 'up' : 'down');
          }
          pushHistory(symbol, price);
          return { ...prev, [symbol]: { ...existing, ...data, price } };
        });
      } else if (category === 'forex') {
        setForex((prev) => {
          const existing = prev[symbol] || {};
          const price = data.mid || data.ask || existing.price;
          if (price && existing.price && price !== existing.price) {
            flash(key, price > existing.price ? 'up' : 'down');
          }
          pushHistory(symbol, price);
          return { ...prev, [symbol]: { ...existing, ...data, price } };
        });
      } else if (category === 'crypto') {
        setCrypto((prev) => {
          const existing = prev[symbol] || {};
          const price = data.price || existing.price;
          if (price && existing.price && price !== existing.price) {
            flash(key, price > existing.price ? 'up' : 'down');
          }
          pushHistory(symbol, price);
          return { ...prev, [symbol]: { ...existing, ...data, price } };
        });
      }
    }
  }, []);

  useWebSocket(handleMessage);

  // ── Load REST snapshots on mount ──────────────────────────────────────────
  useEffect(() => {
    async function loadSnapshots() {
      try {
        const [stocksRes, forexRes, cryptoRes, newsRes, statusRes] = await Promise.allSettled([
          fetch(`${SERVER_URL}/api/snapshot/stocks`).then((r) => r.json()),
          fetch(`${SERVER_URL}/api/snapshot/forex`).then((r)  => r.json()),
          fetch(`${SERVER_URL}/api/snapshot/crypto`).then((r) => r.json()),
          fetch(`${SERVER_URL}/api/news?limit=30`).then((r)   => r.json()),
          fetch(`${SERVER_URL}/api/status`).then((r)          => r.json()),
        ]);

        if (stocksRes.status === 'fulfilled') {
          setStocks(mergeSnapshot(stocksRes.value, 'stocks'));
        }
        if (forexRes.status === 'fulfilled') {
          setForex(mergeSnapshot(forexRes.value, 'forex'));
        }
        if (cryptoRes.status === 'fulfilled') {
          setCrypto(mergeSnapshot(cryptoRes.value, 'crypto'));
        }
        if (newsRes.status === 'fulfilled') {
          setNews(newsRes.value?.results || []);
        }
        if (statusRes.status === 'fulfilled') {
          setMarketStatus(statusRes.value);
        }
      } catch (e) {
        console.error('[Data] Snapshot load failed:', e);
      }
    }

    loadSnapshots();

    // Refresh news every 2 minutes
    const newsInterval = setInterval(async () => {
      try {
        const r = await fetch(`${SERVER_URL}/api/news?limit=30`);
        const data = await r.json();
        setNews(data?.results || []);
      } catch {}
    }, 120_000);

    return () => clearInterval(newsInterval);
  }, []);

  return { stocks, forex, crypto, news, connected, marketStatus, flashes, history: history.current };
}
