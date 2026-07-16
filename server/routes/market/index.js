/**
 * routes/market/index.js — Aggregates all domain-scoped market sub-routers.
 *
 * Each sub-router defines its own Express Router with route handlers.
 * This file mounts them all onto a single parent router that is exported
 * as the default module, preserving the original /api/market/* URL structure.
 */

const express = require('express');
const router  = express.Router();

const stocksRouter      = require('./stocks');
const forexRouter       = require('./forex');
const cryptoRouter      = require('./crypto');
const commoditiesRouter = require('./commodities');
const searchRouter      = require('./search');
const newsRouter        = require('./news');
const debtRouter        = require('./debt');
const futuresRouter     = require('./futures');   // #226 regional futures/index box
const utilitiesRouter   = require('./utilities');
const dataRouter         = require('./data');
const intelligenceRouter = require('./intelligence');
const moversRouter       = require('./movers');   // H2 W1 — home Movers panel

// Mount all sub-routers. moversRouter goes BEFORE dataRouter so the exact
// GET /market/movers (query-param form) is matched ahead of the legacy
// parameterized GET /market/movers/:direction in data.js — distinct paths,
// but explicit ordering keeps intent obvious.
router.use(moversRouter);
router.use(dataRouter);
router.use(intelligenceRouter);
router.use(stocksRouter);
router.use(forexRouter);
router.use(cryptoRouter);
router.use(commoditiesRouter);
router.use(searchRouter);
router.use(newsRouter);
router.use(debtRouter);
router.use(futuresRouter);
router.use(utilitiesRouter);

module.exports = router;
