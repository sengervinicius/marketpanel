/**
 * unusualWhales.parse.test.js — P2 item 7: "NET $0 · 139 SIGNALS" defect.
 *
 * Root causes pinned here:
 *   1. flow-alerts premium was read from `item.premium`; the documented
 *      field is `total_premium` (a STRING, e.g. "186705") → every alert
 *      carried premium 0.
 *   2. sentiment was read from `option_type`/`put_call`; the documented
 *      field is `type` ('call'|'put') → every alert was 'neutral', and the
 *      client's net-$ math ignores neutral rows → NET $0 forever.
 *   3. sweep/floor/multileg flags were read from `is_*`; the fields are
 *      `has_*` → everything rendered as BLOCK.
 *   4. market-tide summed `tick.call_premium` (nonexistent) across a
 *      CUMULATIVE series; fields are net_call_premium/net_put_premium
 *      (strings, can be negative) and only the LATEST tick matters.
 *
 * Fixtures mirror the documented response examples at
 * api.unusualwhales.com/docs (FlowAlert + Market Tide schemas).
 *
 *   cd server && node --test services/__tests__/unusualWhales.parse.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseUwNumber,
  normalizeFlowAlert,
  summarizeMarketTide,
} = require('../unusualWhales');

// ── Realistic fixtures (from UW docs response examples) ─────────────

// GET /api/option-trades/flow-alerts — documented FlowAlert shape.
const FLOW_ALERT_DOC = {
  alert_rule: 'RepeatedHits',
  all_opening_trades: false,
  created_at: '2026-07-20T16:35:52.168490Z',
  expiry: '2026-07-24',
  expiry_count: 1,
  has_floor: false,
  has_multileg: false,
  has_singleleg: true,
  has_sweep: true,
  issue_type: 'Common Stock',
  open_interest: 7913,
  option_chain: 'MSFT260724C00375000',
  price: '4.05',
  strike: '375',
  ticker: 'MSFT',
  total_ask_side_prem: '151875',
  total_bid_side_prem: '405',
  total_premium: '186705',
  total_size: 461,
  trade_count: 32,
  type: 'call',
  underlying_price: '372.99',
  volume: 2442,
  volume_oi_ratio: '0.30860609124226',
};

// GET /api/market/market-tide — documented tick shape (cumulative series;
// STRING premiums, put side can be negative).
const TIDE_TICKS_DOC = [
  { date: '2026-07-20', net_call_premium: '660338.0000',    net_put_premium: '-547564.0000',  net_volume: 23558,  timestamp: '2026-07-20T09:30:00-04:00' },
  { date: '2026-07-20', net_call_premium: '9711936.0000',   net_put_premium: '-3341365.0000', net_volume: 254771, timestamp: '2026-07-20T12:00:00-04:00' },
  { date: '2026-07-20', net_call_premium: '14562233.0000',  net_put_premium: '-5876548.0000', net_volume: 407710, timestamp: '2026-07-20T15:55:00-04:00' },
];

describe('parseUwNumber (tolerant $/comma/string parsing)', () => {
  it('parses documented string dollars', () => {
    assert.equal(parseUwNumber('186705'), 186705);
    assert.equal(parseUwNumber('-547564.0000'), -547564);
  });
  it('strips $ signs, commas and whitespace', () => {
    assert.equal(parseUwNumber('$1,234,567.89'), 1234567.89);
    assert.equal(parseUwNumber(' 50 000 '), 50000);
  });
  it('passes numbers through and rejects junk as null (never NaN/0)', () => {
    assert.equal(parseUwNumber(2442), 2442);
    assert.equal(parseUwNumber(null), null);
    assert.equal(parseUwNumber(undefined), null);
    assert.equal(parseUwNumber(''), null);
    assert.equal(parseUwNumber('n/a'), null);
    assert.equal(parseUwNumber(NaN), null);
  });
});

describe('normalizeFlowAlert (documented flow-alerts schema)', () => {
  const a = normalizeFlowAlert(FLOW_ALERT_DOC);

  it('reads REAL premium from total_premium (the $0 root cause)', () => {
    assert.equal(a.premium, 186705);
    assert.equal(a.askSidePremium, 151875);
    assert.equal(a.bidSidePremium, 405);
  });

  it('reads sentiment from `type` — call/put, not neutral (NET $0 root cause)', () => {
    assert.equal(a.sentiment, 'call');
    const put = normalizeFlowAlert({ ...FLOW_ALERT_DOC, type: 'put' });
    assert.equal(put.sentiment, 'put');
  });

  it('reads sweep/floor/multileg from has_* flags', () => {
    assert.equal(a.isSweep, true);
    assert.equal(a.type, 'sweep');
    const floor = normalizeFlowAlert({ ...FLOW_ALERT_DOC, has_sweep: false, has_floor: true });
    assert.equal(floor.type, 'floor');
    assert.equal(floor.isFloor, true);
    const block = normalizeFlowAlert({ ...FLOW_ALERT_DOC, has_sweep: false });
    assert.equal(block.type, 'block');
  });

  it('maps symbol/strike/expiry/timestamp/volume/OI', () => {
    assert.equal(a.symbol, 'MSFT');
    assert.equal(a.strike, 375);
    assert.equal(a.expiry, '2026-07-24');
    assert.equal(a.timestamp, '2026-07-20T16:35:52.168490Z'); // created_at
    assert.equal(a.volume, 2442);
    assert.equal(a.openInterest, 7913);
    assert.equal(a.tradeCount, 32);
    assert.equal(a.optionChain, 'MSFT260724C00375000');
  });

  it('still tolerates legacy field names (is_sweep / option_type / premium)', () => {
    const legacy = normalizeFlowAlert({
      symbol: 'aapl', option_type: 'put', premium: '$52,500',
      is_sweep: true, size: 100, timestamp: '2026-07-20T10:00:00Z',
    });
    assert.equal(legacy.symbol, 'AAPL');
    assert.equal(legacy.sentiment, 'put');
    assert.equal(legacy.premium, 52500);
    assert.equal(legacy.isSweep, true);
    assert.equal(legacy.volume, 100);
  });

  it('missing everything degrades safely (premium 0, sentiment neutral)', () => {
    const empty = normalizeFlowAlert({});
    assert.equal(empty.symbol, 'N/A');
    assert.equal(empty.premium, 0);
    assert.equal(empty.sentiment, 'neutral');
    assert.equal(empty.type, 'block');
  });
});

describe('summarizeMarketTide (documented market-tide series)', () => {
  it('uses the LATEST tick, not a sum of the cumulative series', () => {
    const t = summarizeMarketTide(TIDE_TICKS_DOC);
    assert.equal(t.netCallPremium, 14562233);
    assert.equal(t.netPutPremium, -5876548);
    assert.equal(t.netPremium, 14562233 - -5876548);
    assert.equal(t.asOf, '2026-07-20T15:55:00-04:00');
  });

  it('derives non-negative bull/bear dollars and a [0,1] ratio', () => {
    const t = summarizeMarketTide(TIDE_TICKS_DOC);
    // net call buying + net put selling are BOTH bullish here
    assert.equal(t.bullDollars, 14562233 + 5876548);
    assert.equal(t.bearDollars, 0);
    assert.equal(t.ratio, 1);
    assert.equal(t.sentiment, 'bullish');
  });

  it('bearish tape: negative calls / positive puts flips the ratio', () => {
    const t = summarizeMarketTide([
      { net_call_premium: '-2000000', net_put_premium: '3000000', timestamp: 'x' },
    ]);
    assert.equal(t.bullDollars, 0);
    assert.equal(t.bearDollars, 5000000);
    assert.equal(t.ratio, 0);
    assert.equal(t.sentiment, 'bearish');
    assert.equal(t.netPremium, -5000000);
  });

  it('returns null on empty/unparseable input (route serves honest default)', () => {
    assert.equal(summarizeMarketTide([]), null);
    assert.equal(summarizeMarketTide(null), null);
    assert.equal(summarizeMarketTide([{ foo: 'bar' }]), null);
  });

  it('flat zero tick → 0.5 ratio, neutral', () => {
    const t = summarizeMarketTide([{ net_call_premium: '0', net_put_premium: '0.00', date: '2026-07-20' }]);
    assert.equal(t.ratio, 0.5);
    assert.equal(t.sentiment, 'neutral');
    assert.equal(t.asOf, '2026-07-20');
  });
});
