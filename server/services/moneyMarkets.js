/**
 * services/moneyMarkets.js — "Treasury & Money Markets" per country.
 *
 * One call assembles the desk view a BTMM screen gives: policy / overnight
 * rates, the government curve, rate futures, FX (spot, fixing, forwards),
 * sovereign risk, local bonds, the index + front futures, and the economic
 * releases ahead — each block carrying its own `source` and a `status`:
 *
 *   'live' | 'eod' | 'daily' | 'monthly'   real data, with its cadence
 *   'needs:<KEY>'                          wired, but the key / plan is missing
 *   'unavailable'                          no licensed source yet
 *
 * Nothing is interpolated or invented. A block without data says what
 * would unlock it; that line IS the API shopping list for the owner.
 */

'use strict';

const fetch = require('node-fetch');
const fred = require('../providers/fred');
const { getUsTreasuryCurve } = require('../providers/usTreasuryCurve');
const yfCurve = require('../providers/yahooFuturesCurve');
const brapi = require('../providers/brapi');
const { yahooQuote, eulerpool } = require('../routes/market/lib/providers');
const { cacheGet, cacheSet } = require('../routes/market/lib/cache');
const logger = require('../utils/logger');

const TTL_MS = 60 * 1000;

const COUNTRIES = {
  BR: { name: 'Brazil',         ccy: 'BRL', flag: '🇧🇷', index: '^BVSP',     indexLabel: 'IBOVESPA' },
  US: { name: 'United States',  ccy: 'USD', flag: '🇺🇸', index: '^GSPC',     indexLabel: 'S&P 500' },
  EU: { name: 'Euro Area',      ccy: 'EUR', flag: '🇪🇺', index: '^STOXX50E', indexLabel: 'EURO STOXX 50' },
  GB: { name: 'United Kingdom', ccy: 'GBP', flag: '🇬🇧', index: '^FTSE',     indexLabel: 'FTSE 100' },
  JP: { name: 'Japan',          ccy: 'JPY', flag: '🇯🇵', index: '^N225',     indexLabel: 'NIKKEI 225' },
  MX: { name: 'Mexico',         ccy: 'MXN', flag: '🇲🇽', index: '^MXX',      indexLabel: 'IPC MEXICO' },
};

