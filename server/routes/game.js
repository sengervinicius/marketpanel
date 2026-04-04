/**
 * game.js — Virtual investing game routes.
 *
 * GET  /api/game/profile    — current game profile
 * GET  /api/game/snapshots  — equity curve (last 365)
 * GET  /api/game/trades     — recent trades, paginated
 * POST /api/game/trade      — execute a buy/sell
 */

const express = require('express');
const router = express.Router();
const { isTicker } = require('../utils/validate');
const {
  getOrCreateGameProfile,
  saveGameProfile,
  addGameTrade,
  getGameTrades,
  getGameTradeCount,
} = require('../gameStore');
const { fetchWithFallback } = require('./market/lib/providers');

// ── Helpers ─────────────────────────────────────────────────────────────────

function profileSummary(gp) {
  return {
    startedAt: gp.startedAt,
    startBalance: gp.startBalance,
    cash: gp.cash,
    equity: gp.equity,
    totalReturnPct: gp.totalReturnPct,
    cashMultiple: gp.cashMultiple,
    realizedPnl: gp.realizedPnl,
    peakEquity: gp.peakEquity,
    troughEquity: gp.troughEquity,
    lastUpdatedAt: gp.lastUpdatedAt,
    positions: gp.positions || [],
    snapshotCount: (gp.snapshots || []).length,
  };
}

// ── GET /api/game/profile ───────────────────────────────────────────────────

router.get('/profile', async (req, res) => {
  try {
    const gp = await getOrCreateGameProfile(req.user.id);
    res.json(profileSummary(gp));
  } catch (e) {
    console.error('[game] GET /profile error:', e.message);
    res.status(500).json({ error: 'Failed to load game profile' });
  }
});

// ── GET /api/game/snapshots ─────────────────────────────────────────────────

router.get('/snapshots', async (req, res) => {
  try {
    const gp = await getOrCreateGameProfile(req.user.id);
    const snapshots = (gp.snapshots || []).slice(-365);
    res.json({ snapshots });
  } catch (e) {
    console.error('[game] GET /snapshots error:', e.message);
    res.status(500).json({ error: 'Failed to load snapshots' });
  }
});

// ── GET /api/game/trades ────────────────────────────────────────────────────

router.get('/trades', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const userId = req.user.id;

    const trades = getGameTrades(userId, limit, offset);
    const total = getGameTradeCount(userId);

    res.json({ trades, total, limit, offset });
  } catch (e) {
    console.error('[game] GET /trades error:', e.message);
    res.status(500).json({ error: 'Failed to load trades' });
  }
});

// ── POST /api/game/trade ────────────────────────────────────────────────────

router.post('/trade', async (req, res) => {
  try {
    const { symbol, side, quantity } = req.body || {};

    // ── Validation ──────────────────────────────────────────────────────
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol is required (string).' });
    }
    if (!isTicker(symbol)) {
      return res.status(400).json({ error: `Invalid symbol: "${symbol}". Max 20 chars, alphanumeric plus . - : ^ =` });
    }
    if (!side || !['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ error: 'side must be "BUY" or "SELL".' });
    }
    const qty = parseInt(quantity);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 1_000_000) {
      return res.status(400).json({ error: 'quantity must be a positive integer, max 1,000,000.' });
    }

    const sym = symbol.toUpperCase();

    // ── Fetch live price ────────────────────────────────────────────────
    let price;
    try {
      const result = await fetchWithFallback(sym);
      price = result?.data?.regularMarketPrice;
      if (!price || typeof price !== 'number' || price <= 0) {
        return res.status(503).json({ error: `Could not fetch live price for ${sym}. Try again.` });
      }
    } catch (e) {
      console.error(`[game] Price fetch failed for ${sym}:`, e.message);
      return res.status(503).json({ error: `Could not fetch live price for ${sym}. Try again.` });
    }

    const notional = price * qty;
    const gp = await getOrCreateGameProfile(req.user.id);

    // ── BUY ─────────────────────────────────────────────────────────────
    if (side === 'BUY') {
      if (gp.cash < notional) {
        return res.status(400).json({
          error: `Insufficient cash. You have $${gp.cash.toLocaleString('en-US', { minimumFractionDigits: 2 })}, need $${notional.toLocaleString('en-US', { minimumFractionDigits: 2 })} for this trade.`,
        });
      }

      gp.cash -= notional;

      const existing = gp.positions.find(p => p.symbol === sym);
      if (existing) {
        const newQty = existing.quantity + qty;
        existing.avgPrice = (existing.quantity * existing.avgPrice + qty * price) / newQty;
        existing.quantity = newQty;
      } else {
        gp.positions.push({
          symbol: sym,
          quantity: qty,
          avgPrice: price,
          lastPrice: price,
          marketValue: notional,
          unrealizedPnl: 0,
        });
      }
    }

    // ── SELL ────────────────────────────────────────────────────────────
    if (side === 'SELL') {
      const existing = gp.positions.find(p => p.symbol === sym);
      if (!existing || existing.quantity < qty) {
        const held = existing ? existing.quantity : 0;
        return res.status(400).json({
          error: `You don't hold enough ${sym}. You have ${held} shares, trying to sell ${qty}.`,
        });
      }

      gp.realizedPnl += (price - existing.avgPrice) * qty;
      gp.cash += notional;

      if (existing.quantity - qty === 0) {
        gp.positions = gp.positions.filter(p => p.symbol !== sym);
      } else {
        existing.quantity -= qty;
      }
    }

    // ── Mark all positions ──────────────────────────────────────────────
    for (const pos of gp.positions) {
      // Re-mark traded symbol with current price; others keep lastPrice
      if (pos.symbol === sym) {
        pos.lastPrice = price;
      }
      pos.marketValue = pos.quantity * pos.lastPrice;
      pos.unrealizedPnl = (pos.lastPrice - pos.avgPrice) * pos.quantity;
    }

    // ── Recalculate metrics ─────────────────────────────────────────────
    const totalMarketValue = gp.positions.reduce((sum, p) => sum + p.marketValue, 0);
    gp.equity = gp.cash + totalMarketValue;
    gp.totalReturnPct = (gp.equity - gp.startBalance) / gp.startBalance;
    gp.cashMultiple = gp.equity / gp.startBalance;
    gp.peakEquity = Math.max(gp.peakEquity, gp.equity);
    gp.troughEquity = Math.min(gp.troughEquity, gp.equity);
    gp.lastUpdatedAt = new Date().toISOString();

    // ── Append snapshot ─────────────────────────────────────────────────
    gp.snapshots.push({
      asOf: new Date().toISOString(),
      equity: gp.equity,
      totalReturnPct: gp.totalReturnPct,
    });
    if (gp.snapshots.length > 365) {
      gp.snapshots = gp.snapshots.slice(-365);
    }

    // ── Persist ─────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    await saveGameProfile(req.user.id, gp);
    await addGameTrade({
      userId: req.user.id,
      symbol: sym,
      side,
      quantity: qty,
      price,
      notional,
      createdAt: now,
    });

    // ── Response ────────────────────────────────────────────────────────
    res.json({
      ok: true,
      trade: { symbol: sym, side, quantity: qty, price, notional },
      gameProfile: profileSummary(gp),
    });

  } catch (e) {
    console.error('[game] POST /trade error:', e.message);
    res.status(500).json({ error: 'Trade execution failed. Please try again.' });
  }
});

module.exports = router;
