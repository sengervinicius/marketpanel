/**
 * alertStore.js
 *
 * Server-side alert persistence (write-through to MongoDB).
 *
 * Strategy: Same pattern as portfolioStore / authStore —
 *   - In-memory Maps are the primary read source.
 *   - On startup, initAlertDB() loads all documents from MongoDB.
 *   - Every write also goes to MongoDB so data survives restarts/redeploys.
 *   - If MongoDB is not configured, falls back to in-memory only (dev mode).
 *
 * Schema:
 *   Collection: "alerts"
 *   Document shape (one per alert):
 *   {
 *     id:                   string,          // unique alert ID (e.g. "alt_kxyz123")
 *     userId:               number,          // references authStore user.id
 *     type:                 string,          // 'price_above' | 'price_below' | 'pct_move_from_entry' | 'fx_level_above' | 'fx_level_below'
 *     symbol:               string,          // ticker / instrument identifier
 *     portfolioPositionId:  string | null,   // optional link to a portfolio position
 *     parameters: {
 *       targetPrice:        number | null,   // for price_above / price_below / fx_level_*
 *       pctChange:          number | null,   // for pct_move_from_entry (e.g. 5 = 5%)
 *       entryPrice:         number | null,   // reference price for pct_move_from_entry
 *       direction:          string | null,   // 'up' | 'down' | null
 *     },
 *     note:                 string | null,   // optional user note
 *     active:               boolean,         // whether to evaluate
 *     triggeredAt:          string | null,    // ISO timestamp when condition was met
 *     dismissed:            boolean,          // whether user has dismissed the notification
 *     createdAt:            string,           // ISO
 *     updatedAt:            string,           // ISO
 *   }
 *
 * Trigger semantics (Phase 5A):
 *   - One-shot: when condition is met, alert is marked triggered and deactivated.
 *   - Alerts are NOT re-triggered endlessly.
 */

// ── In-memory store (primary read) ───────────────────────────────────────────
// userId (number) → Map<alertId, alertDoc>
const alertsByUserId = new Map();

// ── MongoDB handle ───────────────────────────────────────────────────────────
let alertsCollection = null;

/**
 * Generate a short unique alert ID.
 */
let _counter = 0;
function alertId() {
  return `alt_${Date.now().toString(36)}${(++_counter).toString(36)}`;
}

/**
 * Initialise MongoDB collection for alerts.
 * Called from index.js after initDB().
 * @param {import('mongodb').Db} db - The MongoDB database instance
 */
async function initAlertDB(db) {
  if (!db) {
    console.log('[alertStore] No MongoDB — alert data is in-memory only');
    return;
  }
  try {
    alertsCollection = db.collection('alerts');
    await alertsCollection.createIndex({ userId: 1, id: 1 }, { unique: true });
    await alertsCollection.createIndex({ userId: 1, active: 1 });

    // Load all alert documents into memory
    const docs = await alertsCollection.find({}).toArray();
    for (const doc of docs) {
      const uid = Number(doc.userId);
      if (!alertsByUserId.has(uid)) alertsByUserId.set(uid, new Map());
      const clean = { ...doc };
      delete clean._id;
      alertsByUserId.get(uid).set(doc.id, clean);
    }
    console.log(`[alertStore] Loaded ${docs.length} alert(s) from MongoDB`);
  } catch (e) {
    console.error('[alertStore] MongoDB init failed:', e.message);
    alertsCollection = null;
  }
}

// ── Persist helpers ──────────────────────────────────────────────────────────
async function persistAlert(alert) {
  if (!alertsCollection) return;
  try {
    const { _id, ...rest } = alert;
    await alertsCollection.replaceOne(
      { userId: Number(alert.userId), id: alert.id },
      { ...rest, userId: Number(alert.userId) },
      { upsert: true },
    );
  } catch (e) {
    console.error(`[alertStore] MongoDB write error (alert ${alert.id}):`, e.message);
  }
}

