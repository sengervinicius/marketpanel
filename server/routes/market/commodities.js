/**
 * routes/market/commodities.js — Commodity-related endpoints
 *
 * Note: Commodity tickers (GLD, SLV, USO, UNG, SOYB, WEAT, CORN, BHP, CPER, REMX)
 * are currently served as part of the /snapshot/stocks default ticker list and
 * /snapshot/etfs categories in stocks.js. This file exists as a placeholder for
 * future dedicated commodity endpoints (e.g. futures, physical spot prices).
 */

const express = require('express');
const router  = express.Router();

// No dedicated commodity routes yet — all commodity data flows through
// stocks.js via ETF proxies. Future endpoints could include:
//   GET /snapshot/commodities   — dedicated commodity snapshot
//   GET /futures/:symbol        — futures contract data

module.exports = router;