// ── helpers ──────────────────────────────────────────────────────────
async function bcb(series, n = 2) {
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/${n}?formato=json`, {
    headers: { Accept: 'application/json' }, timeout: 8000,
  });
  if (!r.ok) throw new Error(`BCB ${series} HTTP ${r.status}`);
  const j = await r.json();
  const rows = (Array.isArray(j) ? j : [])
    .map(x => ({ date: x.data, value: Number(String(x.valor).replace(',', '.')) }))
    .filter(x => Number.isFinite(x.value));
  const last = rows[rows.length - 1] || null;
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  return last
    ? { value: last.value, date: last.date, prev: prev?.value ?? null, change: prev ? Number((last.value - prev.value).toFixed(4)) : null }
    : null;
}
const settle = p => (p && p.status === 'fulfilled' ? p.value : null);
const row = (label, value, { chg = null, unit = '%', date = null, note = null } = {}) => ({ label, value, chg, unit, date, note });
const fredRow = (label, pair, unit = '%') => (pair ? row(label, pair.value, { chg: pair.change, unit, date: pair.date }) : row(label, null, { unit }));
const bpRow = (label, pair) => (pair
  ? row(label, Number((pair.value * 100).toFixed(0)), { chg: pair.change != null ? Number((pair.change * 100).toFixed(0)) : null, unit: 'bp', date: pair.date })
  : row(label, null, { unit: 'bp' }));

async function quotes(symbols) {
  try {
    const rows = await yahooQuote(symbols.join(','));
    return Object.fromEntries((rows || []).map(r => [String(r.symbol).toUpperCase(), r]));
  } catch (_) { return {}; }
}
const qRow = (label, q, { digits = 2, unit = '' } = {}) => (q && Number.isFinite(q.regularMarketPrice)
  ? row(label, Number(q.regularMarketPrice.toFixed(digits)), {
    chg: Number.isFinite(q.regularMarketChangePercent) ? Number(q.regularMarketChangePercent.toFixed(2)) : null,
    unit, date: q.regularMarketTime ? new Date(q.regularMarketTime * 1000).toISOString() : null, note: 'chg = day %',
  })
  : row(label, null, { unit }));
const fxLabel = s => s.replace('=X', '').replace('DX-Y.NYB', 'DXY').replace(/^([A-Z]{3})([A-Z]{3})$/, '$1/$2');

// ── blocks ───────────────────────────────────────────────────────────
async function policyBlock(cc) {
  if (cc === 'BR') {
    const [meta, over, cdi, ipca] = await Promise.allSettled([bcb(432), bcb(1178), bcb(4389), bcb(13522)]);
    const m = settle(meta), o = settle(over), c = settle(cdi), i = settle(ipca);
    const rows = [
      m ? row('SELIC META', m.value, { chg: m.change, date: m.date }) : row('SELIC META', null),
      o ? row('SELIC O/N', o.value, { chg: o.change, date: o.date }) : row('SELIC O/N', null),
      c ? row('CDI (CETIP O/N)', c.value, { chg: c.change, date: c.date }) : row('CDI (CETIP O/N)', null),
      i ? row('IPCA 12M', i.value, { chg: i.change, date: i.date }) : row('IPCA 12M', null),
    ];
    if (m && i) rows.push(row('REAL RATE (SELIC−IPCA)', Number((((1 + m.value / 100) / (1 + i.value / 100) - 1) * 100).toFixed(2)), { note: 'ex-post, Fisher' }));
    return { title: 'OVERNIGHT & POLICY', rows, source: 'BCB SGS', status: 'daily' };
  }
  if (cc === 'US') {
    const [upper, lower, effr, sofr, iorb, tbill] = await Promise.allSettled(['DFEDTARU', 'DFEDTARL', 'DFF', 'SOFR', 'IORB', 'DTB3'].map(s => fred.fetchLatestPair(s)));
    const u = settle(upper), l = settle(lower);
    return {
      title: 'OVERNIGHT & POLICY',
      rows: [
        row('FED FUNDS TARGET', u && l ? `${l.value.toFixed(2)}–${u.value.toFixed(2)}` : null, { date: u?.date, note: 'range' }),
        fredRow('EFFR', settle(effr)), fredRow('SOFR', settle(sofr)), fredRow('IORB', settle(iorb)), fredRow('3M T-BILL', settle(tbill)),
      ],
      source: 'FRED (NY Fed / Board)', status: 'daily',
    };
  }
  if (cc === 'EU') {
    const [dfr, estr, eur3m] = await Promise.allSettled(['ECBDFR', 'ECBESTRVOLWGTTRMDMNRT', 'IR3TIB01EZM156N'].map(s => fred.fetchLatestPair(s)));
    return { title: 'OVERNIGHT & POLICY', rows: [fredRow('ECB DEPOSIT RATE', settle(dfr)), fredRow('€STR', settle(estr)), fredRow('EURIBOR 3M (M)', settle(eur3m))], source: 'FRED (ECB)', status: 'daily' };
  }
  if (cc === 'GB') {
    const [bank, sonia] = await Promise.allSettled(['IUDBEDR', 'IUDSOIA'].map(s => fred.fetchLatestPair(s)));
    return { title: 'OVERNIGHT & POLICY', rows: [fredRow('BANK RATE', settle(bank)), fredRow('SONIA', settle(sonia))], source: 'FRED (BoE)', status: 'daily' };
  }
  if (cc === 'JP') {
    const [pol, call] = await Promise.allSettled(['IRSTCB01JPM156N', 'IRSTCI01JPM156N'].map(s => fred.fetchLatestPair(s)));
    return { title: 'OVERNIGHT & POLICY', rows: [fredRow('BOJ POLICY RATE (M)', settle(pol)), fredRow('CALL RATE (M)', settle(call))], source: 'FRED (OECD)', status: 'monthly' };
  }
  if (cc === 'MX') {
    const [pol] = await Promise.allSettled(['IRSTCB01MXM156N'].map(s => fred.fetchLatestPair(s)));
    return { title: 'OVERNIGHT & POLICY', rows: [fredRow('BANXICO RATE (M)', settle(pol))], source: 'FRED (OECD)', status: 'monthly' };
  }
  return { title: 'OVERNIGHT & POLICY', rows: [], source: null, status: 'unavailable' };
}

async function curveBlock(cc) {
  if (cc === 'US') {
    try {
      const c = await getUsTreasuryCurve();
      const pts = (c?.points || (Array.isArray(c) ? c : [])).map(p => row(p.tenor, p.yield ?? p.rate, { date: c?.asOf || c?.fetchedAt || null }));
      return { title: 'TREASURY CURVE', rows: pts, source: 'FRED (Treasury CMT)', status: 'daily' };
    } catch (e) { return { title: 'TREASURY CURVE', rows: [], source: 'FRED', status: 'unavailable', error: e.message }; }
  }
  if (cc === 'BR') {
    const { buildBrCurve, TD_URL, TD_HEADERS, BCB_SELIC_URL } = require('../routes/market/debt');
    const [selicRes, tdRes] = await Promise.allSettled([
      fetch(BCB_SELIC_URL, { headers: { Accept: 'application/json' }, timeout: 8000 }).then(r => r.json()),
      fetch(TD_URL, { headers: TD_HEADERS, timeout: 8000 }).then(r => { if (!r.ok) throw new Error(`TD ${r.status}`); return r.json(); }),
    ]);
    const br = await buildBrCurve({ tdRes, selicRes });
    const rows = (br.curve || []).filter(p => p.tenor !== 'SELIC').map(p => row(p.tenor, p.rate, { date: br.asOf, note: p.contract || null }));
    const needs = !rows.length && /BRAPI_API_KEY not set/.test(br.error || '') ? 'needs:BRAPI_API_KEY (Pro plan — DI1 term structure)' : null;
    return { title: 'DI × PRÉ CURVE', rows, source: br.source, status: rows.length ? 'eod' : (needs || 'unavailable'), error: rows.length ? undefined : br.error, label: br.label };
  }
  const series = { EU: 'IRLTLT01EZM156N', GB: 'IRLTLT01GBM156N', JP: 'IRLTLT01JPM156N', MX: 'IRLTLT01MXM156N' }[cc];
  const p = series ? await fred.fetchLatestPair(series).catch(() => null) : null;
  return { title: 'GOVT CURVE', rows: p ? [fredRow('10Y (OECD, MONTHLY)', p)] : [], source: 'FRED (OECD)', status: p ? 'monthly' : 'unavailable', note: 'Full daily curve lives on the Rates & Credit panel (ECB / BoE / SNB feeds)' };
}

async function rateFuturesBlock(cc) {
  if (cc === 'US') {
    const [zq, sr3] = await Promise.all([yfCurve.getFuturesCurve('ZQ', { horizonMonths: 14 }), yfCurve.getFuturesCurve('SR3', { horizonMonths: 24 })]);
    const rows = [
      ...zq.curve.slice(0, 8).map(c => row(`FF ${c.contract}`, c.impliedRate, { chg: c.changePct, date: zq.asOf, note: `px ${c.price}` })),
      ...sr3.curve.slice(0, 6).map(c => row(`SOFR ${c.contract}`, c.impliedRate, { chg: c.changePct, date: sr3.asOf, note: `px ${c.price}` })),
    ];
    return { title: 'RATE FUTURES (IMPLIED)', rows, source: 'CME/CBOT via Yahoo (delayed)', status: rows.length ? 'live' : 'unavailable', note: 'implied = 100 − price' };
  }
  if (cc === 'BR') {
    const di = await brapi.getDiTermStructure().catch(e => ({ points: [], errors: [e.message] }));
    const rows = di.points.slice(0, 10).map(p => row(`DI1 ${String(p.symbol).slice(3)}`, p.rate, { date: di.asOfMs ? new Date(di.asOfMs).toISOString() : null, note: p.maturity }));
    const needs = !rows.length && /BRAPI_API_KEY/.test((di.errors || []).join(' ')) ? 'needs:BRAPI_API_KEY (Pro plan — B3 futures EOD)' : null;
    return { title: 'DI FUTURES (B3)', rows, source: 'B3 via brapi (EOD)', status: rows.length ? 'eod' : (needs || 'unavailable'), error: rows.length ? undefined : (di.errors || [])[0] };
  }
  if (cc === 'EU') {
    const e = await yfCurve.getFuturesCurve('6E', { horizonMonths: 12 });
    return { title: 'EUR FX FUTURES', rows: e.curve.slice(0, 4).map(c => row(`6E ${c.contract}`, c.price, { chg: c.changePct, unit: '', date: e.asOf })), source: 'CME via Yahoo (delayed)', status: e.curve.length ? 'live' : 'unavailable' };
  }
  return { title: 'RATE FUTURES', rows: [], source: null, status: 'unavailable', note: 'No licensed listed-futures source for this market yet' };
}

async function fxBlock(cc) {
  const syms = {
    BR: ['USDBRL=X', 'EURBRL=X'], US: ['DX-Y.NYB', 'EURUSD=X', 'USDJPY=X'], EU: ['EURUSD=X', 'EURGBP=X', 'EURJPY=X'],
    GB: ['GBPUSD=X', 'EURGBP=X'], JP: ['USDJPY=X', 'EURJPY=X'], MX: ['USDMXN=X'],
  }[cc] || [];
  const q = await quotes(syms);
  const rows = syms.filter(s => q[s]).map(s => qRow(fxLabel(s), q[s], { digits: 4 }));
  if (cc === 'BR') {
    const [ptaxBuy, ptaxSell] = await Promise.allSettled([bcb(10813), bcb(1)]);
    const b = settle(ptaxBuy), s = settle(ptaxSell);
    if (s) rows.push(row('PTAX (SELL)', s.value, { chg: s.change, unit: '', date: s.date }));
    if (b) rows.push(row('PTAX (BUY)', b.value, { chg: b.change, unit: '', date: b.date }));
    const fut = await brapi.getFuturesQuotes(['DOLZ26', 'DOLF27', 'DOLG27', 'DOLH27', 'WDOZ26', 'WDOF27']).catch(() => ({ quotes: [], errors: ['brapi'] }));
    const fq = (fut.quotes || []).filter(x => x.price != null);
    if (fq.length) {
      fq.forEach(x => rows.push(row(`${x.symbol} FUT`, Number((x.price / 1000).toFixed(4)), { chg: x.changePct, unit: '', date: x.asOf, note: x.expiration })));
      return { title: 'FX · SPOT, PTAX, USD FUTURES', rows, source: 'Yahoo · BCB PTAX · B3 via brapi (EOD)', status: 'live' };
    }
    return { title: 'FX · SPOT, PTAX, USD FUTURES', rows, source: 'Yahoo · BCB PTAX', status: 'live', needs: 'USD futures (DOL/WDO), cupom cambial & NDF curve → BRAPI_API_KEY (Pro)' };
  }
  return { title: 'FX', rows, source: 'Yahoo (delayed)', status: rows.length ? 'live' : 'unavailable' };
}

async function riskBlock(cc) {
  if (cc === 'BR') {
    // BCB SGS 40940 (JPMorgan EMBI+ Brazil) is rejected by the API now —
    // the series was discontinued — so there is no free sovereign-risk
    // print left. Say so; do not proxy it with an ETF.
    return {
      title: 'SOVEREIGN RISK', rows: [], source: null, status: 'unavailable',
      needs: 'CDS 5Y / EMBI+: no affordable API (BCB discontinued EMBI+ series 40940; Markit/ICE, Bloomberg, Refinitiv only). Global USD bonds (GLB27…): needs a bond-pricing vendor.',
    };
  }
  if (cc === 'US') {
    const [s2s10, be10, f5y5y, hy, ig] = await Promise.allSettled(['T10Y2Y', 'T10YIE', 'T5YIFR', 'BAMLH0A0HYM2', 'BAMLC0A0CM'].map(s => fred.fetchLatestPair(s)));
    const rows = [bpRow('2S10S', settle(s2s10)), fredRow('10Y BREAKEVEN', settle(be10)), fredRow('5Y5Y FWD INFL', settle(f5y5y)), bpRow('HY OAS', settle(hy)), bpRow('IG OAS', settle(ig))];
    return { title: 'SPREADS & INFLATION', rows, source: 'FRED (ICE BofA, Treasury)', status: 'daily' };
  }
  return { title: 'SOVEREIGN RISK', rows: [], source: null, status: 'unavailable', needs: 'CDS: no affordable API' };
}

async function bondsBlock(cc) {
  if (cc === 'BR') {
    return {
      title: 'NTN-B · LTN · NTN-F', rows: [], source: null,
      status: 'needs:BRAPI_API_KEY (Pro — Tesouro Direto rates) or ANBIMA Feed (secondary-market yields)',
      note: 'Tesouro Direto public JSON was retired (404); the official Tesouro Transparente CSV is a full-history dump, too heavy to poll.',
    };
  }
  if (cc === 'US') {
    const [t2, t5, t10, t30, tips10] = await Promise.allSettled(['DGS2', 'DGS5', 'DGS10', 'DGS30', 'DFII10'].map(s => fred.fetchLatestPair(s)));
    return { title: 'TREASURIES & TIPS', rows: [fredRow('UST 2Y', settle(t2)), fredRow('UST 5Y', settle(t5)), fredRow('UST 10Y', settle(t10)), fredRow('UST 30Y', settle(t30)), fredRow('TIPS 10Y REAL', settle(tips10))], source: 'FRED (Treasury)', status: 'daily' };
  }
  return { title: 'GOVT BONDS', rows: [], source: null, status: 'unavailable' };
}

async function marketsBlock(cc, meta) {
  const extra = { BR: ['EWZ', 'BZ=F', 'CL=F', 'GC=F'], US: ['ES=F', 'NQ=F', 'YM=F', 'CL=F', 'GC=F'], EU: ['^GDAXI', '^FCHI', 'BZ=F'], GB: ['^FTMC', 'BZ=F'], JP: ['^TOPX', 'CL=F'], MX: ['EWW', 'CL=F'] }[cc] || [];
  const syms = [meta.index, ...extra];
  const q = await quotes(syms);
  const LABELS = { '^BVSP': 'IBOVESPA', '^GSPC': 'S&P 500', '^STOXX50E': 'EURO STOXX', '^FTSE': 'FTSE 100', '^N225': 'NIKKEI', '^MXX': 'IPC', 'ES=F': 'S&P FUT', 'NQ=F': 'NDX FUT', 'YM=F': 'DOW FUT', 'BZ=F': 'BRENT', 'CL=F': 'WTI', 'GC=F': 'GOLD', '^GDAXI': 'DAX', '^FCHI': 'CAC', '^FTMC': 'FTSE 250', '^TOPX': 'TOPIX' };
  const rows = syms.filter(s => q[s]).map(s => qRow(LABELS[s] || s, q[s], { digits: 2 }));
  return { title: 'STOCKS & COMMODITIES', rows, source: 'Yahoo (delayed)', status: rows.length ? 'live' : 'unavailable' };
}

async function releasesBlock(cc) {
  const code = { EU: 'ea', GB: 'gb' }[cc] || cc.toLowerCase();
  try {
    if (!eulerpool.isConfigured()) return { title: 'ECONOMIC RELEASES', rows: [], source: null, status: 'needs:EULERPOOL_API_KEY' };
    const cal = await eulerpool.getMacroCalendar();
    const now = Date.now();
    const ev = (Array.isArray(cal) ? cal : []).filter(e => String(e.country_code || '').toLowerCase() === code);
    const window = ev
      .filter(e => { const t = Number(e.timestamp); return t > now - 2 * 86400000 && t < now + 8 * 86400000; })
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      .slice(0, 18);
    const rows = window.map(e => ({
      when: new Date(Number(e.timestamp)).toISOString(), name: e.name, period: e.reference_date || null,
      actual: e.actual_value ?? null, consensus: e.consensus_value ?? null, previous: e.previous_value ?? null,
    }));
    return { title: 'ECONOMIC RELEASES', rows, source: 'Eulerpool macro calendar', status: rows.length ? 'live' : 'unavailable' };
  } catch (e) {
    return { title: 'ECONOMIC RELEASES', rows: [], source: 'Eulerpool', status: 'unavailable', error: e.message };
  }
}

async function getMoneyMarkets(cc) {
  const meta = COUNTRIES[cc];
  if (!meta) return null;
  const ck = `mm:${cc}`;
  const hit = cacheGet(ck);
  if (hit) return hit;
  const t0 = Date.now();
  const guard = p => p.catch(e => ({ title: '—', rows: [], status: 'unavailable', error: e.message }));
  const [policy, curve, rateFutures, fx, risk, bonds, markets, releases] = await Promise.all([
    guard(policyBlock(cc)), guard(curveBlock(cc)), guard(rateFuturesBlock(cc)), guard(fxBlock(cc)),
    guard(riskBlock(cc)), guard(bondsBlock(cc)), guard(marketsBlock(cc, meta)), guard(releasesBlock(cc)),
  ]);
  const blocks = { policy, curve, rateFutures, fx, risk, bonds, markets, releases };
  const needs = [...new Set(Object.values(blocks)
    .map(b => b.needs || (String(b.status).startsWith('needs:') ? b.status.slice(6) : null))
    .filter(Boolean))];
  const out = { country: cc, ...meta, blocks, needs, generatedAt: new Date().toISOString(), ms: Date.now() - t0 };
  cacheSet(ck, out, TTL_MS);
  logger.info('moneyMarkets', `${cc} assembled in ${out.ms}ms`, { needs: needs.length });
  return out;
}

module.exports = { getMoneyMarkets, COUNTRIES };
