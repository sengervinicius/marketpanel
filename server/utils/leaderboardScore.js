/**
 * leaderboardScore.js
 * Pure function to compute a single composite leaderboard score from user stats.
 * Used by the cron job and the leaderboard API.
 *
 * Weights: 40% total return, 30% Sharpe, 20% win rate, 10% drawdown penalty,
 * plus a small bonus for gamification level/xp.
 */

function calculateLeaderboardScore(stats = {}) {
  const totalReturn = stats.totalReturn ?? 0;       // %
  const sharpe      = stats.sharpeRatio ?? 0;
  const winRate     = stats.winRate ?? 0;            // %
  const worstMonth  = stats.worstMonth ?? 0;         // %
  const level       = stats.level ?? 1;
  const xp          = stats.xp ?? 0;

  const drawdownPenalty = Math.abs(worstMonth) * 0.1;

  const baseScore =
    totalReturn * 0.4 +
    sharpe      * 20 * 0.3 +
    winRate     * 0.2 -
    drawdownPenalty;

  const levelBonus = level * 0.5 + xp / 1000;

  const score = baseScore + levelBonus;
  return Math.max(0, Math.round(score));
}

module.exports = { calculateLeaderboardScore };
