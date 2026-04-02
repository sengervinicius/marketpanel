/**
 * alertScheduler.js
 *
 * Server-side alert evaluation engine.
 *
 * Runs a periodic loop (every EVAL_INTERVAL_MS) that:
 *   1. Fetches all active alerts from alertStore.
 *   2. Groups them by symbol for batched provider calls.
 *   3. Fetches current prices via internal HTTP to /api/snapshot/ticker/:symbol
 *      (reuses all existing caching, provider fallback chains, and auth-free
 *       internal access since we call localhost directly).
 *   4. Evaluates each alert condition.
 *   5. Marks triggered alerts (one-shot: deactivate after trigger).
 *
 * Supported alert types in 5A:
 *   - price_above:          triggers when current price >= targetPrice
 *   - price_below:          triggers when current price <= targetPrice
 *   - pct_move_from_entry:  triggers when |((current - entry) / entry) * 100| >= |pctChange|
 *   - fx_level_above:       triggers when FX rate >= targetPrice
 *   - fx_level_below:       triggers when FX rate <= targetPrice
 *
 * Performance:
 *   - Batches by symbol (one fetch per unique symbol regardless of how many alerts).
 *   - Modest cadence (30–60s) to avoid provider hammering.
 *   - Uses existing server-side caching from the snapshot endpoint.
 *
 * One-shot semantics:
 *   - When a condition is met, the alert is marked triggered (triggeredAt = now)
 *     and deactivated (active = false).
 *   - The alert will NOT be re-evaluated until manually reactivated by the user.
 */

const { listAllActiveAlerts, markTriggered, updateAlert } = require('./alertStore');
const logger = require('./utils/logger');
const { dispatchAlert } = require('./services/notificationService');

const EVAL_INTERVAL_MS = 45_000; // 45 seconds
let _intervalId = null;
let _serverPort = 3001;

/**
 * Fetch current price data for a symbol via internal HTTP.
 * Uses the server's own /api/snapshot/ticker/:symbol endpoint.
 * This avoids duplicating provider logic and benefits from all existing caching.
 *
 * @param {string} symbol
 * @returns {{ price: number|null, changePct: number|null }} or null on failure
 */
async function fetchPrice(symbol) {
  try {
    const url = `http://127.0.0.1:${_serverPort}/api/snapshot/ticker/${encodeURIComponent(symbol)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.ticker ?? data;

    const price = (t?.min?.c > 0 ? t.min.c : null)
      ?? (t?.day?.c > 0 ? t.day.c : null)
      ?? (t?.lastTrade?.p > 0 ? t.lastTrade.p : null)
      ?? t?.prevDay?.c ?? null;

    return {
      price,
      changePct: t?.todaysChangePerc ?? null,
    };
  } catch (e) {
    // Silence errors — stale prices just mean alerts aren't evaluated this cycle
    return null;
  }
}

/**
 * Evaluate a single alert against the current price.
 * Returns true if the condition is met.
 */
function evaluateAlert(alert, priceData) {
  if (!priceData || priceData.price == null) return false;
  const price = priceData.price;
  const params = alert.parameters || {};

  switch (alert.type) {
    case 'price_above':
    case 'fx_level_above':
      return params.targetPrice != null && price >= params.targetPrice;

    case 'price_below':
    case 'fx_level_below':
      return params.targetPrice != null && price <= params.targetPrice;

    case 'pct_move_from_entry': {
      if (params.entryPrice == null || params.entryPrice <= 0) return false;
      if (params.pctChange == null) return false;
      const actualPctMove = ((price - params.entryPrice) / params.entryPrice) * 100;
      const threshold = Math.abs(params.pctChange);
      const direction = params.direction;

      if (direction === 'up') return actualPctMove >= threshold;
      if (direction === 'down') return actualPctMove <= -threshold;
      // No direction specified → trigger on absolute move
      return Math.abs(actualPctMove) >= threshold;
    }

    default:
      return false;
  }
}

/**
 * Evaluate a screener alert by running the screener internally and comparing
 * the matched symbols against the last known set.
 * Returns true if the alert should trigger.
 */
async function evaluateScreenerAlert(alert) {
  try {
    const params = alert.parameters || {};
    const { screenerUniverse, screenerFilters, matchMode, lastMatchedSymbols = [] } = params;
    if (!screenerUniverse || !screenerFilters) return false;

    // Run screener via internal HTTP
    const url = `http://127.0.0.1:${_serverPort}/api/screener/run`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ universe: screenerUniverse, filters: screenerFilters, limit: 200 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return false;
    const data = await res.json();
    if (!data.ok) return false;

    const currentSymbols = (data.results || []).map(r => r.symbol);
    const currentCount = currentSymbols.length;
    const prevSet = new Set(lastMatchedSymbols);
    const newSymbols = currentSymbols.filter(s => !prevSet.has(s));

    // Always update lastMatchedSymbols/lastMatchCount for next eval cycle
    await updateAlert(alert.userId, alert.id, {
      parameters: {
        ...params,
        lastMatchedSymbols: currentSymbols,
        lastMatchCount: currentCount,
      },
    });

    if (matchMode === 'new_match') {
      // Trigger if any new symbols appeared since last check
      // Skip on first eval (when lastMatchedSymbols was empty — initial population)
      if (lastMatchedSymbols.length === 0) return false;
      return newSymbols.length > 0;
    }

    if (matchMode === 'count_change') {
      // Trigger if result count changed from previous eval
      if (lastMatchedSymbols.length === 0) return false;
      return currentCount !== lastMatchedSymbols.length;
    }

    return false;
  } catch (e) {
    // Silence errors — screener alerts just skip this cycle
    return false;
  }
}

