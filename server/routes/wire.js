/**
 * routes/wire.js — The Wire & Morning Brief REST endpoints
 *
 * GET /api/wire               — Recent Wire entries (limit, offset params)
 * GET /api/wire/latest        — Single most recent Wire entry
 * GET /api/wire/brief         — Today's Morning Brief
 * GET /api/wire/brief/user    — Personalized brief for authenticated user
 * GET /api/wire/summary       — System health summary
 * POST /api/wire/generate     — Force-generate a Wire entry (admin/debug)
 * POST /api/wire/brief/generate — Force-generate today's brief (admin/debug)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const wireGenerator = require('../services/wireGenerator');
const morningBrief  = require('../services/morningBrief');

// GET /api/wire — recent entries
router.get('/', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const entries = await wireGenerator.getFromDB(limit, offset);
    res.json({ entries, count: entries.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch Wire entries' });
  }
});

// GET /api/wire/latest — most recent entry
router.get('/latest', (req, res) => {
  const latest = wireGenerator.getLatest();
  if (!latest) {
    return res.json({ entry: null, message: 'No Wire entries yet' });
  }
  res.json({ entry: latest });
});

// GET /api/wire/brief — shared morning brief
router.get('/brief', (req, res) => {
  const brief = morningBrief.getSharedBrief();
  if (!brief) {
    return res.json({ brief: null, message: 'No brief available today' });
  }
  res.json({ brief });
});

// GET /api/wire/brief/user — personalized brief
router.get('/brief/user', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const brief = await morningBrief.getUserBrief(userId);
    if (!brief) {
      return res.json({ brief: null, message: 'No brief available today' });
    }
    res.json({ brief });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch brief' });
  }
});

// GET /api/wire/summary — health info
router.get('/summary', (req, res) => {
  res.json({
    wire: wireGenerator.getSummary(),
    brief: morningBrief.getSummary(),
  });
});

// POST /api/wire/generate — force-generate (debug)
router.post('/generate', async (req, res) => {
  try {
    const entry = await wireGenerator.forceGenerate();
    res.json({ entry, success: !!entry });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/wire/brief/generate — force-generate brief (debug)
router.post('/brief/generate', async (req, res) => {
  try {
    const brief = await morningBrief.forceGenerate();
    res.json({ brief, success: !!brief });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
