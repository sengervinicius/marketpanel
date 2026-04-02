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
