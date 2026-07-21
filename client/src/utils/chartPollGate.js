/**
 * chartPollGate.js — pause/resume gate for the detail-chart bars poll
 * (fix/bug-wave3 BUG 4: measure tool vs. polling refresh).
 *
 * On intraday ranges the detail chart re-fetches bars every 60s. Replacing
 * the bars array mid-measure re-runs the chart (recharts re-animates on new
 * data identity → reads as a "reload") and shifts/invalidates the clicked
 * A/B indices — on active tickers the first measure click seemed to reset
 * the chart. While measure mode is armed the poll must be deferred, then
 * flushed once on completion/cancel so the chart catches up.
 *
 * Pure state machine so the pause/defer/flush logic is unit-testable.
 */
export function createPollGate() {
  let paused = false;
  let pending = false;

  return {
    /**
     * Called on each poll tick / visibility wake.
     * @param {boolean} hidden document hidden → skip silently (no catch-up:
     *        the visibilitychange handler already refetches on return).
     * @returns {boolean} true → run the fetch now.
     */
    shouldRun(hidden = false) {
      if (hidden) return false;
      if (paused) { pending = true; return false; }
      return true;
    },

    /**
     * Arm/disarm the pause (measure mode enter/exit).
     * @returns {boolean} true → a poll was deferred while paused; caller
     *          should flush one fetch now.
     */
    setPaused(next) {
      paused = !!next;
      if (!paused && pending) {
        pending = false;
        return true;
      }
      if (paused) pending = false; // re-arming clears stale flush debt
      return false;
    },

    get paused() { return paused; },
    get pending() { return pending; },
  };
}
