/**
 * routes/behavior.js — Behavioral tracking endpoints (Wave 10)
 *
 * POST /api/behavior/track      — Record a behavior event
 * GET  /api/behavior/profile     — Get user's interest profile
 * POST /api/behavior/recompute   — Force recompute profile
 * DELETE /api/behavior/clear      — Clear all behavior data (privacy)
 * GET  /api/behavior/chips        — Get personalized smart chips
 */

'use strict';

const express = require('express');
const router  = express.Router();
const behaviorTracker = require('../services/behaviorTracker');
const predictionAggregator = require('../services/predictionAggregator');

// POST /api/behavior/track — record event
router.post('/track', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { eventType, payload, timezone } = req.body;
    if (!eventType) return res.status(400).json({ error: 'eventType required' });

    // Merge timezone into payload if provided
    const enrichedPayload = { ...payload };
    if (timezone) {
      enrichedPayload.timezone = timezone;
    }

    // Fire-and-forget — don't block the response
    behaviorTracker.track(userId, eventType, enrichedPayload).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Track failed' });
  }
});

// GET /api/behavior/profile — get interest profile
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const profile = await behaviorTracker.getProfile(userId);
    res.json({ profile: profile || null });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// POST /api/behavior/recompute — force recompute
router.post('/recompute', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const profile = await behaviorTracker.computeProfile(userId);
    res.json({ profile });
  } catch (e) {
    res.status(500).json({ error: 'Recompute failed' });
  }
});

// DELETE /api/behavior/clear — clear all data
router.delete('/clear', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    await behaviorTracker.clearUserData(userId);
    res.json({ ok: true, message: 'All behavior data cleared' });
  } catch (e) {
    res.status(500).json({ error: 'Clear failed' });
  }
});

// GET /api/behavior/chips — personalized smart chips
router.get('/chips', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const chips = await generateSmartChips(userId);
    res.json({ chips });
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate chips' });
  }
});

/**
 * Generate personalized smart chips based on:
 * 1. User's interest profile
 * 2. Current market state (time of day)
 * 3. Prediction market events
 */
async function generateSmartChips(userId) {
  const profile = await behaviorTracker.getCachedProfile(userId);
  const now = new Date();
  const hour = now.getHours();

  const chips = [];

  // Time-based chips
  if (hour < 10) {
    chips.push({ label: 'Morning brief', query: 'Give me today\'s morning market brief with key events to watch.' });
  } else if (hour >= 16) {
    chips.push({ label: 'Day recap', query: 'Summarize today\'s market action — biggest moves, surprises, and what to watch tomorrow.' });
  }

  // Always include a market overview chip
  chips.push({ label: 'Market now', query: 'Quick snapshot: how are major indices, sectors, and prediction markets looking right now?' });

  // Profile-based chips
  if (profile?.topics) {
    const topTopics = Object.entries(profile.topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .filter(([, v]) => v > 0.3);

    for (const [topic] of topTopics) {
      const chip = topicToChip(topic);
      if (chip && chips.length < 6) chips.push(chip);
    }
  }

  if (profile?.tickers) {
    const topTickers = Object.entries(profile.tickers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .filter(([, v]) => v > 0.4);

    for (const [ticker] of topTickers) {
      if (chips.length < 6) {
        chips.push({
          label: `$${ticker} update`,
          query: `What's the latest on $${ticker}? Price action, news, and outlook.`,
        });
      }
    }
  }

  // Prediction market chip (always useful)
  try {
    const preds = predictionAggregator.getTopMarkets?.(1) || [];
    if (preds.length > 0 && chips.length < 6) {
      const p = preds[0];
      chips.push({
        label: 'Top prediction',
        query: `Tell me about this prediction market: "${p.title}" — currently at ${(p.probability * 100).toFixed(0)}%.`,
      });
    }
  } catch (e) { /* non-critical */ }

  // Phase 2: Dynamic alert chips — surface tickers with big intraday moves from user's watchlist/portfolio
  try {
    const portfolioStore = require('../portfolioStore');
    const { getMarketState } = require('../services/marketContextBuilder');
    const marketState = getMarketState();
    if (userId && marketState?.stocks) {
      const portfolio = portfolioStore.getPortfolio?.(userId);
      const positions = portfolio?.positions || [];
      for (const pos of positions) {
        if (chips.length >= 6) break;
        const sym = pos.symbol;
        const data = marketState.stocks[sym];
        if (data && Math.abs(data.changePercent || 0) >= 3.0) {
          const dir = data.changePercent > 0 ? '+' : '';
          chips.push({
            label: `$${sym} ${dir}${data.changePercent.toFixed(1)}%`,
            query: `$${sym} is moving ${dir}${data.changePercent.toFixed(1)}% today — analyze the move. What's driving it and should I act?`,
            priority: true,
          });
        }
      }
    }
  } catch (e) { /* non-critical */ }

  // Deep analysis chips (Wave 11) — rotate one based on profile
  if (chips.length < 6) {
    const hasPortfolioInterest = profile?.topics?.portfolio > 0.3 || profile?.tickers && Object.keys(profile.tickers).length >= 3;
    if (hasPortfolioInterest) {
      chips.push({ label: 'Portfolio autopsy', query: 'Analyze my portfolio — concentration risk, sector exposure, and what needs attention.' });
    } else {
      chips.push({ label: 'Scenario analysis', query: 'What if the Fed holds rates higher for longer? How would that affect major sectors and asset classes?' });
    }
  }

  // Phase 2: Sort priority chips to front, then cap
  chips.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
  return chips.slice(0, 6);
}

function topicToChip(topic) {
  const map = {
    fed_rates:    { label: 'Rate cut odds', query: 'What are current Fed rate cut odds? Include prediction market data from Kalshi and Polymarket.' },
    inflation:    { label: 'CPI outlook', query: 'What is the latest inflation outlook? CPI expectations and what prediction markets say.' },
    macro:        { label: 'Macro pulse', query: 'Give me a macro pulse: GDP, employment, yields, and recession odds from prediction markets.' },
    crypto:       { label: 'Crypto now', query: 'How is crypto performing? Bitcoin, Ethereum, and notable altcoin moves.' },
    brazil:       { label: 'Brazil update', query: 'How are Brazilian markets doing? Ibovespa, real, and top B3 movers.' },
    defense:      { label: 'Defense sector', query: 'How is the defense sector performing? LMT, RTX, NOC, and recent contract news.' },
    energy:       { label: 'Energy & oil', query: 'What\'s happening in energy? Oil prices, OPEC, and energy sector movers.' },
    earnings:     { label: 'Earnings watch', query: 'What earnings are coming up this week? Any notable beats or misses?' },
    options:      { label: 'Options flow', query: 'Any notable options activity today? Unusual volume or significant puts/calls.' },
    prediction:   { label: 'Prediction markets', query: 'What are the most interesting prediction markets right now? Show me top probabilities.' },
    tech:         { label: 'Tech & AI', query: 'How is the tech sector doing? Key AI and semiconductor stocks update.' },
    fixed_income: { label: 'Bonds & yields', query: 'What\'s happening in fixed income? Treasury yields, curve shape, and rate expectations.' },
  };
  return map[topic] || null;
}

module.exports = router;
