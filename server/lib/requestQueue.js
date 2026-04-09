/**
 * lib/requestQueue.js — Request queue/throttle with priority support
 *
 * Addresses Polygon free tier rate limiting (~5 req/min).
 * Serializes requests with configurable delay between them.
 *
 * Usage:
 *   const queue = new RequestQueue({ delay: 250, maxConcurrent: 1 });
 *   const result = await queue.add(() => polyFetch(...), { priority: 10 });
 */

const logger = require('../utils/logger');

class RequestQueue {
  constructor(options = {}) {
    this.delay = options.delay || 250;           // ms between requests (250ms = 4 req/s)
    this.maxConcurrent = options.maxConcurrent || 1;
    this.queue = [];                             // Array of { fn, priority, resolve, reject, label }
    this.running = 0;
    this.lastRequestTime = 0;
    this.stats = {
      queued: 0,
      processed: 0,
      failed: 0,
      totalWaitTime: 0,
    };
  }

  /**
   * Add async function to queue.
   * @param {Function} fn - Async function to execute
   * @param {Object} options - { priority: 10, label?: 'chart-request' }
   * @returns {Promise} Resolves with fn's result
   */
  add(fn, options = {}) {
    const priority = options.priority || 0;
    const label = options.label || 'request';

    return new Promise((resolve, reject) => {
      const entry = { fn, priority, resolve, reject, label, queuedAt: Date.now() };

      // Insert sorted by priority (higher priority first)
      let inserted = false;
      for (let i = 0; i < this.queue.length; i++) {
        if (priority > this.queue[i].priority) {
          this.queue.splice(i, 0, entry);
          inserted = true;
          break;
        }
      }
      if (!inserted) this.queue.push(entry);

      this.stats.queued++;
      this._process();
    });
  }

  async _process() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      this.running++;
      const entry = this.queue.shift();

      // Respect delay between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.delay) {
        const waitMs = this.delay - timeSinceLastRequest;
        await new Promise(r => setTimeout(r, waitMs));
      }

      const waitTime = Date.now() - entry.queuedAt;
      this.stats.totalWaitTime += waitTime;

      this.lastRequestTime = Date.now();

      try {
        const result = await entry.fn();
        this.stats.processed++;
        entry.resolve(result);
      } catch (err) {
        this.stats.failed++;
        logger.warn('requestQueue', `[${entry.label}] Error after ${waitTime}ms: ${err.message}`);
        entry.reject(err);
      }

      this.running--;
      if (this.queue.length > 0) this._process();
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      avgWaitTime: this.stats.processed > 0 ? Math.round(this.stats.totalWaitTime / this.stats.processed) : 0,
      queueLength: this.queue.length,
      running: this.running,
    };
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.stats = {
      queued: 0,
      processed: 0,
      failed: 0,
      totalWaitTime: 0,
    };
  }
}

module.exports = RequestQueue;
