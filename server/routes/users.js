/**
 * routes/users.js
 * User search for chat. Requires auth.
 * GET /api/users/search?query=...
 */

const express = require('express');
const router  = express.Router();
const { listUsers } = require('../authStore');

router.get('/search', (req, res) => {
  const { query } = req.query;
  const results   = listUsers(query, req.user.id);
  res.json({ users: results });
});

module.exports = router;
