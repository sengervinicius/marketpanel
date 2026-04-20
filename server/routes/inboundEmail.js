/**
 * routes/inboundEmail.js — Inbound email → Central Vault ingestion.
 *
 * P3.1 — vault@the-particle.com ingests research PDFs / notes that the
 * CIO forwards from their inbox (earnings call transcripts, sell-side
 * notes, regulatory filings). Anything that lands in vault@the-particle.com
 * is parsed, chunked, embedded, and surfaced to ALL Particle users via
 * the central (global) vault.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Provider: Postmark inbound.
 *
 * Postmark's inbound stream POSTs a JSON payload to a webhook URL we
 * configure in the Postmark dashboard. Attachments arrive as base64 in
 * the `Attachments[]` array, so there is zero multipart/form parsing.
 * DNS-side setup is a single MX record at Cloudflare pointing to
 * inbound.postmarkapp.com (see docs/OPS_INBOUND_EMAIL.md).
 *
 * Swapping to Mailgun later: the payload shape is different (multipart,
 * different attachment encoding, HMAC-signed body). Isolate the parsing
 * in `parsePostmarkPayload` so a sibling `parseMailgunPayload` can be
 * added without touching the auth / allowlist / ingestion logic.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Defence in depth:
 *
 *  Layer 1 — Secret token in URL path.
 *    Webhook URL is /api/inbound/email/:token, where :token must equal
 *    INBOUND_EMAIL_WEBHOOK_SECRET. Postmark's config is therefore the
 *    only place this token lives; any request without it gets a flat 404
 *    so we don't even advertise the endpoint exists. Timing-safe compare.
 *
 *  Layer 2 — Sender allowlist.
 *    Only `From` addresses in VAULT_INBOUND_ALLOWED_SENDERS get their
 *    attachments ingested. Everything else is acknowledged with 200
 *    (so Postmark doesn't retry) but dropped with an audit log line.
 *    This is the critical defence against prompt-injection payloads
 *    mailed to the address by an attacker who discovered it.
 *
 *  Layer 3 — Attachment filter.
 *    Only extensions the vault pipeline knows how to parse are ingested
 *    (pdf / docx / csv / tsv / txt / md). Everything else is logged and
 *    dropped — we never pipe unknown binary into the embedding pipeline.
 *
 *  Layer 4 — MessageID dedupe.
 *    Postmark retries on 5xx. In-memory LRU keeps the last 500 MessageIDs
 *    we've seen so a retry doesn't double-ingest. Process restart clears
 *    the map — acceptable because Postmark caps retries at ~3 over 1h,
 *    and duplicate chunks would just reduce retrieval precision slightly.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Why always 200?
 *
 * Postmark's retry policy is aggressive on 5xx. If our DB is down and we
 * 500, Postmark keeps delivering the same payload for an hour, which is
 * both noisy and can flood the ingestion queue once the DB comes back.
 * Instead we ACK 200 with `{ok: false, reason}` in the body — Postmark
 * records the response but does not retry, and we've logged the failure
 * for on-call to replay manually.
 *
 * The ONE exception is 401 on bad token: that's "your config is wrong,
 * stop delivering here", which Postmark handles correctly.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');

const vault = require('../services/vault');
const logger = require('../utils/logger');
const { findUserByEmail } = require('../authStore');

const router = express.Router();

// ── Config ────────────────────────────────────────────────────────────

// Extensions we trust the vault to parse. Mirrors ingestFile's switch.
const ALLOWED_EXT = new Set(['pdf', 'docx', 'csv', 'tsv', 'txt', 'md', 'markdown']);

// Per-message caps. Prevents a hostile payload from fanning out.
const MAX_ATTACHMENTS_PER_EMAIL = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per attachment

// MessageID LRU for dedupe. Bounded at 500 entries, oldest first.
const DEDUPE_CAPACITY = 500;
const _seenMessageIds = new Map(); // messageId → receivedAt ms

function rememberMessageId(id) {
  if (!id) return false;
  if (_seenMessageIds.has(id)) return true;
  if (_seenMessageIds.size >= DEDUPE_CAPACITY) {
    // Evict the oldest (insertion-ordered Map).
    const oldest = _seenMessageIds.keys().next().value;
    _seenMessageIds.delete(oldest);
  }
  _seenMessageIds.set(id, Date.now());
  return false;
}

// Test-only hook so unit tests start from a clean dedupe state.
function __resetDedupeForTests() {
  _seenMessageIds.clear();
}

// ── Config readers ────────────────────────────────────────────────────

function getAllowedSenders() {
  const raw = (process.env.VAULT_INBOUND_ALLOWED_SENDERS ?? '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
}

function getOwnerEmail() {
  // The user_id attached to ingested documents. We use the first
  // ADMIN_EMAILS entry as the canonical "owner" of central vault rows
  // so deletions from the admin UI line up with the ingestor identity.
  const raw = (process.env.ADMIN_EMAILS ?? '').trim();
  if (!raw) return null;
  return raw.split(',')[0].toLowerCase().trim();
}

function getWebhookSecret() {
  return (process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? '').trim();
}

// ── Auth helpers ──────────────────────────────────────────────────────

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function extractSenderEmail(payload) {
  // Postmark sends `FromFull: { Email, Name, MailboxHash }` plus a raw
  // `From: "Name <addr>"`. Prefer the structured field.
  const full = payload && payload.FromFull;
  if (full && typeof full.Email === 'string' && full.Email) {
    return full.Email.toLowerCase().trim();
  }
  const raw = payload && typeof payload.From === 'string' ? payload.From : '';
  const m = raw.match(/<([^>]+)>/);
  if (m) return m[1].toLowerCase().trim();
  return raw.toLowerCase().trim();
}

function getExtension(filename) {
  const s = String(filename || '').toLowerCase();
  const idx = s.lastIndexOf('.');
  if (idx < 0 || idx === s.length - 1) return '';
  return s.slice(idx + 1);
}

// ── Postmark payload → normalised attachment list ─────────────────────

/**
 * Normalise the Postmark inbound JSON into:
 *   { messageId, subject, sender, receivedAt, attachments: [{filename, buffer, ext}] }
 *
 * Attachments that exceed size caps or have disallowed extensions are
 * DROPPED here and surfaced in the `skipped` array so the caller can
 * log them without treating them as ingestable.
 */
