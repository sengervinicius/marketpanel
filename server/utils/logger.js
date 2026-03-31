'use strict';

function ts() { return new Date().toISOString(); }
function shortId() { return Math.random().toString(36).slice(2, 10); }

function fmt(level, ctx, msg, meta) {
  const base = `${ts()} [${level}] [${ctx}]${msg ? ' ' + msg : ''}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

const info  = (ctx, msg, meta) => console.log(fmt('INFO', ctx, msg, meta));
const warn  = (ctx, msg, meta) => console.warn(fmt('WARN', ctx, msg, meta));
const error = (ctx, msg, meta) => console.error(fmt('ERROR', ctx, msg, meta));

function requestLogger(req, _res, next) {
  req.reqId = shortId();
  next();
}

function reqId(req) { return req?.reqId || '--------'; }

module.exports = { info, warn, error, requestLogger, reqId };
