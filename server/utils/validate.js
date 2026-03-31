'use strict';

const TICKER_RE = /^[A-Za-z0-9.\-:^=]{1,20}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function isString(v)      { return typeof v === 'string'; }
function isNumber(v)      { return typeof v === 'number' && !isNaN(v); }
function isPositiveInt(v)  { return Number.isInteger(v) && v > 0; }
function isBoolean(v)     { return typeof v === 'boolean'; }
function isTicker(v)      { return isString(v) && TICKER_RE.test(v); }
function isCountryCode(v) { return isString(v) && COUNTRY_RE.test(v); }
function isUserId(v)      { const n = Number(v); return Number.isInteger(n) && n > 0; }

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeText(v, maxLen = 1000) {
  if (!isString(v)) return '';
  // Strip control chars except newlines/tabs
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}

function parseTickerList(v, maxCount = 50) {
  if (!isString(v)) return [];
  return v.split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s && TICKER_RE.test(s))
    .slice(0, maxCount);
}

function validateBody(body, schema) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Body must be an object'] };
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const val = body[field];
    if (rules.required && (val === undefined || val === null || val === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    if (val === undefined || val === null) continue;
    if (rules.type === 'string'  && !isString(val))  errors.push(`${field} must be a string`);
    if (rules.type === 'number'  && !isNumber(val))   errors.push(`${field} must be a number`);
    if (rules.type === 'boolean' && !isBoolean(val))  errors.push(`${field} must be a boolean`);
    if (rules.type === 'integer' && !Number.isInteger(val)) errors.push(`${field} must be an integer`);
    if (rules.max != null && isString(val) && val.length > rules.max) errors.push(`${field} exceeds max length ${rules.max}`);
    if (rules.min != null && isNumber(val) && val < rules.min) errors.push(`${field} must be >= ${rules.min}`);
    if (rules.pattern && isString(val) && !rules.pattern.test(val)) errors.push(`${field} has invalid format`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  isString, isNumber, isPositiveInt, isBoolean,
  isTicker, isCountryCode, isUserId,
  clampInt, sanitizeText, parseTickerList, validateBody,
};