function parsePostmarkPayload(payload) {
  const messageId = payload && typeof payload.MessageID === 'string' ? payload.MessageID : null;
  const subject = (payload && payload.Subject) || '(no subject)';
  const sender = extractSenderEmail(payload);
  const receivedAt = (payload && payload.Date) || new Date().toISOString();

  const accepted = [];
  const skipped = [];

  const raw = Array.isArray(payload && payload.Attachments) ? payload.Attachments : [];
  for (let i = 0; i < raw.length && accepted.length < MAX_ATTACHMENTS_PER_EMAIL; i++) {
    const att = raw[i] || {};
    const filename = typeof att.Name === 'string' ? att.Name : `attachment-${i}`;
    const ext = getExtension(filename);
    const b64 = typeof att.Content === 'string' ? att.Content : '';

    if (!ALLOWED_EXT.has(ext)) {
      skipped.push({ filename, reason: 'unsupported_extension', ext });
      continue;
    }
    if (!b64) {
      skipped.push({ filename, reason: 'empty_content' });
      continue;
    }

    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch (e) {
      skipped.push({ filename, reason: 'base64_decode_failed' });
      continue;
    }
    if (!buffer || buffer.length === 0) {
      skipped.push({ filename, reason: 'empty_after_decode' });
      continue;
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      skipped.push({ filename, reason: 'over_size_cap', bytes: buffer.length });
      continue;
    }

    accepted.push({ filename, buffer, ext, bytes: buffer.length });
  }

  return { messageId, subject, sender, receivedAt, accepted, skipped };
}

// ── Route ─────────────────────────────────────────────────────────────

/**
 * POST /api/inbound/email/:token
 *
 * Receives Postmark's inbound-webhook JSON payload. The :token segment
 * is a shared secret — without it the handler returns 404 to avoid
 * advertising the endpoint.
 *
 * Response is ALWAYS 200 on well-formed input (see "Why always 200?"
 * in the header). The JSON body tells on-call what happened per
 * attachment for audit replay.
 */
