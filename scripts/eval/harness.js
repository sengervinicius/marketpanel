#!/usr/bin/env node
/**
 * scripts/eval/harness.js
 * ─────────────────────────────────────────────────────────────────────
 * Wave 1 / WS1 — Quality Harness skeleton.
 *
 * Runs canonical probes against every Coverage Matrix cell and reports
 * pass/fail per cell. On failure, the harness writes a row to
 * coverage_probes (when DATABASE_URL is set) and exits non-zero so CI
 * blocks merge.
 *
 * Subcommands:
 *   adapter-slo              Probe every (adapter, market, asset, cap) cell
 *   calendar-freshness       Verify canonical macro events are present
 *   fundamentals-divergence  Tri-source reconcile on canonical tickers
 *   vault-retrieval          MRR / precision@5 on hand-labeled probes
 *   all                      Run every subcommand in sequence
 *
 * Flags:
 *   --dry-run            Do not hit real providers; synthesize Results from
 *                        stub fixtures. Used in CI without API keys.
 *   --json               Emit machine-readable JSON only (no human log)
 *   --fail-fast          Exit on first failure (default: run everything)
 *   --cells=<pattern>    Filter probes by glob on cell identifier
 *
 * CI integration: .github/workflows/quality-gates.yml runs
 * `node scripts/eval/harness.js all --json > harness-report.json` then
 * uploads the report and fails the job if any cell regressed.
 * ─────────────────────────────────────────────────────────────────────
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, 'golden');

function loadGolden(name) {
  const full = path.join(GOLDEN_DIR, `${name}.json`);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing golden set: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

// ── Argument parsing (no external deps) ─────────────────────────────
function parseArgs(argv) {
  const flags = { dryRun: false, json: false, failFast: false, cellsFilter: null };
  const positional = [];
  for (const a of argv) {
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--fail-fast') flags.failFast = true;
    else if (a.startsWith('--cells=')) flags.cellsFilter = a.slice('--cells='.length);
    else positional.push(a);
  }
  return { flags, positional };
}

function matchesFilter(cell, pattern) {
  if (!pattern) return true;
  // Simple glob: treat * as .*
  const rx = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return rx.test(cell);
}

// ── Logging primitives ──────────────────────────────────────────────
let JSON_MODE = false;
function log(msg) { if (!JSON_MODE) console.log(msg); }
function info(msg) { if (!JSON_MODE) console.log(`  ${msg}`); }
function pass(msg) { if (!JSON_MODE) console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { if (!JSON_MODE) console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }

// ── Adapter resolution ──────────────────────────────────────────────
// In dry-run we synthesize; in live mode we resolve from the registry.
let _registry = null;
async function getRegistry() {
  if (_registry) return _registry;
  try {
    // Resolve relative to repo root so harness can be invoked from anywhere
    const reg = require(path.join(__dirname, '..', '..', 'server', 'adapters', 'registry'));
    _registry = await reg.getRegistry();
  } catch (e) {
    // Registry not yet wired — return a minimal stub so the harness can still
    // run in dry-run mode and still exercise the report-writing code paths.
    _registry = {
      get: () => null,
      all: () => [],
      declarations: () => [],
    };
  }
  return _registry;
}

function synthDryRunOk(cell, symbol) {
  // Synthetic payload covers every field declared across all probe types,
  // so dry-run green really means "harness wiring is correct", not
  // "expectations silently dropped".
  return {
    ok: true,
    data: {
      symbol,
      bid: 99.98,
      ask: 100.02,
      last: 100.0,
      volume: 123456,
      timestamp: new Date().toISOString(),
      currency: 'USD',
      exchange: 'SYNTH',
      tenors: [
        { tenor: '2Y',  yield: 4.10 },
        { tenor: '5Y',  yield: 4.05 },
        { tenor: '10Y', yield: 4.20 },
        { tenor: '30Y', yield: 4.45 },
      ],
      citations: [{ url: 'https://example.com', publishedAt: new Date().toISOString(), source: 'stub' }],
    },
    provenance: {
      source: cell.split('/')[0],
      fetchedAt: new Date().toISOString(),
      freshnessMs: 0,
      confidence: 'medium',
      adapterChain: [cell.split('/')[0]],
      warnings: ['dry-run synthetic'],
    },
  };
}

// ── Subcommand: adapter-slo ─────────────────────────────────────────
async function runAdapterSlo(flags) {
  const golden = loadGolden('adapter-slo');
  const registry = await getRegistry();
  const results = [];
  log(`\n[adapter-slo] ${golden.probes.length} probes loaded`);

  for (const probe of golden.probes) {
    if (!matchesFilter(probe.cell, flags.cellsFilter)) continue;
    const [adapterName, market, assetClass, capability] = probe.cell.split('/');
    const t0 = Date.now();
    let result;
    if (flags.dryRun) {
      result = synthDryRunOk(probe.cell, probe.symbol);
    } else {
      const adapter = registry.get(adapterName);
      if (!adapter || typeof adapter[capability] !== 'function') {
        result = {
          ok: false,
          error: { code: 'NOT_IN_COVERAGE', adapter: adapterName, message: `no ${capability} on ${adapterName}` },
          provenance: { source: adapterName, confidence: 'unverified', adapterChain: [adapterName] },
        };
      } else {
        try {
          result = await adapter[capability](probe.symbol, {});
        } catch (e) {
          result = {
            ok: false,
            error: { code: 'UNKNOWN', adapter: adapterName, message: e.message },
            provenance: { source: adapterName, confidence: 'unverified', adapterChain: [adapterName] },
          };
        }
      }
    }
    const latencyMs = Date.now() - t0;
    const slaMiss = latencyMs > (probe.latencyP95MaxMs || Infinity);
    let passed = !!result.ok && !slaMiss;

    if (result.ok && probe.expectFields) {
      for (const f of probe.expectFields) {
        if (result.data[f] === undefined || result.data[f] === null) {
          passed = false;
          break;
        }
      }
    }

    results.push({
      cell: probe.cell,
      symbol: probe.symbol,
      ok: !!result.ok,
      passed,
      latencyMs,
      slaTargetMs: probe.latencyP95MaxMs,
      slaMiss,
      errorCode: result.ok ? null : (result.error && result.error.code),
    });
    if (passed) pass(`${probe.cell} · ${probe.symbol} · ${latencyMs}ms`);
    else fail(`${probe.cell} · ${probe.symbol} · ${latencyMs}ms · ${result.ok ? 'sla_miss' : (result.error && result.error.code)}`);

    if (flags.failFast && !passed) break;
  }

  return summarize('adapter-slo', results);
}

// ── Subcommand: calendar-freshness ──────────────────────────────────
async function runCalendarFreshness(flags) {
  const golden = loadGolden('calendar-freshness');
  const results = [];
  log(`\n[calendar-freshness] ${golden.events.length} canonical events loaded`);

  const registry = await getRegistry();
  const finnhub = registry.get('finnhub');

  for (const ev of golden.events) {
    let passed = false;
    let latencyMs = null;
    let errorCode = null;
    if (flags.dryRun || !finnhub || typeof finnhub.calendar !== 'function') {
      passed = flags.dryRun;
      errorCode = flags.dryRun ? null : 'NOT_IN_COVERAGE';
    } else {
      const t0 = Date.now();
      const res = await finnhub.calendar({ title: ev.title, country: ev.country });
      latencyMs = Date.now() - t0;
      if (res.ok) {
        const found = (res.data || []).find(e => e.title === ev.title);
        passed = !!found;
        if (found) {
          for (const f of (ev.expectedFields || [])) {
            if (found[f] === undefined || found[f] === null) { passed = false; break; }
          }
        }
      } else {
        errorCode = res.error && res.error.code;
      }
    }
    results.push({ event: ev.title, country: ev.country, passed, latencyMs, errorCode });
    if (passed) pass(`${ev.country} · ${ev.title}`);
    else fail(`${ev.country} · ${ev.title} · ${errorCode || 'missing'}`);
    if (flags.failFast && !passed) break;
  }
  return summarize('calendar-freshness', results);
}

// ── Subcommand: fundamentals-divergence ─────────────────────────────
async function runFundamentalsDivergence(flags) {
  const golden = loadGolden('fundamentals-divergence');
  const results = [];
  log(`\n[fundamentals-divergence] ${golden.probes.length} probes loaded`);

  const registry = await getRegistry();

  for (const probe of golden.probes) {
    const sourceValues = {};
    let anyError = false;
    for (const srcName of probe.sources) {
      if (flags.dryRun) {
        sourceValues[srcName] = { revenue_ttm: 1000, ebitda_ttm: 250, net_income_ttm: 150 };
        continue;
      }
      const adapter = registry.get(srcName);
      if (!adapter || typeof adapter.fundamentals !== 'function') {
        anyError = true;
        continue;
      }
      const res = await adapter.fundamentals(probe.symbol, probe.period, 'all');
      if (res.ok) sourceValues[srcName] = res.data;
      else anyError = true;
    }

    // Compute pairwise divergence on the declared fields
    const tol = golden.toleranceDefault;
    const divergences = [];
    const sources = Object.keys(sourceValues);
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        for (const field of golden.fields) {
          const a = sourceValues[sources[i]][field];
          const b = sourceValues[sources[j]][field];
          if (a == null || b == null) continue;
          const diff = Math.abs(a - b);
          const pct = Math.abs(a) > 0 ? (diff / Math.abs(a)) * 100 : 0;
          if (pct > tol.absolutePctMax && diff > tol.absoluteAmountMax) {
            divergences.push({ a: sources[i], b: sources[j], field, pct, diff });
          }
        }
      }
    }

    const passed = !anyError && (sources.length < 2 || divergences.length === 0);
    results.push({ symbol: probe.symbol, sources, divergences, passed });
    if (passed) pass(`${probe.symbol} · ${sources.join(' vs ')} · ${divergences.length} divergences`);
    else fail(`${probe.symbol} · ${divergences.length} material divergence(s)${anyError ? ' · some source errored' : ''}`);
    if (flags.failFast && !passed) break;
  }
  return summarize('fundamentals-divergence', results);
}

// ── Subcommand: vault-retrieval ─────────────────────────────────────
async function runVaultRetrieval(flags) {
  const golden = loadGolden('vault-retrieval');
  const results = [];
  log(`\n[vault-retrieval] ${golden.probes.length} probes loaded`);
  log('  (skeleton — MRR/precision@5 computation lands with WS5 parser overhaul)');

  // Skeleton only — real implementation lands in WS5 when the parser pipeline
  // populates golden with real chunk IDs. For now, verify the loader works
  // and the target metrics are declared.
  for (const probe of golden.probes) {
    const passed = !!(probe.query && Array.isArray(probe.expectedChunkIds));
    results.push({ query: probe.query, passed, skipped: true, reason: 'WS5 pending' });
    pass(`${probe.query.substring(0, 60)}... [skipped — WS5 pending]`);
  }
  return summarize('vault-retrieval', results, { skeletonOnly: true });
}

// ── Summary + exit ──────────────────────────────────────────────────
function summarize(name, results, opts = {}) {
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const summary = {
    subcommand: name,
    total: results.length,
    passed,
    failed,
    passRate: results.length ? passed / results.length : 1,
    skeletonOnly: !!opts.skeletonOnly,
    results,
  };
  log(`\n[${name}] ${passed}/${results.length} passed${failed ? ` · \x1b[31m${failed} FAILED\x1b[0m` : ''}`);
  return summary;
}

// ── main ────────────────────────────────────────────────────────────
async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  JSON_MODE = flags.json;
  const cmd = positional[0] || 'all';

  const summaries = [];
  if (cmd === 'all' || cmd === 'adapter-slo')               summaries.push(await runAdapterSlo(flags));
  if (cmd === 'all' || cmd === 'calendar-freshness')        summaries.push(await runCalendarFreshness(flags));
  if (cmd === 'all' || cmd === 'fundamentals-divergence')   summaries.push(await runFundamentalsDivergence(flags));
  if (cmd === 'all' || cmd === 'vault-retrieval')           summaries.push(await runVaultRetrieval(flags));

  const totalFailed = summaries.reduce(
    (a, s) => a + (s.skeletonOnly ? 0 : s.failed),
    0
  );

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({ summaries, totalFailed }, null, 2) + '\n');
  } else {
    log(`\n=== Harness complete: ${totalFailed} failures across ${summaries.length} subcommands ===`);
  }

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('[harness] fatal:', e && e.stack || e);
  process.exit(2);
});
