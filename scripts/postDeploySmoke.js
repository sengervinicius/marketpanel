#!/usr/bin/env node
/**
 * postDeploySmoke.js — #250 P3.4 / D9.2
 *
 * Canary probe executed immediately after a Render deploy. Hits a short
 * list of "if this is wrong, nothing else matters" endpoints and fails
 * loudly when any of them is non-2xx or slower than its threshold.
 *
 * Invoked from .github/workflows/post-deploy-smoke.yml on push-to-main and
 * on manual workflow_dispatch, but it's a plain Node script with no extra
 * deps so it can also be run from a laptop to spot-check prod:
 *
 *   SMOKE_BASE_URL=https://senger-market-server.onrender.com \
 *     node scripts/postDeploySmoke.js
 *
 * Exit codes:
 *   0   — all probes green
 *   1   — at least one probe failed (HTTP or latency)
 *   2   — fatal script error (bad config etc.)
 *
 * The probe list is intentionally short. Add to it only for checks that
 * belong in "site is live enough for humans"; deeper invariants live in
 * the e2e suite.
 */

'use strict';

const DEFAULT_BASE = 'https://senger-market-server.onrender.com';
const DEFAULT_CLIENT_BASE = 'https://the-particle.com';

const PROBES = [
  {
    name: 'healthz',
    // LB health check — must be instantaneous and 200 even on cold start.
    url: (base) => `${base.server}/healthz`,
    maxMs: 2000,
    expectStatus: 200,
  },
  {
    name: 'health',
    // Detailed status — body contains { status, dbConnected, feeds }.
    url: (base) => `${base.server}/health`,
    maxMs: 5000,
    expectStatus: 200,
    validateBody: (body) => {
      try {
        const j = JSON.parse(body);
        if (!j.status) return 'missing status field';
        if (j.status !== 'ok' && j.status !== 'degraded') {
          return `unexpected status "${j.status}"`;
        }
        return null;
      } catch (e) {
        return `invalid JSON: ${e.message}`;
      }
    },
  },
  {
    name: 'api_flags',
    // Feature-flag eval endpoint — a quick check that core auth middleware
    // doesn't 500 on anonymous calls and the DB lookup still works.
    url: (base) => `${base.server}/api/flags`,
    maxMs: 5000,
    expectStatus: 200,
    validateBody: (body) => {
      try {
        const j = JSON.parse(body);
        if (!j.flags || typeof j.flags !== 'object') return 'missing flags map';
        return null;
      } catch (e) {
        return `invalid JSON: ${e.message}`;
      }
    },
  },
  {
    name: 'client_index',
    // Static site served? We expect a 200 on / with an HTML payload that
    // mentions the app shell. This catches the client build being missing
    // or Render's static redirect rule being broken.
    url: (base) => `${base.client}/`,
    maxMs: 8000,
    expectStatus: 200,
    validateBody: (body) => {
      if (!body || body.length < 200) return 'client body too short';
      if (!/<div id=["']?root["']?/i.test(body)) return 'no React root div';
      return null;
    },
  },
];

function readEnv(key, fallback) {
  const v = process.env[key];
  return (v && v.trim()) ? v.trim() : fallback;
}

function fetchUrl(url, timeoutMs) {
  // Node 18+ has global fetch. AbortController bounds the wall clock.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs + 500);
  const started = Date.now();
  return fetch(url, {
    redirect: 'follow',
    signal: ac.signal,
    headers: { 'user-agent': 'particle-post-deploy-smoke/1.0' },
  })
    .then(async (res) => {
      const body = await res.text();
      return { status: res.status, body, elapsedMs: Date.now() - started };
    })
    .finally(() => clearTimeout(t));
}

// Render free/starter tiers periodically 502/503 during a deploy swap or
// cold start. A single transient blip should NOT fail the whole job —
// we retry up to RETRY_ATTEMPTS with jittered backoff and only surface
// a failure when every retry is bad. Cumulative timeout per probe is
// bounded so the job can't exceed the workflow timeout.
const RETRY_ATTEMPTS = 4;
const RETRY_BACKOFF_MS = [0, 5000, 15000, 30000]; // 0, 5s, 15s, 30s

function _isTransient(res) {
  if (!res) return true;
  if (res.status === 502 || res.status === 503 || res.status === 504) return true;
  return false;
}

async function runProbe(probe, base) {
  const url = probe.url(base);
  const attempts = [];
  const overallStarted = Date.now();
  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    if (i > 0 && RETRY_BACKOFF_MS[i]) {
      const jitter = Math.floor(Math.random() * 1000);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS[i] + jitter));
    }
    const started = Date.now();
    let res = null;
    let requestError = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await fetchUrl(url, probe.maxMs);
    } catch (e) {
      requestError = e;
    }
    const reasons = [];
    if (requestError) {
      reasons.push(`request failed: ${requestError.name}: ${requestError.message}`);
    } else {
      if (res.status !== probe.expectStatus) {
        reasons.push(`status ${res.status} (expected ${probe.expectStatus})`);
      }
      // Latency only counted on the FINAL attempt — transient cold-start
      // slowness during retries should not fail an otherwise-good deploy.
      if (i === RETRY_ATTEMPTS - 1 && res.elapsedMs > probe.maxMs) {
        reasons.push(`latency ${res.elapsedMs}ms > ${probe.maxMs}ms`);
      }
      if (probe.validateBody) {
        const bodyErr = probe.validateBody(res.body);
        if (bodyErr) reasons.push(`body check: ${bodyErr}`);
      }
    }
    attempts.push({
      attempt: i + 1,
      ok: reasons.length === 0,
      status: res?.status ?? null,
      elapsedMs: res ? res.elapsedMs : Date.now() - started,
      reasons,
    });
    if (reasons.length === 0) {
      return {
        name: probe.name,
        url,
        ok: true,
        status: res.status,
        elapsedMs: res.elapsedMs,
        reasons: [],
        attempts,
      };
    }
    // Give up immediately on NON-transient failures (404, body mismatch).
    // Only retry 5xx / network errors.
    if (res && !_isTransient(res) && !requestError) {
      break;
    }
  }
  const last = attempts[attempts.length - 1];
  return {
    name: probe.name,
    url,
    ok: false,
    status: last.status,
    elapsedMs: Date.now() - overallStarted,
    reasons: last.reasons,
    attempts,
  };
}

async function main() {
  const base = {
    server: readEnv('SMOKE_BASE_URL', DEFAULT_BASE),
    client: readEnv('SMOKE_CLIENT_URL', DEFAULT_CLIENT_BASE),
  };

  // eslint-disable-next-line no-console
  console.log(`post-deploy smoke: server=${base.server} client=${base.client}`);

  const results = [];
  for (const probe of PROBES) {
    const r = await runProbe(probe, base);
    results.push(r);
    const tag = r.ok ? 'OK' : 'FAIL';
    if (r.attempts && r.attempts.length > 1) {
      const transients = r.attempts.slice(0, -1).filter(a => !a.ok).length;
      if (transients > 0) {
        // eslint-disable-next-line no-console
        console.log(`       (${transients} transient failure${transients === 1 ? '' : 's'} before final attempt)`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `[${tag}] ${r.name} ${r.status ?? 'ERR'} ${r.elapsedMs}ms — ${r.url}` +
      (r.reasons.length ? `\n       ${r.reasons.join('; ')}` : '')
    );
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.error(`\npost-deploy smoke FAILED (${failed.length}/${results.length} probes red)`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`\npost-deploy smoke PASSED (${results.length} probes green)`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('post-deploy smoke crashed:', e.stack || e.message);
  process.exit(2);
});
