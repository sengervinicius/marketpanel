/**
 * routes/share.js — Share card generation endpoints.
 *
 * POST /api/share/portfolio-card   → portfolio summary card
 * POST /api/share/ticker-card      → ticker snapshot card
 */

const express = require('express');
const router  = express.Router();

const { generateCard }      = require('../services/shareCardService');
const { getUserById }       = require('../authStore');
const { getPortfolio }      = require('../portfolioStore');

// ── POST /api/share/portfolio-card ──────────────────────────────────────────
router.post('/portfolio-card', async (req, res) => {
  try {
    const userId = req.userId;
    const user   = getUserById(userId);
    if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });

    const portfolio = getPortfolio(userId);
    if (!portfolio || !portfolio.positions || portfolio.positions.length === 0) {
      return res.status(400).json({ ok: false, error: 'no_portfolio', message: 'No positions in portfolio' });
    }

    // Allow optional body params: portfolioId, subportfolioId
    const { portfolioId } = req.body || {};

    // Filter positions if portfolioId provided
    let positions = portfolio.positions;
    let portfolioName = 'Portfolio';
    if (portfolioId) {
      const pf = portfolio.portfolios.find(p => p.id === portfolioId);
      if (pf) {
        portfolioName = pf.name;
        positions = positions.filter(p => p.portfolioId === portfolioId);
      }
    }

    if (positions.length === 0) {
      return res.status(400).json({ ok: false, error: 'empty_portfolio', message: 'No positions to share' });
    }

    // Compute basic portfolio metrics from position data
    const totalInvested = positions.reduce((s, p) => s + (p.investedAmount || 0), 0);

    // Build top holdings (up to 3)
    const holdings = positions
      .sort((a, b) => (b.investedAmount || 0) - (a.investedAmount || 0))
      .slice(0, 3)
      .map(p => ({
        symbol: p.symbol,
        name:   p.note || p.symbol,
        value:  p.investedAmount || 0,
        pnlPct: null, // would need live prices; card shows '--'
      }));

    const cardData = {
      username:       user.username,
      portfolioName,
      totalValue:     totalInvested,
      totalReturnPct: user.persona?.stats?.totalReturn ?? null,
      dayReturnPct:   null,
      holdings,
    };

    const result = await generateCard('portfolio', cardData);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[share] portfolio-card error:', e.message);
    res.status(500).json({ ok: false, error: 'card_generation_failed', message: e.message });
  }
});

// ── POST /api/share/ticker-card ─────────────────────────────────────────────
router.post('/ticker-card', async (req, res) => {
  try {
    const { symbol, price, changePct, name, sparkline } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, error: 'missing_symbol' });

    // Frontend sends current price data to avoid an extra server-side fetch
    const cardData = {
      symbol: String(symbol).toUpperCase(),
      name:   name || symbol,
      price:  price ?? null,
      changePct: changePct ?? null,
      sparkline: Array.isArray(sparkline) ? sparkline : null,
    };

    const result = await generateCard('ticker', cardData);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[share] ticker-card error:', e.message);
    res.status(500).json({ ok: false, error: 'card_generation_failed', message: e.message });
  }
});

module.exports = router;