/**
 * Run one evaluation cycle.
 */
async function runEvaluation() {
  const evalStart = Date.now();
  try {
    const activeAlerts = listAllActiveAlerts();
    if (activeAlerts.length === 0) return;

    // Group alerts by symbol for batched fetching
    const bySymbol = new Map();
    for (const alert of activeAlerts) {
      const sym = alert.symbol;
      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym).push(alert);
    }

    // Fetch prices in parallel (batched by symbol)
    const symbols = Array.from(bySymbol.keys());
    const priceResults = await Promise.allSettled(
      symbols.map(sym => fetchPrice(sym))
    );

    // Build symbol → priceData map
    const priceMap = new Map();
    let fetchFailed = 0;
    for (let i = 0; i < symbols.length; i++) {
      const result = priceResults[i];
      if (result.status === 'fulfilled' && result.value) {
        priceMap.set(symbols[i], result.value);
      } else {
        fetchFailed++;
      }
    }

    // Evaluate each alert
    let triggeredCount = 0;

    // Separate screener alerts from price alerts
    const screenerAlerts = activeAlerts.filter(a => a.type === 'screener');
    const priceAlerts = activeAlerts.filter(a => a.type !== 'screener');

    for (const alert of priceAlerts) {
      // Skip snoozed alerts
      if (alert.snoozedUntil && new Date(alert.snoozedUntil) > new Date()) continue;

      const priceData = priceMap.get(alert.symbol);
      if (!priceData) continue;

      const shouldTrigger = evaluateAlert(alert, priceData);
      if (shouldTrigger) {
        const triggerContext = { price: priceData.price, changePct: priceData.changePct };
        const triggered = await markTriggered(alert.userId, alert.id, new Date().toISOString(), triggerContext);
        triggeredCount++;
        // Dispatch notifications (non-blocking)
        if (triggered && triggered.status !== 'muted') {
          dispatchAlert(triggered, { price: priceData.price, actualValue: priceData.price?.toString() }).catch(e => {
            logger.error('alerts', 'Dispatch failed', { alertId: alert.id, error: e.message });
          });
        }
      }
    }

    // Evaluate screener alerts (less frequently — every 3rd cycle to reduce API load)
    if (!runEvaluation._cycleCount) runEvaluation._cycleCount = 0;
    runEvaluation._cycleCount++;
    let screenerEvaluated = 0;
    if (screenerAlerts.length > 0 && runEvaluation._cycleCount % 3 === 0) {
      for (const alert of screenerAlerts) {
        // Skip snoozed alerts
        if (alert.snoozedUntil && new Date(alert.snoozedUntil) > new Date()) continue;

        const shouldTrigger = await evaluateScreenerAlert(alert);
        screenerEvaluated++;
        if (shouldTrigger) {
          const triggerContext = { matchMode: alert.parameters?.matchMode, lastMatchCount: alert.parameters?.lastMatchCount };
          const triggered = await markTriggered(alert.userId, alert.id, new Date().toISOString(), triggerContext);
          triggeredCount++;
          if (triggered && triggered.status !== 'muted') {
            dispatchAlert(triggered, { actualValue: `${alert.parameters?.lastMatchCount || 0} matches` }).catch(e => {
              logger.error('alerts', 'Screener dispatch failed', { alertId: alert.id, error: e.message });
            });
          }
        }
      }
    }

    const durationMs = Date.now() - evalStart;
    logger.info('alerts', 'Evaluation cycle completed', {
      alertsScanned: activeAlerts.length,
      priceAlerts: priceAlerts.length,
      screenerAlerts: screenerAlerts.length,
      screenerEvaluated,
      symbolsFetched: symbols.length,
      fetchFailed,
      triggered: triggeredCount,
      cycle: runEvaluation._cycleCount,
      durationMs,
    });
  } catch (e) {
    const durationMs = Date.now() - evalStart;
    logger.error('alerts', 'Evaluation cycle failed', { error: e.message, durationMs });
  }
}

/**
 * Start the alert evaluation scheduler.
 * @param {number} port - The server port (for internal HTTP calls)
 */
function startAlertScheduler(port) {
  _serverPort = port || 3001;
  logger.info('alerts', `Starting alert evaluation`, { intervalSec: EVAL_INTERVAL_MS / 1000, port: _serverPort });

  // Run first evaluation after a short delay (let server fully boot)
  setTimeout(() => {
    runEvaluation();
    _intervalId = setInterval(runEvaluation, EVAL_INTERVAL_MS);
  }, 5000);
}

/**
 * Stop the scheduler (for graceful shutdown / tests).
 */
function stopAlertScheduler() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info('alerts', 'Scheduler stopped');
  }
}

module.exports = {
  startAlertScheduler,
  stopAlertScheduler,
  runEvaluation, // exported for testing
};
