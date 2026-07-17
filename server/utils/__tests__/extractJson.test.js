// node --test — fixtures for tolerant LLM JSON extraction (news-briefing bug).
// Run: node --test server/utils/__tests__/extractJson.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../extractJson');

const BRIEFING = {
  briefing: [
    { rank: 1, headline: 'Fed holds, signals one cut', sentiment: 'neutral', regime: 'policy' },
    { rank: 2, headline: 'Brent spikes on Hormuz risk', sentiment: 'bearish', regime: 'geo' },
  ],
};

test('parses clean JSON unchanged', () => {
  assert.deepEqual(extractJson(JSON.stringify(BRIEFING)), BRIEFING);
});

test('strips ```json fences', () => {
  const raw = '```json\n' + JSON.stringify(BRIEFING, null, 2) + '\n```';
  assert.deepEqual(extractJson(raw), BRIEFING);
});

test('strips bare ``` fences', () => {
  const raw = '```\n' + JSON.stringify(BRIEFING) + '\n```';
  assert.deepEqual(extractJson(raw), BRIEFING);
});

test('ignores prose before and after the JSON block', () => {
  const raw = 'Here is the CIO briefing you asked for:\n\n' +
    JSON.stringify(BRIEFING) +
    '\n\nLet me know if you need anything else!';
  assert.deepEqual(extractJson(raw), BRIEFING);
});

test('fenced AND prefixed prose together', () => {
  const raw = 'Sure! Here is valid JSON:\n```json\n' + JSON.stringify(BRIEFING) + '\n```\nHope this helps.';
  assert.deepEqual(extractJson(raw), BRIEFING);
});

test('cleans trailing commas in objects and arrays', () => {
  const raw = '{ "briefing": [ { "rank": 1, "headline": "x", }, ], }';
  assert.deepEqual(extractJson(raw), { briefing: [{ rank: 1, headline: 'x' }] });
});

test('top-level arrays work', () => {
  const raw = 'The picks:\n[{"rank":1},{"rank":2},]';
  assert.deepEqual(extractJson(raw), [{ rank: 1 }, { rank: 2 }]);
});

test('braces/brackets inside string values do not break the balanced scan', () => {
  const obj = { headline: 'S&P {vol} spikes ] after } close', tickers: ['SPY'] };
  const raw = 'Note:\n' + JSON.stringify(obj) + ' trailing prose }';
  assert.deepEqual(extractJson(raw), obj);
});

test('escaped quotes inside strings are honored', () => {
  const obj = { headline: 'Powell: "higher for longer"' };
  assert.deepEqual(extractJson('```json\n' + JSON.stringify(obj) + '\n```'), obj);
});

test('truncated output returns null (caller retries the LLM)', () => {
  const full = JSON.stringify(BRIEFING);
  const truncated = full.slice(0, Math.floor(full.length * 0.6));
  assert.equal(extractJson(truncated), null);
});

test('pure prose with no JSON returns null', () => {
  assert.equal(extractJson('I could not produce a briefing today, sorry.'), null);
});

test('non-string / empty input returns null', () => {
  assert.equal(extractJson(null), null);
  assert.equal(extractJson(undefined), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson('   '), null);
  assert.equal(extractJson(42), null);
});
