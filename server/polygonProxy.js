/**
 * polygonProxy.js
 * Connects to Polygon.io WebSocket feeds (stocks, forex, crypto),
 * updates shared marketState, and broadcasts ticks to all clients.
 *
 * Features:
 *  - Subscriptions loaded from subscriptions.json (no code changes needed to add tickers)
 *  - Server-side tick throttle: buffers ticks and broadcasts batched snapshots at THROTTLE_MS intervals
 *  - Memory pruning: removes symbols not in subscription lists after STALE_MS of inactivity
 *  - Daily reset: clears intraday volume/tick data at midnight UTC
 *  - Status events: broadcasts live/degraded/error to all clients for UI feed indicators
 */

const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');

// ─── Load subscriptions from config file ──────────────────────────────────────
let SUBSCRIPTIONS;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'subscriptions.json'), 'utf8');
  SUBSCRIPTIONS = JSON.parse(raw);
  console.log('[Polygon] Loaded subscriptions from subscriptions.json');
} catch (e) {
  console.warn('[Polygon] Could not load subscriptions.json, using defaults:', e.message);
  SUBSCRIPTIONS = {
    stocks: [
      'T.SPY','T.QQQ','T.IWM','T.DIA',
      'T.AAPL','T.MSFT','T.NVDA','T.GOOGL','T.AMZN',
      'T.META','T.TSLA','T.BRKB','T.JPM','T.XOM',
      'T.GLD','T.SLV','T.USO','T.UNG',
      'T.VALE','T.PBR','T.ITUB','T.BBD',
    ],
    forex: [
      'C.EUR/USD','C.GBP/USD','C.USD/JPY','C.USD/BRL',
      'C.USD/ARS','C.USD/CHF','C.USD/CNY','C.USD/MXN',
      'C.AUD/USD','C.USD/CLP',
    ],
    crypto: [
      'XT.BTC-USD','XT.ETH-USD','XT.SOL-USD','XT.XRP-USD',
      'XT.BNB-USD','XT.DOGE-USD',
    ],
  };
}

// Build a Set of "bare" subscribed symbols per category for fast pruning checks
function buildSymbolSet(subs) {
  const set = { stocks: new Set(), forex: new Set(), crypto: new Set() };
  (subs.stocks || []).forEach(s => set.stocks.add(s.replace(/^T\./, '')));
  (subs.forex  || []).forEach(s => set.forex.add(s.replace(/^C\./, '').replace('/', '')));
  (subs.crypto || []).forEach(s => set.crypto.add(s.replace(/^XT\./, '').replace('-', '')));
  return set;
}

const POLYGON_WS = {
  stocks: 'wss://socket.polygon.io/stocks',
  forex:  'wss://socket.polygon.io/forex',
  crypto: 'wss://socket.polygon.io/crypto',
};

// How often to flush the tick buffer to clients (ms)
const THROTTLE_MS = 250;

// Symbols not updated within this window and not in subscription list are pruned (ms)
const STALE_MS = 10 * 60 * 1000; // 10 minutes

