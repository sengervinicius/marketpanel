/**
 * utils/wsBackpressure.js — W1.8 WebSocket backpressure policy.
 *
 * Problem: a slow (or adversarial) client causes the server to buffer unbounded
 * outbound messages. Under a burst the process RSS climbs and every other
 * client sees degraded latency.
 *
 * Policy:
 *   - Per-connection outbound buffer cap (BP_MAX_BUFFERED_BYTES, default 1 MiB).
 *   - On overflow, terminate the slow client with a backpressure-kick close
 *     code (1008) and let the client reconnect with exponential backoff.
 *   - Per-user concurrent connection cap (BP_MAX_CONNECTIONS_PER_USER = 5)
 *     to limit fan-out abuse.
 *   - Per-connection drop-counter + total-sent-bytes attached to the ws for
 *     observability. Wave 1.4 will export these via prom-client.
 *
 * Usage:
 *   const { safeSend, registerConnection, unregisterConnection, getWSMetrics }
 *     = require('./utils/wsBackpressure');
 *
 *   wss.on('connection', (ws) => {
 *     if (!registerConnection(ws, userId)) { ws.close(1008, 'too many connections'); return; }
 *     safeSend(ws, JSON.stringify({ type: 'snapshot', data }));
 *     ws.on('close', () => unregisterConnection(ws, userId));
 *   });
 */

'use strict';

const logger = require('./logger');
const { swallow } = require('./swallow');
// W1.4: prom-client wiring. utils/metrics exposes a NOOP shim if prom-client
// isn't installed, so these calls are always safe.
const { metrics: promMetrics } = require('./metrics');

// Tunables — overridable via env.
const BP_MAX_BUFFERED_BYTES     = Number(process.env.WS_MAX_BUFFER_BYTES)    || 1024 * 1024; // 1 MiB
// 5 was too tight for real use: a terminal user with two or three monitors, or a
// couple of tabs plus a phone, hit the cap and their live feed flapped forever.
// Slots are released on close (server/index.js unregisterConnection), so the only
// cost of a higher cap is fan-out per user.
const BP_MAX_CONNECTIONS_PER_USER = Number(process.env.WS_MAX_CONN_PER_USER) || 10;
const BP_WARN_BUFFERED_BYTES    = Number(process.env.WS_WARN_BUFFER_BYTES)   || 256 * 1024; // 256 KiB

// Per-user connection bookkeeping: Map<userId, Set<WebSocket>>.
const _connectionsByUser = new Map();

// Aggregate metrics (snapshot at any point).
const _metrics = {
  connections_opened:         0,
  connections_closed_backpressure: 0,
  connections_rejected_capacity:   0,
  messages_sent:              0,
  messages_dropped_backpressure: 0,
  bytes_sent:                 0,
  peak_buffered_observed:     0,
};

/**
 * Register a new WebSocket for a given user. Returns false if that user has
 * already reached BP_MAX_CONNECTIONS_PER_USER.
 */
