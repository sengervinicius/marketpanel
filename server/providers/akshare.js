/**
 * providers/akshare.js — R1.2 AkShare China-markets connector.
 *
 * AkShare (https://akshare.akfamily.xyz/) is a Python-only library
 * that wraps 150+ Chinese-market endpoints (SHSE, SZSE, HK, A-shares
 * macro, futures, options, Northbound/Southbound capital flows). It
 * does NOT expose an HTTP API of its own — it's a Python lib.
 *
 * This adapter talks to an EXTERNAL Python worker that hosts AkShare.
 * The worker is a tiny FastAPI process running:
 *
 *   GET  /api/akshare/quote?symbol=600519
 *   GET  /api/akshare/breadth?index=000001
 *   GET  /api/akshare/flow?direction=northbound
 *
 * Reference worker source lives in scripts/akshare-worker/ in this
 * repo (Python ~70 lines + Dockerfile). Deploy it as a separate
 * Render service or any Python host you control. Set AKSHARE_URL
 * env var on the Node server to point at it. Without AKSHARE_URL
 * set the adapter returns a graceful "not configured" envelope on
 * every call — no crash, no hang.
 *
 * Cache: 60s in-process per symbol/index/flow query. Chinese
 * markets close 11:30-13:00 BJT and 15:00-09:30 BJT; data is
 * static for long stretches so a tight cache is fine.
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const TIMEOUT_MS = 10000;
const TTL_MS = 60 * 1000;

const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  _cache.set(k, { v, exp: Date.now() + TTL_MS });
}

function baseUrl() {
  const u = process.env.AKSHARE_URL;
  if (!u) return null;
  return u.replace(/\/+$/, '');
}

function notConfigured() {
  return {
    error: 'akshare_not_configured',
    note: 'Set AKSHARE_URL env var to point at a Python worker. See scripts/akshare-worker/README.md.',
  };
}

async function _get(path, params) {
  const base = baseUrl();
  if (!base) return notConfigured();
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${path}${qs ? '?' + qs : ''}`;
  const cached = cacheGet(url);
  if (cached) return cached;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'user-agent': 'particle-akshare/1.0',
        'accept': 'application/json',
        ...(process.env.AKSHARE_API_KEY ? { authorization: `Bearer ${process.env.AKSHARE_API_KEY}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `akshare ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = await res.json();
    cacheSet(url, json);
    return json;
  } catch (e) {
    logger.warn('akshare', 'request failed', { url, error: e.message });
    return { error: `akshare: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Lookup a single Chinese-market quote.
 * Symbols: A-shares numeric ('600519'), HK ('00700'), or AkShare codes.
 */
function quote({ symbol }) {
  if (!symbol) return Promise.resolve({ error: 'akshare.quote: symbol required' });
  return _get('/api/akshare/quote', { symbol });
}

/**
 * Market breadth for an index — advancers / decliners / unchanged + volume.
 * index: '000001' (SHSE), '399001' (SZSE), 'HSI' (Hang Seng), …
 */
function breadth({ index }) {
  if (!index) return Promise.resolve({ error: 'akshare.breadth: index required' });
  return _get('/api/akshare/breadth', { index });
}

/**
 * Northbound / Southbound capital flows (Connect programs).
 * direction: 'northbound' | 'southbound'
 */
function flow({ direction }) {
  if (!direction) return Promise.resolve({ error: 'akshare.flow: direction required' });
  if (!['northbound', 'southbound'].includes(direction)) {
    return Promise.resolve({ error: `akshare.flow: direction must be northbound|southbound (got ${direction})` });
  }
  return _get('/api/akshare/flow', { direction });
}

module.exports = { quote, breadth, flow, _cache, _baseUrl: baseUrl };