function connectFeed(feedName, wsUrl, marketState, broadcast) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    console.error('[Polygon] POLYGON_API_KEY not set — running in demo mode');
    return;
  }

  let ws;
  let reconnectDelay = 2000;
  let pingInterval;

  // ─── Server-side tick buffer (throttle) ─────────────────────────────────────
  // Accumulate dirty symbols; flush once per THROTTLE_MS to avoid per-tick broadcasts
  const dirtySymbols  = new Set(); // symbols that changed since last flush
  const dirtyCategory = {}; // symbol → category

  const flushInterval = setInterval(() => {
    if (dirtySymbols.size === 0) return;
    dirtySymbols.forEach(sym => {
      const cat = dirtyCategory[sym];
      if (!cat) return;
      const state = marketState[cat]?.[sym];
      if (state) {
        broadcast({ type: 'tick', category: cat, symbol: sym, data: state });
      }
    });
    dirtySymbols.clear();
  }, THROTTLE_MS);

  function connect() {
    console.log(`[Polygon] Connecting to ${feedName} feed...`);
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`[Polygon] ${feedName} connected`);
      reconnectDelay = 2000;
    });

    ws.on('message', (raw) => {
      let events;
      try { events = JSON.parse(raw); } catch { return; }
      if (!Array.isArray(events)) events = [events];

      events.forEach((ev) => {
        switch (ev.ev) {
          // ── Auth ─────────────────────────────────────────────────────────────
          case 'connected':
            ws.send(JSON.stringify({ action: 'auth', params: apiKey }));
            break;

          case 'auth_success':
            console.log(`[Polygon] ${feedName} authenticated ✓`);
            ws.send(JSON.stringify({
              action: 'subscribe',
              params: SUBSCRIPTIONS[feedName].join(','),
            }));
            broadcast({ type: 'status', feed: feedName, level: 'live', message: `${feedName} connected` });
            pingInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) ws.ping();
            }, 30000);
            break;

          case 'auth_failed':
            console.error(`[Polygon] ${feedName} auth failed — check API key`);
            broadcast({ type: 'status', feed: feedName, level: 'error', message: `${feedName} auth failed` });
            break;

          // ── Stock trades ──────────────────────────────────────────────────────
          case 'T': {
            const sym = ev.sym;
            if (!marketState.stocks[sym]) marketState.stocks[sym] = {};
            const prev = marketState.stocks[sym].price;
            marketState.stocks[sym] = {
              ...marketState.stocks[sym],
              symbol:        sym,
              price:         ev.p,
              volume:        (marketState.stocks[sym].volume || 0) + (ev.s || 0),
              lastTradeTime: ev.t,
              updatedAt:     Date.now(),
              change:        prev != null ? ev.p - prev : (marketState.stocks[sym].change || 0),
            };
            dirtySymbols.add(sym); dirtyCategory[sym] = 'stocks';
            break;
          }

          // ── Stock quotes (bid/ask) ────────────────────────────────────────────
          case 'Q': {
            const sym = ev.sym;
            if (!marketState.stocks[sym]) marketState.stocks[sym] = {};
            marketState.stocks[sym] = {
              ...marketState.stocks[sym],
              symbol:        sym,
              bid:           ev.bp,
              ask:           ev.ap,
              bidSize:       ev.bs,
              askSize:       ev.as,
              lastTradeTime: ev.t,
              updatedAt:     Date.now(),
            };
            dirtySymbols.add(sym); dirtyCategory[sym] = 'stocks';
            break;
          }

          // ── Forex quotes ──────────────────────────────────────────────────────
          case 'C': {
            const pair = `${ev.p}`.replace('/', '');
            if (!marketState.forex[pair]) marketState.forex[pair] = {};
            const prevAsk = marketState.forex[pair].ask;
            const mid     = (ev.b + ev.a) / 2;
            marketState.forex[pair] = {
              symbol:        pair,
              price:         mid,
              bid:           ev.b,
              ask:           ev.a,
              mid,
              change:        prevAsk != null ? ev.a - prevAsk : (marketState.forex[pair].change || 0),
              lastTradeTime: ev.t,
              updatedAt:     Date.now(),
            };
            dirtySymbols.add(pair); dirtyCategory[pair] = 'forex';
            break;
          }

          // ── Crypto trades ─────────────────────────────────────────────────────
          case 'XT': {
            const pair = ev.pair?.replace('-', '') || ev.sym;
            if (!marketState.crypto[pair]) marketState.crypto[pair] = {};
            const prev = marketState.crypto[pair].price;
            marketState.crypto[pair] = {
              symbol:        pair,
              price:         ev.p,
              volume:        (marketState.crypto[pair].volume || 0) + (ev.s || 0),
              change:        prev != null ? ev.p - prev : (marketState.crypto[pair].change || 0),
              lastTradeTime: ev.t,
              updatedAt:     Date.now(),
            };
            dirtySymbols.add(pair); dirtyCategory[pair] = 'crypto';
            break;
          }
        }
      });
    });

    ws.on('close', (code) => {
      clearInterval(pingInterval);
      console.warn(`[Polygon] ${feedName} closed (${code}). Reconnecting in ${reconnectDelay}ms...`);
      broadcast({ type: 'status', feed: feedName, level: 'degraded', message: `${feedName} reconnecting` });
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      console.error(`[Polygon] ${feedName} error:`, err.message);
      ws.terminate();
    });
  }

  connect();
  return flushInterval; // returned so caller can clean it up if needed
}

// ─── Memory pruning ────────────────────────────────────────────────────────────
// Removes symbols that are not in SUBSCRIPTIONS AND haven't been updated recently
function schedulePruning(marketState) {
  const symSets = buildSymbolSet(SUBSCRIPTIONS);
  const PRUNE_INTERVAL = 5 * 60 * 1000; // check every 5 minutes

  setInterval(() => {
    const now = Date.now();
    let pruned = 0;

    ['stocks', 'forex', 'crypto'].forEach(cat => {
      const allowedSet = symSets[cat];
      const state = marketState[cat];
      Object.keys(state).forEach(sym => {
        const entry = state[sym];
        const isSubscribed = allowedSet.has(sym);
        const isStale = !entry.updatedAt || (now - entry.updatedAt) > STALE_MS;
        if (!isSubscribed && isStale) {
          delete state[sym];
          pruned++;
        }
      });
    });

    if (pruned > 0) {
      console.log(`[Polygon] Pruned ${pruned} stale symbols from marketState`);
    }
  }, PRUNE_INTERVAL);
}

// ─── Daily reset at midnight UTC ──────────────────────────────────────────────
// Clears intraday volume counters so they don't compound day-over-day
function scheduleDailyReset(marketState) {
  function msUntilMidnightUTC() {
    const now  = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return next.getTime() - now.getTime();
  }

  function doReset() {
    let cleared = 0;
    ['stocks', 'forex', 'crypto'].forEach(cat => {
      Object.values(marketState[cat]).forEach(entry => {
        entry.volume  = 0;   // reset intraday volume
        entry.change  = 0;   // reset intraday change (will rebuild from first tick)
        cleared++;
      });
    });
    console.log(`[Polygon] Daily reset: cleared intraday state for ${cleared} symbols`);
    // Schedule next reset
    setTimeout(doReset, msUntilMidnightUTC());
  }

  setTimeout(doReset, msUntilMidnightUTC());
  console.log(`[Polygon] Daily reset scheduled in ${Math.round(msUntilMidnightUTC() / 60000)} min`);
}

// ─── Main entry point ─────────────────────────────────────────────────────────
function connectPolygon(marketState, broadcast) {
  connectFeed('stocks', POLYGON_WS.stocks, marketState, broadcast);
  connectFeed('forex',  POLYGON_WS.forex,  marketState, broadcast);
  connectFeed('crypto', POLYGON_WS.crypto, marketState, broadcast);

  schedulePruning(marketState);
  scheduleDailyReset(marketState);
}

module.exports = { connectPolygon };
