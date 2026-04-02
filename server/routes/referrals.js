/**
 * routes/referrals.js — Referral code system.
 *
 * POST /api/referrals/redeem   — redeem a referral code (awards XP to both)
 * GET  /api/referrals/status   — get user's referral code + stats
 */

const express = require('express');
const router  = express.Router();
const { redeemReferral, getReferralStatus } = require('../authStore');

// POST /api/referrals/redeem
router.post('/redeem', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing_code', message: 'Referral code is required' });
    }

    const result = await redeemReferral(req.userId, code.trim());
    res.json({
      ok: true,
      referrer:   result.referrer,
      xpAwarded:  result.xpAwarded,
      message:    `Referral redeemed! Both you and ${result.referrer} received ${result.xpAwarded} XP.`,
    });
  } catch (e) {
    const msg = e.message;
    if (msg.includes('Already redeemed'))      return res.status(409).json({ ok: false, error: 'already_redeemed', message: msg });
    if (msg.includes('own referral'))          return res.status(400).json({ ok: false, error: 'self_referral', message: msg });
    if (msg.includes('Invalid referral code')) return res.status(404).json({ ok: false, error: 'invalid_code', message: msg });
    console.error('[referrals] redeem error:', msg);
    res.status(500).json({ ok: false, error: 'redeem_failed', message: msg });
  }
});

// GET /api/referrals/status
router.get('/status', (req, res) => {
  const status = getReferralStatus(req.userId);
  if (!status) return res.status(404).json({ ok: false, error: 'user_not_found' });
  res.json({ ok: true, ...status });
});

module.exports = router;
