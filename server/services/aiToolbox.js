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
//
// Phase 10.4 (#217): raised 40k → 80k. A multi-ticker comparables flow
// (HTZ + CAR + RENT3 + MOVI3 with fleet research) routinely needs
// ~4 lookup_quote + ~4 web_research tool calls, each returning up to
// 12KB of text. After 2-3 synthesis rounds, input tokens alone were
// clearing 35k, tripping the cap mid-thought and leaving the user with
// the "I hit this turn's token budget" canned reply. 80k gives genuine
// agentic workflows room to breathe while still protecting against a
// runaway loop — the Pro tier's daily budget is 1M, so a single turn at
// 80k is 8% of the day.
const MAX_TOKENS_PER_REQUEST = 80000;

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
    name: 'list_market_movers',
    description:
      'Return the top US-equity movers for today: biggest gainers, ' +
      'biggest losers, or most actively traded (by session volume). ' +
      'Use this for any "top 5 S&P gainers", "who\'s down the most ' +
      'today", "most active names", "unusual volume" question. Returns ' +
      'symbol, price, change, change %, and session volume per row. ' +
      'US equities ONLY — the response will include a coverage_note if ' +
      'the user asked about a non-US market (B3, HK, A-shares, Nifty); ' +
      'in that case relay the gap honestly instead of inventing a list.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['gainers', 'losers', 'actives'],
          description:
            'gainers = top % up, losers = top % down, actives = most ' +
            'traded by session volume.',
        },
        limit: {
          type: 'number',
          description:
            'How many rows to return (1-50). Default 10. Prefer 5-10 for ' +
            'conversational answers.',
        },
        market: {
          type: 'string',
          description:
            'Market code. Only "US" is wired today; any other value ' +
            'returns an empty list with a coverage_note.',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'list_cvm_filings',
    description:
      'List regulatory filings from CVM (Comissão de Valores Mobiliários, ' +
      'the Brazilian SEC) for a B3-listed company. Covers all IPE ' +
      '(Informações Periódicas e Eventuais) documents: Fatos Relevantes ' +
      '(material facts), Comunicados ao Mercado (market notices), DFP ' +
      '(annual financials), ITR (quarterly), atas de assembleia, avisos ' +
      'aos acionistas. Use this for "did PETR4 file anything recently", ' +
      '"últimos fatos relevantes da Vale", "Itaú CVM filings this month", ' +
      '"what\'s the latest material event from Eletrobras", "show me VALE3 ' +
      'DFPs". This is the Brazilian equivalent of EDGAR 8-K/10-K; do NOT ' +
      'use EDGAR for B3-listed names (EDGAR only covers SEC filers / ADRs).',
    input_schema: {
      type: 'object',
      properties: {
        ticker: {
          type: 'string',
          description:
            'B3 ticker (PETR4, VALE3, ITUB4, MGLU3). Accepts .SA suffix. ' +
            'Top ~40 blue chips resolve instantly via a hard-coded CNPJ ' +
            'map; for others pass `company` instead.',
        },
        company: {
          type: 'string',
          description:
            'Company name substring as it appears on CVM (e.g. ' +
            '"Petrobras", "Vale", "Itaúsa", "Oi S.A."). Use when the ' +
            'ticker isn\'t in the alias table.',
        },
        cnpj: {
          type: 'string',
          description: 'CNPJ (digits only or formatted). Wins over ticker / company if provided.',
        },
        category: {
          type: 'string',
          description:
            'CVM Categoria substring filter (e.g. "Fato Relevante", ' +
            '"Comunicado", "DFP", "ITR"). Optional.',
        },
        type: {
          type: 'string',
          description: 'CVM Tipo substring filter (e.g. "Aviso aos Acionistas"). Optional.',
        },
        from: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Inclusive lower bound on Data_Entrega.',
        },
        to: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Inclusive upper bound on Data_Entrega.',
        },
        limit: {
          type: 'number',
          description: 'Max rows (1-100). Default 20.',
        },
        year: {
          type: 'number',
          description:
            'IPE year to load. Defaults to the current year; the tool ' +
            'auto-falls-back to previous year if the current-year CSV is empty.',
        },
      },
    },
  },
  {
    name: 'get_brazil_macro',
    description:
      'Fetch a Brazilian macro time-series from the BCB SGS (Banco Central ' +
      'do Brasil — Sistema Gerenciador de Séries Temporais). Covers Selic ' +
      '(daily and Copom target), IPCA (monthly and 12-month accumulated), ' +
      'IGP-M, IBC-Br (GDP proxy), PTAX USD/BRL sell rate, and PNAD ' +
      'unemployment. Use this for ANY Brazilian macro question — "onde ' +
      'está a Selic", "IPCA do mês", "IGP-M trend", "IBC-Br último", ' +
      '"trajetória do desemprego", "Selic history chart". Prefer this over ' +
      'get_macro_snapshot when the user asks about Brazil specifically or ' +
      'wants a series / history / trajectory rather than a one-row ' +
      'snapshot. Set history=true when the user wants a trend, chart, ' +
      'histórico, or "últimos N meses". Note: ptax_venda here returns the ' +
      'BCB PTAX series — if the user asks for a live USD/BRL quote, use ' +
      'lookup_fx instead (which surfaces both PTAX and live side-by-side).',
    input_schema: {
      type: 'object',
      properties: {
        series: {
          type: 'string',
          description:
            'Series name or canonical key. Accepts: selic, selic_meta, ' +
            'ipca, ipca_12m, igpm, ibc_br, ptax_venda, desemprego. Also ' +
            'tolerates aliases: "Selic diária", "meta Selic", "Copom", ' +
            '"IPCA 12m", "IPCA acumulado", "IGP-M", "IBC-Br", "PTAX", ' +
            '"câmbio", "dólar", "unemployment_br".',
        },
        history: {
          type: 'boolean',
          description:
            'If true, include the history window (up to 300 most recent ' +
            'observations). Default false — only the latest value.',
        },
        months: {
          type: 'number',
          description:
            'How many months of history to fetch (1-240). Default 24. ' +
            'Only meaningful when history=true.',
        },
      },
      required: ['series'],
    },
  },
  {
    name: 'get_market_regime',
    description:
      'Classify the current market regime based on live cross-asset ' +
      'signals: VIX level, 2s10s US Treasury slope, US HY credit spread, ' +
      'SPY 20-day trend, and DXY 20-day trend. Returns one of: risk-on ' +
      'expansion, late-cycle euphoria, transition / crosscurrents, ' +
      'risk-off correction, stress / flight-to-quality, stagflationary, ' +
      'or disinflationary soft-landing — with a confidence score, the ' +
      'underlying readings, and a runner-up label. Use this for any ' +
      '"what regime are we in", "risk-on or risk-off", "is this a ' +
      'late-cycle setup", "are we in stagflation" question, or before ' +
      'answering scenario questions so your framing matches the ' +
      'backdrop. This is a rules-based classifier, not a prediction — ' +
      'always relay the methodology_note so the user knows the model is ' +
      'interpreting current readings, not forecasting.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'run_scenario',
    description:
      'Run a first-order macro scenario and get estimated impact on ' +
      'sector factors (and optionally on a specific ticker). Shocks ' +
      'supported: rates_up / rates_down (bps magnitude, e.g. 100 for ' +
      '+100 bps 10Y UST), usd_up / usd_down (% magnitude, e.g. 10 for ' +
      '+10% DXY), oil_up / oil_down (% magnitude, e.g. 20 for +20% WTI), ' +
      'equity_down (% magnitude, e.g. 10 for a -10% SPX shock), and ' +
      'credit_widen (bps magnitude, e.g. 100 for +100 bps HY OAS). ' +
      'Returns factorImpacts keyed by asset bucket (SPX, QQQ, XLF, XLK, ' +
      'XLE, XLU, XLRE, XLP, XLY, XLV, XLI, XLB, EM, IBOV, GOLD, OIL, ' +
      'HY, etc.). If `symbol` is provided, also returns a ticker-level ' +
      'estimate via the ticker\'s sector bucket. Use this for "what ' +
      'happens to my portfolio if the Fed hikes 100 bps", "how does ' +
      'PETR4 react to +20% oil", "if the dollar strengthens 10%, what ' +
      'breaks", scenario-testing questions. ALWAYS relay the ' +
      'methodology_note — sensitivities are hand-calibrated, not a live ' +
      'regression, and real betas are regime-dependent.',
    input_schema: {
      type: 'object',
      properties: {
        shock: {
          type: 'string',
          enum: [
            'rates_up', 'rates_down',
            'usd_up', 'usd_down',
            'oil_up', 'oil_down',
            'equity_down', 'credit_widen',
          ],
          description: 'Which macro shock to apply.',
        },
        magnitude: {
          type: 'number',
          description:
            'Magnitude in the natural unit: bps for rates/credit, % for ' +
            'usd/oil/equity. Must be positive — the direction is in ' +
            'the shock name.',
        },
        symbol: {
          type: 'string',
          description:
            'Optional ticker for a symbol-specific impact. Uses sector ' +
            'mapping (AAPL→XLK, JPM→XLF, PETR4→oil bucket, etc.).',
        },
      },
      required: ['shock', 'magnitude'],
    },
  },
  {
    name: 'describe_portfolio_import',
    description:
      'Describe how the user can import their existing portfolio / ' +
      'holdings into the terminal. Returns the canonical CSV schema ' +
      '(column names, required vs optional fields, example values), the ' +
      'upload/commit endpoint URLs, the template download URL, and the ' +
      'supported file formats. Use this for ANY question about bringing a ' +
      'portfolio in: "how do I import my positions", "what columns do you ' +
      'need", "can I upload a CSV from my broker", "sync my Itaú / XP / ' +
      'Interactive Brokers account", "importar minha carteira", "posso ' +
      'conectar minha corretora". Critical: the terminal does NOT have ' +
      'direct brokerage sync (no Plaid integration) — never ask the user ' +
      'for credentials or account numbers. Always relay the CSV/XLSX path ' +
      'and the template URL so the user can self-serve. This tool has no ' +
      'required arguments; just call it and paraphrase the returned ' +
      'schema + URLs in the response.',
    input_schema: {
      type: 'object',
      properties: {},
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
  {
    name: 'forward_estimates',
    description:
      'Fetch the street (sell-side analyst consensus) forward estimates ' +
      'for a US equity ticker — EPS, revenue, EBITDA, and net income, ' +
      'with high / low / average across the full analyst set plus the ' +
      'number of analysts contributing. Covers the next ~5 fiscal ' +
      'periods (annual by default, quarterly available). Use this ' +
      'whenever the user asks "what\'s the street modelling", "consensus ' +
      'EPS for FY+1", "forward revenue", "analyst range", "what are ' +
      'estimates for NVDA next year", "how is the Street positioned on ' +
      'X", or any multi-year allocation / valuation question that hinges ' +
      'on forward fundamentals. Historical (reported) periods are ' +
      'filtered out — the tool returns strictly forward-looking rows. ' +
      'Numbers are in raw USD (revenue/ebitda/net income) or USD per ' +
      'share (EPS). Coverage is strong on US large- and mid-cap; thin ' +
      'on ex-US names (ADRs only) and nonexistent on Brazilian .SA / B3 ' +
      'tickers — for those, say the data isn\'t available rather than ' +
      'guessing. If the tool returns { error }, surface that to the ' +
      'user; don\'t fabricate numbers.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description:
            'US equity ticker. Examples: "NVDA", "AAPL", "$MSFT", "GOOGL". ' +
            'Leading $ is tolerated. Do not use .SA / B3 tickers — coverage ' +
            'is US-centric.',
        },
        period: {
          type: 'string',
          description:
            '"annual" (default, FY+1 / FY+2 / ...) or "quarter" for ' +
            'quarterly-granularity estimates. Most allocation questions ' +
            'want annual; only use quarter when the user explicitly asks ' +
            'about next-quarter guidance.',
        },
        limit: {
          type: 'integer',
          description:
            'How many forward periods to return, default 5, cap 15. Keep ' +
            'it tight — 3 is usually enough for a chat answer.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'web_research',
    description:
      'Run a web search for non-financial or operational data that the ' +
      'other tools can\'t reach: fleet size, store count, subscriber ' +
      'count, ARR, headcount, bed count, assets under management, ' +
      'pipeline milestones, regulatory rulings, M&A news, and any other ' +
      'primary-source fact that lives on a company IR page, 10-K, 20-F, ' +
      'earnings release, CVM filing, regulator bulletin, reputable press ' +
      'outlet (Reuters/Bloomberg/FT/Valor), or the company website. ' +
      'Returns a short list of ranked URLs with snippets and a one-line ' +
      'synthesised answer — treat the answer as a hint, not a source; ' +
      'for any number you\'re going to quote, call fetch_url on the ' +
      'most authoritative result to confirm. Use this whenever a ' +
      'comparative or ratio question needs a non-market data point ' +
      '(e.g. "price / fleet for HTZ vs RENT3", "store count for AMER3 ' +
      'vs MGLU3", "ARR trajectory for CrowdStrike vs Palo Alto"). If ' +
      'the tool is unavailable or returns { error }, surface that ' +
      'plainly — do not guess the number.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural-language search query. Be specific — include the ' +
            'company and the KPI. Good: "Localiza RENT3 fleet size ' +
            '2025 annual report". Bad: "Localiza info".',
        },
        depth: {
          type: 'string',
          description:
            '"basic" (default, fast, ~$0.008/search) or "advanced" ' +
            '(slower, ~2× cost, better for ambiguous or sparse queries). ' +
            'Stick to basic unless basic came back thin.',
        },
        maxResults: {
          type: 'integer',
          description: 'How many ranked results to return, default 6, cap 10.',
        },
        includeDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: restrict results to these domains. Use this when ' +
            'the user points at an authoritative source (e.g. ' +
            '["sec.gov", "cvm.gov.br"], ["ri.localiza.com"]).',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch one URL and return cleaned text content. Use this as the ' +
      'second step after web_research: pick the most authoritative URL ' +
      '(prefer IR / SEC / CVM / regulator / company website over press ' +
      'aggregators) and read it end-to-end to extract the exact number ' +
      'the user asked about. Handles HTML and PDF (returns parsed text ' +
      'for both). Returns truncated text if the document is long — if ' +
      'you need a specific section, mention what you\'re looking for so ' +
      'the context budget isn\'t wasted. Only http(s) URLs are allowed; ' +
      'private/local addresses are blocked.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'Fully-qualified http or https URL. Typically pulled from a ' +
            'prior web_research result.',
        },
        maxChars: {
          type: 'integer',
          description:
            'Cap returned text length (default 12000). Reduce for large ' +
            'filings when you only need the summary section.',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'compute',
    description:
      'Safely evaluate an arithmetic expression. Use this for every ' +
      'numeric answer in a comparatives or ratio workflow — price / ' +
      'fleet, market-cap / subscribers, EV / EBITDA, % change, ' +
      'duration-weighted averages, anything involving multiplication, ' +
      'division, or exponents. LLMs are unreliable at arithmetic with ' +
      'billion-scale numbers; this tool is deterministic and gives the ' +
      'exact result. Supports +, -, *, /, %, ^ (power), parentheses, ' +
      'scientific notation, and these functions: abs, sqrt, log (natural), ' +
      'log10, log2, exp, round(x, digits), floor, ceil, min, max, pow. ' +
      'Constants pi and e are available. Pass large or repeated numbers ' +
      'via the `variables` map (e.g. `expression="mc / fleet"`, ' +
      '`variables={ mc: 5.5e9, fleet: 500000 }`) — the model does not ' +
      'need to inline long numbers into the expression. Returns ' +
      '{ result, expression, variables }. Returns { error } on bad ' +
      'input; never throws. Call this once per computed value in your ' +
      'answer, even if the arithmetic looks trivial.',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description:
            'Math expression to evaluate. Examples: "1.5e9 / 500000", ' +
            '"(price / fleet) * 1e6", "round(mc / sub, 2)". Identifiers ' +
            'must be either whitelisted functions/constants or keys of ' +
            'the `variables` map.',
        },
        variables: {
          type: 'object',
          description:
            'Named numeric inputs referenced by `expression`. Keys must ' +
            'be valid identifiers (letters/digits/underscore, starting ' +
            'with a letter). Values must be finite numbers. Prefer this ' +
            'over inlining big numbers — keeps the expression readable ' +
            'and avoids transcription errors.',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['expression'],
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
  movers:             lazy('../providers/marketMoversProvider'),
  macroBr:            lazy('../providers/macroBrProvider'),
  cvmFilings:         lazy('../providers/cvmFilingsProvider'),
  analystEstimates:   lazy('../providers/analystEstimatesProvider'),
  tavily:             lazy('../providers/tavily'),
};
const services = {
  earnings:           lazy('./earnings'),
  unusualWhales:      lazy('./unusualWhales'),
  predictionAgg:      lazy('./predictionAggregator'),
  vault:              lazy('./vault'),
  wireGenerator:      lazy('./wireGenerator'),
  csvImporter:        lazy('./csvImporter'),
  scenarioEngine:     lazy('./scenarioEngine'),
  webFetch:           lazy('./webFetch'),
};

async function handleLookupQuote({ symbol }) {
  const mod = providers.multiAsset();
  if (!mod || typeof mod.getInstrumentDetail !== 'function') {
    return { error: 'quote adapter unavailable' };
  }

  // 2026-04-22 incident fix: previously we called
  //   mod.getInstrumentDetail({ symbol })
  // which hit multiAssetProvider's switch with assetClass=undefined and fell
  // through to `default: return null`. lookup_quote then returned
  // { symbol, error: 'no data' } for EVERY ticker that wasn't already in
  // instrumentStore's seed list (HTZ, CAR, RENT3, MOVI3, most of global
  // equity, all FX pairs not in the 5-pair seed, etc.), which drove the
  // AI to its "BOTTOM LINE: the terminal's feeds don't have market caps"
  // refusal behaviour.
  //
  // Now we resolve assetClass from the symbol (instrumentStore seed first,
  // then heuristic) and pass a fully-formed instrument descriptor so the
  // provider always picks the right detail fetcher.
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { error: 'symbol required' };

  const assetClass = typeof mod.resolveAssetClass === 'function'
    ? mod.resolveAssetClass(sym)
    : 'equity';

  try {
    const detail = await mod.getInstrumentDetail({ symbol: sym, assetClass, name: sym });
    // Even if the adapter comes back empty, never return a bare error —
    // give the AI a structured coverage_gap signal so it says "I don't
    // have a live figure for X" instead of refusing the whole question.
    if (!detail) {
      return {
        symbol: sym,
        assetClass,
        price: null,
        marketCap: null,
        coverage_gap: true,
        note: `No adapter returned data for ${sym} (resolved as ${assetClass}). This is a terminal coverage gap — suggest the user try a ticker variant (e.g. add .SA for Brazilian names) or search_instruments.`,
      };
    }
    return {
      symbol: detail.symbol || sym,
      assetClass,
      name: detail.name || null,
      price: detail.price ?? null,
      change: detail.change ?? null,
      chgPct: detail.chgPct ?? null,
      currency: detail.currency || null,
      marketCap: detail.marketCap ?? null,
      sector: detail.sector || null,
      industry: detail.industry || null,
      pe: detail.pe ?? null,
      forwardPe: detail.forwardPe ?? null,
      dividendYield: detail.dividendYield ?? null,
      beta: detail.beta ?? null,
      high52w: detail.high52w ?? null,
      low52w: detail.low52w ?? null,
      description: detail.description || null,
      coverage_gap: detail.coverage_gap === true || undefined,
      note: detail.note || undefined,
      source: detail.source || null,
      asOf: detail.asOf || null,
    };
  } catch (e) {
    return { error: e.message, symbol: sym };
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

async function handleListMarketMovers({ direction, limit, market }) {
  const mod = providers.movers();
  if (!mod || typeof mod.getMarketMovers !== 'function') {
    return { error: 'market movers adapter unavailable' };
  }
  try {
    const res = await mod.getMarketMovers({
      direction: String(direction || 'gainers').toLowerCase(),
      limit,
      market,
    });
    return res || { direction, movers: [], count: 0 };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleListCvmFilings(args) {
  const mod = providers.cvmFilings();
  if (!mod || typeof mod.getCvmFilings !== 'function') {
    return { error: 'CVM filings adapter unavailable' };
  }
  try {
    const res = await mod.getCvmFilings({
      ticker:   args.ticker,
      company:  args.company,
      cnpj:     args.cnpj,
      category: args.category,
      type:     args.type,
      from:     args.from,
      to:       args.to,
      limit:    Number(args.limit) || 20,
      year:     args.year ? Number(args.year) : undefined,
    });
    return res || { error: 'no data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetBrazilMacro({ series, history, months }) {
  const mod = providers.macroBr();
  if (!mod || typeof mod.getBrazilMacro !== 'function') {
    return { error: 'Brazilian macro adapter unavailable' };
  }
  try {
    const res = await mod.getBrazilMacro({
      series,
      history: !!history,
      months: Number(months) || 24,
    });
    return res || { series, error: 'no data' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleGetMarketRegime() {
  const mod = services.scenarioEngine();
  if (!mod || typeof mod.detectMarketRegime !== 'function') {
    return { error: 'scenario engine unavailable' };
  }
  try {
    const res = await mod.detectMarketRegime();
    return res || { error: 'no regime detected' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleRunScenario(args) {
  const mod = services.scenarioEngine();
  if (!mod || typeof mod.runScenario !== 'function') {
    return { error: 'scenario engine unavailable' };
  }
  try {
    const res = mod.runScenario({
      shock: args.shock,
      magnitude: Number(args.magnitude),
      symbol: args.symbol,
    });
    return res || { error: 'no scenario result' };
  } catch (e) {
    return { error: e.message };
  }
}

async function handleDescribePortfolioImport() {
  const mod = services.csvImporter();
  if (!mod || typeof mod.getImportSchema !== 'function') {
    return { error: 'portfolio import adapter unavailable' };
  }
  try {
    const schema = mod.getImportSchema();
    return schema || { error: 'no schema' };
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

async function handleForwardEstimates({ symbol, period, limit }) {
  const mod = providers.analystEstimates();
  if (!mod || typeof mod.getForwardEstimates !== 'function') {
    return { error: 'forward estimates adapter unavailable' };
  }
  try {
    const res = await mod.getForwardEstimates({ symbol, period, limit });
    return res || { error: 'no forward estimates' };
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

// ── Per-user daily caps for web_research + fetch_url ─────────────────────
//
// These tools hit paid APIs (Tavily) and the open web. We don't want a
// single chatty user — or a prompt-injected agent loop — burning through
// a month of spend or scraping a remote site into an IP block. So each
// user gets a fixed daily quota; over-limit calls return { error } so the
// model sees the exhaustion and can tell the user.
//
// In-process counters are acceptable for v1 (single Render instance). If
// we horizontally scale, promote these to Redis keyed on `YYYY-MM-DD:userId`.
const WEB_RESEARCH_DAILY_CAP = 50;      // searches per user per day
const FETCH_URL_DAILY_CAP    = 100;     // URL reads per user per day
const _webQuota = new Map();            // userId → { day, research, fetch }

function _utcDayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _bumpWebQuota(userId, bucket) {
  const uid = userId || '_anon';
  const day = _utcDayKey();
  let q = _webQuota.get(uid);
  if (!q || q.day !== day) { q = { day, research: 0, fetch: 0 }; _webQuota.set(uid, q); }
  const cap = bucket === 'research' ? WEB_RESEARCH_DAILY_CAP : FETCH_URL_DAILY_CAP;
  if (q[bucket] >= cap) return { over: true, used: q[bucket], cap };
  q[bucket] += 1;
  return { over: false, used: q[bucket], cap };
}

async function handleWebResearch({ query, depth, maxResults, includeDomains }, ctx = {}) {
  const tavily = providers.tavily();
  if (!tavily || typeof tavily.search !== 'function') {
    return { error: 'web research adapter unavailable (TAVILY_API_KEY not set)' };
  }
  const q = String(query || '').trim();
  if (!q) return { error: 'query required' };

  const quota = _bumpWebQuota(ctx.userId, 'research');
  if (quota.over) {
    return { error: `daily web_research cap reached (${quota.cap}/day). Reset at 00:00 UTC.` };
  }

  try {
    const out = await tavily.search(q, {
      depth: depth === 'advanced' ? 'advanced' : 'basic',
      maxResults: Math.min(10, Math.max(1, Number(maxResults) || 6)),
      includeDomains: Array.isArray(includeDomains) ? includeDomains : undefined,
    });
    if (!out) {
      return { error: 'web research unavailable — TAVILY_API_KEY not configured', query: q };
    }
    if (out.error) return { error: out.error, query: q };
    return {
      query: out.query,
      answer: out.answer,
      results: out.results,
      source: out.source,
      quota: { used: quota.used, cap: quota.cap },
      asOf: out.asOf,
    };
  } catch (e) {
    return { error: e.message || 'web research failed', query: q };
  }
}

async function handleCompute({ expression, variables }) {
  const safeMath = require('./safeMath');
  const out = safeMath.evaluate(expression, variables);
  if (out.error) {
    return {
      error: out.error,
      expression: typeof expression === 'string' ? expression : null,
      variables: variables || null,
    };
  }
  return {
    expression,
    variables: variables || null,
    result: out.result,
  };
}

async function handleFetchUrl({ url, maxChars }, ctx = {}) {
  const svc = services.webFetch();
  if (!svc || typeof svc.fetchUrl !== 'function') {
    return { error: 'url fetcher unavailable' };
  }
  if (!url) return { error: 'url required' };

  const quota = _bumpWebQuota(ctx.userId, 'fetch');
  if (quota.over) {
    return { error: `daily fetch_url cap reached (${quota.cap}/day). Reset at 00:00 UTC.` };
  }

  try {
    const out = await svc.fetchUrl(url, {
      maxChars: Number(maxChars) || undefined,
    });
    if (out && !out.error) {
      return { ...out, quota: { used: quota.used, cap: quota.cap } };
    }
    return out;
  } catch (e) {
    return { error: e.message || 'fetch failed', url };
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
  forward_estimates:         handleForwardEstimates,
  list_market_movers:        handleListMarketMovers,
  get_brazil_macro:          handleGetBrazilMacro,
  list_cvm_filings:          handleListCvmFilings,
  describe_portfolio_import: handleDescribePortfolioImport,
  get_market_regime:         handleGetMarketRegime,
  run_scenario:              handleRunScenario,
  web_research:              handleWebResearch,
  fetch_url:                 handleFetchUrl,
  compute:                   handleCompute,
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
  // P2.6 — optional per-tool status callback. When the caller wires one
  // (runToolLoopStream does), we emit an event for every tool dispatch so
  // the client tool-pill can render "✓ name · 120ms" for successes and
  // "⚠ name · failed: <reason>" for failures. The callback is invoked
  // defensively — any throw inside it is swallowed so a UI hiccup never
  // blows up the model loop.
  const onToolEvent = typeof ctx.onToolEvent === 'function' ? ctx.onToolEvent : null;
  // tokenCapHit is set when the per-request ceiling is reached between
  // rounds. It switches the closing synthesis into "budget exhausted" mode
  // so the model stops trying to call tools and just answers from what it
  // has gathered so far.
  let tokenCapHit = false;
  // Phase 10.4 (#217): accumulate ALL text blocks the model emits across
  // rounds. Previously we only kept the last round's text, so if the model
  // wrote "HTZ: $38B market cap" in round 2 and then called more tools in
  // round 3, that partial synthesis was lost if tokenCapHit or loop-exhaust
  // triggered before a clean end_turn. Now we preserve each round's text
  // as a fallback when the closing synthesis can't run or returns empty.
  const accumulatedText = [];

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

    // Stash this round's text for the fallback path. Only non-empty blocks —
    // empty text noise from a pure tool-call round is useless and would just
    // make the fallback feel choppy.
    if (textBlocks && textBlocks.trim()) {
      accumulatedText.push(textBlocks.trim());
    }

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
    //
    // P2.6 — as each dispatch resolves we fire onToolEvent so the tool pill
    // can paint a "✓ name" or "⚠ name · failed: <reason>" badge BEFORE the
    // model finishes synthesising. dispatchTool never throws — it wraps
    // handler errors in `{ error }` — so we just read `.error` to classify
    // success vs. failure. We also surface `{ truncated: true }` as a
    // successful-but-noteworthy event so the UI can hint that the payload
    // was capped.
    const limited = toolUses.slice(0, MAX_TOOLS_PER_ROUND);
    const results = await Promise.all(limited.map(async (tu) => {
      const t0 = Date.now();
      const out = await dispatchTool(tu.name, tu.input || {}, ctx);
      const durationMs = Date.now() - t0;
      const errorMsg = (out && typeof out === 'object' && typeof out.error === 'string')
        ? out.error
        : null;
      if (onToolEvent) {
        try {
          onToolEvent({
            name: tu.name,
            ok: !errorMsg,
            error: errorMsg,
            durationMs,
            truncated: !!(out && out.truncated),
          });
        } catch (_) { /* never let the UI wiring break the loop */ }
      }
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
  //
  // Phase 10.4 (#217): before falling back to a canned apology, use ANY
  // text the model managed to emit across the rounds we ran. For a
  // comparables question that ran 3 rounds and hit the cap mid-synthesis,
  // the user usually has a partial table in round 2's output that is
  // genuinely useful — far more so than the generic "try narrowing".
  if (!finalText || !finalText.trim()) {
    if (accumulatedText.length > 0) {
      const partial = accumulatedText.join('\n\n').trim();
      const prefix = tokenCapHit
        ? '_(Partial answer — hit this turn\'s token budget before I could finish polishing it.)_\n\n'
        : '';
      finalText = prefix + partial;
      logger.warn('aiToolbox', 'runToolLoop closing synthesis empty — using accumulated text', {
        userId: ctx.userId || null,
        rounds,
        tokenCapHit,
        accumulatedChars: partial.length,
        totalIn,
        totalOut,
      });
    } else {
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
  // P2.6 — forward per-tool status events as SSE frames so the client can
  // update its tool-pill component in real time. Emitting inline means a
  // failing FMP call shows up as "⚠ forward_estimates · failed: no key"
  // the moment dispatchTool resolves, not after the final synthesis.
  const onToolEvent = (evt) => {
    if (res.writableEnded) return;
    try {
      res.write(`data: ${JSON.stringify({ toolEvent: evt })}\n\n`);
    } catch (_) { /* fire-and-forget — never break the stream on a pill write */ }
  };
  try {
    const out = await runToolLoop(provider, initialMessages, systemPrompt, { userId, onToolEvent });
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
