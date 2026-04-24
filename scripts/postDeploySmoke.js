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

async function runProbe(probe, base) {
  const url = probe.url(base);
  const started = Date.now();
  try {
    const res = await fetchUrl(url, probe.maxMs);
    const reasons = [];
    if (res.status !== probe.expectStatus) {
      reasons.push(`status ${res.status} (expected ${probe.expectStatus})`);
    }
    if (res.elapsedMs > probe.maxMs) {
      reasons.push(`latency ${res.elapsedMs}ms > ${probe.maxMs}ms`);
    }
    if (probe.validateBody) {
      const bodyErr = probe.validateBody(res.body);
      if (bodyErr) reasons.push(`body check: ${bodyErr}`);
    }
    return {
      name: probe.name,
      url,
      ok: reasons.length === 0,
      status: res.status,
      elapsedMs: res.elapsedMs,
      reasons,
    };
  } catch (e) {
    return {
      name: probe.name,
      url,
      ok: false,
      status: null,
      elapsedMs: Date.now() - started,
      reasons: [`request failed: ${e.name}: ${e.message}`],
    };
  }
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
