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
 *     status:               string,          // 'active' | 'triggered' | 'snoozed' | 'muted'
 *     active:               boolean,         // whether to evaluate
 *     triggeredAt:          string | null,    // ISO timestamp when condition was met
 *     dismissed:            boolean,          // whether user has dismissed the notification
 *     cooldownSeconds:      number,           // minimum seconds between repeated notifications (default 300)
 *     lastNotifiedAt:       string | null,    // ISO timestamp of last outbound notification
 *     overrideChannels:     boolean,          // whether this alert overrides global channel prefs
 *     channels:             string[],         // per-alert channel list (used when overrideChannels=true)
 *     snoozedUntil:         string | null,    // ISO timestamp — no notifications until this time
 *     triggerContext:        object | null,    // snapshot of price/values at trigger time
 *     createdAt:            string,           // ISO
 *     updatedAt:            string,           // ISO
 *   }
 *
 * Trigger semantics (Phase 5A):
 *   - One-shot: when condition is met, alert is marked triggered and deactivated.
 *   - Alerts are NOT re-triggered endlessly.
 */

const pg = require('./db/postgres');

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
  // Postgres hydration
  if (pg.isConnected()) {
    try {
      const res = await pg.query('SELECT * FROM alerts ORDER BY created_at');
      if (res && res.rows.length > 0) {
        for (const row of res.rows) {
          const uid = Number(row.user_id);
          if (!alertsByUserId.has(uid)) alertsByUserId.set(uid, new Map());
          const alert = {
            id: row.id, userId: uid, type: row.type, symbol: row.symbol,
            portfolioPositionId: row.portfolio_position_id || null,
            parameters: row.parameters || {},
            note: row.note || null, active: row.active,
            triggeredAt: row.triggered_at || null, dismissed: row.dismissed || false,
            createdAt: row.created_at, updatedAt: row.updated_at,
          };
          alertsByUserId.get(uid).set(alert.id, alert);
        }
        console.log(`[alertStore] Hydrated ${res.rows.length} alert(s) from Postgres`);
      }
    } catch (e) {
      console.error('[alertStore] Postgres hydration failed:', e.message);
    }
  }

  if (!db) {
    if (!pg.isConnected()) console.log('[alertStore] No MongoDB — alert data is in-memory only');
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
  // MongoDB
  if (alertsCollection) {
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
  // Postgres
  if (pg.isConnected()) {
    try {
      await pg.query(`
        INSERT INTO alerts (id, user_id, type, symbol, portfolio_position_id, parameters,
          note, active, triggered_at, dismissed, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (user_id, id) DO UPDATE SET
          type=EXCLUDED.type, symbol=EXCLUDED.symbol, parameters=EXCLUDED.parameters,
          note=EXCLUDED.note, active=EXCLUDED.active, triggered_at=EXCLUDED.triggered_at,
          dismissed=EXCLUDED.dismissed, updated_at=EXCLUDED.updated_at
      `, [alert.id, Number(alert.userId), alert.type, alert.symbol,
          alert.portfolioPositionId || null, JSON.stringify(alert.parameters || {}),
          alert.note || null, alert.active, alert.triggeredAt || null,
          alert.dismissed || false, alert.createdAt, alert.updatedAt]);
    } catch (e) {
      console.error(`[alertStore] Postgres write error (alert ${alert.id}):`, e.message);
    }
  }
}

async function deleteAlertFromDB(userId, alertIdVal) {
  if (alertsCollection) {
    try { await alertsCollection.deleteOne({ userId: Number(userId), id: alertIdVal }); }
    catch (e) { console.error(`[alertStore] MongoDB delete error (alert ${alertIdVal}):`, e.message); }
  }
  if (pg.isConnected()) {
    try { await pg.query('DELETE FROM alerts WHERE user_id = $1 AND id = $2', [Number(userId), alertIdVal]); }
    catch (e) { console.error(`[alertStore] Postgres delete error (alert ${alertIdVal}):`, e.message); }
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
      // Screener alert fields
      screenerUniverse: data.parameters?.screenerUniverse ?? null,
      screenerFilters: data.parameters?.screenerFilters ?? null,
      matchMode: data.parameters?.matchMode ?? null,
      lastMatchedSymbols: data.parameters?.lastMatchedSymbols ?? null,
      lastMatchCount: data.parameters?.lastMatchCount ?? null,
    },
    note: data.note || null,
    status: 'active',
    active: true,
    triggeredAt: null,
    dismissed: false,
    cooldownSeconds: data.cooldownSeconds ?? 300,
    lastNotifiedAt: null,
    overrideChannels: data.overrideChannels ?? false,
    channels: Array.isArray(data.channels) ? data.channels : [],
    snoozedUntil: null,
    triggerContext: null,
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
  if (data.status !== undefined) existing.status = data.status;
  if (data.dismissed !== undefined) existing.dismissed = data.dismissed;
  if (data.portfolioPositionId !== undefined) existing.portfolioPositionId = data.portfolioPositionId;
  if (data.cooldownSeconds !== undefined) existing.cooldownSeconds = data.cooldownSeconds;
  if (data.lastNotifiedAt !== undefined) existing.lastNotifiedAt = data.lastNotifiedAt;
  if (data.overrideChannels !== undefined) existing.overrideChannels = data.overrideChannels;
  if (data.channels !== undefined) existing.channels = data.channels;
  if (data.snoozedUntil !== undefined) existing.snoozedUntil = data.snoozedUntil;
  if (data.triggerContext !== undefined) existing.triggerContext = data.triggerContext;
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
async function markTriggered(userId, alertIdVal, triggeredAt, triggerContext = null) {
  const map = alertsByUserId.get(Number(userId));
  if (!map) return null;
  const existing = map.get(alertIdVal);
  if (!existing) return null;

  existing.triggeredAt = triggeredAt || new Date().toISOString();
  existing.active = false; // One-shot: deactivate after trigger
  existing.status = 'triggered';
  existing.lastNotifiedAt = existing.triggeredAt;
  if (triggerContext) existing.triggerContext = triggerContext;
  existing.updatedAt = new Date().toISOString();

  await persistAlert(existing);
  console.log(`[alertStore] Alert triggered: ${alertIdVal} (${existing.type} ${existing.symbol})`);
  return existing;
}

/**
 * Delete all alerts for a user (account deletion).
 */
async function deleteUserAlerts(userId) {
  const uid = Number(userId);
  alertsByUserId.delete(uid);
  if (alertsCollection) {
    try { await alertsCollection.deleteMany({ userId: uid }); }
    catch (e) { console.error('[alertStore] MongoDB delete error:', e.message); }
  }
  if (pg.isConnected()) {
    try { await pg.query('DELETE FROM alerts WHERE user_id = $1', [uid]); }
    catch (e) { console.error('[alertStore] Postgres delete error:', e.message); }
  }
}

module.exports = {
  initAlertDB,
  listAlerts,
  listAllActiveAlerts,
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  deleteUserAlerts,
  markTriggered,
};
