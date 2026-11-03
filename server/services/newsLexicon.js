/**
 * services/newsLexicon.js — deterministic headline tagger.
 *
 * The wire must look the same whether or not the LLM is reachable: every
 * row gets a sentiment edge and up to two instrument codes. This is the
 * floor. When Haiku answers, its verdict replaces this one (newsClassifier
 * runs the lexicon first and overwrites with the model's output).
 *
 * Sentiment is MARKET impact from verbs/nouns in the headline, not mood.
 * Direction words are scored; a strong negative word beats a weak positive
 * one; ties and no-hits are neutral. Instruments come from a phrase map.
 */

'use strict';

const NEG = [
  ['tumbl', 3], ['plung', 3], ['crash', 3], ['slump', 3], ['sell-off', 3], ['selloff', 3], ['rout', 3],
  ['fall', 2], ['falls', 2], ['fell', 2], ['drop', 2], ['slide', 2], ['slides', 2], ['decline', 2], ['declin', 2],
  ['sink', 2], ['lower', 1], ['down', 1], ['loss', 2], ['losses', 2], ['miss', 2], ['misses', 2], ['cut', 1],
  ['downgrade', 3], ['default', 3], ['bankrupt', 3], ['recession', 3], ['contraction', 2], ['weak', 2], ['weaker', 2],
  ['warn', 2], ['warns', 2], ['fear', 2], ['fears', 2], ['risk', 1], ['strike', 2], ['escalat', 3], ['attack', 3],
  ['war', 2], ['sanction', 2], ['tariff', 2], ['hike', 1], ['tighten', 1], ['inflation', 1], ['deficit', 1],
  ['probe', 2], ['lawsuit', 2], ['fine', 1], ['layoff', 2], ['halt', 2], ['suspend', 2], ['delay', 1], ['shortfall', 2],
  ['pressure', 1], ['worst', 2], ['lowest', 1], ['volatil', 1], ['caution', 1], ['brace', 2],
  ['retreat', 2], ['pullback', 2], ['slip', 2], ['dip', 1], ['shed', 2], ['pare', 1], ['stall', 2], ['cool', 1],
];
const POS = [
  ['surge', 3], ['soar', 3], ['jump', 3], ['rally', 3], ['rallies', 3], ['record', 2], ['rebound', 2],
  ['rise', 2], ['rises', 2], ['rose', 2], ['gain', 2], ['gains', 2], ['climb', 2], ['advance', 2], ['extend', 1],
  ['higher', 1], ['up', 1], ['beat', 3], ['beats', 3], ['upgrade', 3], ['profit', 1], ['growth', 1], ['strong', 2],
  ['stronger', 2], ['boost', 2], ['recover', 2], ['recovery', 2], ['deal', 1], ['agreement', 1], ['truce', 2],
  ['ceasefire', 3], ['approve', 2], ['approval', 2], ['win', 1], ['wins', 1], ['best', 2], ['highest', 1],
  ['expand', 1], ['hire', 1], ['dividend', 1], ['buyback', 2], ['ease', 1], ['eases', 1], ['relief', 2], ['optimism', 2],
  ['cooler', 1], ['cools', 1], ['softer', 1],
];

