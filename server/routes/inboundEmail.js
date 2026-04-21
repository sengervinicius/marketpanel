/**
 * routes/inboundEmail.js — Inbound email → Central Vault ingestion.
 *
 * P3.1 — vault@the-particle.com ingests research PDFs / notes that the
 * CIO forwards from their inbox (earnings call transcripts, sell-side
 * notes, regulatory filings). Anything that lands in vault@the-particle.com
 * is parsed, chunked, embedded, and surfaced to ALL Particle users via
 * the central (global) vault.
 *
 * P4 — vault-<token>@the-particle.com ingests into the sender's PERSONAL
 * vault. Each user gets their own token (see services/inboundTokens.js);
 * their personal address has no From-allowlist because the token IS the
 * credential. The route dispatches by the recipient local part:
 *
 *   To: vault@the-particle.com               → global/admin flow
 *   To: vault-<token>@the-particle.com       → personal flow for <token>
 *   anything else                            → unknown_recipient (200 drop)
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
const inboundTokens = require('../services/inboundTokens');

const router = express.Router();

// ── Config ────────────────────────────────────────────────────────────

// Extensions we trust the vault to parse. Mirrors ingestFile's switch.
const ALLOWED_EXT = new Set(['pdf', 'docx', 'csv', 'tsv', 'txt', 'md', 'markdown']);

// Per-message caps. Prevents a hostile payload from fanning out.
const MAX_ATTACHMENTS_PER_EMAIL = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per attachment

// Body-ingestion thresholds. When an email has no parsable attachments we
// fall back to ingesting the email body itself as a synthetic .md. The
// min guards against "thanks"-style one-liners that would only pollute
// retrieval; the max is a sanity bound well above any realistic broker note.
const MIN_BODY_CHARS = 200;
const MAX_BODY_CHARS = 200_000;

// MessageID LRU for dedupe. Bounded at 500 entries, oldest first.
const DEDUPE_CAPACITY = 500;
const _seenMessageIds = new Map(); // messageId → receivedAt ms

// Phase 10.2: in-memory ring buffer of the last N delivery outcomes so
// admins can diagnose "why didn't my email arrive" without leaving Render
// logs. Capped small — this is a debugging aid, not a database.
const RECENT_CAPACITY = 50;
const _recentOutcomes = []; // newest last
function recordOutcome(entry) {
  try {
    _recentOutcomes.push({ at: new Date().toISOString(), ...entry });
    while (_recentOutcomes.length > RECENT_CAPACITY) _recentOutcomes.shift();
  } catch { /* non-critical */ }
}
function getRecentOutcomes() {
  // Most recent first — admins want to see their last attempt at the top.
  return [..._recentOutcomes].reverse();
}

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

// ── Recipient parsing ─────────────────────────────────────────────────
//
// Postmark's inbound payload exposes the envelope recipient in three
// places, in descending order of fidelity:
//
//   • OriginalRecipient  — the address the SMTP server actually RCPT TO'd.
//                          This is the most reliable when the message has
//                          been forwarded by an upstream server.
//   • ToFull[]           — structured list of header-level recipients.
//   • To                 — raw "Name <addr>, Name <addr>" header.
//
// We walk all three looking for the FIRST address whose local part starts
// with `vault` (either `vault` exactly or `vault-<token>`). Any other
// recipients (cc/bcc to the same message) are ignored — we only ingest
// what was actually addressed to us.
// The `vault` prefix is matched case-insensitively (email local parts are
// RFC-case-insensitive in practice), but the <token> capture group
// preserves its original case — our base64url tokens are case-sensitive,
// and lowercasing "AbCdEf…" would silently break every lookup.
const VAULT_LOCAL_RE = /^vault(?:-([A-Za-z0-9_-]{8,64}))?$/i;

function splitLocalAndDomain(addr) {
  if (typeof addr !== 'string') return null;
  const s = addr.trim();
  const at = s.lastIndexOf('@');
  if (at < 1 || at === s.length - 1) return null;
  // Domain is always compared case-insensitively; local part keeps its
  // case so the token survives verbatim for lookupActiveToken().
  return { local: s.slice(0, at), domain: s.slice(at + 1).toLowerCase() };
}

