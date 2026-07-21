/**
 * lib/searchRanking.js — FEAT-4: primary-ticker ranking for /search.
 *
 * A company that trades on many venues (Deutsche Telekom → DTE.DE, DTEGY,
 * DTEGF…) used to come back as an undifferentiated list. This module:
 *   1. groups results by company-name similarity (normalized name key),
 *   2. ranks within each group: primary-exchange listing first (home-market
 *      big boards beat OTC/pink), ADRs slightly penalized, then market
 *      cap / volume when the provider supplied them, then original
 *      relevance order,
 *   3. marks the top result of each multi-listing group `primary: true`
 *      and annotates every member with { groupId, listings }.
 *
 * Pure functions — unit-testable with node:test.
 */

'use strict';

// Exchange priority: home-market big boards (Polygon MIC codes AND Yahoo
// short codes) over OTC/pink. Unknown venues sit in the middle.
const EXCHANGE_SCORE = {
  // US big boards
  XNYS: 100, NYSE: 100, NYQ: 100,
  XNAS: 100, NASDAQ: 100, NMS: 100, NGM: 97, NCM: 95,
  ARCX: 92, PCX: 92, BATS: 90, XASE: 90, ASE: 90, AMEX: 90,
  // Home-market big boards
  XETR: 96, XETRA: 96, GER: 96,
  XLON: 96, LSE: 96, LON: 96,
  BVMF: 96, B3: 96, SAO: 96,
  XTKS: 96, TSE: 96, JPX: 96, TYO: 96,
  XPAR: 96, PAR: 96, EPA: 96,
  XAMS: 96, AMS: 96,
  XSWX: 96, SWX: 96, EBS: 96, VTX: 96,
  XHKG: 96, HKG: 96, HKSE: 96, HKEX: 96,
  XASX: 96, ASX: 96,
  XTSE: 96, TSX: 96, TOR: 96,
  XMIL: 96, MIL: 96,
  XMAD: 96, MCE: 96, MAD: 96,
  XSTO: 96, STO: 96,
  XKRX: 96, KRX: 96, KSC: 96,
  XNSE: 96, NSI: 96, XBOM: 90, BSE: 90,
  KOE: 90, KOSDAQ: 90,
  // Secondary German floors (below XETRA)
  XFRA: 80, FRA: 80, XSTU: 75, STU: 75, XMUN: 75, MUN: 75, XBER: 75, BER: 75, XDUS: 75, DUS: 75, XHAM: 75, HAM: 75,
  // OTC / pink
  OTCQX: 20, OTCQB: 18, OTC: 15, OTCM: 15, OTCMKTS: 15, OTCBB: 12, OOTC: 12, PINK: 10, PNK: 10, EXPM: 8, GREY: 5, GREYMARKET: 5,
};

function exchangeScore(exchange) {
  const e = String(exchange || '').toUpperCase().trim();
  if (!e) return 50;
  if (EXCHANGE_SCORE[e] != null) return EXCHANGE_SCORE[e];
  if (/OTC|PINK|GREY|EXPM/.test(e)) return 12;
  return 50;
}

const NAME_STOPWORDS = new RegExp(
  '\\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|ag|se|sa|nv|ab|asa|as|spa|oyj|nvsa|kgaa|' +
  'holdings?|holding|group|the|class\\s+[a-z]|cl\\s+[a-z]|series\\s+[a-z]|' +
  'common\\s+stock|ordinary\\s+shares?|preferred|preference|shares?|shs|stock|units?|' +
  'adr|ads|adss|gdr|american\\s+depositary(?:\\s+(?:shares?|receipts?))?|depositary|receipts?|' +
  'sponsored|unsponsored|reg\\s+s|npv|new|ord)\\b', 'g');

function normalizeCompanyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(NAME_STOPWORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAdr(r) {
  const t = String(r.type || '').toUpperCase();
  if (t.startsWith('ADR')) return true;
  return /\b(adr|ads)\b|depositary/i.test(String(r.name || ''));
}

function listingScore(r) {
  let s = exchangeScore(r.primaryExchange || r.exchange || r.market);
  if (isAdr(r)) s -= 8; // home listing beats its ADR when both on big boards
  return s;
}

function capOrVolume(r) {
  const cap = Number(r.marketCap ?? r.market_cap ?? 0);
  if (Number.isFinite(cap) && cap > 0) return cap;
  const vol = Number(r.volume ?? r.avgVolume ?? r.avg_volume ?? 0);
  return Number.isFinite(vol) && vol > 0 ? vol : 0;
}

function sameCompanyKey(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // "deutsche telekom" ~ "deutsche telekom international finance"
  if (a.length >= 8 && b.length >= 8) {
    return a.startsWith(b + ' ') || b.startsWith(a + ' ');
  }
  return false;
}

/**
 * rankSearchResults(results) → new array, same item shapes plus:
 *   primary  — true for the best listing of each company group
 *   groupId  — present only when the group has >1 listing
 *   listings — group size (only when >1)
 * Group order follows the original relevance order of each group's first
 * hit; within a group the primary listing comes first.
 */
function rankSearchResults(results) {
  const groups = [];
  (results || []).forEach((r, idx) => {
    const key = normalizeCompanyName(r.name || r.ticker);
    let g = key ? groups.find(x => sameCompanyKey(x.key, key)) : null;
    if (!g) {
      g = { key: key || `__solo_${idx}`, firstIdx: idx, items: [] };
      groups.push(g);
    }
    g.items.push({ ...r, _idx: idx });
  });

  for (const g of groups) {
    g.items.sort((a, b) =>
      (listingScore(b) - listingScore(a)) ||
      (capOrVolume(b) - capOrVolume(a)) ||
      (a._idx - b._idx));
  }
  groups.sort((a, b) => a.firstIdx - b.firstIdx);

  const out = [];
  groups.forEach((g, gi) => {
    const multi = g.items.length > 1;
    g.items.forEach((item, i) => {
      const { _idx, ...rest } = item;
      out.push({
        ...rest,
        primary: i === 0,
        ...(multi ? { groupId: `g${gi}`, listings: g.items.length } : {}),
      });
    });
  });
  return out;
}

module.exports = {
  rankSearchResults,
  normalizeCompanyName,
  exchangeScore,
  listingScore,
  isAdr,
  sameCompanyKey,
};
