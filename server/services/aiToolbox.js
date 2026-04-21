/**
 * services/aiToolbox.js — Tool-use layer for Particle AI (s3).
 *
 * Before this module, the Particle chat handler pre-fetched a fixed set of
 * context strings (market, news, vault, earnings, options, edgar) and glued
 * them to the system prompt. When the user asked for anything outside those
 * buckets — EU corporate bond maturities, a Brazilian sovereign curve, a
 * Kalshi prediction — the model had no way to reach the relevant adapter
 * and would tell the user to check Bloomberg.
 *
 * This module turns that around. It exposes the terminal's internal
 * adapters as Claude tool definitions and runs an agentic loop: the model
 * decides what data it needs, we execute the tool, we feed the result
 * back, and we repeat until the model has what it needs to answer. This
 * lets the AI reach every adapter we already have (quotes, yield curves,
 * macro, earnings, options flow, prediction markets, vault, sovereign
 * bonds) without anyone pre-guessing what the user will ask about.
 *
 * Design contract:
 *   - Tool definitions follow Anthropic's tool-use JSON schema.
 *   - Every tool handler is async, returns a plain serialisable object
 *     (or throws). The dispatcher catches and returns an `error` string
 *     so a single flaky adapter can never break the loop.
 *   - All handlers respect the per-user authorisation context. The Vault
 *     tool requires a userId; without one it returns empty rather than
 *     leaking another user's data.
 *   - Every round is capped: MAX_TOOL_ROUNDS keeps a model from looping
 *     forever, MAX_TOOLS_PER_ROUND keeps one round from being a DDOS.
 *
 * Wiring: see server/routes/search.js — when the selected provider is
 * Claude (which supports native tool use) the handler routes through
 * runToolLoopStream() instead of modelRouter.streamResponse().
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');
const aiCostLedger = require('./aiCostLedger');

// ── Loop limits — defensive caps for runaway agent behaviour ──────────
const MAX_TOOL_ROUNDS = 5;        // how many model→tools round trips
const MAX_TOOLS_PER_ROUND = 6;    // parallel tool calls per round
const MAX_TOOL_PAYLOAD_BYTES = 12 * 1024; // 12 KB per tool result

// Hard per-request token ceiling. The middleware/aiQuotaGate runs once
// pre-flight, but a single tool-loop can burn 5× the tokens of a single-shot
// call. This cap prevents a user at 45k/50k daily from overdrafting by 25k
// in one session. Once this is tripped mid-loop we stop calling tools and
// force the model to synthesise from what it has.
const MAX_TOKENS_PER_REQUEST = 40000;

// ── Tool catalog ──────────────────────────────────────────────────────
//
// Each tool has:
//   name         — stable identifier the model references
//   description  — when to use it (read by the model)
//   input_schema — JSON schema Claude uses to validate/generate arguments
//
// Keep descriptions tight and imperative. The model follows these.
const TOOLS = [
  {
    name: 'lookup_quote',
    description:
      'Fetch the latest price, change, and basic fundamentals for a ticker ' +
      'across equities, ETFs, crypto, and FX. Use this whenever the user ' +
      'asks about a specific symbol price or performance.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker or symbol (AAPL, BTC-USD, EURUSD=X, PETR4.SA).' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_yield_curve',
    description:
      'Fetch the current sovereign yield curve for a country. Use for ' +
      '"what is the US 10Y at", "show me the Brazil curve", curve ' +
      'steepness/inversion questions, or when the user asks about rates.',
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO country code: US, DE, GB, JP, BR, EU.' },
      },
      required: ['country'],
    },
  },
  {
    name: 'list_sovereign_bonds',
    description:
      'List individual sovereign bonds for a country (ISIN, maturity, ' +
      'yield). Use when the user asks about specific issues, bond ' +
      'maturities, refunding walls, or upcoming rollovers.',
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO country code: US, DE, GB, JP, BR, EU.' },
      },
      required: ['country'],
    },
  },
  {
    name: 'list_corporate_bonds',
    description:
      'List corporate bonds filtered by region, sector, rating, or ' +
      'maturity window. Use for questions like "EU corporate bonds ' +
      'maturing this month", "HY bonds with issuers under stress", or ' +
      'credit-risk screens.',
    input_schema: {
      type: 'object',
      properties: {
        region:        { type: 'string', description: 'US, EU, UK, Asia, BR. Optional.' },
        sector:        { type: 'string', description: 'Sector filter (financials, energy, tech...). Optional.' },
        ratingMax:     { type: 'string', description: 'Highest rating to include (e.g. "BB" to get HY and below). Optional.' },
        maturityBefore:{ type: 'string', description: 'ISO date (YYYY-MM-DD). Include only bonds maturing on/before this date. Optional.' },
        maturityAfter: { type: 'string', description: 'ISO date (YYYY-MM-DD). Include only bonds maturing on/after this date. Optional.' },
        limit:         { type: 'integer', description: 'Max rows, default 30, cap 100.' },
      },
    },
  },
  {
    name: 'get_macro_snapshot',
    description:
      'Fetch the current macro snapshot for a country — policy rate, CPI ' +
      'YoY, GDP growth, unemployment, debt/GDP. Use whenever the user ' +
      'asks about a country\'s economy or a specific macro series.',
    input_schema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO country code: US, BR, EU, GB, JP, CN, IN, MX, AR.' },
      },
      required: ['country'],
    },
  },
  {
    name: 'get_earnings_calendar',
    description:
      'Fetch upcoming or past earnings prints in a date window (optionally ' +
      'filtered to one symbol). Use for "who reports this week", ' +
      '"Apple last earnings", or surprise/guidance questions.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Optional ticker filter.' },
        from:   { type: 'string', description: 'ISO start date (YYYY-MM-DD).' },
        to:     { type: 'string', description: 'ISO end date (YYYY-MM-DD).' },
      },
    },
  },
  {
    name: 'get_options_flow',
    description:
      'Fetch unusual options activity for a ticker — net flow, calls vs ' +
      'puts, sentiment. Use when the user asks "what are options doing", ' +
      '"dark pool", or about unusual whales activity.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'search_prediction_markets',
    description:
      'Search prediction markets (Kalshi, Polymarket) for a topic. Use ' +
      'whenever the user asks "what are prediction markets saying about ' +
      'X", or wants odds on election/policy/economic events.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Free-text topic or keyword.' },
        limit: { type: 'integer', description: 'Max markets, default 10, cap 25.' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'search_vault',
    description:
      'Semantic search over the user\'s personal Vault of uploaded ' +
      'research, emails, and PDFs. Use when the user asks about something ' +
      'they uploaded, or when a question is likely grounded in their own ' +
      'materials.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language query.' },
        limit: { type: 'integer', description: 'Max passages, default 6, cap 12.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_recent_wire',
    description:
      'Fetch the most recent market wire entries (news + headlines). Use ' +
      'for "what\'s happening", general market color, or when a question ' +
      'references unspecified recent events.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max entries, default 20, cap 50.' },
      },
    },
  },
  {
    name: 'lookup_fx',
    description:
      'Fetch an FX spot rate. For ANY pair including BRL (USDBRL, EURBRL, ' +
      'GBPBRL, BRLUSD, etc.) this returns BOTH the official BCB PTAX rate ' +
      'AND the live market rate — they are different numbers and you must ' +
      'explain the distinction: PTAX is the end-of-day official reference ' +
      'rate published by the Brazilian central bank (updated a few times ' +
      'per day with a final closing print) used for contracts and tax; ' +
      'live is the current market mid from Twelve Data or Yahoo. For ' +
      'non-BRL pairs (EURUSD, USDJPY, GBPUSD, USDMXN, etc.) only the live ' +
      'rate applies. Use this whenever the user asks about a currency, FX ' +
      'pair, câmbio, dólar, euro, or exchange rate.',
    input_schema: {
      type: 'object',
      properties: {
        pair: {
          type: 'string',
          description:
            'FX pair in any common format: "USDBRL", "USD/BRL", "EURUSD", ' +
            '"GBP/BRL". ISO-4217 codes only.',
        },
      },
      required: ['pair'],
    },
  },
  {
    name: 'lookup_commodity',
    description:
      'Fetch the latest futures price for a commodity — energy (WTI, ' +
      'Brent, natgas), precious metals (gold, silver, platinum, ' +
      'palladium), base metals (copper, iron ore), grains (corn, ' +
      'soybeans, wheat), softs (coffee, sugar, cocoa, cotton), or ' +
      'livestock (live cattle, lean hogs). Accepts plain names in ' +
      'English or Portuguese (petróleo, ouro, minério de ferro, café, ' +
      'soja, milho, boi gordo) OR canonical Yahoo futures symbols ' +
      '(CL=F, GC=F, ZC=F, KC=F). Returns price, change, change %, unit ' +
      '(per barrel, per troy oz, etc.), exchange, and a coverage_note ' +
      'field if the specific commodity has a known data gap (e.g. SGX ' +
      'iron ore can be delayed). Use this for any question about a ' +
      'commodity price, "how is oil doing", "what\'s gold at", ' +
      'inflation hedge discussions, or resource-sector context.',
    input_schema: {
      type: 'object',
      properties: {
        commodity: {
          type: 'string',
          description:
            'Commodity name or futures symbol. Examples: "oil", "brent", ' +
            '"gold", "iron ore", "corn", "coffee", "CL=F", "GC=F", ' +
            '"minério de ferro", "boi gordo".',
        },
      },
      required: ['commodity'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────
//
// Each handler receives (args, ctx) where ctx = { userId }. Returns a
// plain JSON-serialisable object. Any throw is caught by dispatch() and
// reported back to the model as { error: <message> }.
//
// We lazy-require the adapter so a missing module or missing API key
// can't crash the whole toolbox at load time.
function lazy(modulePath) {
  return () => {
    try { return require(modulePath); }
    catch (e) {
      logger.warn('aiToolbox', `module unavailable: ${modulePath}`, { error: e.message });
      return null;
    }
  };
}

const providers = {
  multiAsset:         lazy('../providers/multiAssetProvider'),
  bonds:              lazy('../providers/bondsProvider'),
  macro:              lazy('../providers/macroProvider'),
  fx:                 lazy('../providers/fxProvider'),
  commodities:        lazy('../providers/commoditiesProvider'),
};
const services = {
  earnings:           lazy('./earnings'),
  unusualWhales:      lazy('./unusualWhales'),
  predictionAgg:      lazy('./predictionAggregator'),
  vault:              lazy('./vault'),
  wireGenerator:      lazy('./wireGenerator'),
};

async function handleLookupQuote({ symbol }) {
  const mod = providers.multiAsset();
  if (!mod || typeof mod.getInstrumentDetail !== 'function') {
    return { error: 'quote adapter unavailable' };
  }
  try {
    const detail = await mod.getInstrumentDetail({ symbol });
    if (!detail) return { symbol, error: 'no data' };
    return {
      symbol: detail.symbol || symbol,
      name: detail.name,
      price: detail.price,
      change: detail.change,
      chgPct: detail.chgPct,
      marketCap: detail.marketCap,
      sector: detail.sector,
      industry: detail.industry,
      pe: detail.pe,
      dividendYield: detail.dividendYield,
      source: detail.source,
      asOf: detail.asOf,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetYieldCurve({ country }) {
  const mod = providers.bonds();
  if (!mod || typeof mod.getYieldCurve !== 'function') {
    return { error: 'bonds adapter unavailable' };
  }
  try {
    const res = await mod.getYieldCurve(String(country).toUpperCase());
    return res || { country, error: 'no curve data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleListSovereignBonds({ country }) {
  const mod = providers.bonds();
  if (!mod || typeof mod.getSovereignBonds !== 'function') {
    return { error: 'bonds adapter unavailable' };
  }
  try {
    const rows = await mod.getSovereignBonds(String(country).toUpperCase());
    const count = Array.isArray(rows) ? rows.length : 0;
    // An empty array from bondsProvider means "Eulerpool returned nothing or
    // isn't configured". Without this distinction the model sees count=0 and
    // happily asserts "there are no bonds", which is misleading. Signal the
    // coverage gap explicitly so the synthesis can say "I don't have that
    // data source live".
    if (count === 0) {
      return {
        country,
        count: 0,
        bonds: [],
        coverage_gap: 'No individual sovereign bond rows available for this country. Terminal coverage is partial — recommend using get_yield_curve for tenor-level yields instead.',
      };
    }
    return { country, count, bonds: (rows || []).slice(0, 40) };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleListCorporateBonds(args) {
  const mod = providers.bonds();
  if (!mod || typeof mod.getCorpBonds !== 'function') {
    return { error: 'corporate bond adapter unavailable' };
  }
  try {
    const rows = await mod.getCorpBonds({
      region:         args.region,
      sector:         args.sector,
      ratingMax:      args.ratingMax,
      maturityBefore: args.maturityBefore,
      maturityAfter:  args.maturityAfter,
      limit:          Math.min(100, Math.max(1, Number(args.limit) || 30)),
    });
    const count = Array.isArray(rows) ? rows.length : 0;
    // Same signal as sovereign bonds — empty here almost always means the
    // Eulerpool data feed isn't configured in this environment, not that
    // the universe is empty. The model must not pretend otherwise.
    if (count === 0) {
      return {
        count: 0,
        bonds: [],
        coverage_gap: 'Corporate bond rows are not available in this environment. Tell the user plainly that the terminal does not currently cover individual corporate issues for these filters; suggest get_yield_curve, sovereign bonds, or an equity-level view as alternatives.',
      };
    }
    return { count, bonds: (rows || []).slice(0, 40) };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetMacroSnapshot({ country }) {
  const mod = providers.macro();
  if (!mod || typeof mod.getSnapshot !== 'function') {
    return { error: 'macro adapter unavailable' };
  }
  try {
    const snap = await mod.getSnapshot(String(country).toUpperCase());
    return snap || { country, error: 'no snapshot' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetEarningsCalendar({ symbol, from, to }) {
  const mod = services.earnings();
  if (!mod) return { error: 'earnings adapter unavailable' };
  try {
    // Default window: next 14 days if none supplied.
    const today = new Date();
    const in14 = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const fromIso = from || today.toISOString().slice(0, 10);
    const toIso   = to   || in14.toISOString().slice(0, 10);

    if (symbol && typeof mod.getEarningsForTicker === 'function') {
      const rows = await mod.getEarningsForTicker(String(symbol).toUpperCase());
      return { symbol, count: Array.isArray(rows) ? rows.length : 0, earnings: (rows || []).slice(0, 20) };
    }
    if (typeof mod.getEarningsCalendar === 'function') {
      const rows = await mod.getEarningsCalendar(fromIso, toIso);
      return { from: fromIso, to: toIso, count: Array.isArray(rows) ? rows.length : 0, earnings: (rows || []).slice(0, 50) };
    }
    return { error: 'earnings adapter missing entry points' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetOptionsFlow({ symbol }) {
  const mod = services.unusualWhales();
  if (!mod || typeof mod.getOptionsFlow !== 'function') {
    return { error: 'options flow adapter unavailable (UNUSUAL_WHALES_API_KEY not set)' };
  }
  try {
    const flow = await mod.getOptionsFlow(String(symbol).toUpperCase());
    return flow || { symbol, error: 'no flow data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSearchPredictionMarkets({ topic, limit }) {
  const mod = services.predictionAgg();
  if (!mod) return { error: 'prediction adapter unavailable' };
  const cap = Math.min(25, Math.max(1, Number(limit) || 10));
  try {
    // Prefer query-based search if available; otherwise fall back to topN +
    // post-filter by substring match so the tool still returns something
    // relevant even when the specific helper isn't exported.
    if (typeof mod.getForQuery === 'function') {
      const res = await mod.getForQuery(topic, { limit: cap });
      return res || { topic, markets: [] };
    }
    if (typeof mod.getTopMarkets === 'function') {
      const top = await mod.getTopMarkets({ limit: Math.max(cap, 40) });
      const needle = String(topic).toLowerCase();
      const matches = (top?.markets || []).filter(m =>
        String(m.title || m.question || '').toLowerCase().includes(needle),
      ).slice(0, cap);
      return { topic, count: matches.length, markets: matches };
    }
    return { error: 'prediction adapter missing entry points' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSearchVault({ query, limit }, ctx) {
  if (!ctx || !ctx.userId) {
    return { error: 'vault search requires an authenticated user' };
  }
  const mod = services.vault();
  if (!mod || typeof mod.retrieve !== 'function') {
    return { error: 'vault adapter unavailable' };
  }
  const cap = Math.min(12, Math.max(1, Number(limit) || 6));
  try {
    const rows = await mod.retrieve(ctx.userId, query, cap);
    return {
      query,
      count: Array.isArray(rows) ? rows.length : 0,
      passages: (rows || []).map(r => ({
        documentId: r.documentId,
        filename: r.filename,
        similarity: r.similarity,
        // Keep passage text tight — the model doesn't need the whole chunk.
        excerpt: typeof r.content === 'string' ? r.content.slice(0, 800) : '',
      })),
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleLookupFx({ pair }) {
  const mod = providers.fx();
  if (!mod || typeof mod.getFxQuote !== 'function') {
    return { error: 'FX adapter unavailable' };
  }
  try {
    const res = await mod.getFxQuote(pair);
    return res || { error: 'no FX data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleLookupCommodity({ commodity }) {
  const mod = providers.commodities();
  if (!mod || typeof mod.getCommodityQuote !== 'function') {
    return { error: 'commodities adapter unavailable' };
  }
  try {
    const res = await mod.getCommodityQuote(commodity);
    return res || { error: 'no commodity data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetRecentWire({ limit }) {
  const mod = services.wireGenerator();
  if (!mod || typeof mod.getFromDB !== 'function') {
    return { error: 'wire adapter unavailable' };
  }
  const cap = Math.min(50, Math.max(1, Number(limit) || 20));
  try {
    const rows = await mod.getFromDB(cap, 0);
    return { count: Array.isArray(rows) ? rows.length : 0, wire: (rows || []).slice(0, cap) };
  } catch (e) {
    return { error: e.message };
  }
}

const HANDLERS = {
  lookup_quote:              handleLookupQuote,
  get_yield_curve:           handleGetYieldCurve,
  list_sovereign_bonds:      handleListSovereignBonds,
  list_corporate_bonds:      handleListCorporateBonds,
  get_macro_snapshot:        handleGetMacroSnapshot,
  get_earnings_calendar:     handleGetEarningsCalendar,
  get_options_flow:          handleGetOptionsFlow,
  search_prediction_markets: handleSearchPredictionMarkets,
  search_vault:              handleSearchVault,
  get_recent_wire:           handleGetRecentWire,
  lookup_fx:                 handleLookupFx,
  lookup_commodity:          handleLookupCommodity,
};

/**
 * Execute a tool by name. Never throws — errors become `{ error }` so the
 * model can observe them and react. Output is size-capped to protect the
 * context budget.
 */