function registerConnection(ws, userId) {
  _metrics.connections_opened++;
  if (!userId) return true; // anon path — cap-by-IP handled elsewhere
  let set = _connectionsByUser.get(userId);
  if (!set) {
    set = new Set();
    _connectionsByUser.set(userId, set);
  }
  if (set.size >= BP_MAX_CONNECTIONS_PER_USER) {
    // #292 — "Live feed paused — too many Particle windows open" was
    // showing to the owner with ONE window open. Two causes: (1) sockets
    // of closed laptops / discarded tabs / backgrounded phones were never
    // reaped, because nothing pinged them, so they sat in this set until
    // TCP gave up; (2) the newest tab — the one the user is looking at —
    // was the one rejected. Now the cap evicts the OLDEST connection
    // (which is the most likely zombie) and lets the new one in; the
    // reaper below terminates sockets that stop answering pings.
    const oldest = set.values().next().value;
    if (oldest) {
      _metrics.connections_evicted_oldest = (_metrics.connections_evicted_oldest || 0) + 1;
      logger.warn('ws', 'Per-user cap reached — evicting oldest connection', {
        userId, cap: BP_MAX_CONNECTIONS_PER_USER, ageMs: Date.now() - (oldest._bp_openedAt || Date.now()),
      });
      set.delete(oldest);
      try { oldest.close(4002, 'Replaced by a newer window'); } catch (e) { swallow(e, 'ws.bp.evict_close'); }
      try { setTimeout(() => { try { oldest.terminate(); } catch (_) { /* gone */ } }, 2000); } catch (_) { /* no-op */ }
    }
  }
  set.add(ws);
  ws._bp_openedAt = Date.now();
  ws._bp_alive = true;
  // Lazy-initialize per-connection bookkeeping fields.
  ws._bp_messagesSent = 0;
  ws._bp_bytesSent = 0;
  ws._bp_droppedBackpressure = 0;
  ws._bp_peakBuffered = 0;
  ws._bp_userId = userId;
  try { promMetrics.ws_connections_open.inc(); } catch (e) { swallow(e, 'ws.bp.metric.connections_open_inc'); }
  return true;
}

/**
 * #292 — dead-socket reaper. Every PING_INTERVAL_MS, every registered
 * socket must answer a protocol-level ping; one that missed the previous
 * one is terminated (which fires 'close' → unregisterConnection). Without
 * this, a closed laptop held its slot for as long as the OS kept the TCP
 * connection half-open.
 */
const PING_INTERVAL_MS = Number(process.env.WS_PING_INTERVAL_MS) || 30_000;
let _reaper = null;
function startReaper() {
  if (_reaper) return _reaper;
  _reaper = setInterval(() => {
    for (const [userId, set] of _connectionsByUser) {
      for (const ws of set) {
        if (ws._bp_alive === false) {
          _metrics.connections_reaped = (_metrics.connections_reaped || 0) + 1;
          logger.info('ws', 'Reaping unresponsive socket', { userId, ageMs: Date.now() - (ws._bp_openedAt || Date.now()) });
          set.delete(ws);
          try { ws.terminate(); } catch (e) { swallow(e, 'ws.bp.reap_terminate'); }
          continue;
        }
        ws._bp_alive = false;
        try { ws.ping(); } catch (e) { swallow(e, 'ws.bp.ping'); }
      }
      if (set.size === 0) _connectionsByUser.delete(userId);
    }
  }, PING_INTERVAL_MS);
  _reaper.unref?.();
  return _reaper;
}
function stopReaper() { if (_reaper) { clearInterval(_reaper); _reaper = null; } }
/** Call from the server's 'pong' handler. */
function markAlive(ws) { ws._bp_alive = true; }

function unregisterConnection(ws, userId) {
  if (!userId) return;
  const set = _connectionsByUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) _connectionsByUser.delete(userId);
  try { promMetrics.ws_connections_open.dec(); } catch (e) { swallow(e, 'ws.bp.metric.connections_open_dec'); }
}

/**
 * Bounded-buffer send. Returns true on dispatch, false on drop/kick.
 * Silently no-ops on non-OPEN sockets (ready state 1).
 */
