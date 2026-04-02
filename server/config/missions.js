/**
 * config/missions.js
 * Static mission catalog. Each entry defines a mission template.
 * The store hydrates per-user state from these templates.
 */

const MISSION_CATALOG = [
  // ── Daily ────────────────────────────────────────────────
  {
    id: 'daily-login',
    kind: 'daily',
    title: 'Daily Check-In',
    description: 'Log in to the terminal today.',
    xpReward: 10,
    target: 1,
  },
  {
    id: 'daily-ai-chart',
    kind: 'daily',
    title: 'Chart Analyst',
    description: 'Run AI Chart Insight at least once today.',
    xpReward: 15,
    target: 1,
  },
  {
    id: 'daily-alert-check',
    kind: 'daily',
    title: 'Alert Monitor',
    description: 'Open the Alerts panel today.',
    xpReward: 5,
    target: 1,
  },

  // ── Weekly ───────────────────────────────────────────────
  {
    id: 'weekly-leaderboard',
    kind: 'weekly',
    title: 'Competitor',
    description: 'Check the leaderboard at least once this week.',
    xpReward: 20,
    target: 1,
  },
  {
    id: 'weekly-macro',
    kind: 'weekly',
    title: 'Macro Watcher',
    description: 'Run a Macro AI Insight this week.',
    xpReward: 20,
    target: 1,
  },
  {
    id: 'weekly-instruments',
    kind: 'weekly',
    title: 'Explorer',
    description: 'View 5 different instruments this week.',
    xpReward: 25,
    target: 5,
  },

  // ── One-time ─────────────────────────────────────────────
  {
    id: 'first-alert',
    kind: 'one-time',
    title: 'First Alert',
    description: 'Create your first price alert.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'first-portfolio',
    kind: 'one-time',
    title: 'Portfolio Starter',
    description: 'Add your first position to the portfolio.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'first-ai-insight',
    kind: 'one-time',
    title: 'AI Pioneer',
    description: 'Use AI Chart Insight for the first time.',
    xpReward: 30,
    target: 1,
  },
  {
    id: 'complete-onboarding',
    kind: 'one-time',
    title: 'Welcome Aboard',
    description: 'Complete the onboarding flow.',
    xpReward: 50,
    target: 1,
  },

  // ── Screener workflow (Phase 19) ─────────────────────────
  {
    id: 'daily-screener-run',
    kind: 'daily',
    title: 'Daily Scanner',
    description: 'Run the screener at least once today.',
    xpReward: 10,
    target: 1,
  },
  {
    id: 'first-screener-run',
    kind: 'one-time',
    title: 'First Scan',
    description: 'Run the fundamental screener for the first time.',
    xpReward: 20,
    target: 1,
  },
  {
    id: 'first-screener-ai',
    kind: 'one-time',
    title: 'AI Screener',
    description: 'Use the AI helper on the screener.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'first-screener-alert',
    kind: 'one-time',
    title: 'Screener Watcher',
    description: 'Create your first screener alert.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'screener-power-user',
    kind: 'one-time',
    title: 'Power User',
    description: 'Create bulk alerts from screener results.',
    xpReward: 30,
    target: 1,
  },
  {
    id: 'screener-to-portfolio',
    kind: 'one-time',
    title: 'From Screen to Portfolio',
    description: 'Add screener results to your portfolio.',
    xpReward: 20,
    target: 1,
  },
  {
    id: 'first-screener-preset',
    kind: 'one-time',
    title: 'Saved Strategy',
    description: 'Save your first screener preset.',
    xpReward: 20,
    target: 1,
  },

  // ── Options (Phase 20) ───────────────────────────────────
  {
    id: 'daily-options-chain',
    kind: 'daily',
    title: 'Options Scout',
    description: 'Open an options chain today.',
    xpReward: 10,
    target: 1,
  },
  {
    id: 'weekly-options-strategy',
    kind: 'weekly',
    title: 'Strategist',
    description: 'Build an options strategy this week.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'first-options-chain',
    kind: 'one-time',
    title: 'Options Explorer',
    description: 'View your first options chain.',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'first-payoff',
    kind: 'one-time',
    title: 'Payoff Pioneer',
    description: 'Open your first payoff diagram.',
    xpReward: 20,
    target: 1,
  },

  // ── Persona-specific quests ──────────────────────────────
  {
    id: 'quest-crypto-view',
    kind: 'one-time',
    title: 'Crypto Explorer',
    description: 'View 3 different crypto tickers.',
    xpReward: 30,
    target: 3,
    personaType: 'crypto_degen',
  },
  {
    id: 'quest-value-fundamentals',
    kind: 'one-time',
    title: 'Deep Value',
    description: 'Open the Fundamental Screener.',
    xpReward: 30,
    target: 1,
    personaType: 'value_investor',
  },
  {
    id: 'quest-day-trader-charts',
    kind: 'one-time',
    title: 'Chart Master',
    description: 'Use technical indicators on 3 different charts.',
    xpReward: 30,
    target: 3,
    personaType: 'day_trader',
  },
  {
    id: 'quest-macro-global',
    kind: 'one-time',
    title: 'Global Macro Analyst',
    description: 'Run 3 Macro AI Insights.',
    xpReward: 40,
    target: 3,
    personaType: 'macro_investor',
  },

  // ── Alert delivery & management (Phase 22) ──────────────
  {
    id: 'alert-power-user',
    kind: 'one-time',
    title: 'Alert Power User',
    description: 'Re-arm or manage 5 alerts (snooze, mute, re-arm).',
    xpReward: 30,
    target: 5,
  },
  {
    id: 'multi-channel-ready',
    kind: 'one-time',
    title: 'Multi-Channel Ready',
    description: 'Enable at least 2 notification channels (email, Discord, etc.).',
    xpReward: 25,
    target: 2,
  },

  // ── Sharing & Referral missions (Phase 18) ──────────────
  {
    id: 'first-share',
    kind: 'one-time',
    title: 'Social Trader',
    description: 'Share your first card (portfolio, ticker, or leaderboard).',
    xpReward: 25,
    target: 1,
  },
  {
    id: 'weekly-sharer',
    kind: 'weekly',
    title: 'Market Influencer',
    description: 'Share 3 cards this week.',
    xpReward: 30,
    target: 3,
  },
  {
    id: 'invite-first-trader',
    kind: 'one-time',
    title: 'Invite a Trader',
    description: 'Have someone redeem your referral code.',
    xpReward: 50,
    target: 1,
  },
  {
    id: 'referral-champion',
    kind: 'one-time',
    title: 'Referral Champion',
    description: 'Refer 5 traders to the terminal.',
    xpReward: 100,
    target: 5,
  },
];

// Streak milestones with XP rewards
const STREAK_MILESTONES = [
  { days: 1, xp: 5,  title: 'First Day' },
  { days: 3, xp: 15, title: '3-Day Streak' },
  { days: 7, xp: 30, title: 'Week Warrior' },
  { days: 14, xp: 50, title: 'Two Weeks Strong' },
  { days: 30, xp: 100, title: 'Monthly Legend' },
];

module.exports = { MISSION_CATALOG, STREAK_MILESTONES };
