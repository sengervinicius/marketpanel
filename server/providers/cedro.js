/**
 * providers/cedro.js — #292 Wave 7
 *
 * Cedro Technologies "Market Data Cloud" (Web Feeder) — the realistic
 * path to LICENSED B3 real-time / delayed data with display rights, and
 * the only vendor in the licensing memo with BM&F futures (DI1, WDO, WIN)
 * intraday. This adapter is REST only; the WebSocket host is assigned
 * per account (not public) and goes in a follow-up once the contract
 * exists.
 *
 * Docs read 26 Oct 2026:
 *   https://docs.cedrotech.com/reference/market-data-authentication.md
 *   https://docs.cedrotech.com/reference/market-data-services-quotes-quote-codativo.md
 *   https://docs.cedrotech.com/reference/market-data-services-quotes-indexlist.md
 *
 * Auth:  POST {BASE}/SignIn?login=…&password=…  → body "true"/"false",
 *        Set-Cookie JSESSIONID; send the cookie on every call; 401 ⇒
 *        session expired ⇒ sign in again (single-flight).
 * Quote: GET  {BASE}/services/quotes/quote/{codAtivo}  — one or more
 *        codes (comma-separated per the OpenAPI array schema).
 * Index: GET  {BASE}/services/quotes/quote/IBOV
 *
 * Env:   CEDRO_LOGIN, CEDRO_PASSWORD, optional CEDRO_BASE_URL
 *        (default https://webfeeder.cedrotech.com), CEDRO_DELAYED=1 to
 *        label the feed as 15-min delayed (B3 "Delayed Continuous").
 *
 * Unknowns flagged by the docs research — the parser is defensive about
 * them and the provider probe will show what the wire actually carries:
 *   - timeUpdate / dateTrade are declared date-time, but the public
 *     sample shows dateUpdate "10-03-2025" (DD-MM-YYYY). parseCedroTime()
 *     accepts ISO, DD-MM-YYYY[ HH:mm:ss], YYYYMMDDHHmmss and HHmmss+date.
 *   - `change` is documented as the day's variation (PDF says %).
 *   - DI1F27-style symbols are expected to work (market 3 = BM&F incl. DI)
 *     but are not shown in any example.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = (process.env.CEDRO_BASE_URL || 'https://webfeeder.cedrotech.com').replace(/\/$/, '');
const TIMEOUT_MS = 10_000;
const SESSION_TTL_MS = 25 * 60 * 1000;

function isConfigured() {
  return !!(process.env.CEDRO_LOGIN && process.env.CEDRO_PASSWORD);
}
function isDelayed() { return process.env.CEDRO_DELAYED === '1'; }

let _session = { cookie: null, exp: 0 };
let _inflight = null;
let _lastErr = null;

async function signIn() {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    const url = `${BASE}/SignIn?login=${encodeURIComponent(process.env.CEDRO_LOGIN)}&password=${encodeURIComponent(process.env.CEDRO_PASSWORD)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', signal: controller.signal, headers: { Accept: 'application/json, text/plain' } });
      const body = (await res.text().catch(() => '')).trim();
      const raw = (res.headers.raw?.()?.['set-cookie']) || [];
      const cookie = raw.map(c => c.split(';')[0]).join('; ') || (res.headers.get('set-cookie') || '').split(';')[0];
      if (!res.ok || body === 'false' || !cookie) {
        _lastErr = `AUTH ${res.status} (${body.slice(0, 40) || 'no cookie'})`;
        throw new Error(`[Cedro] sign-in failed: ${_lastErr}`);
      }
      _session = { cookie, exp: Date.now() + SESSION_TTL_MS };
      _lastErr = null;
      logger.info('cedro', 'session established');
      return cookie;
    } finally {
      clearTimeout(timer);
      _inflight = null;
    }
  })();
  return _inflight;
}

async function getJson(path, retry = true) {
  const cookie = (_session.cookie && Date.now() < _session.exp) ? _session.cookie : await signIn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json', Cookie: cookie }, signal: controller.signal });
    if (res.status === 401 && retry) {
      _session = { cookie: null, exp: 0 };
      return getJson(path, false);
    }
    if (!res.ok) {
      _lastErr = `HTTP ${res.status}`;
      throw new Error(`[Cedro] ${res.status} for ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts ISO, "DD-MM-YYYY", "DD-MM-YYYY HH:mm:ss", "YYYYMMDDHHmmss"; returns ms or null. Assumes America/Sao_Paulo (-03:00) when no zone. */