function candidateRecipients(payload) {
  const out = [];
  const pushOne = (raw) => {
    if (typeof raw !== 'string' || !raw) return;
    // Split a header into individual addresses.
    for (const part of raw.split(',')) {
      const m = part.match(/<([^>]+)>/);
      const e = (m ? m[1] : part).trim();
      if (e) out.push(e);
    }
  };
  if (payload) {
    pushOne(payload.OriginalRecipient);
    if (Array.isArray(payload.ToFull)) {
      for (const t of payload.ToFull) {
        if (t && typeof t.Email === 'string') out.push(t.Email);
      }
    }
    pushOne(payload.To);
  }
  return out;
}

/**
 * Resolve which vault should ingest this email. Returns one of:
 *   { kind: 'global' }
 *   { kind: 'personal', token }
 *   { kind: 'unknown' }
 *
 * We take the FIRST candidate whose local part matches VAULT_LOCAL_RE —
 * if a user BCCs multiple recipients we still do the right thing.
 */
function classifyRecipient(payload) {
  for (const addr of candidateRecipients(payload)) {
    const parts = splitLocalAndDomain(addr);
    if (!parts) continue;
    const m = parts.local.match(VAULT_LOCAL_RE);
    if (!m) continue;
    const token = m[1];
    return token ? { kind: 'personal', token, address: addr } : { kind: 'global', address: addr };
  }
  return { kind: 'unknown' };
}

// ── Per-token rate limiter ────────────────────────────────────────────
//
// Personal tokens have no allowlist gate, so a leaked token could be
// weaponised by an attacker to burn through our Voyage embedding budget.
// Cap each token at PERSONAL_RATE_MAX deliveries per PERSONAL_RATE_WIN_MS.
// In-memory is fine — the attack vector is sustained abuse, not a
// coordinated spike across pods.
const PERSONAL_RATE_MAX = 30;
const PERSONAL_RATE_WIN_MS = 60 * 60 * 1000; // 1h
const _personalRateWin = new Map(); // token → { windowStart, count }

function checkPersonalRate(token) {
  const now = Date.now();
  const row = _personalRateWin.get(token);
  if (!row || now - row.windowStart >= PERSONAL_RATE_WIN_MS) {
    _personalRateWin.set(token, { windowStart: now, count: 1 });
    return { ok: true };
  }
  if (row.count >= PERSONAL_RATE_MAX) {
    return { ok: false, retryInSec: Math.ceil((PERSONAL_RATE_WIN_MS - (now - row.windowStart)) / 1000) };
  }
  row.count++;
  return { ok: true };
}

