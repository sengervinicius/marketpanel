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
const utilitiesRouter   = require('./utilities');
const dataRouter         = require('./data');
const intelligenceRouter = require('./intelligence');

// Mount all sub-routers — order doesn't matter since routes are distinct
router.use(dataRouter);
router.use(intelligenceRouter);
router.use(stocksRouter);
router.use(forexRouter);
router.use(cryptoRouter);
router.use(commoditiesRouter);
router.use(searchRouter);
router.use(newsRouter);
router.use(debtRouter);
router.use(utilitiesRouter);

module.exports = router;
