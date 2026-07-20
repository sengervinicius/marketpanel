/**
 * services/briefEngine.js — Phase S wave 2: the personalized Daily Brief.
 *
 * Approved mockup: particle-phase-s-design-review.html §1 (BRIEF panel).
 * Composes existing services into ONE per-user morning object:
 *
 *   buildBriefData(userId)  — gather raw signals for the user's book:
 *     · watchlist bucketized via utils/assetClass (same buckets as the
 *       auto-sectorized watchlist, S5)
 *     · per symbol: last/chg, volume vs 3-month average, next earnings
 *       ≤7d, news headlines from the last 24h, UW options-flow
 *       aggregates when the API is configured
 *     · macro: today+tomorrow economic-calendar rows with matching
 *       prediction-market odds (CPI/FED/PAYROLLS… keyword join), rates
 *       tape 1-day deltas, Brazil Focus consensus
 *     · vault: for the 3 most-active names, vault.retrieve(userId,
 *       "<symbol> outlook", 3) — surfaced only when a real passage
 *       comes back (empty-over-noise)
 *
 *   composeBrief(data)      — ONE Haiku call (modelRouter) with a strict
 *     JSON contract, parsed through the tolerant extractJson util. On
 *     parse failure we fall back to a deterministic composition built
 *     from the same raw numbers — the brief never dies on a bad LLM day.
 *
 *   getBrief(userId, {force}) — cached per user for 30 minutes; force
 *     bypasses (the panel's refresh chip).
 *
 * Mockup note 2 is the contract: ONLY names with a real trigger appear
 * ("3 of 12 active"). Triggers: |move| ≥ 1.5%, volume ≥ 2× avg, earnings
 * within 7 days, news in the last 24h, UW flow ≥ $1M on the name.
 *
 * Every external source is injected through `deps` so unit tests can run
 * the whole pipeline fully mocked (see __tests__/briefEngine.test.js).
 */

'use strict';

const logger = require('../utils/logger');
const { swallow } = require('../utils/swallow');
const { extractJson } = require('../utils/extractJson');
const { ASSET_CLASSES, classifyAssetClass } = require('../utils/assetClass');

// ── Tunables ──────────────────────────────────────────────────────────
const CACHE_TTL_MS        = 30 * 60 * 1000; // per-user brief cache
const MAX_WATCHLIST       = 40;             // symbols considered per user
const MOVE_TRIGGER_PCT    = 1.5;            // |day %| that counts as "in play"
const VOL_TRIGGER_RATIO   = 2.0;            // volume ≥ 2× 3-month average
const EARN_TRIGGER_DAYS   = 7;              // earnings within a week
const FLOW_TRIGGER_USD    = 1_000_000;      // UW aggregate premium on the name
const NEWS_WINDOW_MS      = 24 * 3600 * 1000;
const NEWS_SYMBOL_CAP     = 10;             // symbols we pull company news for
const NEWS_PER_SYMBOL     = 3;
const EARNINGS_SYMBOL_CAP = 15;
const VAULT_SYMBOLS       = 3;              // most-active names checked vs vault
const VAULT_AGING_DAYS    = 90;             // fallback "AGING" threshold
const HAIKU_MAX_TOKENS    = 1400;

const REASONS  = ['NEWS', 'FLOW', 'EARN', 'MACRO', 'VAULT'];
const VERDICTS = ['CONFIRMS', 'CONTRADICTS', 'AGING'];