function __resetRateLimitForTests() {
  _personalRateWin.clear();
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

// Phase 10.2: CIO reported 3 emails marked "Processed" in Postmark that
// never landed in the vault. "Processed" just means our webhook returned
// 200 — but we ACK 200 even when we *drop* a message (allowlist miss, bad
// recipient, etc.). The most common failure in practice is the From header
// not matching the allowlist verbatim, either because:
//
//   (a) the sender uses a different address in this client (iOS Mail vs
//       webmail sign different From identities),
//   (b) the message was forwarded — the envelope sender differs from the
//       header From, or
//   (c) ADMIN_EMAILS was updated but VAULT_INBOUND_ALLOWED_SENDERS wasn't.
//
// Fix: widen the "who is this really from" check. An admin (ADMIN_EMAILS)
// should never be blocked by the allowlist — their identity is already
// authoritative elsewhere in the system. And if the header From isn't on
// the list, check Reply-To / Sender / Return-Path before rejecting —
// these survive forwarding more consistently than the display From.
function getAdminEmails() {
  const raw = (process.env.ADMIN_EMAILS ?? '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.toLowerCase().trim()).filter(Boolean);
}

function extractAlternateSenders(payload) {
  const out = new Set();
  if (!payload) return out;

  // Postmark's ReplyToFull / Reply-To is often the "real" identity when
  // forwarding through an auto-responder or mailing list.
  const rtFull = payload.ReplyToFull;
  if (Array.isArray(rtFull)) {
    for (const r of rtFull) {
      if (r && typeof r.Email === 'string' && r.Email) out.add(r.Email.toLowerCase().trim());
    }
  }
  if (typeof payload.ReplyTo === 'string') {
    for (const part of payload.ReplyTo.split(',')) {
      const m = part.match(/<([^>]+)>/);
      const e = (m ? m[1] : part).trim().toLowerCase();
      if (e) out.add(e);
    }
  }

  // Walk the raw Headers[] block for Return-Path / Sender / X-Original-From.
  // Postmark delivers custom headers here exactly as the MTA saw them.
  const headers = Array.isArray(payload.Headers) ? payload.Headers : [];
  const WANTED = new Set(['return-path', 'sender', 'x-original-from', 'x-forwarded-for']);
  for (const h of headers) {
    if (!h || typeof h.Name !== 'string' || typeof h.Value !== 'string') continue;
    if (!WANTED.has(h.Name.toLowerCase())) continue;
    // Strip angle brackets, pick the first address if multiple.
    const v = h.Value.trim();
    const m = v.match(/<([^>]+)>/);
    const e = (m ? m[1] : v.split(',')[0] || '').trim().toLowerCase();
    if (e && e.includes('@')) out.add(e);
  }

  return out;
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

// ── Email-body fallback ───────────────────────────────────────────────
//
// Some senders paste the research note straight into the body with no
// PDF attached (e.g. morning strategy blasts, sell-side trade ideas).
// When the email has no parsable attachments AND the body clears a
// minimum-length bar, we synthesise a `.md` document and route it
// through the same vault.ingestFile path attachments use — so the W4.1
// scrubber, chunker, and pgvector indexing all apply uniformly.

// Minimal HTML → text fallback. Good enough for the Apple-Mail /
// Outlook / Gmail shapes we actually see; not a general-purpose HTML
// parser. We do NOT try to render tables, CSS, or images — if a
// research desk sends richly-formatted HTML-only mail, the recall
// improvement from doing it perfectly is marginal vs. the risk of
// pulling in a heavy DOM library on the critical ingestion path.
function htmlToText(html) {
  if (typeof html !== 'string' || !html) return '';
  let s = html;
  // Strip scripts / styles wholesale (content is never human-readable).
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Strip HTML comments (often contain tracking pixels, list markers).
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Block-level elements → newlines so paragraphs don't collapse.
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6]|br)\s*>/gi, '\n');
  // Everything else → nothing.
  s = s.replace(/<[^>]+>/g, '');
  // Decode the handful of entities Gmail / Outlook actually emit.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return s;
}

// Collapse runaway whitespace a la Mail.app's soft-wrapped bodies while
// preserving paragraph breaks.
function normaliseBodyText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Best-effort extraction of the "new" content from a reply-chain email.
 *
 * Postmark's `StrippedTextReply` already does this when it recognises the
 * reply boundary; we honour that first. Otherwise we cut at the common
 * quote markers — this is deliberately conservative and only trims
 * obvious boundaries so we don't accidentally delete the actual content.
 */
function parseEmailBody(payload) {
  if (!payload || typeof payload !== 'object') return { text: '', source: null };

  // 1. Postmark pre-strips reply history when it can — highest quality signal.
  const stripped = typeof payload.StrippedTextReply === 'string' ? payload.StrippedTextReply.trim() : '';
  if (stripped) {
    return { text: normaliseBodyText(stripped), source: 'stripped' };
  }

  // 2. Plain-text body is next-best. Cut at obvious reply markers.
  const textBody = typeof payload.TextBody === 'string' ? payload.TextBody : '';
  if (textBody.trim()) {
    let t = textBody;
    // Common reply/forward separators, in order of reliability.
    const markers = [
      /\nOn .+ wrote:\n/,
      /\n-----\s*Original Message\s*-----\n/i,
      /\nFrom:\s.+\nSent:/i,
      /\n________________________________\n/,
      /\n-- \n/, // signature delimiter (RFC-ish)
    ];
    for (const rx of markers) {
      const idx = t.search(rx);
      if (idx > 0) {
        t = t.slice(0, idx);
      }
    }
    const out = normaliseBodyText(t);
    if (out) return { text: out, source: 'textbody' };
  }

  // 3. HTML-only last resort (Outlook often sends HTML with empty TextBody).
  const htmlBody = typeof payload.HtmlBody === 'string' ? payload.HtmlBody : '';
  if (htmlBody.trim()) {
    const out = normaliseBodyText(htmlToText(htmlBody));
    if (out) return { text: out, source: 'html' };
  }

  return { text: '', source: null };
}

