/**
 * routes/settings.js
 * Per-user settings: GET to load, POST to update (partial merge).
 * Mounted at /api/settings. All routes require requireAuth.
 */

const express = require('express');
const router  = express.Router();
const { getUserById, mergeSettings } = require('../authStore');

// GET /api/settings — return current user's settings
router.get('/', (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({
    settings: user.settings,
    subscription: {
      isPaid:             user.isPaid,
      subscriptionActive: user.subscriptionActive,
      trialEndsAt:        user.trialEndsAt,
    },
  });
});

// POST /api/settings — partial merge of settings
router.post('/', (req, res) => {
  try {
    const partial  = req.body;
    if (!partial || typeof partial !== 'object') {
      return res.status(400).json({ error: 'Body must be a settings object' });
    }
    const settings = mergeSettings(req.user.id, partial);
    res.json({ ok: true, settings });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
