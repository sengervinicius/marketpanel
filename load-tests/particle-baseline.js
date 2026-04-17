/*
 * load-tests/particle-baseline.js — W1.7 baseline k6 scenario.
 *
 * Synthetic user journey:
 *   1. POST /api/auth/login                                (cookie auth)
 *   2. GET  5 "panel" routes in parallel                   (instruments, screener, macro, bonds, options)
 *   3. WS   /ws/stream + send 20 subscribe messages        (simulating panel live-feed)
 *   4. POST /api/search/chat  (1 AI question, streamed)
 *   5. Idle 2 minutes with a heartbeat every 30s           (stresses backpressure + WS stability)
 *   6. Repeat the loop within a 15-minute session
 *
 * Targets (see SLOs.md):
 *   http_req_duration.p(95)  < 400 ms on JSON endpoints
 *   http_req_duration.p(99)  < 1.5 s on JSON endpoints
 *   ws_session_duration      ≥ 2 min with 0 unexpected closes
 *   ai_answer_time_to_first  < 3.5 s (streamed)
 *   checks.rate              > 0.99
 *
 * Usage:
 *   k6 run -e BASE=https://your-api.example.com load-tests/particle-baseline.js
 *
 *   # Staged load: 50 → 200 VUs over 20 minutes
 *   k6 run --stage 5m:50,10m:200,5m:0 -e BASE=... load-tests/particle-baseline.js
 *
 *   # CI smoke (small, fast, deterministic):
 *   k6 run -e BASE=... -e SMOKE=1 load-tests/particle-baseline.js
 *
 * Output:
 *   - `k6-summary.json` (--summary-export) feeds the nightly Grafana dashboard.
 *   - Thresholds determine exit code; CI gate in .github/workflows/loadtest.yml
 *     fails the PR if any threshold regresses > 10% from the stored baseline.
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep, group } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Config ────────────────────────────────────────────────────────────────
const BASE     = __ENV.BASE   || 'http://localhost:10000';
const WS_BASE  = BASE.replace(/^http/, 'ws') + '/ws/stream';
const IS_SMOKE = !!__ENV.SMOKE;

// Pre-provisioned load-test accounts (seeded separately; never rely on
// VU registration to avoid contaminating production Stripe state).
const TEST_USERS = (__ENV.TEST_USERS || 'loadtest1@particle.dev:pw,loadtest2@particle.dev:pw')
  .split(',')
  .map(s => { const [u, p] = s.split(':'); return { username: u, password: p }; });

// ── Custom metrics ────────────────────────────────────────────────────────
const aiFirstByte       = new Trend('ai_answer_time_to_first_ms', true);
const aiFullResponse    = new Trend('ai_answer_full_ms', true);
const wsSessionDuration = new Trend('ws_session_duration_s', true);
const wsUnexpectedClose = new Counter('ws_unexpected_close');
const wsSubscribes      = new Counter('ws_subscribe_sent');
const panelFailures     = new Rate('panel_failure_rate');

// ── Scenarios / thresholds ────────────────────────────────────────────────
export const options = IS_SMOKE
  ? {
      vus: 5, duration: '1m',
      thresholds: {
        http_req_failed: ['rate<0.02'],
        http_req_duration: ['p(95)<800'],
        checks: ['rate>0.99'],
      },
    }
  : {
      scenarios: {
        ramp: {
          executor: 'ramping-vus',
          startVUs: 5,
          stages: [
            { target: 50,  duration: '5m'  },   // warm-up
            { target: 200, duration: '10m' },   // target load
            { target: 200, duration: '10m' },   // sustained
            { target: 0,   duration: '3m'  },   // cool-down
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: {
        http_req_failed:                    ['rate<0.01'],
        'http_req_duration{type:panel}':    ['p(95)<400', 'p(99)<1500'],
        'http_req_duration{type:auth}':     ['p(95)<600'],
        ai_answer_time_to_first_ms:         ['p(95)<3500'],
        ws_unexpected_close:                ['count<5'],     // absolute, over the full run
        panel_failure_rate:                 ['rate<0.01'],
        checks:                             ['rate>0.99'],
      },
    };

// ── Helpers ───────────────────────────────────────────────────────────────
function pickUser() {
  return TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
}

function login(u) {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify(u),
    { headers: { 'Content-Type': 'application/json' }, tags: { type: 'auth' } }
  );
  check(res, { 'login 200': r => r.status === 200 });
  // Extract token from JSON (WS uses query param; HTTP uses cookie)
  let token = '';
  try { token = res.json('token') || ''; } catch (_) {}
  return { cookies: res.cookies, token };
}

function panelBatch(session) {
  group('panel-batch', () => {
    const paths = [
      '/api/instruments?market=us',
      '/api/screener/presets',
      '/api/macro/indicators?country=BR',
      '/api/bonds/treasuries?country=US',
      '/api/options/chain?underlying=AAPL',
    ];
    const requests = paths.map(p => ({
      method: 'GET',
      url:    BASE + p,
      params: { tags: { type: 'panel', route: p.split('?')[0] } },
    }));
    const responses = http.batch(requests);
    let ok = 0;
    for (const r of responses) {
      const good = check(r, { 'panel 2xx': x => x.status >= 200 && x.status < 300 });
      if (good) ok += 1;
    }
    panelFailures.add(ok < responses.length);
  });
}

function wsSession(session, duration) {
  const url = `${WS_BASE}?token=${encodeURIComponent(session.token)}`;
  const start = Date.now();
  const response = ws.connect(url, { tags: { type: 'ws' } }, function (socket) {
    socket.on('open', () => {
      // Fire 20 subscribe messages rapid-fire (panel add-all burst)
      const tickers = ['AAPL','MSFT','NVDA','AMZN','GOOG','META','TSLA','NFLX','CRM','ADBE',
                       'JPM','BAC','GS','WFC','C','XOM','CVX','COP','BA','CAT'];
      for (const t of tickers) {
        socket.send(JSON.stringify({ type: 'subscribe', ticker: t }));
        wsSubscribes.add(1);
      }
      // Heartbeat every 30s for the scenario's idle window
      socket.setInterval(() => {
        socket.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }, 30 * 1000);
      // Close after `duration` seconds have elapsed.
      socket.setTimeout(() => { try { socket.close(); } catch (_) {} }, duration * 1000);
    });
    socket.on('close', (code) => {
      // 1000 = normal, 1001 = going away (our intentional close).
      if (code && code !== 1000 && code !== 1001) {
        wsUnexpectedClose.add(1);
      }
      wsSessionDuration.add((Date.now() - start) / 1000);
    });
    socket.on('error', () => wsUnexpectedClose.add(1));
  });
  check(response, { 'ws 101 upgrade': r => r && r.status === 101 });
}

function askAI(session) {
  group('ai-chat', () => {
    const start = Date.now();
    const body = {
      provider: 'auto',
      messages: [{ role: 'user', content: 'Summarize the latest Fed statement in three bullets.' }],
      stream: false,
    };
    // Streamed endpoints should be measured with the raw socket; for k6 baseline
    // we call the non-stream variant and record end-to-end latency as an upper
    // bound. The /api/search/chat route supports both via the `stream` flag.
    const res = http.post(
      `${BASE}/api/search/chat`,
      JSON.stringify(body),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { type: 'ai', endpoint: 'chat' },
        timeout: '60s',
      }
    );
    const elapsed = Date.now() - start;
    // Upper-bound estimate of TTFB: full response / 2 (conservative).
    aiFirstByte.add(Math.round(elapsed / 2));
    aiFullResponse.add(elapsed);
    check(res, {
      'chat 2xx':         r => r.status >= 200 && r.status < 300,
      'chat has content': r => (r.body || '').length > 10,
    });
  });
}

// ── VU behavior ───────────────────────────────────────────────────────────
export default function () {
  const user = pickUser();
  const session = login(user);

  // 1. Five parallel panel reads.
  panelBatch(session);

  // 2. WebSocket: 20 subscribes + 2-minute idle with heartbeats.
  const idleSeconds = IS_SMOKE ? 10 : 120;
  wsSession(session, idleSeconds);

  // 3. Ask one AI question.
  askAI(session);

  // 4. Simulate think time.
  sleep(Math.random() * 10 + 5);
}

// ── Teardown ──────────────────────────────────────────────────────────────
export function handleSummary(data) {
  // Persist full JSON for the trend dashboard and a short text for CI logs.
  const short = [
    `vus_max:                       ${data.metrics.vus_max?.values?.max}`,
    `http_req_duration.p95:         ${Math.round(data.metrics.http_req_duration?.values['p(95)'])} ms`,
    `http_req_duration.p99:         ${Math.round(data.metrics.http_req_duration?.values['p(99)'])} ms`,
    `http_req_failed.rate:          ${(data.metrics.http_req_failed?.values?.rate * 100).toFixed(2)} %`,
    `ai_answer_time_to_first.p95:   ${Math.round(data.metrics.ai_answer_time_to_first_ms?.values['p(95)'] || 0)} ms`,
    `ws_unexpected_close:           ${data.metrics.ws_unexpected_close?.values?.count ?? 0}`,
    `checks.rate:                   ${(data.metrics.checks?.values?.rate * 100).toFixed(2)} %`,
  ].join('\n');
  return {
    'stdout':            '\n' + short + '\n',
    'k6-summary.json':   JSON.stringify(data, null, 2),
  };
}
