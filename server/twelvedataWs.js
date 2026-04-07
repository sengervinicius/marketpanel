/**
 * twelvedataWs.js — S5.7
 * Connects to Twelve Data WebSocket for real-time streaming of international equities.
 * Merges ticks into the shared marketState and broadcasts via the same mechanism as Polygon.
 *
 * Twelve Data WebSocket: wss://ws.twelvedata.com/v1/quotes/price
 * Auth: apikey sent in subscribe message
 * Pro plan: up to 200 symbols streaming simultaneously
 *
 * Subscribes to European, Asian, and LatAm tickers that Polygon doesn't cover.
 */

const WebSocket = require('ws');
const logger = require('./utils/logger');

const TD_WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 30000;
const THROTTLE_MS = 500; // batch ticks every 500ms

// International tickers to stream (Yahoo-style → we store as-is)
// These are tickers NOT covered by Polygon's US-only feed
const INTL_SUBSCRIPTIONS = [
  // Europe — XETRA
  { symbol: 'SAP', exchange: 'XETR', yahooKey: 'SAP.DE' },
  { symbol: 'SIE', exchange: 'XETR', yahooKey: 'SIE.DE' },
  { symbol: 'ALV', exchange: 'XETR', yahooKey: 'ALV.DE' },
  { symbol: 'DTE', exchange: 'XETR', yahooKey: 'DTE.DE' },
  { symbol: 'BAS', exchange: 'XETR', yahooKey: 'BAS.DE' },
  // Europe — LSE
  { symbol: 'SHEL', exchange: 'LSE', yahooKey: 'SHEL.L' },
  { symbol: 'AZN', exchange: 'LSE', yahooKey: 'AZN.L' },
  { symbol: 'HSBA', exchange: 'LSE', yahooKey: 'HSBA.L' },
  { symbol: 'ULVR', exchange: 'LSE', yahooKey: 'ULVR.L' },
  { symbol: 'BP', exchange: 'LSE', yahooKey: 'BP.L' },
  // Europe — Euronext Paris
  { symbol: 'MC', exchange: 'EPA', yahooKey: 'MC.PA' },
  { symbol: 'TTE', exchange: 'EPA', yahooKey: 'TTE.PA' },
  { symbol: 'SAN', exchange: 'EPA', yahooKey: 'SAN.PA' },
  // Asia — Tokyo
  { symbol: '7203', exchange: 'TSE', yahooKey: '7203.T' },
  { symbol: '6758', exchange: 'TSE', yahooKey: '6758.T' },
  { symbol: '9984', exchange: 'TSE', yahooKey: '9984.T' },
  // Asia — Hong Kong
  { symbol: '0700', exchange: 'HKEX', yahooKey: '0700.HK' },
  { symbol: '9988', exchange: 'HKEX', yahooKey: '9988.HK' },
  // Korea — KRX
  { symbol: '005930', exchange: 'KRX', yahooKey: '005930.KS' },  // Samsung Electronics
  { symbol: '000660', exchange: 'KRX', yahooKey: '000660.KS' },  // SK Hynix
  { symbol: '035420', exchange: 'KRX', yahooKey: '035420.KS' },  // NAVER
  { symbol: '051910', exchange: 'KRX', yahooKey: '051910.KS' },  // LG Chem
  { symbol: '005380', exchange: 'KRX', yahooKey: '005380.KS' },  // Hyundai Motor
  // Taiwan — TWSE
  { symbol: '2330', exchange: 'TWSE', yahooKey: '2330.TW' },     // TSMC
  { symbol: '2317', exchange: 'TWSE', yahooKey: '2317.TW' },     // Hon Hai (Foxconn)
  // Brazil — B3 (augment Polygon's ADR-only coverage)
  { symbol: 'PETR4', exchange: 'BOVESPA', yahooKey: 'PETR4.SA' },
  { symbol: 'VALE3', exchange: 'BOVESPA', yahooKey: 'VALE3.SA' },
  { symbol: 'ITUB4', exchange: 'BOVESPA', yahooKey: 'ITUB4.SA' },
  { symbol: 'BBDC4', exchange: 'BOVESPA', yahooKey: 'BBDC4.SA' },
  { symbol: 'WEGE3', exchange: 'BOVESPA', yahooKey: 'WEGE3.SA' },
  { symbol: 'RENT3', exchange: 'BOVESPA', yahooKey: 'RENT3.SA' },  // Localiza
  { symbol: 'SUZB3', exchange: 'BOVESPA', yahooKey: 'SUZB3.SA' },  // Suzano
  { symbol: 'EMBR3', exchange: 'BOVESPA', yahooKey: 'EMBR3.SA' },  // Embraer
  { symbol: 'RDOR3', exchange: 'BOVESPA', yahooKey: 'RDOR3.SA' },  // Rede D'Or
  { symbol: 'B3SA3', exchange: 'BOVESPA', yahooKey: 'B3SA3.SA' },  // B3 Exchange
  { symbol: 'HAPV3', exchange: 'BOVESPA', yahooKey: 'HAPV3.SA' },  // Hapvida
  { symbol: 'FLRY3', exchange: 'BOVESPA', yahooKey: 'FLRY3.SA' },  // Fleury
];