function parseCedroTime(v, timeHHmmss) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let iso = null;
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s))) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  if ((m = /^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
    iso = `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}-03:00`;
  } else if ((m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(s))) {
    iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00`;
  } else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    const hh = String(timeHHmmss || '').padStart(6, '0');
    iso = `${m[1]}-${m[2]}-${m[3]}T${hh.slice(0, 2)}:${hh.slice(2, 4)}:${hh.slice(4, 6)}-03:00`;
  }
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** One Cedro quote object → our quote shape. Exported for tests. */
function normaliseRow(r) {
  const symbol = String(r.symbol || '').toUpperCase();
  const price = num(r.lastTrade);
  const prev = num(r.previous);
  let changePct = num(r.change);
  let change = null;
  if (price != null && prev != null) {
    change = +(price - prev).toFixed(6);
    // Documented as % variation; if it disagrees with the computed % by a
    // lot, trust price/previous (the authoritative fields).
    const computed = prev !== 0 ? (price - prev) / prev * 100 : null;
    if (computed != null && (changePct == null || Math.abs(changePct - computed) > 0.5)) changePct = +computed.toFixed(4);
  }
  const asOfMs = parseCedroTime(r.timeUpdate) || parseCedroTime(r.dateTrade) || parseCedroTime(r.dateUpdate, r.timeLastTrade) || null;
  return {
    symbol, name: r.company || null, price, change, changePct, prevClose: prev,
    open: num(r.open), high: num(r.high), low: num(r.low), volume: num(r.volumeAmount), financialVolume: num(r.volumeFinancier),
    bid: num(r.bid), ask: num(r.ask), openInterest: num(r.interest),
    settlement: num(r.adjustmentDay), settlementPrev: num(r.adjustmentPreviousDay),
    marketCode: r.marketCode ?? null, securityType: r.securityType ?? null,
    exchange: 'B3', source: isDelayed() ? 'cedro-delayed' : 'cedro', delayMin: isDelayed() ? 15 : 0,
    asOf: asOfMs ? new Date(asOfMs).toISOString() : null, fetchedAt: new Date().toISOString(),
  };
}

/**
 * Batch quotes. Returns { quotes, requested, received, missing, failed } like
 * brapi.getQuotes / batchYahooQuoteDetailed. Never throws.
 */
async function getQuotes(symbols) {
  const syms = [...new Set((symbols || []).map(s => String(s).replace(/\.SA$/i, '').toUpperCase()).filter(Boolean))];
  const out = { quotes: [], requested: syms.length, received: 0, missing: [], failed: [] };
  if (!isConfigured()) { out.failed.push({ error: 'CEDRO_LOGIN/CEDRO_PASSWORD not set' }); out.missing = syms; return out; }
  const seen = new Set();
  const BATCH = 50;
  for (let i = 0; i < syms.length; i += BATCH) {
    const batch = syms.slice(i, i + BATCH);
    try {
      const j = await getJson(`/services/quotes/quote/${encodeURIComponent(batch.join(','))}`);
      const rows = Array.isArray(j) ? j : (j && j.symbol ? [j] : []);
      for (const r of rows) {
        const n = normaliseRow(r);
        if (!n.symbol || n.price == null) continue;
        out.quotes.push(n); seen.add(n.symbol);
      }
    } catch (e) {
      out.failed.push({ batch, error: String(e.message).slice(0, 160) });
      if (/AUTH|401|403/.test(e.message)) break;
    }
  }
  out.received = out.quotes.length;
  out.missing = syms.filter(s => !seen.has(s));
  return out;
}

async function getQuote(symbol) {
  const r = await getQuotes([symbol]);
  return r.quotes[0] || null;
}

/** Ibovespa level. */
async function getIbov() {
  const q = await getQuote('IBOV');
  return q ? { ...q, symbol: '^BVSP' } : null;
}

module.exports = { isConfigured, isDelayed, getQuotes, getQuote, getIbov, normaliseRow, parseCedroTime, _lastError: () => _lastErr };