async function dispatchTool(name, args, ctx = {}) {
  const fn = HANDLERS[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  const start = Date.now();
  let result;
  try {
    result = await fn(args || {}, ctx);
  } catch (e) {
    result = { error: e.message || 'tool threw' };
  }
  const ms = Date.now() - start;
  logger.info('aiToolbox', `tool ${name} executed`, {
    name,
    ms,
    ok: !(result && result.error),
    userId: ctx.userId || null,
  });
  // Enforce payload cap — a single tool result blowing up the context
  // budget has killed us before. Stringify, slice, re-wrap.
  try {
    const s = JSON.stringify(result);
    if (s.length > MAX_TOOL_PAYLOAD_BYTES) {
      return {
        truncated: true,
        originalBytes: s.length,
        note: `result truncated to ${MAX_TOOL_PAYLOAD_BYTES} bytes`,
        preview: s.slice(0, MAX_TOOL_PAYLOAD_BYTES),
      };
    }
  } catch { /* non-serialisable — let it through and let JSON.stringify throw upstream */ }
  return result;
}

// ── Agentic loop ──────────────────────────────────────────────────────
//
// Runs the multi-round Claude tool-use loop, then streams the final text
// to the Express response as SSE chunks compatible with the existing
// client parser (`data: {"chunk": "..."}\n\n`).
//
// The client doesn't need to know tool rounds are happening; it just sees
// text chunks arrive when the model finishes synthesising.

function buildToolUseBody(provider, messages, systemPrompt, { maxTokens = 4096 } = {}) {
  return {
    model: provider.model,
    system: systemPrompt,
    messages,
    max_tokens: maxTokens,
    tools: TOOLS,
  };
}

async function callClaudeJson(provider, body) {
  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) throw new Error(`API key not configured for ${provider.keyEnv}`);
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Returns true iff the provider targets Anthropic — Perplexity's OpenAI
 * shape does not support our tool schema.
 */
function providerSupportsTools(provider) {
  return !!(provider && typeof provider.url === 'string' && provider.url.includes('anthropic'));
}

/**
 * Run the tool-use loop. Appends to `messages` in place across rounds so
 * the caller can inspect what happened. Returns { finalText, usage, rounds }.
 */
async function runToolLoop(provider, initialMessages, systemPrompt, ctx = {}) {
  const messages = [...initialMessages];
  let rounds = 0;
  let totalIn = 0;
  let totalOut = 0;
  let finalText = '';
  // tokenCapHit is set when the per-request ceiling is reached between
  // rounds. It switches the closing synthesis into "budget exhausted" mode
  // so the model stops trying to call tools and just answers from what it
  // has gathered so far.
  let tokenCapHit = false;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const body = buildToolUseBody(provider, messages, systemPrompt);
    const resp = await callClaudeJson(provider, body);

    if (resp.usage) {
      totalIn  += Number(resp.usage.input_tokens)  || 0;
      totalOut += Number(resp.usage.output_tokens) || 0;
    }

    const content = Array.isArray(resp.content) ? resp.content : [];
    const textBlocks = content.filter(b => b.type === 'text').map(b => b.text || '').join('');
    const toolUses = content.filter(b => b.type === 'tool_use');

    // Always append the assistant message, even if it's partial — the
    // follow-up tool_result must be sent as a user turn AFTER the
    // assistant's tool_use turn. Claude rejects tool_result without the
    // preceding assistant message.
    messages.push({ role: 'assistant', content });

    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      finalText = textBlocks;
      break;
    }

    // Per-request token cap. A single tool-loop can 5× the spend of a
    // single-shot call; without this, a trial user at 45k/50k daily could
    // overdraft by another 25k in one session. Fire the check BEFORE
    // dispatching more tool calls — tool-results are cheap to gather but
    // the next round's model call is where the real tokens go.
    if (totalIn + totalOut >= MAX_TOKENS_PER_REQUEST) {
      tokenCapHit = true;
      logger.warn('aiToolbox', 'per-request token cap hit', {
        userId: ctx.userId || null,
        rounds,
        totalIn,
        totalOut,
        cap: MAX_TOKENS_PER_REQUEST,
      });
      break;
    }

    // Execute all tool_uses in parallel, then reply as a single user turn
    // with the tool_result blocks. Cap per-round to protect the budget.
    const limited = toolUses.slice(0, MAX_TOOLS_PER_ROUND);
    const results = await Promise.all(limited.map(async (tu) => {
      const out = await dispatchTool(tu.name, tu.input || {}, ctx);
      let serialised;
      try { serialised = JSON.stringify(out); }
      catch (_) { serialised = '{"error":"non-serialisable tool result"}'; }
      return {
        type: 'tool_result',
        tool_use_id: tu.id,
        content: serialised,
      };
    }));

    messages.push({ role: 'user', content: results });
  }

  // If we exhausted the loop without a final text, ask the model to
  // synthesise from what it has. Don't re-run tools on this closing turn.
  if (!finalText) {
    const exhaustionNote = tokenCapHit
      ? '\n\nYou have used most of the token budget for this turn. Synthesise your answer NOW from the tool results you already have. Do not call additional tools. If the data is incomplete, state that plainly in one sentence.'
      : '\n\nYou have exhausted your tool budget. Synthesise your answer now from the tool results you have. Do not call additional tools. Always produce a user-facing text answer.';
    const closeBody = {
      model: provider.model,
      system: systemPrompt + exhaustionNote,
      messages,
      max_tokens: 2048,
    };
    try {
      const resp = await callClaudeJson(provider, closeBody);
      if (resp.usage) {
        totalIn  += Number(resp.usage.input_tokens)  || 0;
        totalOut += Number(resp.usage.output_tokens) || 0;
      }
      const content = Array.isArray(resp.content) ? resp.content : [];
      finalText = content.filter(b => b.type === 'text').map(b => b.text || '').join('');
    } catch (e) {
      logger.warn('aiToolbox', 'closing synthesis failed', { error: e.message });
    }
  }

  // Hard safety net — we must never return an empty answer to the user.
  // An empty finalText shows up in the UI as "(No response)", which is
  // worse than a plain-English admission that something went sideways.
  // This catches both the "closing-synthesis returned zero text blocks"
  // case and any other path that produced no text.
  if (!finalText || !finalText.trim()) {
    logger.warn('aiToolbox', 'runToolLoop produced empty finalText', {
      userId: ctx.userId || null,
      rounds,
      tokenCapHit,
      totalIn,
      totalOut,
    });
    finalText = tokenCapHit
      ? "I hit this turn's token budget before I could finish. Try narrowing the question — for example, a specific country, sector, or maturity window — and I'll answer from what I can gather."
      : "I couldn't assemble a useful answer from the terminal data available for that question. Try rephrasing, or ask me for an adjacent angle (e.g. a yield curve or sovereign bonds) that I can source directly.";
  }

  return { finalText, rounds, tokenCapHit, usage: { input: totalIn, output: totalOut } };
}

