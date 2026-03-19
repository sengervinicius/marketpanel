# Bloomberg Terminal — Real-time Market Dashboard

A Bloomberg Terminal-style web app powered by **Polygon.io** real-time WebSocket data.

## Stack
- **Backend**: Node.js + Express + `ws` (WebSocket proxy to Polygon.io)
- **Frontend**: React 18 + Vite + Recharts
- **Data**: Polygon.io Developer plan ($79/mo) — real-time US stocks, forex, crypto

---

## Quick Start (Local)

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/bloomberg-terminal.git
cd bloomberg-terminal
npm run install:all
```

### 2. Set up your API key
```bash
cp server/.env.example server/.env
# Edit server/.env and add your Polygon.io API key:
# POLYGON_API_KEY=your_key_here
```

### 3. Run both servers
```bash
npm run dev
```
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

---

## Deploy to Render

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial Bloomberg Terminal"
git remote add origin https://github.com/YOUR_USERNAME/bloomberg-terminal.git
git push -u origin main
```

### Step 2 — Create services on Render

**Backend (Web Service):**
1. Go to render.com → New → Web Service
2. Connect your GitHub repo
3. Root directory: `server`
4. Build: `npm install`
5. Start: `node index.js`
6. Add env var: `POLYGON_API_KEY` = your key

**Frontend (Static Site):**
1. New → Static Site
2. Same repo
3. Root directory: `client`
4. Build: `npm install && npm run build`
5. Publish: `dist`
6. Add env vars:
   - `VITE_SERVER_URL` = `https://your-server.onrender.com`
   - `VITE_WS_URL` = `wss://your-server.onrender.com/ws`

---

## Panels

| Panel | Description |
|---|---|
| Header | Multi-city clocks + FX quick view + live ticker tape |
| World Indexes | SPY, QQQ, DIA, IWM, EWZ (Ibovespa ETF), and more |
| US Equities | AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, JPM, XOM |
| LatAm ADRs | VALE, PBR, ITUB, BBD |
| Intraday Charts | 5-min bars for SPY, QQQ, AAPL, NVDA |
| News Feed | Real-time Polygon news with breaking news highlight |
| Sentiment | Market breadth bars + fixed income yields + heatmap |
| FX / Forex | EUR/USD, GBP/USD, USD/JPY, USD/BRL, USD/ARS, and more |
| Crypto | BTC, ETH, SOL, XRP, BNB, DOGE |
| Commodities | GLD, SLV, USO, UNG (ETF proxies) |

---

## Adding More Tickers

Edit `client/src/utils/constants.js` to add any ticker to any panel.
Edit `server/polygonProxy.js` → `SUBSCRIPTIONS` to subscribe to its WebSocket feed.

---

## Notes

- Polygon Developer plan required for real-time WebSocket data
- Commodity futures require Polygon's commodities add-on; ETF proxies (GLD, USO) work on Developer
- Fixed income yields use mock data — Polygon has Treasury data on higher plans
- The app auto-reconnects if the WebSocket drops
