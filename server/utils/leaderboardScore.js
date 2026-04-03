/**
 * leaderboardScore.js
 * Pure function to compute a single composite leaderboard score from user stats.
 * Used by the cron job and the leaderboard API.
 *
 * Weights: 40% total return, 30% Sharpe, 20% win rate, 10% drawdown penalty.
 */

function calculateLeaderboardScore(stats = {}) {
  const totalReturn = stats.totalReturn ?? 0;       // %
  const sharpe      = stats.sharpeRatio ?? 0;
  const winRate     = stats.winRate ?? 0;            // %
  const worstMonth  = stats.worstMonth ?? 0;         // %

  const drawdownPenalty = Math.abs(worstMonth) * 0.1;

  const baseScore =
    totalReturn * 0.4 +
    sharpe      * 20 * 0.3 +
    winRate     * 0.2 -
    drawdownPenalty;

  return Math.max(0, Math.round(baseScore));
}

module.exports = { calculateLeaderboardScore };
