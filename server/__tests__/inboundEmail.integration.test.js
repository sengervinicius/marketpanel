/**
 * inboundEmail.integration.test.js — wave-nov Phase Z item (a).
 *
 * Two guarantees the unit suite (inboundEmail.test.js) does not give:
 *
 *   1. MOUNT — server/index.js actually mounts routes/inboundEmail at
 *      /api/inbound/email. The unit suite mounts the router itself, so a
 *      deleted/renamed app.use() line would pass every existing test while
 *      the production webhook 404s. We assert against the index.js source.
 *
 *   2. END-TO-END INGEST — a REALISTIC Postmark inbound payload (ToFull,
 *      MessageStream, Headers, TextBody, mixed attachments) POSTed through
 *      the real route creates a vault document for the token owner
 *      (vault.ingestFile mocked; secret mocked via env).
 *
 *   cd server && node --test __tests__/inboundEmail.integration.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.NODE_ENV = 'test';

// ── Stub vault.ingestFile before requiring the route (require.cache
//    injection — same pattern as inboundEmail.test.js) ─────────────────
const vaultPath = require.resolve('../services/vault');
let _createdDocs = [];
require.cache[vaultPath] = {
  id: vaultPath,
  filename: vaultPath,
  loaded: true,
  exports: {
    ingestFile: async (userId, buffer, filename, metadata, isGlobal) => {
      const doc = {
        documentId: 500 + _createdDocs.length,
        userId,
        filename,
        bytes: buffer.length,
        metadata,
        isGlobal,
      };
      _createdDocs.push(doc);
      return { documentId: doc.documentId, fileType: filename.split('.').pop() };
    },
  },
  children: [],
  paths: [],
};

// Silence logs.
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

const inboundTokens = require('../services/inboundTokens');
const inboundEmailRoutes = require('../routes/inboundEmail');

function makeServer() {
  const express = require('express');
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  // Same mount point as server/index.js (verified by the MOUNT test below).
  app.use('/api/inbound/email', inboundEmailRoutes);
  const server = app.listen(0);
  const { port } = server.address();
  return {
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
        path: u.pathname,
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

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// ── 1. MOUNT ───────────────────────────────────────────────────────────
test('server/index.js mounts routes/inboundEmail at /api/inbound/email', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/routes\/inboundEmail['"]\)/,
    'index.js must require ./routes/inboundEmail');
  assert.match(src, /app\.use\(\s*['"]\/api\/inbound\/email['"]/,
    "index.js must app.use('/api/inbound/email', …)");
});

// ── 2. END-TO-END INGEST (personal flow, realistic Postmark payload) ──
test('realistic Postmark POST through the real route creates a vault doc for the token owner', async () => {
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET = 'it-secret-123';
  _createdDocs = [];
  inboundTokens.__test.__resetForTests();
  const { token } = await inboundTokens.mintForUser(1337);

  const srv = makeServer();
  try {
    // Field-for-field shape of a real Postmark inbound webhook delivery.
    const payload = {
      FromName: 'Sell Side Research',
      MessageStream: 'inbound',
      From: 'Sell Side Research <research@bigbank.com>',
      FromFull: { Email: 'research@bigbank.com', Name: 'Sell Side Research', MailboxHash: '' },
      To: `vault-${token}@the-particle.com`,
      ToFull: [{ Email: `vault-${token}@the-particle.com`, Name: '', MailboxHash: '' }],
      Cc: '', CcFull: [], Bcc: '', BccFull: [],
      OriginalRecipient: `vault-${token}@the-particle.com`,
      Subject: 'PETR4 — 2H26 upgrade note',
      MessageID: 'a8c1d9e2-73f4-4b21-9c1a-integration-1',
      ReplyTo: '',
      MailboxHash: '',
      Date: 'Mon, 20 Jul 2026 14:32:00 -0300',
      TextBody: 'Attached our upgrade note on Petrobras. Target R$52.',
      HtmlBody: '<p>Attached our upgrade note on Petrobras. Target R$52.</p>',
      StrippedTextReply: '',
      Tag: '',
      Headers: [
        { Name: 'X-Spam-Status', Value: 'No' },
        { Name: 'Message-ID', Value: '<a8c1d9e2@bigbank.com>' },
      ],
      Attachments: [
        {
          Name: 'PETR4-upgrade-2H26.pdf',
          Content: b64('%PDF-1.7 upgrade note body'),
          ContentType: 'application/pdf',
          ContentLength: 26,
        },
        // Unsupported type must be skipped, not fail the delivery.
        {
          Name: 'logo.png.exe',
          Content: b64('MZ...'),
          ContentType: 'application/octet-stream',
          ContentLength: 5,
        },
      ],
    };

    const res = await postJson(`${srv.url}/api/inbound/email/it-secret-123`, payload);

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.kind, 'personal');
    assert.equal(res.body.accepted.length, 1);
    assert.equal(res.body.accepted[0].ok, true);
    assert.equal(res.body.accepted[0].filename, 'PETR4-upgrade-2H26.pdf');
    assert.equal(res.body.skipped.length, 1);

    // The vault doc was created for the token owner, private shelf,
    // with the email provenance tag the INBOX status line counts on.
    assert.equal(_createdDocs.length, 1);
    const doc = _createdDocs[0];
    assert.equal(doc.userId, 1337);
    assert.equal(doc.isGlobal, false);
    assert.equal(doc.filename, 'PETR4-upgrade-2H26.pdf');
    assert.equal(doc.metadata.source, 'inbound_email_personal');
    assert.equal(doc.metadata.sender, 'research@bigbank.com');
    assert.equal(doc.metadata.subject, 'PETR4 — 2H26 upgrade note');
    assert.equal(doc.metadata.messageId, 'a8c1d9e2-73f4-4b21-9c1a-integration-1');
  } finally {
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    await srv.close();
  }
});