function sanitiseFilenameStub(subject, receivedAt) {
  const base = String(subject || 'email').slice(0, 80);
  const cleaned = base
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'email';
  // Pull date-only prefix for filesystem stability / at-a-glance ordering.
  let datePart = '';
  try {
    const d = new Date(receivedAt);
    if (!isNaN(d.getTime())) datePart = d.toISOString().slice(0, 10);
  } catch (_) { /* fall through */ }
  return datePart ? `${datePart} - ${cleaned}.md` : `${cleaned}.md`;
}

/**
 * Wrap the extracted body in a small frontmatter header so the retrieval
 * layer sees `Subject/From/Date` alongside the content — helpful for
 * later citations like "per the 2026-04-20 Goldman morning note".
 */
function buildBodyDocument({ text, subject, sender, receivedAt, source }) {
  const header =
    `# ${subject || '(no subject)'}\n\n` +
    `**From:** ${sender}\n` +
    `**Date:** ${receivedAt}\n` +
    `**Source:** email-body (${source})\n\n` +
    `---\n\n`;
  const body = text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text;
  return Buffer.from(header + body, 'utf8');
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
    recordOutcome({ outcome: 'duplicate', messageId, sender, subject });
    return res.status(200).json({ ok: true, reason: 'duplicate', messageId });
  }

  // Classify by recipient (To/ToFull/OriginalRecipient). Decides which
  // vault this message belongs to before we spend any work parsing.
  const classification = classifyRecipient(payload);
  if (classification.kind === 'unknown') {
    logger.warn('inbound-email', 'Dropped — recipient is not a vault address', {
      messageId,
      sender,
    });
    recordOutcome({
      outcome: 'dropped',
      reason: 'unknown_recipient',
      messageId,
      sender,
      subject,
      recipients: candidateRecipients(payload),
    });
    return res.status(200).json({ ok: false, reason: 'unknown_recipient', messageId });
  }

  // ── Personal flow (vault-<token>@…) ─────────────────────────────────
  if (classification.kind === 'personal') {
    const tokenStr = classification.token;
    const rate = checkPersonalRate(tokenStr);
    if (!rate.ok) {
      logger.warn('inbound-email', 'Dropped — personal token rate-limited', {
        messageId,
        retryInSec: rate.retryInSec,
      });
      recordOutcome({
        outcome: 'dropped',
        reason: 'rate_limited',
        kind: 'personal',
        messageId,
        sender,
        subject,
        retryInSec: rate.retryInSec,
      });
      return res.status(200).json({
        ok: false,
        reason: 'rate_limited',
        retryInSec: rate.retryInSec,
        messageId,
      });
    }
    const tokRow = await inboundTokens.lookupActiveToken(tokenStr);
    if (!tokRow) {
      logger.warn('inbound-email', 'Dropped — unknown or revoked personal token', {
        messageId,
        sender,
      });
      recordOutcome({
        outcome: 'dropped',
        reason: 'unknown_token',
        kind: 'personal',
        messageId,
        sender,
        subject,
      });
      return res.status(200).json({ ok: false, reason: 'unknown_token', messageId });
    }
    const result = await ingestEmail({
      payload,
      parsed,
      ownerId: tokRow.userId,
      isGlobal: false,
      sourceTag: 'inbound_email_personal',
      bodySourceTag: 'inbound_email_personal_body',
    });
    logger.info('inbound-email', 'Processed personal inbound email', {
      messageId,
      sender,
      subject,
      userId: tokRow.userId,
      acceptedCount: accepted.length,
      ingestedCount: result.outcomes.filter((o) => o.ok).length,
      bodyIngested: !!(result.bodyIngest && result.bodyIngest.ok),
    });
    recordOutcome({
      outcome: 'processed',
      kind: 'personal',
      messageId,
      sender,
      subject,
      userId: tokRow.userId,
      acceptedCount: accepted.length,
      ingestedCount: result.outcomes.filter((o) => o.ok).length,
      skippedCount: result.skipped.length,
      bodyIngested: !!(result.bodyIngest && result.bodyIngest.ok),
    });
    return res.status(200).json({
      ok: true,
      kind: 'personal',
      messageId,
      sender,
      subject,
      accepted: result.outcomes,
      skipped: result.skipped,
      body: result.bodyIngest,
    });
  }

  // ── Global / admin flow (vault@…) ───────────────────────────────────
  // Sender allowlist. Phase 10.2: admins are implicitly allowed, and we
  // check Reply-To / Sender / Return-Path headers as fallbacks before
  // rejecting on From alone.
  const allowed = getAllowedSenders();
  const adminEmails = getAdminEmails();
  const effectiveAllowed = new Set([...allowed, ...adminEmails]);

  if (effectiveAllowed.size === 0) {
    logger.error('inbound-email', 'Rejected — no allowlist configured (VAULT_INBOUND_ALLOWED_SENDERS / ADMIN_EMAILS)', {
      messageId,
      sender,
    });
    recordOutcome({
      outcome: 'dropped',
      reason: 'allowlist_unconfigured',
      kind: 'global',
      messageId,
      sender,
      subject,
    });
    return res.status(200).json({ ok: false, reason: 'allowlist_unconfigured', messageId });
  }

  const alternateSenders = extractAlternateSenders(payload);
  const allCandidateSenders = [sender, ...alternateSenders].filter(Boolean);
  const matchedSender = allCandidateSenders.find(s => effectiveAllowed.has(s));

  if (!matchedSender) {
    logger.warn('inbound-email', 'Rejected — no sender identity in allowlist', {
      messageId,
      sender,
      subject,
      alternateSenders: [...alternateSenders],
      allowlistSize: effectiveAllowed.size,
    });
    recordOutcome({
      outcome: 'dropped',
      reason: 'sender_not_allowed',
      kind: 'global',
      messageId,
      sender,
      subject,
      checked: allCandidateSenders,
    });
    return res.status(200).json({
      ok: false,
      reason: 'sender_not_allowed',
      messageId,
      sender,
      // Surface the alternate identities we checked so on-call can see
      // which header to add to the allowlist env var to unblock a user.
      checked: allCandidateSenders,
    });
  }

  if (matchedSender !== sender) {
    logger.info('inbound-email', 'Accepted via alternate sender header', {
      messageId,
      originalFrom: sender,
      matchedSender,
    });
  }

  // Resolve the "owner" user_id for central-vault rows.
  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) {
    logger.error('inbound-email', 'Rejected — ADMIN_EMAILS not configured', { messageId });
    recordOutcome({
      outcome: 'dropped',
      reason: 'owner_unconfigured',
      kind: 'global',
      messageId,
      sender,
      subject,
    });
    return res.status(200).json({ ok: false, reason: 'owner_unconfigured', messageId });
  }
  const ownerUser = findUserByEmail(ownerEmail);
  if (!ownerUser || !ownerUser.id) {
    logger.error('inbound-email', 'Rejected — owner user not found', {
      messageId,
      ownerEmail,
    });
    recordOutcome({
      outcome: 'dropped',
      reason: 'owner_not_found',
      kind: 'global',
      messageId,
      sender,
      subject,
      ownerEmail,
    });
    return res.status(200).json({ ok: false, reason: 'owner_not_found', messageId });
  }

  const result = await ingestEmail({
    payload,
    parsed,
    ownerId: ownerUser.id,
    isGlobal: true,
    sourceTag: 'inbound_email',
    bodySourceTag: 'inbound_email_body',
  });

  logger.info('inbound-email', 'Processed inbound email', {
    messageId,
    sender,
    subject,
    acceptedCount: accepted.length,
    skippedCount: result.skipped.length,
    ingestedCount: result.outcomes.filter((o) => o.ok).length,
    bodyIngested: !!(result.bodyIngest && result.bodyIngest.ok),
  });
  recordOutcome({
    outcome: 'processed',
    kind: 'global',
    messageId,
    sender,
    matchedSender: matchedSender !== sender ? matchedSender : undefined,
    subject,
    ownerEmail,
    acceptedCount: accepted.length,
    ingestedCount: result.outcomes.filter((o) => o.ok).length,
    skippedCount: result.skipped.length,
    bodyIngested: !!(result.bodyIngest && result.bodyIngest.ok),
  });

  return res.status(200).json({
    ok: true,
    kind: 'global',
    messageId,
    sender,
    subject,
    accepted: result.outcomes,
    skipped: result.skipped,
    body: result.bodyIngest,
  });
});