// ── Injectable dependencies (lazy requires so tests never boot the app) ──
function makeDefaultDeps() {
  return {
    getUser(userId) {
      return require('../authStore').getUserById(userId);
    },
    async quotes(yahooSymbols) {
      const { yahooQuote } = require('../routes/market/lib/providers');
      return yahooQuote(yahooSymbols.join(','));
    },
    async nextEarnings(symbol) {
      const { getEarningsForTicker } = require('./earnings');
      return getEarningsForTicker(symbol);
    },
    async tickerNews(symbol) {
      // Finnhub company news, same source as the news panel's per-ticker
      // feed; we window to 24h in the caller.
      const key = process.env.FINNHUB_API_KEY;
      if (!key) return [];
      const fetch = require('node-fetch');
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const base = symbol.replace(/\.SA$/i, '');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(base)}&from=${from}&to=${to}&token=${key}`,
          { headers: { Accept: 'application/json' }, signal: ctrl.signal }
        );
        if (!r.ok) return [];
        const items = await r.json();
        if (!Array.isArray(items)) return [];
        return items.map(i => ({
          title: i.headline || '',
          source: i.source || 'Finnhub',
          publishedAt: i.datetime ? new Date(i.datetime * 1000).toISOString() : null,
        }));
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },
    uwConfigured() {
      return !!process.env.UNUSUAL_WHALES_API_KEY;
    },
    async flowAlerts() {
      return require('./unusualWhales').getFlowAlerts();
    },
    async macroCalendar() {
      const eulerpool = require('../providers/eulerpool');
      return eulerpool.getMacroCalendar();
    },
    predictions() {
      return require('./predictionAggregator').getForYouMarkets({ limit: 16 });
    },
    async ratesTape() {
      const fred = require('../providers/fred');
      const SERIES = [
        { id: 'us10y',       label: 'US 10Y',   seriesId: 'DGS10',        unit: '%' },
        { id: 'spread2s10s', label: '2S10S',    seriesId: 'T10Y2Y',       unit: 'bp' },
        { id: 'hyOas',       label: 'HY OAS',   seriesId: 'BAMLH0A0HYM2', unit: 'bp' },
        { id: 'real10y',     label: '10Y REAL', seriesId: 'DFII10',       unit: '%' },
      ];
      const settled = await Promise.allSettled(SERIES.map(s => fred.fetchLatestPair(s.seriesId)));
      return SERIES.map((s, i) => {
        const r = settled[i].status === 'fulfilled' ? settled[i].value : null;
        const mult = s.unit === 'bp' ? 100 : 1;
        return {
          label: s.label,
          unit: s.unit,
          value: r && r.value != null ? r.value * mult : null,
          change1d: r && r.change != null ? r.change * mult : null,
        };
      });
    },
    async brazilFocus() {
      const brazilFocus = require('../routes/market/brazilFocus');
      return brazilFocus._buildFocus();
    },
    async vaultRetrieve(userId, query, limit) {
      return require('./vault').retrieve(userId, query, limit);
    },
    async callModel(prompt, systemPrompt, userId) {
      const modelRouter = require('./modelRouter');
      const provider = modelRouter.getProvider('claude_haiku');
      if (!provider) throw new Error('claude_haiku provider unavailable');
      const response = await modelRouter.callProvider(
        provider,
        [{ role: 'user', content: prompt }],
        systemPrompt,
        { maxTokens: HAIKU_MAX_TOKENS, userId }
      );
      const json = await response.json();
      return json?.content?.[0]?.text || json?.choices?.[0]?.message?.content || '';
    },
    toYahoo(symbol) {
      try { return require('../utils/tickerNormalize').toYahoo(symbol); }
      catch { return symbol; }
    },
    now() { return Date.now(); },
  };
}

let deps = makeDefaultDeps();

// ── Per-user cache ────────────────────────────────────────────────────
const _cache = new Map(); // userId → { brief, at, generatedAt }

// ── Watchlist bucketization ───────────────────────────────────────────

/**
 * Group a watchlist into the five asset-class buckets, honouring per-user
 * overrides from settings.watchlistMeta[sym].assetClass.
 * Returns ordered [{ id, label, symbols }] (empty buckets dropped).
 */
function bucketizeWatchlist(watchlist, watchlistMeta = {}) {
  const byId = new Map();
  for (const raw of watchlist) {
    const sym = String(raw || '').trim().toUpperCase();
    if (!sym) continue;
    const meta = watchlistMeta[sym] || watchlistMeta[raw] || {};
    const id = classifyAssetClass(sym, { override: meta.assetClass });
    if (!byId.has(id)) byId.set(id, []);
    if (!byId.get(id).includes(sym)) byId.get(id).push(sym);
  }
  return ASSET_CLASSES
    .filter(c => byId.has(c.id))
    .map(c => ({ id: c.id, label: c.label, symbols: byId.get(c.id) }));
}

// ── Macro event ↔ prediction-market keyword join ──────────────────────
const EVENT_TAGS = [
  { re: /\bCPI\b|consumer\s+price|inflation/i,                  tag: 'cpi' },
  { re: /\bFOMC\b|federal\s+reserve|fed\s+(rate|funds|decision)|interest\s+rate\s+decision/i, tag: 'fed' },
  { re: /payrolls?|nonfarm|\bNFP\b|employment\s+(situation|report)/i, tag: 'payrolls' },
  { re: /\bGDP\b/i,                                             tag: 'gdp' },
  { re: /\bPCE\b/i,                                             tag: 'pce' },
  { re: /\bPPI\b|producer\s+price/i,                            tag: 'ppi' },
  { re: /selic|copom/i,                                         tag: 'selic' },
  { re: /unemployment|jobless/i,                                tag: 'jobs' },
  { re: /retail\s+sales/i,                                      tag: 'retail' },
  { re: /\bECB\b/i,                                             tag: 'ecb' },
];

function tagsFor(text) {
  const t = String(text || '');
  const out = new Set();
  for (const { re, tag } of EVENT_TAGS) if (re.test(t)) out.add(tag);
  return out;
}

/**
 * Find the best prediction market for a calendar event by keyword tags.
 * Returns { source, probability, title } or null.
 */
function matchPredictionToEvent(eventTitle, markets) {
  const evTags = tagsFor(eventTitle);
  if (evTags.size === 0) return null;
  for (const m of markets || []) {
    const mTags = tagsFor(m.title || m.question || '');
    for (const t of evTags) {
      if (mTags.has(t)) {
        const prob = m.probability != null ? m.probability : m.impliedProbability;
        if (prob == null) continue;
        return {
          source: String(m.source || 'MKT').toUpperCase().slice(0, 6),
          probability: Math.round(prob <= 1 ? prob * 100 : prob),
          title: m.title || m.question || '',
        };
      }
    }
  }
  return null;
}

// ── Trigger detection ─────────────────────────────────────────────────
function triggersFor(row) {
  const trig = [];
  if (row.changePct != null && Math.abs(row.changePct) >= MOVE_TRIGGER_PCT) trig.push('MOVE');
  if (row.volRatio != null && row.volRatio >= VOL_TRIGGER_RATIO) trig.push('VOL');
  if (row.earningsInDays != null && row.earningsInDays >= 0 && row.earningsInDays <= EARN_TRIGGER_DAYS) trig.push('EARN');
  if (Array.isArray(row.news) && row.news.length > 0) trig.push('NEWS');
  if (row.flow && Math.abs(row.flow.totalPremium || 0) >= FLOW_TRIGGER_USD) trig.push('FLOW');
  return trig;
}

function primaryReason(triggers) {
  if (triggers.includes('NEWS')) return 'NEWS';
  if (triggers.includes('FLOW')) return 'FLOW';
  if (triggers.includes('EARN')) return 'EARN';
  // A bare MOVE/VOL trigger has no better source chip than NEWS-less
  // tape action — bucket it under MACRO (color = source, not sentiment).
  return 'MACRO';
}

// Activity score used to rank names (drives vault checks + fallback lines).
function activityScore(row) {
  let s = 0;
  if (row.changePct != null) s += Math.abs(row.changePct);
  if (row.volRatio != null && row.volRatio > 1) s += (row.volRatio - 1) * 2;
  if (Array.isArray(row.news)) s += row.news.length * 1.5;
  if (row.earningsInDays != null && row.earningsInDays <= EARN_TRIGGER_DAYS) s += 2;
  if (row.flow) s += Math.min(4, Math.abs(row.flow.totalPremium || 0) / 5e6);
  return s;
}

// ══════════════════════════════════════════════════════════════════════
// 1. buildBriefData(userId)
// ══════════════════════════════════════════════════════════════════════
async function buildBriefData(userId) {
  const user = deps.getUser(userId);
  const settings = (user && user.settings) || {};
  const watchlist = (settings.watchlist || [])
    .map(s => String(s || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_WATCHLIST);
  const watchlistMeta = settings.watchlistMeta || {};

  const buckets = bucketizeWatchlist(watchlist, watchlistMeta);
  const allSymbols = buckets.flatMap(b => b.symbols);

  // ── Quotes (one Yahoo batch; vol × avg comes free) ──────────────────
  const quoteMap = {};
  if (allSymbols.length > 0) {
    try {
      const ySyms = allSymbols.map(s => deps.toYahoo(s));
      const yToDisplay = {};
      allSymbols.forEach((s, i) => { yToDisplay[String(ySyms[i]).toUpperCase()] = s; });
      const qs = await deps.quotes(ySyms);
      for (const q of qs || []) {
        const key = yToDisplay[String(q.symbol || '').toUpperCase()]
          || String(q.symbol || '').toUpperCase();
        quoteMap[key] = q;
      }
    } catch (e) {
      swallow(e, 'briefEngine.quotes');
    }
  }

  // ── Per-symbol rows ──────────────────────────────────────────────────
  const rows = allSymbols.map(sym => {
    const q = quoteMap[sym] || {};
    const vol = q.regularMarketVolume != null ? q.regularMarketVolume : null;
    const avg = q.averageDailyVolume3Month != null ? q.averageDailyVolume3Month : null;
    return {
      symbol: sym,
      bucket: buckets.find(b => b.symbols.includes(sym))?.label || 'EQUITIES',
      last: q.regularMarketPrice != null ? q.regularMarketPrice : null,
      changePct: q.regularMarketChangePercent != null ? q.regularMarketChangePercent : null,
      volume: vol,
      avgVolume: avg,
      volRatio: vol != null && avg > 0 ? +(vol / avg).toFixed(2) : null,
      earningsInDays: null,
      earningsDate: null,
      news: [],
      flow: null,
    };
  });
  const bySymbol = new Map(rows.map(r => [r.symbol, r]));

  // ── Next earnings ≤7d (equities only, capped) ───────────────────────
  const eqSymbols = buckets.find(b => b.id === 'EQ')?.symbols.slice(0, EARNINGS_SYMBOL_CAP) || [];
  if (eqSymbols.length > 0) {
    const settled = await Promise.allSettled(eqSymbols.map(s => deps.nextEarnings(s.replace(/\.SA$/i, ''))));
    eqSymbols.forEach((sym, i) => {
      const r = settled[i].status === 'fulfilled' ? settled[i].value : null;
      const row = bySymbol.get(sym);
      if (row && r && r.nextEarningsDate != null && r.daysUntilEarnings != null
          && r.daysUntilEarnings >= 0 && r.daysUntilEarnings <= EARN_TRIGGER_DAYS) {
        row.earningsInDays = r.daysUntilEarnings;
        row.earningsDate = r.nextEarningsDate;
      }
    });
  }

  // ── News last 24h (most-active names first) ─────────────────────────
  const newsCandidates = [...rows]
    .filter(r => r.bucket === 'EQUITIES' || /\.SA$/.test(r.symbol) || r.bucket === 'CRYPTO')
    .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .slice(0, NEWS_SYMBOL_CAP);
  if (newsCandidates.length > 0) {
    const cutoff = deps.now() - NEWS_WINDOW_MS;
    const settled = await Promise.allSettled(newsCandidates.map(r => deps.tickerNews(r.symbol)));
    newsCandidates.forEach((r, i) => {
      const items = settled[i].status === 'fulfilled' ? settled[i].value : [];
      r.news = (items || [])
        .filter(n => n.publishedAt && new Date(n.publishedAt).getTime() >= cutoff)
        .slice(0, NEWS_PER_SYMBOL)
        .map(n => ({ title: String(n.title || '').slice(0, 160), source: n.source || '' }));
    });
  }

  // ── UW flow aggregates on the user's names (single alerts pull) ─────
  if (deps.uwConfigured()) {
    try {
      const alerts = await deps.flowAlerts();
      const bySym = {};
      for (const a of alerts || []) {
        const sym = String(a.symbol || '').toUpperCase();
        if (!bySymbol.has(sym)) continue;
        if (!bySym[sym]) bySym[sym] = { count: 0, totalPremium: 0, callPremium: 0, putPremium: 0 };
        const agg = bySym[sym];
        agg.count += 1;
        agg.totalPremium += a.premium || 0;
        if (a.sentiment === 'call') agg.callPremium += a.premium || 0;
        if (a.sentiment === 'put')  agg.putPremium  += a.premium || 0;
      }
      for (const [sym, agg] of Object.entries(bySym)) {
        bySymbol.get(sym).flow = agg;
      }
    } catch (e) {
      swallow(e, 'briefEngine.uwFlow');
    }
  }

  // ── Triggers → active names (mockup note 2: only real reasons) ──────
  for (const r of rows) r.triggers = triggersFor(r);
  const activeRows = rows.filter(r => r.triggers.length > 0);

  // ── Macro block ──────────────────────────────────────────────────────
  const macro = { events: [], rates: [], brazil: null };

  try {
    const cal = await deps.macroCalendar();
    const nowD = new Date(deps.now());
    const today = nowD.toISOString().slice(0, 10);
    const tomorrow = new Date(nowD.getTime() + 86400000).toISOString().slice(0, 10);
    const rowsCal = Array.isArray(cal) ? cal : (cal && (cal.events || cal.data)) || [];
    macro.events = rowsCal
      .filter(e => {
        const d = String(e.date || e.day || e.time || '').slice(0, 10);
        return d === today || d === tomorrow;
      })
      .slice(0, 8)
      .map(e => ({
        title: String(e.title || e.event || e.name || '').slice(0, 90),
        date: String(e.date || e.day || '').slice(0, 10),
        country: e.country || e.region || null,
        consensus: e.consensus != null ? e.consensus : (e.forecast != null ? e.forecast : null),
        odds: null,
      }));
  } catch (e) {
    swallow(e, 'briefEngine.macroCalendar');
  }

  try {
    const markets = deps.predictions() || [];
    for (const ev of macro.events) {
      const hit = matchPredictionToEvent(ev.title, markets);
      if (hit) ev.odds = hit;
    }
  } catch (e) {
    swallow(e, 'briefEngine.predictions');
  }

  try {
    const tape = await deps.ratesTape();
    macro.rates = (tape || []).filter(t => t.value != null);
  } catch (e) {
    swallow(e, 'briefEngine.ratesTape');
  }

  try {
    const focus = await deps.brazilFocus();
    if (focus && focus.ok !== false && focus.years) {
      const yr = String(new Date(deps.now()).getFullYear());
      const y = focus.years[yr] || Object.values(focus.years)[0] || {};
      macro.brazil = {
        selicYE: y.selic != null ? y.selic : null,
        ipca: y.ipca != null ? y.ipca : null,
        fxYE: y.cambio != null ? y.cambio : (y.fx != null ? y.fx : null),
        referenceDate: focus.referenceDate || null,
      };
    }
  } catch (e) {
    swallow(e, 'briefEngine.brazilFocus');
  }

  // ── Vault check: 3 most-active names vs the user's research ─────────
  const vaultHits = [];
  const vaultTargets = [...activeRows]
    .sort((a, b) => activityScore(b) - activityScore(a))
    .slice(0, VAULT_SYMBOLS);
  for (const row of vaultTargets) {
    try {
      const passages = await deps.vaultRetrieve(userId, `${row.symbol.replace(/\.SA$/i, '')} outlook`, 3);
      const top = (passages || [])[0];
      if (!top) continue; // empty-over-noise: no doc, no row
      const created = top.doc_created_at ? new Date(top.doc_created_at).getTime() : null;
      vaultHits.push({
        symbol: row.symbol,
        docName: top.filename || 'Research note',
        excerpt: String(top.content || '').slice(0, 300),
        similarity: top.similarity != null ? +parseFloat(top.similarity).toFixed(3) : null,
        ageDays: created ? Math.round((deps.now() - created) / 86400000) : null,
      });
    } catch (e) {
      swallow(e, 'briefEngine.vault');
    }
  }

  return {
    userId,
    generatedAt: new Date(deps.now()).toISOString(),
    buckets: buckets.map(b => ({
      id: b.id,
      label: b.label,
      total: b.symbols.length,
      active: activeRows.filter(r => r.bucket === b.label).map(r => ({
        symbol: r.symbol,
        last: r.last,
        changePct: r.changePct != null ? +r.changePct.toFixed(2) : null,
        volRatio: r.volRatio,
        earningsInDays: r.earningsInDays,
        earningsDate: r.earningsDate,
        news: r.news,
        flow: r.flow,
        triggers: r.triggers,
      })),
    })),
    totals: {
      names: allSymbols.length,
      active: activeRows.length,
    },
    macro,
    vault: vaultHits,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 2. composeBrief(data) — ONE Haiku call, strict JSON, tolerant parse
// ══════════════════════════════════════════════════════════════════════

const COMPOSE_SYSTEM = [
  'You compose the Daily Brief for a professional investor\'s market terminal.',
  'You are given structured JSON about THEIR watchlist ("their book"), macro events and their research vault.',
  'Respond with STRICT JSON only — no prose, no markdown fences, no commentary.',
].join(' ');

function buildComposePrompt(data) {
  const activeSymbols = data.buckets.flatMap(b => b.active.map(a => a.symbol));
  const bucketLabels = data.buckets.filter(b => b.active.length > 0).map(b => b.label);
  return [
    `DATA:\n${JSON.stringify(data)}`,
    '',
    'Produce exactly this JSON shape:',
    '{',
    '  "oneThing": "<= 220 chars. The single most important judgment connecting today\'s tape to the user\'s book. Reference their names/buckets. Not a headline list — a judgment.",',
    '  "buckets": [{ "name": "<bucket label>", "items": [{ "symbol": "...", "line": "<= 120 chars, concrete numbers from DATA only", "reason": "NEWS|FLOW|EARN|MACRO|VAULT", "meta": "short chip text like EARN 4D, or null" }] }],',
    '  "macro": [{ "label": "<event or rate>", "line": "<= 120 chars", "odds": "e.g. POLY 34%, or null" }],',
    '  "vaultCheck": [{ "docName": "...", "line": "<= 160 chars: what the doc argued vs what the tape is doing now; honest nudge if the note is old", "verdict": "CONFIRMS|CONTRADICTS|AGING" }]',
    '}',
    'Rules:',
    `- ONLY these symbols may appear in buckets: ${activeSymbols.join(', ') || '(none)'}. Never invent names or numbers.`,
    `- Allowed bucket names: ${bucketLabels.join(', ') || '(none)'}.`,
    '- One item per symbol, max. Skip a symbol rather than pad a weak line.',
    '- macro: max 4 rows, from DATA.macro only. Attach odds only when DATA provides them (format "SRC NN%").',
    '- vaultCheck: one row per DATA.vault entry; use its ageDays for AGING judgments. Empty array if DATA.vault is empty.',
    '- If nothing is active, buckets is an empty array and oneThing says the book is quiet — honestly.',
  ].join('\n');
}

/** Clamp/validate the model output against the data contract. */
function sanitizeComposed(parsed, data) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const allowedSymbols = new Set(data.buckets.flatMap(b => b.active.map(a => a.symbol)));
  const allowedBuckets = new Set(data.buckets.map(b => b.label));
  const rowFor = sym => data.buckets.flatMap(b => b.active).find(a => a.symbol === sym);

  const oneThing = typeof parsed.oneThing === 'string'
    ? parsed.oneThing.trim().slice(0, 220)
    : null;
  if (!oneThing) return null;

  const buckets = [];
  for (const b of Array.isArray(parsed.buckets) ? parsed.buckets : []) {
    const name = allowedBuckets.has(b?.name) ? b.name : null;
    if (!name) continue;
    const seen = new Set();
    const items = [];
    for (const it of Array.isArray(b.items) ? b.items : []) {
      const symbol = String(it?.symbol || '').toUpperCase();
      if (!allowedSymbols.has(symbol) || seen.has(symbol)) continue;
      seen.add(symbol);
      const row = rowFor(symbol);
      let reason = REASONS.includes(it?.reason) ? it.reason : null;
      if (!reason) reason = row ? primaryReason(row.triggers || []) : 'NEWS';
      let meta = typeof it?.meta === 'string' ? it.meta.trim().slice(0, 12) : null;
      if (reason === 'EARN' && !meta && row && row.earningsInDays != null) {
        meta = `EARN ${row.earningsInDays}D`;
      }
      items.push({
        symbol,
        line: String(it?.line || '').trim().slice(0, 120),
        reason,
        meta: meta || null,
      });
    }
    if (items.length > 0) buckets.push({ name, items });
  }

  const macro = (Array.isArray(parsed.macro) ? parsed.macro : [])
    .slice(0, 4)
    .map(m => ({
      label: String(m?.label || '').trim().slice(0, 40),
      line: String(m?.line || '').trim().slice(0, 120),
      odds: typeof m?.odds === 'string' && m.odds.trim() ? m.odds.trim().slice(0, 12) : null,
    }))
    .filter(m => m.label && m.line);

  const knownDocs = new Set(data.vault.map(v => v.docName));
  const vaultCheck = (Array.isArray(parsed.vaultCheck) ? parsed.vaultCheck : [])
    .filter(v => knownDocs.has(v?.docName))
    .slice(0, VAULT_SYMBOLS)
    .map(v => ({
      docName: String(v.docName).slice(0, 80),
      line: String(v?.line || '').trim().slice(0, 160),
      verdict: VERDICTS.includes(v?.verdict) ? v.verdict : 'AGING',
    }))
    .filter(v => v.line);

  return { oneThing, buckets, macro, vaultCheck };
}

/** Deterministic composition when the model output is unusable. */
function fallbackCompose(data) {
  const activeRows = data.buckets.flatMap(b => b.active.map(a => ({ ...a, bucket: b.label })));
  const top = [...activeRows].sort((a, b) => activityScore(b) - activityScore(a)).slice(0, 3);

  const oneThing = activeRows.length === 0
    ? `Quiet tape on your book — no live triggers across ${data.totals.names} names.`
    : `${data.totals.active} of ${data.totals.names} names on your book have a live trigger — ${top.map(r => r.symbol).join(', ')} lead the tape.`.slice(0, 220);

  const buckets = data.buckets
    .filter(b => b.active.length > 0)
    .map(b => ({
      name: b.label,
      items: b.active.map(a => {
        const bits = [];
        if (a.changePct != null) bits.push(`${a.changePct > 0 ? '+' : ''}${a.changePct}%`);
        if (a.volRatio != null && a.volRatio >= VOL_TRIGGER_RATIO) bits.push(`vol ${a.volRatio}× avg`);
        if (a.earningsInDays != null) bits.push(`earnings in ${a.earningsInDays}d`);
        if (a.news && a.news.length > 0) bits.push(a.news[0].title.slice(0, 60));
        if (a.flow && a.flow.totalPremium) bits.push(`UW $${Math.round(a.flow.totalPremium / 1e6)}M premium`);
        const reason = primaryReason(a.triggers || []);
        return {
          symbol: a.symbol,
          line: bits.join(' · ').slice(0, 120) || 'On the tape today',
          reason,
          meta: a.earningsInDays != null ? `EARN ${a.earningsInDays}D` : null,
        };
      }),
    }));

  const macro = [];
  for (const ev of data.macro.events.slice(0, 3)) {
    macro.push({
      label: ev.title.slice(0, 40),
      line: `${ev.date}${ev.consensus != null ? ` · consensus ${ev.consensus}` : ''}`.slice(0, 120),
      odds: ev.odds ? `${ev.odds.source} ${ev.odds.probability}%` : null,
    });
  }
  const rateMove = (data.macro.rates || [])
    .filter(r => r.change1d != null)
    .sort((a, b) => Math.abs(b.change1d) - Math.abs(a.change1d))[0];
  if (rateMove && macro.length < 4) {
    const d = rateMove.unit === 'bp'
      ? `${rateMove.change1d > 0 ? '+' : ''}${Math.round(rateMove.change1d)}bp`
      : `${rateMove.change1d > 0 ? '+' : ''}${rateMove.change1d.toFixed(2)}%`;
    const v = rateMove.unit === 'bp' ? `${Math.round(rateMove.value)}bp` : `${rateMove.value.toFixed(2)}%`;
    macro.push({ label: rateMove.label, line: `${v} (${d} 1d)`, odds: null });
  }

  // Empty-over-noise: without a model judgment we only surface docs that
  // are demonstrably aging; we don't fake CONFIRMS/CONTRADICTS verdicts.
  const vaultCheck = data.vault
    .filter(v => v.ageDays != null && v.ageDays >= VAULT_AGING_DAYS)
    .map(v => ({
      docName: v.docName,
      line: `Touches ${v.symbol} — note is ${Math.round(v.ageDays / 30)}mo old and the name is in play today. Refresh?`,
      verdict: 'AGING',
    }));

  return { oneThing, buckets, macro, vaultCheck, degraded: true };
}

async function composeBrief(data, { userId } = {}) {
  // Nothing anywhere → skip the model call entirely; honest quiet-day brief.
  const hasContent = data.totals.active > 0 || data.macro.events.length > 0 || data.vault.length > 0;
  if (!hasContent) {
    return {
      oneThing: data.totals.names > 0
        ? `Quiet tape on your book — no live triggers across ${data.totals.names} names.`
        : 'No names on your watchlist yet — add some and the brief starts working for you.',
      buckets: [],
      macro: [],
      vaultCheck: [],
    };
  }

  let composed = null;
  try {
    const raw = await deps.callModel(buildComposePrompt(data), COMPOSE_SYSTEM, userId);
    composed = sanitizeComposed(extractJson(raw), data);
  } catch (e) {
    logger.warn('briefEngine', 'compose model call failed — deterministic fallback', { error: e.message });
  }
  return composed || fallbackCompose(data);
}

// ══════════════════════════════════════════════════════════════════════
// 3. getBrief — cached-or-built
// ══════════════════════════════════════════════════════════════════════
async function getBrief(userId, { force = false } = {}) {
  const cached = _cache.get(userId);
  if (!force && cached && (deps.now() - cached.at) < CACHE_TTL_MS) {
    return { ...cached, cached: true };
  }

  const data = await buildBriefData(userId);
  const composed = await composeBrief(data, { userId });

  const brief = {
    ...composed,
    counts: data.buckets.map(b => ({ label: b.label, active: b.active.length, total: b.total })),
    totals: data.totals,
    generatedAt: data.generatedAt,
  };

  const entry = { brief, at: deps.now(), generatedAt: data.generatedAt };
  _cache.set(userId, entry);
  return { ...entry, cached: false };
}

// ══════════════════════════════════════════════════════════════════════
// 4. Email rendering (07:30 BRT job) — compact HTML mirror of the panel
// ══════════════════════════════════════════════════════════════════════
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const REASON_COLORS = {
  NEWS: '#ce93d8', FLOW: '#22c55e', EARN: '#e55a00', MACRO: '#64b5f6', VAULT: '#d4af37',
};

function renderEmailHtml(brief, { dateLabel = '' } = {}) {
  const mono = "'JetBrains Mono','SF Mono',Menlo,monospace";
  const section = (label) =>
    `<div style="font-family:${mono};font-size:10px;letter-spacing:2px;color:rgba(255,255,255,.45);padding:14px 0 4px;border-bottom:1px solid rgba(255,255,255,.08)">${esc(label)}</div>`;
  const chip = (reason, meta) =>
    `<span style="font-family:${mono};font-size:9px;color:${REASON_COLORS[reason] || '#a0a0a0'};border:1px solid ${REASON_COLORS[reason] || '#a0a0a0'};border-radius:2px;padding:0 5px;white-space:nowrap">${esc(meta || reason)}</span>`;

  let body = '';
  body += `<div style="background:linear-gradient(90deg,rgba(88,60,160,.25),transparent);padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:2px;margin-bottom:6px">`
    + `<div style="font-family:${mono};font-size:9px;letter-spacing:2px;color:#ce93d8">&#10022; THE ONE THING</div>`
    + `<div style="font-size:13px;color:#f0f0f0;margin-top:5px;line-height:1.45">${esc(brief.oneThing)}</div></div>`;

  for (const b of brief.buckets || []) {
    const count = (brief.counts || []).find(c => c.label === b.name);
    body += section(count ? `${b.name} · ${count.active} of ${count.total} names active` : b.name);
    for (const it of b.items || []) {
      body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="font-family:${mono};font-size:11px;font-weight:700;color:#f0f0f0;width:64px;vertical-align:top;padding:5px 8px 5px 0">${esc(it.symbol)}</td>`
        + `<td style="font-size:12px;color:#a0a0a0;line-height:1.4;padding:5px 8px 5px 0">${esc(it.line)}</td>`
        + `<td style="text-align:right;vertical-align:top;padding:5px 0">${chip(it.reason, it.meta)}</td></tr></table>`;
    }
  }

  if ((brief.macro || []).length > 0) {
    body += section('MACRO');
    for (const m of brief.macro) {
      body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="font-family:${mono};font-size:11px;font-weight:700;color:#f0f0f0;width:90px;vertical-align:top;padding:5px 8px 5px 0">${esc(m.label)}</td>`
        + `<td style="font-size:12px;color:#a0a0a0;line-height:1.4;padding:5px 8px 5px 0">${esc(m.line)}</td>`
        + `<td style="text-align:right;vertical-align:top;padding:5px 0">${m.odds ? `<span style="font-family:${mono};font-size:9px;color:#a0a0a0;border:1px solid rgba(255,255,255,.16);border-radius:2px;padding:0 5px">${esc(m.odds)}</span>` : ''}</td></tr></table>`;
    }
  }

  if ((brief.vaultCheck || []).length > 0) {
    body += section(`VAULT CHECK · ${brief.vaultCheck.length} doc${brief.vaultCheck.length > 1 ? 's' : ''} touched by the tape`);
    for (const v of brief.vaultCheck) {
      body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>`
        + `<td style="font-family:${mono};font-size:11px;font-weight:700;color:#d4af37;vertical-align:top;padding:5px 8px 5px 0;white-space:nowrap">&#9670; ${esc(v.docName.length > 18 ? v.docName.slice(0, 16) + '…' : v.docName)}</td>`
        + `<td style="font-size:12px;color:#a0a0a0;line-height:1.4;padding:5px 8px 5px 0">${esc(v.line)}</td>`
        + `<td style="text-align:right;vertical-align:top;padding:5px 0">${chip('VAULT', v.verdict)}</td></tr></table>`;
    }
  }

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a">`
    + `<div style="max-width:560px;margin:0 auto;padding:24px 16px;background:#0a0a0a;font-family:Inter,-apple-system,sans-serif">`
    + `<div style="font-family:${mono};font-size:12px;font-weight:700;letter-spacing:2px;color:#e55a00;padding-bottom:4px">PARTICLE &middot; BRIEF</div>`
    + `<div style="font-family:${mono};font-size:9px;color:#5a5a5a;letter-spacing:1px;padding-bottom:14px">${esc(dateLabel)}</div>`
    + body
    + `<div style="font-family:${mono};font-size:9px;color:#5a5a5a;padding-top:18px;line-height:1.5">You get this because Daily Brief email is on in your Particle settings.<br>Turn it off from the BRIEF panel (EMAIL chip) or Settings.</div>`
    + `</div></body></html>`;
}

// ── Test hooks ─────────────────────────────────────────────────────────
function _setDeps(overrides) { deps = { ...makeDefaultDeps(), ...overrides }; }
function _resetDeps() { deps = makeDefaultDeps(); }
function _clearCache() { _cache.clear(); }

module.exports = {
  buildBriefData,
  composeBrief,
  getBrief,
  renderEmailHtml,
  // internals for tests
  bucketizeWatchlist,
  matchPredictionToEvent,
  triggersFor,
  fallbackCompose,
  sanitizeComposed,
  _setDeps,
  _resetDeps,
  _clearCache,
};
