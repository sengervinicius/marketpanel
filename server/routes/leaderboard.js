/**
 * leaderboard.js — Read-only leaderboard API.
 *
 * GET /api/leaderboard/global        — top 100, all users
 * GET /api/leaderboard/persona/:type — top 50, filtered by persona
 * GET /api/leaderboard/weekly        — top 50, ranked by 7-day return
 */

const express = require('express');
const router = express.Router();
const {
  getGlobalLeaderboard,
  getPersonaLeaderboard,
  getWeeklyLeaderboard,
  getGameLeaderboard,
} = require('../jobs/leaderboards');

/**
 * Find the 1-based rank of a user in a sorted array.
 */
function findUserRank(data, userId) {
  const idx = data.findIndex(e => e.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

// GET /api/leaderboard/global
router.get('/global', (req, res) => {
  const board = getGlobalLeaderboard();
  const userId = req.userId;
  res.json({
    leaderboard: board.data.slice(0, 100),
    userRank: findUserRank(board.data, userId),
    total: board.data.length,
    generatedAt: board.generatedAt,
  });
});

// GET /api/leaderboard/persona/:type
router.get('/persona/:type', (req, res) => {
  const { type } = req.params;
  const board = getPersonaLeaderboard(type);
  const userId = req.userId;
  res.json({
    leaderboard: board.data.slice(0, 50),
    userRank: findUserRank(board.data, userId),
    total: board.data.length,
    generatedAt: board.generatedAt,
  });
});

// GET /api/leaderboard/weekly
router.get('/weekly', (req, res) => {
  const board = getWeeklyLeaderboard();
  const userId = req.userId;
  res.json({
    title: 'Best 7-Day Return',
    leaderboard: board.data.slice(0, 50),
    userRank: findUserRank(board.data, userId),
    total: board.data.length,
    endsAt: board.endsAt,
    generatedAt: board.generatedAt,
  });
});

// ── Game leaderboards (returns-only ranking) ────────────────────────────────

const GAME_PERIODS = ['global', 'weekly', 'monthly', 'quarterly', 'annual'];

GAME_PERIODS.forEach(period => {
  router.get(`/game/${period}`, (req, res) => {
    const board = getGameLeaderboard(period);
    const userId = req.userId;
    const response = {
      leaderboard: board.data.slice(0, 100),
      userRank: findUserRank(board.data, userId),
      total: board.data.length,
      generatedAt: board.generatedAt,
      ready: board.ready ?? false,
    };
    if (board.endsAt) response.endsAt = board.endsAt;
    res.json(response);
  });
});

module.exports = router;