// ── Shared ingestion helper ───────────────────────────────────────────
//
// Both the global (admin) flow and the personal flow do the same work:
//   1. Loop accepted attachments into vault.ingestFile, tolerant of
//      per-file failures.
//   2. If no attachments were accepted, fall back to ingesting the
//      email body as a synthetic .md.
// The only differences are:
//   • ownerId  — admin's user_id vs the token-resolved user_id
//   • isGlobal — true for the central vault, false for the personal one
//   • sourceTag / bodySourceTag — for downstream provenance filtering
//
async function ingestEmail({ payload, parsed, ownerId, isGlobal, sourceTag, bodySourceTag }) {
  const { messageId, subject, sender, receivedAt, accepted, skipped } = parsed;
  const outcomes = [];
  for (const att of accepted) {
    try {
      const result = await vault.ingestFile(
        ownerId,
        att.buffer,
        att.filename,
        { source: sourceTag, sender, subject, messageId, receivedAt },
        isGlobal,
      );
      outcomes.push({
        filename: att.filename,
        bytes: att.bytes,
        ok: true,
        fileType: result && result.fileType,
        documentId: result && result.documentId,
      });
      logger.info('inbound-email', 'Ingested attachment', {
        messageId, sender, filename: att.filename, bytes: att.bytes, isGlobal,
      });
    } catch (err) {
      outcomes.push({
        filename: att.filename,
        bytes: att.bytes,
        ok: false,
        error: err && err.message,
      });
      logger.error('inbound-email', 'Attachment ingest failed', {
        messageId, sender, filename: att.filename, error: err && err.message, isGlobal,
      });
    }
  }

  // Body-fallback: only when nothing landed as an attachment.
  let bodyIngest = null;
  if (accepted.length === 0) {
    const body = parseEmailBody(payload);
    if (body.text && body.text.length >= MIN_BODY_CHARS) {
      const filename = sanitiseFilenameStub(subject, receivedAt);
      const buffer = buildBodyDocument({
        text: body.text, subject, sender, receivedAt, source: body.source,
      });
      try {
        const result = await vault.ingestFile(
          ownerId,
          buffer,
          filename,
          {
            source: bodySourceTag,
            sender, subject, messageId, receivedAt,
            bodyContentType: body.source,
          },
          isGlobal,
        );
        bodyIngest = {
          filename, bytes: buffer.length, ok: true, source: body.source,
          fileType: result && result.fileType,
          documentId: result && result.documentId,
        };
        logger.info('inbound-email', 'Ingested email body', {
          messageId, sender, filename, bytes: buffer.length,
          bodyContentType: body.source, isGlobal,
        });
      } catch (err) {
        bodyIngest = {
          filename, bytes: buffer.length, ok: false, source: body.source,
          error: err && err.message,
        };
        logger.error('inbound-email', 'Email body ingest failed', {
          messageId, sender, filename, error: err && err.message, isGlobal,
        });
      }
    } else if (body.text) {
      skipped.push({ filename: '(email-body)', reason: 'body_too_short', bytes: body.text.length });
    }
  }

  return { outcomes, skipped, bodyIngest };
}

module.exports = router;
// Phase 10.2 — exposed to the admin debug surface so the CIO/on-call can
// see why recent deliveries were dropped without tailing Render logs.
module.exports.getRecentOutcomes = getRecentOutcomes;
// Exposed for tests.
module.exports.__test = {
  parsePostmarkPayload,
  parseEmailBody,
  htmlToText,
  normaliseBodyText,
  sanitiseFilenameStub,
  buildBodyDocument,
  timingSafeEqualStrings,
  extractSenderEmail,
  __resetDedupeForTests,
  // P4 — personal inbound dispatch helpers
  classifyRecipient,
  splitLocalAndDomain,
  candidateRecipients,
  checkPersonalRate,
  __resetRateLimitForTests,
  PERSONAL_RATE_MAX,
  PERSONAL_RATE_WIN_MS,
  MIN_BODY_CHARS,
};