// Build lookup: "SAP:XETR" → "SAP.DE"
const tdKeyToYahoo = new Map();
INTL_SUBSCRIPTIONS.forEach(s => {
  tdKeyToYahoo.set(`${s.symbol}`, s.yahooKey);
});

function connectTwelveData(marketState, broadcast) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    logger.info('[TwelveData WS] No API key configured, skipping WebSocket connection');
    return;
  }

  if (!marketState.feedMeta) marketState.feedMeta = {};
  marketState.feedMeta.twelvedata = {
    lastTickAt: null, lastStatusAt: null, reconnects: 0, lastError: null,
  };

  let ws = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let heartbeatTimer = null;
  let throttleTimer = null;
  const dirtySymbols = new Set();

  // Throttled broadcast: flush dirty symbols periodically
  function startThrottle() {
    if (throttleTimer) return;
    throttleTimer = setInterval(() => {
      if (dirtySymbols.size === 0) return;
      for (const sym of dirtySymbols) {
        const state = marketState.stocks?.[sym];
        if (state) {
          broadcast({ type: 'tick', category: 'stocks', symbol: sym, data: state });
        }
      }
      dirtySymbols.clear();
    }, THROTTLE_MS);
  }

  function connect() {
    logger.info('[TwelveData WS] Connecting...');
    ws = new WebSocket(TD_WS_URL);

    ws.on('open', () => {
      logger.info('[TwelveData WS] Connected, subscribing to', INTL_SUBSCRIPTIONS.length, 'symbols');
      reconnectDelay = RECONNECT_DELAY_MS;
      marketState.feedMeta.twelvedata.lastStatusAt = Date.now();
      marketState.feedMeta.twelvedata.lastError = null;

      broadcast({ type: 'status', feed: 'twelvedata', level: 'live', message: 'Twelve Data WS connected' });

      // Subscribe to all international symbols
      const symbols = INTL_SUBSCRIPTIONS.map(s =>
        s.exchange ? `${s.symbol}:${s.exchange}` : s.symbol
      );

      ws.send(JSON.stringify({
        action: 'subscribe',
        params: {
          symbols: symbols.join(','),
          apikey: apiKey,
        },
      }));

      startThrottle();

      // Heartbeat (Twelve Data requires periodic ping to keep alive)
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'heartbeat' }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        // Price update event
        if (msg.event === 'price') {
          const tdSymbol = msg.symbol; // e.g. "SAP"
          const yahooKey = tdKeyToYahoo.get(tdSymbol);
          if (!yahooKey) return;

          if (!marketState.stocks[yahooKey]) marketState.stocks[yahooKey] = {};

          const prev = marketState.stocks[yahooKey].price;
          const price = parseFloat(msg.price);
          const dayChange = msg.day_change ? parseFloat(msg.day_change) : (prev != null ? price - prev : 0);
          const dayChangePct = msg.percent_change ? parseFloat(msg.percent_change) : null;
          const volume = msg.day_volume ? parseInt(msg.day_volume) : marketState.stocks[yahooKey].volume;

          marketState.stocks[yahooKey] = {
            ...marketState.stocks[yahooKey],
            price,
            change: dayChange,
            changePct: dayChangePct,
            volume: volume || 0,
            updatedAt: Date.now(),
            source: 'twelvedata',
          };

          dirtySymbols.add(yahooKey);
          marketState.feedMeta.twelvedata.lastTickAt = Date.now();
        }

        // Subscription confirmation
        if (msg.event === 'subscribe-status') {
          logger.info(`[TwelveData WS] Subscribe status: ${msg.status}, symbols: ${msg.success?.length || 0} ok, ${msg.fails?.length || 0} failed`);
          if (msg.fails?.length > 0) {
            logger.warn('[TwelveData WS] Failed symbols:', msg.fails.map(f => f.symbol).join(', '));
          }
        }

        // Heartbeat response
        if (msg.event === 'heartbeat') {
          marketState.feedMeta.twelvedata.lastStatusAt = Date.now();
        }

      } catch (e) {
        // Ignore parse errors on binary/ping frames
      }
    });

    ws.on('close', (code) => {
      logger.warn(`[TwelveData WS] Disconnected (code: ${code}), reconnecting in ${reconnectDelay / 1000}s`);
      cleanup();
      marketState.feedMeta.twelvedata.reconnects++;
      broadcast({ type: 'status', feed: 'twelvedata', level: 'degraded', message: `Twelve Data WS reconnecting...` });

      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY_MS);
    });

    ws.on('error', (err) => {
      marketState.feedMeta.twelvedata.lastError = err.message;
      // HTTP 200 instead of 101 = plan doesn't include WebSocket streaming
      if (err.message && err.message.includes('Unexpected server response: 200')) {
        logger.warn('[TwelveData WS] WebSocket endpoint returned HTTP 200 — plan may not include streaming. Disabling reconnect.');
        cleanup();
        if (ws) { try { ws.removeAllListeners(); ws.terminate(); } catch {} }
        ws = null;
        return;
      }
      logger.error('[TwelveData WS] Error:', err.message);
    });
  }

  function cleanup() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (throttleTimer) { clearInterval(throttleTimer); throttleTimer = null; }
  }

  connect();
}

module.exports = { connectTwelveData, INTL_SUBSCRIPTIONS };
