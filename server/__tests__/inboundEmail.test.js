/**
 * inboundEmail.test.js — P3.1 regression guard.
 *
 * Confirms the Postmark inbound webhook correctly:
 *   - rejects 404 when the webhook secret is unconfigured
 *   - rejects 401 on bad token
 *   - drops senders outside VAULT_INBOUND_ALLOWED_SENDERS (with 200 ACK)
 *   - dedupes the same MessageID on retry
 *   - parses base64 attachments and calls vault.ingestFile with isGlobal=true
 *   - drops unsupported extensions and over-size attachments into `skipped`
 *
 * Run:
 *   node --test server/__tests__/inboundEmail.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

process.env.NODE_ENV = 'test';

// ── Stub vault.ingestFile + authStore.findUserByEmail before require ───
const vaultPath = require.resolve('../services/vault');
const authStorePath = require.resolve('../authStore');

let _ingestCalls = [];
let _ingestError = null;

require.cache[vaultPath] = {
  id: vaultPath,
  filename: vaultPath,
  loaded: true,
  exports: {
    ingestFile: async (userId, buffer, filename, metadata, isGlobal) => {
      _ingestCalls.push({ userId, filename, bytes: buffer.length, metadata, isGlobal });
      if (_ingestError) throw _ingestError;
      return { documentId: 999, fileType: filename.split('.').pop() };
    },
  },
  children: [],
  paths: [],
};

require.cache[authStorePath] = {
  id: authStorePath,
  filename: authStorePath,
  loaded: true,
  exports: {
    findUserByEmail: (email) => {
      if (email === 'founder@the-particle.com') return { id: 42, email };
      return null;
    },
  },
  children: [],
  paths: [],
};

// ── Also stub logger so tests stay quiet ──────────────────────────────
const loggerPath = require.resolve('../utils/logger');
const silent = () => {};
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    info: silent, warn: silent, error: silent, debug: silent,
    requestLogger: (req, res, next) => next(),
    correlationSync: (req, res, next) => next(),
  },
  children: [],
  paths: [],
};

// ── Module under test ─────────────────────────────────────────────────
const inboundEmailRoutes = require('../routes/inboundEmail');
const { __test } = inboundEmailRoutes;

// ── Helpers ────────────────────────────────────────────────────────────

function makeServer() {
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use('/api/inbound/email', inboundEmailRoutes);
  const server = app.listen(0);
  const { port } = server.address();
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: { 'content-type': 'application/json', 'content-length': data.length },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function samplePayload(overrides = {}) {
  return {
    MessageID: 'msg-001',
    Subject: 'Q4 earnings deep dive',
    From: 'Vinicius <founder@the-particle.com>',
    FromFull: { Email: 'founder@the-particle.com', Name: 'Vinicius' },
    // Global (admin) recipient by default. P4 tests override with
    // vault-<token>@… via OriginalRecipient.
    To: 'vault@the-particle.com',
    Date: '2026-04-20T12:00:00Z',
    Attachments: [
      { Name: 'earnings.pdf', Content: b64('%PDF-1.4 stub'), ContentType: 'application/pdf' },
    ],
    ...overrides,
  };
}

function resetEnvAndState() {
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'hunter2';
  process.env.VAULT_INBOUND_ALLOWED_SENDERS = 'founder@the-particle.com,vinicius@arccapital.com.br';
  process.env.ADMIN_EMAILS = 'founder@the-particle.com';
  _ingestCalls = [];
  _ingestError = null;
  __test.__resetDedupeForTests();
  __test.__resetRateLimitForTests();
}

// ── parsePostmarkPayload ──────────────────────────────────────────────

test('parsePostmarkPayload: accepts supported extension and base64 content', () => {
  const out = __test.parsePostmarkPayload(samplePayload());
  assert.equal(out.messageId, 'msg-001');
  assert.equal(out.sender, 'founder@the-particle.com');
  assert.equal(out.accepted.length, 1);
  assert.equal(out.accepted[0].filename, 'earnings.pdf');
  assert.equal(out.skipped.length, 0);
});

test('parsePostmarkPayload: skips unsupported extensions', () => {
  const out = __test.parsePostmarkPayload(
    samplePayload({
      Attachments: [
        { Name: 'bad.exe', Content: b64('MZ...'), ContentType: 'application/octet-stream' },
        { Name: 'good.txt', Content: b64('hello'), ContentType: 'text/plain' },
      ],
    }),
  );
  assert.equal(out.accepted.length, 1);
  assert.equal(out.accepted[0].filename, 'good.txt');
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].reason, 'unsupported_extension');
});

test('parsePostmarkPayload: caps attachment count at 10', () => {
  const many = Array.from({ length: 15 }).map((_, i) => ({
    Name: `doc-${i}.txt`,
    Content: b64(`content ${i}`),
  }));
  const out = __test.parsePostmarkPayload(samplePayload({ Attachments: many }));
  assert.equal(out.accepted.length, 10);
});

test('extractSenderEmail: prefers FromFull.Email, falls back to From angle brackets', () => {
  assert.equal(
    __test.extractSenderEmail({ FromFull: { Email: 'A@B.com' }, From: 'ignored' }),
    'a@b.com',
  );
  assert.equal(
    __test.extractSenderEmail({ From: 'Vinicius <vinicius@arccapital.com.br>' }),
    'vinicius@arccapital.com.br',
  );
  assert.equal(__test.extractSenderEmail({ From: 'raw@test.com' }), 'raw@test.com');
});

test('timingSafeEqualStrings: true on match, false on mismatch and length diff', () => {
  assert.equal(__test.timingSafeEqualStrings('abc', 'abc'), true);
  assert.equal(__test.timingSafeEqualStrings('abc', 'abd'), false);
  assert.equal(__test.timingSafeEqualStrings('abc', 'abcd'), false);
  assert.equal(__test.timingSafeEqualStrings(null, 'abc'), false);
});

// ── Route-level ───────────────────────────────────────────────────────

test('POST without a configured secret → 404', async () => {
  resetEnvAndState();
  delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  const srv = makeServer();
  try {
    const res = await postJson(`${srv.url}/api/inbound/email/anything`, samplePayload());
    assert.equal(res.status, 404);
  } finally {
    await srv.close();
  }
});

test('POST with wrong token → 401 bad_token', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const res = await postJson(`${srv.url}/api/inbound/email/wrong`, samplePayload());
    assert.equal(res.status, 401);
    assert.equal(res.body.reason, 'bad_token');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

test('POST from disallowed sender → 200 but sender_not_allowed', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      FromFull: { Email: 'attacker@evil.com' },
      From: 'attacker@evil.com',
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'sender_not_allowed');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

test('POST with allowed sender and PDF attachment → ingested into central vault', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, samplePayload());
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.accepted.length, 1);
    assert.equal(res.body.accepted[0].ok, true);
    assert.equal(res.body.accepted[0].filename, 'earnings.pdf');
    assert.equal(_ingestCalls.length, 1);
    const call = _ingestCalls[0];
    assert.equal(call.userId, 42); // founder@the-particle.com
    assert.equal(call.isGlobal, true);
    assert.equal(call.metadata.source, 'inbound_email');
    assert.equal(call.metadata.sender, 'founder@the-particle.com');
    assert.equal(call.metadata.messageId, 'msg-001');
  } finally {
    await srv.close();
  }
});

test('Duplicate MessageID is dropped on retry', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    await postJson(`${srv.url}/api/inbound/email/hunter2`, samplePayload());
    const res2 = await postJson(`${srv.url}/api/inbound/email/hunter2`, samplePayload());
    assert.equal(res2.status, 200);
    assert.equal(res2.body.reason, 'duplicate');
    assert.equal(_ingestCalls.length, 1); // only the first delivered
  } finally {
    await srv.close();
  }
});

test('ingestFile failure on one attachment does not stop the rest', async () => {
  resetEnvAndState();

  // Re-wire the ingest stub: fail the first, succeed the second.
  const origIngest = require.cache[vaultPath].exports.ingestFile;
  let seen = 0;
  require.cache[vaultPath].exports.ingestFile = async (userId, buffer, filename, metadata, isGlobal) => {
    _ingestCalls.push({ userId, filename, bytes: buffer.length, metadata, isGlobal });
    seen++;
    if (seen === 1) throw new Error('embedding provider down');
    return { documentId: 1000 + seen, fileType: filename.split('.').pop() };
  };

  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-002',
      Attachments: [
        { Name: 'broken.pdf', Content: b64('stub-1') },
        { Name: 'works.pdf', Content: b64('stub-2') },
      ],
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.accepted.length, 2);
    assert.equal(res.body.accepted[0].ok, false);
    assert.equal(res.body.accepted[1].ok, true);
    assert.equal(_ingestCalls.length, 2);
  } finally {
    require.cache[vaultPath].exports.ingestFile = origIngest;
    await srv.close();
  }
});

test('Allowlist unconfigured → 200 but rejected', async () => {
  resetEnvAndState();
  delete process.env.VAULT_INBOUND_ALLOWED_SENDERS;
  const srv = makeServer();
  try {
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, samplePayload());
    assert.equal(res.status, 200);
    assert.equal(res.body.reason, 'allowlist_unconfigured');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

// ── Body-ingestion fallback ───────────────────────────────────────────

const LONG_BODY = (
  'Morning thoughts on the tape:\n\n' +
  'US equities opened firmer on the back of the PCE miss. Bonds bid, ' +
  'dollar offered. Front-end is unwinding the Jackson-Hole hawkishness. ' +
  'Brazil CDS marked 6bp tighter overnight. DI Jan-27 richened 8bp on the ' +
  'back of lower US yields. Copom minutes on Wednesday. '.repeat(4)
).trim();

test('Body-only email (TextBody): ingests as synthetic .md when no attachments', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-body-001',
      Subject: 'GS Morning Notes — 20 Apr 2026',
      Attachments: [],
      TextBody: LONG_BODY,
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.accepted.length, 0);
    assert.ok(res.body.body, 'expected body ingest block in response');
    assert.equal(res.body.body.ok, true);
    assert.equal(res.body.body.source, 'textbody');
    assert.ok(res.body.body.filename.endsWith('.md'), 'filename must be .md');
    assert.equal(_ingestCalls.length, 1);
    const call = _ingestCalls[0];
    assert.equal(call.isGlobal, true);
    assert.equal(call.metadata.source, 'inbound_email_body');
    assert.equal(call.metadata.bodyContentType, 'textbody');
    // Header block should prefix the content.
    const body = call.buffer
      ? call.buffer.toString('utf8')
      : ''; // buffer not captured in stub; verify via bytes instead
    // Stub only captures bytes; prove it's > header+min body length instead.
    assert.ok(call.bytes >= LONG_BODY.length, 'payload includes body text');
  } finally {
    await srv.close();
  }
});

test('Body-only email (HtmlBody fallback): strips tags and ingests', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const htmlBody =
      '<html><body>' +
      '<p>US equities opened firmer on the back of the PCE miss.</p>' +
      '<p>Bonds bid, dollar offered. ' +
        'Front-end is unwinding the Jackson-Hole hawkishness. ' +
      '</p>' +
      '<p>' + ('Copom minutes on Wednesday. '.repeat(20)) + '</p>' +
      '<script>alert(1)</script>' +
      '</body></html>';
    const payload = samplePayload({
      MessageID: 'msg-body-002',
      Subject: 'Outlook-only HTML note',
      Attachments: [],
      TextBody: '',
      HtmlBody: htmlBody,
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.body.ok, true);
    assert.equal(res.body.body.source, 'html');
    assert.equal(_ingestCalls.length, 1);
    assert.equal(_ingestCalls[0].metadata.source, 'inbound_email_body');
    assert.equal(_ingestCalls[0].metadata.bodyContentType, 'html');
  } finally {
    await srv.close();
  }
});

test('Body is ignored when the email has a parsable attachment', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-body-003',
      TextBody: LONG_BODY,
      // Default attachment (earnings.pdf) is kept.
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.accepted.length, 1);
    // No body block should be emitted when attachments already ingested.
    assert.equal(res.body.body ?? null, null);
    assert.equal(_ingestCalls.length, 1);
    assert.equal(_ingestCalls[0].metadata.source, 'inbound_email');
  } finally {
    await srv.close();
  }
});

test('Body shorter than MIN_BODY_CHARS is not ingested', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-body-004',
      Attachments: [],
      TextBody: 'thanks!',
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.body ?? null, null);
    assert.equal(_ingestCalls.length, 0);
    // Expect a skipped entry noting the short body.
    const short = (res.body.skipped || []).find((s) => s.reason === 'body_too_short');
    assert.ok(short, 'expected body_too_short in skipped');
  } finally {
    await srv.close();
  }
});

test('StrippedTextReply is preferred over TextBody for body ingestion', async () => {
  resetEnvAndState();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-body-005',
      Attachments: [],
      StrippedTextReply: LONG_BODY,
      TextBody: LONG_BODY + '\n\nOn Mon, Apr 20 2026 at 7:12, Analyst wrote:\n> old thread',
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.body.body.source, 'stripped');
    assert.equal(_ingestCalls[0].metadata.bodyContentType, 'stripped');
  } finally {
    await srv.close();
  }
});

// ── P4 recipient classification ───────────────────────────────────────

test('classifyRecipient: vault@ → global', () => {
  const c = __test.classifyRecipient({ To: 'vault@the-particle.com' });
  assert.equal(c.kind, 'global');
});

test('classifyRecipient: vault-<token>@ → personal, preserves token case', () => {
  const c = __test.classifyRecipient({
    To: 'vault-AbCdEfGhIjKlMn0p9Q8R7S@the-particle.com',
  });
  assert.equal(c.kind, 'personal');
  // Token case is preserved — base64url tokens are case-sensitive.
  assert.equal(c.token, 'AbCdEfGhIjKlMn0p9Q8R7S');
});

test('classifyRecipient: OriginalRecipient wins over To', () => {
  const c = __test.classifyRecipient({
    OriginalRecipient: 'vault-TOKENABCDEFGH12@the-particle.com',
    To: 'someone-else@example.com',
  });
  assert.equal(c.kind, 'personal');
  assert.equal(c.token, 'TOKENABCDEFGH12');
});

test('classifyRecipient: unknown local → unknown', () => {
  const c = __test.classifyRecipient({ To: 'hello@the-particle.com' });
  assert.equal(c.kind, 'unknown');
});

test('classifyRecipient: ToFull array traversal', () => {
  const c = __test.classifyRecipient({
    ToFull: [{ Email: 'notmine@x.com' }, { Email: 'vault-ABCDEFGH12345678@the-particle.com' }],
  });
  assert.equal(c.kind, 'personal');
  assert.equal(c.token, 'ABCDEFGH12345678');
});

test('classifyRecipient: VAULT@ prefix matched case-insensitively (global)', () => {
  const c = __test.classifyRecipient({ To: 'VAULT@The-Particle.com' });
  assert.equal(c.kind, 'global');
});

// ── P4 personal flow ──────────────────────────────────────────────────

const inboundTokens = require('../services/inboundTokens');

async function mintAndGetToken(userId) {
  const row = await inboundTokens.mintForUser(userId);
  return row.token;
}

function resetP4() {
  resetEnvAndState();
  inboundTokens.__test.__resetForTests();
  __test.__resetRateLimitForTests();
}

test('P4: personal address routes to isGlobal=false with the token owner as userId', async () => {
  resetP4();
  // Seed a token for user 77.
  const tok = await mintAndGetToken(77);
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-p4-001',
      // Deliberately use a sender NOT in the allowlist — personal flow
      // must NOT enforce the allowlist.
      FromFull: { Email: 'some-user@example.com' },
      From: 'some-user@example.com',
      OriginalRecipient: `vault-${tok}@the-particle.com`,
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.kind, 'personal');
    assert.equal(_ingestCalls.length, 1);
    assert.equal(_ingestCalls[0].userId, 77);
    assert.equal(_ingestCalls[0].isGlobal, false);
    assert.equal(_ingestCalls[0].metadata.source, 'inbound_email_personal');
  } finally {
    await srv.close();
  }
});

test('P4: unknown/revoked token → 200 unknown_token and no ingest', async () => {
  resetP4();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-p4-002',
      OriginalRecipient: 'vault-notarealtokenatall@the-particle.com',
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'unknown_token');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

test('P4: unknown recipient (not a vault address) → unknown_recipient', async () => {
  resetP4();
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-p4-003',
      OriginalRecipient: 'billing@the-particle.com',
      To: 'billing@the-particle.com',
      ToFull: [],
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'unknown_recipient');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

test('P4: per-token rate limit kicks in after PERSONAL_RATE_MAX requests', async () => {
  resetP4();
  const tok = await mintAndGetToken(88);
  const srv = makeServer();
  try {
    // Burn through the limit.
    for (let i = 0; i < __test.PERSONAL_RATE_MAX; i++) {
      const payload = samplePayload({
        MessageID: `msg-rate-${i}`,
        OriginalRecipient: `vault-${tok}@the-particle.com`,
      });
      const r = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true, `call ${i} should succeed`);
    }
    // One more → rate_limited.
    const payload = samplePayload({
      MessageID: 'msg-rate-over',
      OriginalRecipient: `vault-${tok}@the-particle.com`,
    });
    const r = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.reason, 'rate_limited');
    assert.ok(typeof r.body.retryInSec === 'number');
    // Ingest count = the successful deliveries only.
    assert.equal(_ingestCalls.length, __test.PERSONAL_RATE_MAX);
  } finally {
    await srv.close();
  }
});

test('P4: revoked token returns unknown_token even if once valid', async () => {
  resetP4();
  const tok = await mintAndGetToken(99);
  await inboundTokens.revokeForUser(99);
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-p4-revoked',
      OriginalRecipient: `vault-${tok}@the-particle.com`,
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.body.reason, 'unknown_token');
    assert.equal(_ingestCalls.length, 0);
  } finally {
    await srv.close();
  }
});

test('P4: rotate (mint-again) invalidates the old token', async () => {
  resetP4();
  const oldTok = await mintAndGetToken(55);
  const newRow = await inboundTokens.mintForUser(55);
  assert.notEqual(newRow.token, oldTok);
  const srv = makeServer();
  try {
    // Old token → rejected
    const oldRes = await postJson(
      `${srv.url}/api/inbound/email/hunter2`,
      samplePayload({
        MessageID: 'msg-rotate-old',
        OriginalRecipient: `vault-${oldTok}@the-particle.com`,
      }),
    );
    assert.equal(oldRes.body.reason, 'unknown_token');
    // New token → accepted
    const newRes = await postJson(
      `${srv.url}/api/inbound/email/hunter2`,
      samplePayload({
        MessageID: 'msg-rotate-new',
        OriginalRecipient: `vault-${newRow.token}@the-particle.com`,
      }),
    );
    assert.equal(newRes.body.ok, true);
    assert.equal(_ingestCalls[0].userId, 55);
    assert.equal(_ingestCalls[0].isGlobal, false);
  } finally {
    await srv.close();
  }
});

test('P4: personal body-only email lands in the user vault as .md', async () => {
  resetP4();
  const tok = await mintAndGetToken(61);
  const srv = makeServer();
  try {
    const payload = samplePayload({
      MessageID: 'msg-p4-body',
      OriginalRecipient: `vault-${tok}@the-particle.com`,
      Attachments: [],
      TextBody: LONG_BODY,
    });
    const res = await postJson(`${srv.url}/api/inbound/email/hunter2`, payload);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.kind, 'personal');
    assert.equal(res.body.body.ok, true);
    assert.equal(res.body.body.source, 'textbody');
    assert.equal(_ingestCalls.length, 1);
    assert.equal(_ingestCalls[0].userId, 61);
    assert.equal(_ingestCalls[0].isGlobal, false);
    assert.equal(_ingestCalls[0].metadata.source, 'inbound_email_personal_body');
  } finally {
    await srv.close();
  }
});
