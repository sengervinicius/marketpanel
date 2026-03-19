/**
 * polygonProxy.js
 * Connects to Polygon.io WebSocket feeds (stocks, forex, crypto),
 * updates the shared marketState, and broadcasts ticks to all clients.
 */

const WebSocket = require('ws');

const POLYGON_WS = {
  stocks: 'wss://socket.polygon.io/stocks',
  forex:  'wss://socket.polygon.io/forex',
  crypto: 'wss://socket.polygon.io/crypto',
};

// Tickers to subscribe to per feed
const SUBSCRIPTIONS = {
  stocks: [
    'T.SPY','T.QQQ','T.IWM','T.DIA',
    'T.AAPL','T.MSFT','T.NVDA','T.GOOGL','T.AMZN',
    'T.META','T.TSLA','T.BRKB','T.JPM','T.XOM',
    'T.GLD','T.SLV','T.USO','T.UNG',
    'T.VALE','T.PBR','T.ITUB','T.BBD',   // LatAm
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

// Map Polygon event types to our categories
const TYPE_MAP = {
  T:  'stocks',   // trade
  Q:  'stocks',   // quote
  'C': 'forex',
  'XT': 'crypto',
};

function connectFeed(feedName, wsUrl, marketState, broadcast) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    console.error('[Polygon] POLYGON_API_KEY not set — running in demo mode');
    return;
  }

  let ws;
  let reconnectDelay = 2000;
  let pingInterval;

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
          // Auth events
          case 'connected':
            ws.send(JSON.stringify({ action: 'auth', params: apiKey }));
            break;

          case 'auth_success':
            console.log(`[Polygon] ${feedName} authenticated ✓`);
            ws.send(JSON.stringify({
              action: 'subscribe',
              params: SUBSCRIPTIONS[feedName].join(','),
            }));
            // Keep-alive ping
            pingInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
              }
            }, 30000);
            break;

          case 'auth_failed':
            console.error(`[Polygon] ${feedName} auth failed — check API key`);
            break;

          // Stock trades
          case 'T': {
            const sym = ev.sym;
            if (!marketState.stocks[sym]) marketState.stocks[sym] = {};
            const prev = marketState.stocks[sym].price;
            marketState.stocks[sym] = {
              ...marketState.stocks[sym],
              symbol: sym,
              price: ev.p,
              size: ev.s,
              timestamp: ev.t,
              change: prev ? ev.p - prev : (marketState.stocks[sym].change || 0),
            };
            broadcast({ type: 'tick', category: 'stocks', symbol: sym, data: marketState.stocks[sym] });
            break;
          }

          // Stock quotes (bid/ask)
          case 'Q': {
            const sym = ev.sym;
            if (!marketState.stocks[sym]) marketState.stocks[sym] = {};
            marketState.stocks[sym] = {
              ...marketState.stocks[sym],
              symbol: sym,
              bid: ev.bp,
              ask: ev.ap,
              bidSize: ev.bs,
              askSize: ev.as,
              timestamp: ev.t,
            };
            broadcast({ type: 'quote', category: 'stocks', symbol: sym, data: marketState.stocks[sym] });
            break;
          }

          // Forex quotes
          case 'C': {
            const pair = `${ev.p}`.replace('/', '');
            if (!marketState.forex[pair]) marketState.forex[pair] = {};
            const prev = marketState.forex[pair].ask;
            marketState.forex[pair] = {
              symbol: pair,
              bid: ev.b,
              ask: ev.a,
              mid: ((ev.b + ev.a) / 2),
              change: prev ? ev.a - prev : (marketState.forex[pair].change || 0),
              timestamp: ev.t,
            };
            broadcast({ type: 'tick', category: 'forex', symbol: pair, data: marketState.forex[pair] });
            break;
          }

          // Crypto trades
          case 'XT': {
            const pair = ev.pair?.replace('-', '') || ev.sym;
            if (!marketState.crypto[pair]) marketState.crypto[pair] = {};
            const prev = marketState.crypto[pair].price;
            marketState.crypto[pair] = {
              symbol: pair,
              price: ev.p,
              size: ev.s,
              change: prev ? ev.p - prev : (marketState.crypto[pair].change || 0),
              timestamp: ev.t,
            };
            broadcast({ type: 'tick', category: 'crypto', symbol: pair, data: marketState.crypto[pair] });
            break;
          }
        }
      });
    });

    ws.on('close', (code, reason) => {
      clearInterval(pingInterval);
      console.warn(`[Polygon] ${feedName} closed (${code}). Reconnecting in ${reconnectDelay}ms...`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      console.error(`[Polygon] ${feedName} error:`, err.message);
      ws.terminate();
    });
  }

  connect();
}

function connectPolygon(marketState, broadcast) {
  connectFeed('stocks', POLYGON_WS.stocks, marketState, broadcast);
  connectFeed('forex',  POLYGON_WS.forex,  marketState, broadcast);
  connectFeed('crypto', POLYGON_WS.crypto, marketState, broadcast);
}

module.exports = { connectPolygon };
