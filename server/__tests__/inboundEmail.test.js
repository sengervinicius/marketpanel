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