// phrase → codes (most relevant first). Lower-case, word-boundary matched.
const INSTR = [
  [/\b(brent)\b/, ['BRENT']], [/\b(wti|crude|oil prices?|oil)\b/, ['WTI', 'BRENT']], [/\b(opec)\b/, ['BRENT', 'WTI']],
  [/\b(nat(ural)? gas|henry hub|lng)\b/, ['NATGAS']], [/\b(gold|bullion)\b/, ['GOLD']], [/\b(silver)\b/, ['SILVER']], [/\b(copper)\b/, ['COPPER']],
  [/\b(iron ore)\b/, ['VALE3', 'IRONORE']], [/\b(soybeans?|soy)\b/, ['SOY']], [/\b(corn)\b/, ['CORN']], [/\b(wheat)\b/, ['WHEAT']], [/\b(coffee)\b/, ['COFFEE']], [/\b(sugar)\b/, ['SUGAR']],
  [/\b(treasur(y|ies)|t-?bills?|yields?|bond market)\b/, ['UST10Y']], [/\b(fed|fomc|powell|federal reserve|rate (cut|hike)s?)\b/, ['FED', 'UST10Y']],
  [/\b(ecb|lagarde)\b/, ['ECB', 'EURUSD']], [/\b(boj|bank of japan|ueda)\b/, ['BOJ', 'USDJPY']], [/\b(boe|bank of england)\b/, ['BOE', 'GBPUSD']],
  [/\b(selic|copom|banco central|bcb|galípolo|galipolo)\b/, ['SELIC', 'DI']], [/\b(ipca|brazil(ian)? inflation)\b/, ['IPCA', 'SELIC']],
  [/\b(real|brl|usd\/brl|dólar|dolar)\b/, ['USDBRL']], [/\b(ibovespa|bovespa|b3)\b/, ['IBOV']], [/\b(brazil|brasil|lula|haddad)\b/, ['IBOV', 'USDBRL']],
  [/\b(petrobras)\b/, ['PETR4']], [/\b(vale)\b/, ['VALE3']], [/\b(ita[uú])\b/, ['ITUB4']], [/\b(bradesco)\b/, ['BBDC4']], [/\b(ambev)\b/, ['ABEV3']], [/\b(embraer)\b/, ['EMBR3']], [/\b(nubank|nu holdings)\b/, ['NU']],
  [/\b(s&p ?500|s&p|wall street|us stocks?|stock market)\b/, ['SPX']], [/\b(nasdaq|tech stocks?)\b/, ['NDX']], [/\b(dow( jones)?)\b/, ['DJI']],
  [/\b(ftse)\b/, ['FTSE']], [/\b(dax)\b/, ['DAX']], [/\b(nikkei|japan(ese)? stocks?)\b/, ['N225']], [/\b(hang seng|china stocks?|shanghai)\b/, ['HSI']], [/\b(sensex|nifty|indian shares?)\b/, ['SENSEX']], [/\b(tsx|canadian stocks?)\b/, ['TSX']],
  [/\b(dollar|dxy|greenback)\b/, ['DXY']], [/\b(euro)\b/, ['EURUSD']], [/\b(yen)\b/, ['USDJPY']], [/\b(sterling|pound)\b/, ['GBPUSD']], [/\b(peso)\b/, ['USDMXN']], [/\b(rupee)\b/, ['USDINR']],
  [/\b(bitcoin|btc)\b/, ['BTC']], [/\b(ethereum|ether|eth)\b/, ['ETH']], [/\b(crypto)\b/, ['BTC']],
  [/\b(apple)\b/, ['AAPL']], [/\b(microsoft)\b/, ['MSFT']], [/\b(nvidia)\b/, ['NVDA']], [/\b(alphabet|google)\b/, ['GOOGL']], [/\b(amazon)\b/, ['AMZN']], [/\b(meta|facebook)\b/, ['META']], [/\b(tesla)\b/, ['TSLA']],
  [/\b(palantir)\b/, ['PLTR']], [/\b(marvell)\b/, ['MRVL']], [/\b(disney)\b/, ['DIS']], [/\b(shell)\b/, ['SHEL']], [/\b(exxon)\b/, ['XOM']], [/\b(boeing)\b/, ['BA']], [/\b(jpmorgan)\b/, ['JPM']], [/\b(goldman)\b/, ['GS']],
  [/\b(iran|israel|middle east|houthi)\b/, ['BRENT', 'GOLD']], [/\b(ukraine|russia)\b/, ['BRENT', 'WHEAT']], [/\b(taiwan)\b/, ['NDX', 'HSI']],
  [/\b(midterms?|election|republicans?|democrats?|congress|senate)\b/, ['SPX', 'UST10Y']], [/\b(tariffs?|trade war)\b/, ['SPX', 'USDCNY']],
  [/\b(jobs?|payrolls?|unemployment|job openings)\b/, ['UST10Y', 'SPX']], [/\b(cpi|inflation|pce)\b/, ['UST10Y', 'FED']], [/\b(gdp)\b/, ['SPX']],
  [/\b(vix|volatility)\b/, ['VIX']], [/\b(credit|high[- ]yield|junk bonds?)\b/, ['HYG']], [/\b(mortgage)\b/, ['UST10Y']],
];

// Word-boundary at the start, prefix-tolerant at the end ("fall" hits
// "falls"/"falling"; "win" no longer hits "swings").
const compile = table => table.map(([w, pts]) => [new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), pts]);
const NEG_RE = compile(NEG);
const POS_RE = compile(POS);
function score(text, table) {
  let s = 0;
  for (const [re, pts] of table) if (re.test(text)) s += pts;
  return s;
}

function sentimentOf(title) {
  const t = ` ${String(title || '').toLowerCase()} `;
  const neg = score(t, NEG_RE);
  const pos = score(t, POS_RE);
  // "oil falls" is negative for oil but risk-on for equities; we judge the
  // headline's own subject, which is what the lexicon reads.
  if (neg === 0 && pos === 0) return 'neutral';
  if (neg >= pos + 1) return 'negative';
  if (pos >= neg + 1) return 'positive';
  return 'neutral';
}

function instrumentsOf(title) {
  const t = String(title || '').toLowerCase();
  const out = [];
  for (const [re, codes] of INSTR) {
    if (re.test(t)) for (const c of codes) if (!out.includes(c)) out.push(c);
    if (out.length >= 4) break;
  }
  return out.slice(0, 4);
}

function tag(title) {
  return { sentiment: sentimentOf(title), instruments: instrumentsOf(title) };
}

module.exports = { tag, sentimentOf, instrumentsOf };