function safeSend(ws, payload) {
  if (!ws || ws.readyState !== 1 /* OPEN */) return false;

  // Measure current outbound buffer.
  const buffered = ws.bufferedAmount || 0;
  if (buffered > ws._bp_peakBuffered) ws._bp_peakBuffered = buffered;
  if (buffered > _metrics.peak_buffered_observed) {
    _metrics.peak_buffered_observed = buffered;
    try { promMetrics.ws_buffered_amount_peak.set(buffered); } catch (e) { swallow(e, 'ws.bp.metric.buffered_peak'); }
  }

  // Warn-level breach: we still send, but log for later analysis.
  if (buffered >= BP_WARN_BUFFERED_BYTES && buffered < BP_MAX_BUFFERED_BYTES) {
    logger.warn('ws', 'Client outbound buffer high', {
      userId: ws._bp_userId,
      buffered,
      threshold: BP_WARN_BUFFERED_BYTES,
    });
  }

  // Hard breach: terminate this client. They'll reconnect via the client-side
  // exponential-backoff path. Dropping messages but keeping the socket alive
  // is worse than a clean reconnect because other broadcast paths would keep
  // piling bytes onto the same buffer.
  if (buffered >= BP_MAX_BUFFERED_BYTES) {
    ws._bp_droppedBackpressure++;
    _metrics.messages_dropped_backpressure++;
    _metrics.connections_closed_backpressure++;
    try { promMetrics.ws_messages_dropped.inc(); } catch (e) { swallow(e, 'ws.bp.metric.messages_dropped'); }
    logger.warn('ws', 'Terminating slow client (backpressure)', {
      userId: ws._bp_userId,
      buffered,
      cap: BP_MAX_BUFFERED_BYTES,
      droppedOnThisSocket: ws._bp_droppedBackpressure,
    });
    try { ws.close(1008, 'backpressure'); } catch (e) { swallow(e, 'ws.bp.close'); }
    try { ws.terminate(); } catch (e) { swallow(e, 'ws.bp.terminate'); }
    return false;
  }

  try {
    ws.send(payload);
  } catch (e) {
    logger.warn('ws', 'ws.send threw', { error: e.message, userId: ws._bp_userId });
    try { promMetrics.ws_messages_dropped.inc(); } catch (e2) { swallow(e2, 'ws.bp.metric.messages_dropped_send'); }
    return false;
  }

  _metrics.messages_sent++;
  ws._bp_messagesSent++;
  const len = Buffer.isBuffer(payload) ? payload.length : (typeof payload === 'string' ? Buffer.byteLength(payload) : 0);
  _metrics.bytes_sent += len;
  ws._bp_bytesSent += len;
  try { promMetrics.ws_messages_sent.inc(); } catch (e) { swallow(e, 'ws.bp.metric.messages_sent'); }
  return true;
}

/**
 * Snapshot of aggregate + per-user metrics. Called by /metrics (W1.4) and
 * the admin health endpoint.
 */
function getWSMetrics() {
  let totalConnections = 0;
  for (const set of _connectionsByUser.values()) totalConnections += set.size;
  return {
    ...( _metrics ),
    connections_open: totalConnections,
    users_online: _connectionsByUser.size,
    max_buffered_bytes_cap: BP_MAX_BUFFERED_BYTES,
    max_connections_per_user: BP_MAX_CONNECTIONS_PER_USER,
  };
}

/**
 * Returns the slow-client watchlist: connections whose peak buffered
 * exceeded BP_WARN_BUFFERED_BYTES at any point. Used by the admin dashboard.
 */
function slowClients() {
  const out = [];
  for (const [userId, set] of _connectionsByUser) {
    for (const ws of set) {
      if ((ws._bp_peakBuffered || 0) >= BP_WARN_BUFFERED_BYTES) {
        out.push({
          userId,
          peakBuffered: ws._bp_peakBuffered,
          currentBuffered: ws.bufferedAmount,
          messagesSent: ws._bp_messagesSent,
          bytesSent: ws._bp_bytesSent,
          droppedBackpressure: ws._bp_droppedBackpressure,
        });
      }
    }
  }
  return out.sort((a, b) => b.peakBuffered - a.peakBuffered);
}

module.exports = {
  safeSend,
  registerConnection,
  unregisterConnection,
  getWSMetrics,
  slowClients,
  BP_MAX_BUFFERED_BYTES,
  BP_MAX_CONNECTIONS_PER_USER,
  startReaper, stopReaper, markAlive,
  BP_WARN_BUFFERED_BYTES,
};
