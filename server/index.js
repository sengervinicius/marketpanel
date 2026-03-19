require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { connectPolygon } = require('./polygonProxy');
const marketRoutes = require('./routes/market');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// REST routes (snapshots, news, charts)
app.use('/api', marketRoutes);

// HTTP server (shared with WebSocket)
const server = createServer(app);

// WebSocket server — clients connect here for live data
const wss = new WebSocket.Server({ server, path: '/ws' });

// In-memory market state — updated by Polygon WS, served to clients
const marketState = {
  stocks: {},   // keyed by ticker symbol
  forex: {},    // keyed by pair  e.g. "EURUSD"
  crypto: {},   // keyed by pair  e.g. "BTCUSD"
  lastUpdate: Date.now(),
};

const clients = new Set();

wss.on('connection', (ws, req) => {
  console.log(`[WS] Client connected. Total: ${clients.size + 1}`);
  clients.add(ws);

  // Send full snapshot immediately on connect
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'snapshot', data: marketState }));
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    clients.delete(ws);
  });
});

// Broadcast tick updates to all connected clients
function broadcast(update) {
  if (clients.size === 0) return;
  const msg = JSON.stringify(update);
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  });
}

// Connect to Polygon.io WebSocket feeds
connectPolygon(marketState, broadcast);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🟠 Senger Market Terminal — Server`);
  console.log(`   REST  → http://localhost:${PORT}/api`);
  console.log(`   WS    → ws://localhost:${PORT}/ws`);
  console.log(`   ENV   → ${process.env.NODE_ENV || 'development'}\n`);
});