router.post('/:token', async (req, res) => {
  const wantSecret = getWebhookSecret();
  const gotToken = String(req.params.token || '');

  // Refuse to operate without a configured secret. Failing open on an
  // unconfigured env var is how credentials leak — prefer 404.
  if (!wantSecret) {
    logger.warn('inbound-email', 'Rejected — INBOUND_EMAIL_WEBHOOK_SECRET not set');
    return res.status(404).end();
  }
  if (!timingSafeEqualStrings(gotToken, wantSecret)) {
    // 401, not 404, so Postmark's dashboard shows a clear auth failure
    // when the URL is mis-configured.
    logger.warn('inbound-email', 'Rejected — token mismatch', { ip: req.ip });
    return res.status(401).json({ ok: false, reason: 'bad_token' });
  }

  const payload = req.body || {};
  const parsed = parsePostmarkPayload(payload);
  const { messageId, subject, sender, receivedAt, accepted, skipped } = parsed;

  // Dedupe.
  if (rememberMessageId(messageId)) {
    logger.info('inbound-email', 'Dropped — duplicate MessageID', { messageId, sender, subject });
    return res.status(200).json({ ok: true, reason: 'duplicate', messageId });
  }

  // Sender allowlist.
  const allowed = getAllowedSenders();
  if (allowed.length === 0) {
    logger.error('inbound-email', 'Rejected — VAULT_INBOUND_ALLOWED_SENDERS not configured', {
      messageId,
      sender,
    });
    return res.status(200).json({ ok: false, reason: 'allowlist_unconfigured', messageId });
  }
  if (!allowed.includes(sender)) {
    logger.warn('inbound-email', 'Rejected — sender not in allowlist', {
      messageId,
      sender,
      subject,
    });
    return res.status(200).json({ ok: false, reason: 'sender_not_allowed', messageId, sender });
  }

  // Resolve the "owner" user_id for central-vault rows.
  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) {
    logger.error('inbound-email', 'Rejected — ADMIN_EMAILS not configured', { messageId });
    return res.status(200).json({ ok: false, reason: 'owner_unconfigured', messageId });
  }
  const ownerUser = findUserByEmail(ownerEmail);
  if (!ownerUser || !ownerUser.id) {
    logger.error('inbound-email', 'Rejected — owner user not found', {
      messageId,
      ownerEmail,
    });
    return res.status(200).json({ ok: false, reason: 'owner_not_found', messageId });
  }

  // Ingest each accepted attachment into the central (global) vault.
  const outcomes = [];
  for (const att of accepted) {
    try {
      const result = await vault.ingestFile(
        ownerUser.id,
        att.buffer,
        att.filename,
        {
          source: 'inbound_email',
          sender,
          subject,
          messageId,
          receivedAt,
        },
        /* isGlobal */ true,
      );
      outcomes.push({
        filename: att.filename,
        bytes: att.bytes,
        ok: true,
        fileType: result && result.fileType,
        documentId: result && result.documentId,
      });
      logger.info('inbound-email', 'Ingested attachment into central vault', {
        messageId,
        sender,
        filename: att.filename,
        bytes: att.bytes,
      });
    } catch (err) {
      outcomes.push({
        filename: att.filename,
        bytes: att.bytes,
        ok: false,
        error: err && err.message,
      });
      logger.error('inbound-email', 'Attachment ingest failed', {
        messageId,
        sender,
        filename: att.filename,
        error: err && err.message,
      });
      // Keep going — we still want the rest of the batch to ingest.
    }
  }

  logger.info('inbound-email', 'Processed inbound email', {
    messageId,
    sender,
    subject,
    acceptedCount: accepted.length,
    skippedCount: skipped.length,
    ingestedCount: outcomes.filter((o) => o.ok).length,
  });

  return res.status(200).json({
    ok: true,
    messageId,
    sender,
    subject,
    accepted: outcomes,
    skipped,
  });
});

module.exports = router;
// Exposed for tests.
module.exports.__test = {
  parsePostmarkPayload,
  timingSafeEqualStrings,
  extractSenderEmail,
  __resetDedupeForTests,
};