/**
 * Wrap runToolLoop with the same SSE contract the client expects. This is
 * what search.js calls when the provider is Claude. Writes `conversationId`
 * upstream, this function only handles the final synthesis chunks.
 *
 * onComplete(fullText) is invoked after the final chunk so callers can
 * persist the assistant turn to aiChatStore.
 */
async function runToolLoopStream(provider, initialMessages, systemPrompt, res, { userId, onComplete, onRoundsMeta } = {}) {
  // Kick off SSE if the caller hasn't already.
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

  let fullText = '';
  let rounds = 0;
  try {
    const out = await runToolLoop(provider, initialMessages, systemPrompt, { userId });
    fullText = out.finalText || '';
    rounds = out.rounds;

    // Emit the text as chunks. 120-char chunks feel incremental to humans
    // without hammering SSE framing.
    if (typeof onRoundsMeta === 'function') {
      try { onRoundsMeta({ rounds }); } catch {}
    }
    // Safety floor — runToolLoop now always produces non-empty finalText,
    // but if that contract is ever broken we still want the user to see
    // something instead of the client rendering "(No response)".
    if (!fullText || !fullText.trim()) {
      fullText = "I wasn't able to assemble a useful answer this turn. Try rephrasing or ask a more specific question.";
    }
    const CHUNK = 120;
    for (let i = 0; i < fullText.length; i += CHUNK) {
      if (res.writableEnded) break;
      res.write(`data: ${JSON.stringify({ chunk: fullText.slice(i, i + CHUNK) })}\n\n`);
    }

    // Ledger recording — best-effort.
    if (userId && (out.usage.input || out.usage.output)) {
      try { aiCostLedger.recordUsage(userId, provider.model, out.usage.input, out.usage.output); }
      catch (_) { /* fire-and-forget */ }
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }

    if (typeof onComplete === 'function') {
      try { await onComplete(fullText); } catch (_) { /* ignore */ }
    }
  } catch (e) {
    logger.error('aiToolbox', 'runToolLoopStream failed', { error: e.message });
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ partial: true, error: 'Response interrupted — tap to retry' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}

module.exports = {
  TOOLS,
  HANDLERS,
  MAX_TOOL_ROUNDS,
  MAX_TOOLS_PER_ROUND,
  MAX_TOOL_PAYLOAD_BYTES,
  MAX_TOKENS_PER_REQUEST,
  dispatchTool,
  runToolLoop,
  runToolLoopStream,
  providerSupportsTools,
};
