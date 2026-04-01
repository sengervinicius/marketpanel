/**
 * routes/market/utilities.js — Ticker reference, market status, settings sync, cache stats
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { yahooCache } = require('./lib/cache');
const { polyFetch, sendError } = require('./lib/providers');

// ── /ticker/:symbol — Polygon ticker reference ─────────────────────
router.get('/ticker/:symbol', async (req, res) => {
  try {
    const data = await polyFetch(`/v3/reference/tickers/${req.params.symbol}`);
    res.json(data);
  } catch (e) {
    sendError(res, e);
  }
});

// ── /status — Market open/close status ──────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) {
    sendError(res, e);
  }
});

// ── Cross-device chart-grid sync (file-backed) ─────────────────────
const SETTINGS_FILE = path.join(process.cwd(), '.senger-settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data), 'utf8'); }
  catch (e) { console.warn('[Settings] save failed:', e.message); }
}

let _syncSettings = loadSettings();

router.get('/settings', (req, res) => {
  res.json(_syncSettings);
});

router.post('/settings', (req, res) => {
  try {
    const body = req.body;
    if (body && typeof body === 'object') {
      _syncSettings = { ..._syncSettings, ...body };
      saveSettings(_syncSettings);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── /cache/stats — LRU cache diagnostics ────────────────────────────
router.get('/cache/stats', (req, res) => {
  res.json(yahooCache.stats());
});

module.exports = router;
