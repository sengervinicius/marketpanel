/**
 * routes/feed.js
 * Feed health endpoints.
 * GET /api/feed/health — returns current feed health status
 */

const express = require('express');
const router  = express.Router();

// Late-bound references — set via init() after marketState is created
let _marketState = null;
let _computeFeedHealth = null;

/**
 * Bind the router to the live marketState and health function.
 * Called once after marketState is defined in index.js.
 */
function initFeedRouter(marketState, computeFeedHealth) {
  _marketState = marketState;
  _computeFeedHealth = computeFeedHealth;
}

router.get('/health', (req, res) => {
  if (!_marketState || !_computeFeedHealth) {
    return res.json({ feeds: [], updatedAt: new Date().toISOString() });
  }
  const feeds = ['stocks', 'forex', 'crypto'].map(f => _computeFeedHealth(f, _marketState));
  res.json({
    feeds,
    updatedAt: new Date().toISOString(),
  });
});

module.exports = { feedRouter: router, initFeedRouter };
