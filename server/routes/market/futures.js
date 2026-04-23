/**
 * routes/market/futures.js — Regional index futures / cash indices feed.
 *
 * #226: the CIO wanted a "Futures box" on the terminal home that shows, at a
 * glance, how each major region is trading right now — US, London, Frankfurt,
 * Hong Kong, Tokyo, São Paulo. During off-hours for the local cash session
 * the CME futures carry the "what will Europe open into, what will Asia open
 * into" signal a macro trader is scanning for. Where Yahoo reliably carries
 * a futures contract (ES, NQ, YM, NIY for Nikkei) we surface that; where it
 * doesn't (FTSE 100 futures, DAX futures, HSI futures, WIN1! for Ibov) we
 * fall back to the cash index, which is what every desk uses as the live
 * proxy during the local session anyway.
 *
 * Wire shape:
 *   GET /api/futures
 *   -> {
 *        items: [
 *          {
 *            region, regionLabel, name, symbol, exchange, tz,
 *            currency, price, prevClose, change, changePct,
 *            marketState, kind: 'futures' | 'index'
 *          },
 *          ...
 *        ],
 *        updatedAt: ISO string,
 *        source: 'Yahoo Finance',
 *      }
 *
 * The client groups by `region` and puts the regionLabel on the first row
 * of each region, Bloomberg-style.
 */

const express = require('express');
const router  = express.Router();

const { yahooQuote } = require('./lib/providers');
const { cacheGet, cacheSet, TTL } = require('./lib/cache');

// ── Regional futures / index spec ──────────────────────────────────────
// Order matters: it's the on-screen row order in FuturesPanel.
//
// `kind` tells the client whether this is a live futures contract or the
// cash index proxy; the UI shows a small tag so it's unambiguous.
//
// Choice of symbols:
//   - ES=F / NQ=F / YM=F are the standard CME E-minis — carry through
//     the US overnight session and drive every "futures overnight"
//     headline in macro media.
//   - ^FTSE / ^GDAXI / ^HSI / ^BVSP: Yahoo exposes no reliable public
//     futures feed for these locals, so we use the cash index. It's what
//     every trading desk reads during the local session.
//   - NIY=F is the CME-listed USD-denominated Nikkei 225 futures — the
//     cleanest public proxy for Japanese equity risk outside Tokyo hours.
const FUTURES_SPEC = [
  { region: 'US',        regionLabel: 'US',         name: 'S&P 500 E-MINI',  symbol: 'ES=F',   exchange: 'CME',   tz: 'America/New_York',   kind: 'futures' },
  { region: 'US',        regionLabel: 'US',         name: 'NASDAQ E-MINI',   symbol: 'NQ=F',   exchange: 'CME',   tz: 'America/New_York',   kind: 'futures' },
  { region: 'US',        regionLabel: 'US',         name: 'DOW E-MINI',      symbol: 'YM=F',   exchange: 'CBOT',  tz: 'America/New_York',   kind: 'futures' },
  { region: 'LONDON',    regionLabel: 'LONDON',     name: 'FTSE 100',        symbol: '^FTSE',  exchange: 'LSE',   tz: 'Europe/London',      kind: 'index'   },
  { region: 'FRANKFURT', regionLabel: 'FRANKFURT',  name: 'DAX 40',          symbol: '^GDAXI', exchange: 'XETRA', tz: 'Europe/Berlin',      kind: 'index'   },
  { region: 'HONG_KONG', regionLabel: 'HONG KONG',  name: 'HANG SENG',       symbol: '^HSI',   exchange: 'HKEX',  tz: 'Asia/Hong_Kong',     kind: 'index'   },
  { region: 'TOKYO',     regionLabel: 'TOKYO',      name: 'NIKKEI 225 (CME)',symbol: 'NIY=F',  exchange: 'CME',   tz: 'Asia/Tokyo',         kind: 'futures' },
  { region: 'SAO_PAULO', regionLabel: 'SÃO PAULO',  name: 'BOVESPA',         symbol: '^BVSP',  exchange: 'B3',    tz: 'America/Sao_Paulo',  kind: 'index'   },
];

const CACHE_KEY = 'futures-box';
const CACHE_TTL_MS = 30_000;  // 30s — WebSocket ticks don't cover these, so
                               // we need a fresh poll, but 30s cushions Yahoo.

function round2(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Number(v.toFixed(2));
}

/**
 * normalizeQuote — map a Yahoo v7 quote row to the wire shape.
 *
 * Yahoo sometimes doesn't include `regularMarketPreviousClose` on futures
 * that haven't settled yet; in those cases we back it out from price and
 * change, which the same payload always carries.
 */
function normalizeQuote(spec, q) {
  if (!q) {
    return {
      region: spec.region, regionLabel: spec.regionLabel, name: spec.name,
      symbol: spec.symbol, exchange: spec.exchange, tz: spec.tz, kind: spec.kind,
      currency: null, price: null, prevClose: null, change: null, changePct: null,
      marketState: null, unavailable: true,
    };
  }

  const price     = q.regularMarketPrice ?? null;
  const change    = q.regularMarketChange ?? null;
  const changePct = q.regularMarketChangePercent ?? null;

  let prevClose = q.regularMarketPreviousClose ?? null;
  if (prevClose == null && price != null && change != null) {
    prevClose = price - change;
  }

  return {
    region:       spec.region,
    regionLabel:  spec.regionLabel,
    name:         spec.name,
    symbol:       spec.symbol,
    exchange:     spec.exchange,
    tz:           spec.tz,
    kind:         spec.kind,
    currency:     q.currency || null,
    price:        round2(price),
    prevClose:    round2(prevClose),
    change:       round2(change),
    changePct:    round2(changePct),
    marketState:  q.marketState || null,  // REGULAR / PRE / POST / CLOSED / PREPRE / POSTPOST
  };
}

router.get('/futures', async (req, res) => {
  try {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    const symbols = FUTURES_SPEC.map(s => s.symbol).join(',');
    let quotes = [];
    try {
      quotes = await yahooQuote(symbols);
    } catch (e) {
      console.warn('[Futures] yahooQuote failed:', e.message);
      // Don't 500 — serve a payload with unavailable rows so the UI can
      // render skeleton state and the user sees the panel instead of an
      // empty card. Next poll will recover.
    }

    const bySym = new Map();
    for (const q of quotes) {
      if (q && q.symbol) bySym.set(q.symbol, q);
    }

    const items = FUTURES_SPEC.map(spec => normalizeQuote(spec, bySym.get(spec.symbol)));

    const payload = {
      items,
      updatedAt: new Date().toISOString(),
      source: 'Yahoo Finance',
    };

    cacheSet(CACHE_KEY, payload, CACHE_TTL_MS);
    res.json(payload);
  } catch (e) {
    console.warn('[Futures] error:', e.message);
    res.status(500).json({ error: e.message || 'futures fetch failed' });
  }
});

module.exports = router;