async function deleteAlertFromDB(userId, alertIdVal) {
  if (!alertsCollection) return;
  try {
    await alertsCollection.deleteOne({ userId: Number(userId), id: alertIdVal });
  } catch (e) {
    console.error(`[alertStore] MongoDB delete error (alert ${alertIdVal}):`, e.message);
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get all alerts for a user.
 * @param {number} userId
 * @returns {object[]} Array of alert documents
 */
function listAlerts(userId) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return [];
  return Array.from(map.values()).sort((a, b) => {
    // Active first, then by creation date descending
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

/**
 * Get all ACTIVE alerts across ALL users (for the evaluation engine).
 * @returns {object[]} Array of active alert documents
 */
function listAllActiveAlerts() {
  const result = [];
  for (const [, map] of alertsByUserId) {
    for (const [, alert] of map) {
      if (alert.active) result.push(alert);
    }
  }
  return result;
}

/**
 * Get a single alert by ID.
 * @param {number} userId
 * @param {string} alertIdVal
 * @returns {object|null}
 */
function getAlert(userId, alertIdVal) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return null;
  return map.get(alertIdVal) || null;
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Create a new alert.
 * @param {number} userId
 * @param {object} data - Alert fields (type, symbol, parameters, etc.)
 * @returns {object} The created alert document
 */
async function createAlert(userId, data) {
  const now = new Date().toISOString();
  const uid = Number(userId);

  const alert = {
    id: alertId(),
    userId: uid,
    type: data.type,
    symbol: (data.symbol || '').toUpperCase(),
    portfolioPositionId: data.portfolioPositionId || null,
    parameters: {
      targetPrice: data.parameters?.targetPrice ?? null,
      pctChange: data.parameters?.pctChange ?? null,
      entryPrice: data.parameters?.entryPrice ?? null,
      direction: data.parameters?.direction ?? null,
    },
    note: data.note || null,
    active: true,
    triggeredAt: null,
    dismissed: false,
    createdAt: now,
    updatedAt: now,
  };

  if (!alertsByUserId.has(uid)) alertsByUserId.set(uid, new Map());
  alertsByUserId.get(uid).set(alert.id, alert);
  await persistAlert(alert);

  console.log(`[alertStore] Alert created: ${alert.id} (${alert.type} ${alert.symbol} for user ${uid})`);
  return alert;
}

/**
 * Update an existing alert.
 * @param {number} userId
 * @param {string} alertIdVal
 * @param {object} data - Fields to update
 * @returns {object|null} Updated alert or null if not found
 */
async function updateAlert(userId, alertIdVal, data) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return null;
  const existing = map.get(alertIdVal);
  if (!existing) return null;

  const now = new Date().toISOString();

  // Update only provided fields
  if (data.type !== undefined) existing.type = data.type;
  if (data.symbol !== undefined) existing.symbol = data.symbol.toUpperCase();
  if (data.parameters !== undefined) {
    existing.parameters = {
      ...existing.parameters,
      ...data.parameters,
    };
  }
  if (data.note !== undefined) existing.note = data.note;
  if (data.active !== undefined) existing.active = data.active;
  if (data.dismissed !== undefined) existing.dismissed = data.dismissed;
  if (data.portfolioPositionId !== undefined) existing.portfolioPositionId = data.portfolioPositionId;
  existing.updatedAt = now;

  await persistAlert(existing);
  return existing;
}

/**
 * Delete an alert.
 * @param {number} userId
 * @param {string} alertIdVal
 * @returns {boolean} true if found and deleted
 */
async function deleteAlert(userId, alertIdVal) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return false;
  if (!map.has(alertIdVal)) return false;

  map.delete(alertIdVal);
  await deleteAlertFromDB(userId, alertIdVal);
  console.log(`[alertStore] Alert deleted: ${alertIdVal} (user ${userId})`);
  return true;
}

/**
 * Mark an alert as triggered (one-shot behavior).
 * Sets triggeredAt, deactivates the alert.
 * @param {number} userId
 * @param {string} alertIdVal
 * @param {string} triggeredAt - ISO timestamp
 * @returns {object|null} Updated alert or null
 */
async function markTriggered(userId, alertIdVal, triggeredAt) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return null;
  const existing = map.get(alertIdVal);
  if (!existing) return null;

  existing.triggeredAt = triggeredAt || new Date().toISOString();
  existing.active = false; // One-shot: deactivate after trigger
  existing.updatedAt = new Date().toISOString();

  await persistAlert(existing);
  console.log(`[alertStore] Alert triggered: ${alertIdVal} (${existing.type} ${existing.symbol})`);
  return existing;
}

module.exports = {
  initAlertDB,
  listAlerts,
  listAllActiveAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  markTriggered,
};
