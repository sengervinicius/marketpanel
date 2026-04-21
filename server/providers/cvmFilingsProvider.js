/**
 * providers/cvmFilingsProvider.js
 *
 * CVM IPE (Informações Periódicas e Eventuais) filings index for
 * Brazilian listed companies.
 *
 * Why this exists
 * ---------------
 * Before this, "did PETR4 file anything recently", "show me VALE fatos
 * relevantes", or "Itaú latest communications" had no wired tool — the
 * model fell back to EDGAR (which only covers SEC filers, i.e. ADRs),
 * narrative Perplexity, or training data. The audit flagged this as a
 * P1 gap (+0.4 CIO lift).
 *
 * Source
 * ------
 * CVM's open-data portal publishes the IPE index as one CSV per year:
 *
 *   https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/
 *     ipe_cia_aberta_{YEAR}.csv
 *
 * Format: ISO-8859-1, semicolon-separated, quoted fields. No API key.
 * Each row is one filing (a "fato relevante", "comunicado ao mercado",
 * "ITR", "DFP", "ata de assembleia", etc.) with:
 *   CNPJ_Companhia, Nome_Companhia, Codigo_CVM, Categoria, Tipo,
 *   Especie, Data_Referencia, Data_Entrega, Status, Versao, Modalidade,
 *   Assunto, Link_Download
 *
 * Strategy
 * --------
 * Fetch + parse once per year, cache 12 hours. Filter in-memory. The
 * current-year CSV is ~3-5 MB — fine for a single node process, painful
 * to hit every request which is why we cache aggressively.
 *
 * Company resolution
 * ------------------
 * CVM filings are keyed by CNPJ, not by B3 ticker. We ship a compact
 * alias table for the top ~40 B3 blue chips so "PETR4", "PETR4.SA",
 * "Petrobras" all resolve to CNPJ 33.000.167/0001-01. For anything not
 * in the table we fall back to a case-insensitive substring match on
 * Nome_Companhia (which is what the RAD UI itself does).
 *
 * Output shape:
 *   {
 *     company: { cnpj, name, ticker? },
 *     from: 'YYYY-MM-DD',
 *     to:   'YYYY-MM-DD',
 *     category?: string,
 *     count: number,
 *     filings: [
 *       {
 *         date: 'YYYY-MM-DD',    // Data_Entrega
 *         referenceDate: 'YYYY-MM-DD',  // Data_Referencia
 *         category: string,      // Categoria
 *         type: string,          // Tipo
 *         subtype: string,       // Especie
 *         subject: string,       // Assunto
 *         status: string,
 *         version: string,
 *         link: string,          // Link_Download
 *       },
 *       ...
 *     ],
 *     source: 'CVM IPE',
 *     asOf: ISO-8601,
 *   }
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

// ── Canonical ticker → CNPJ table for the BR blue-chips our users ask
// about every morning. Kept hand-curated rather than auto-scraped
// because (a) these change rarely, (b) a bad auto-scrape would map the
// wrong filings under a ticker which is a correctness bug, and (c) the
// fallback is substring-match on company name, which handles the long
// tail anyway. If a user asks about a small cap we don't have here,
// they can just type the company name.
const TICKER_TO_CNPJ = {
  // Petróleo / energia
  'PETR3':  { cnpj: '33000167000101', name: 'PETROLEO BRASILEIRO S.A. PETROBRAS' },
  'PETR4':  { cnpj: '33000167000101', name: 'PETROLEO BRASILEIRO S.A. PETROBRAS' },
  'PRIO3':  { cnpj: '10629105000168', name: 'PETRO RIO S.A.' },
  'RECV3':  { cnpj: '12091809000155', name: '3R PETROLEUM ÓLEO E GÁS S.A.' },
  'UGPA3':  { cnpj: '33256378000138', name: 'ULTRAPAR PARTICIPACOES S.A.' },
  'CSAN3':  { cnpj: '50746577000115', name: 'COSAN S.A.' },
  'VBBR3':  { cnpj: '33069766000130', name: 'VIBRA ENERGIA S.A.' },
  // Mineração / metais
  'VALE3':  { cnpj: '33592510000154', name: 'VALE S.A.' },
  'CSNA3':  { cnpj: '33042730000204', name: 'COMPANHIA SIDERURGICA NACIONAL' },
  'GGBR4':  { cnpj: '33611500000119', name: 'GERDAU S.A.' },
  'GOAU4':  { cnpj: '92690783000109', name: 'METALURGICA GERDAU S.A.' },
  'USIM5':  { cnpj: '60894730000105', name: 'USINAS SID DE MINAS GERAIS S.A.-USIMINAS' },
  // Bancos
  'ITUB3':  { cnpj: '60872504000123', name: 'ITAU UNIBANCO HOLDING S.A.' },
  'ITUB4':  { cnpj: '60872504000123', name: 'ITAU UNIBANCO HOLDING S.A.' },
  'ITSA3':  { cnpj: '61532644000115', name: 'ITAUSA S.A.' },
  'ITSA4':  { cnpj: '61532644000115', name: 'ITAUSA S.A.' },
  'BBDC3':  { cnpj: '60746948000112', name: 'BANCO BRADESCO S.A.' },
  'BBDC4':  { cnpj: '60746948000112', name: 'BANCO BRADESCO S.A.' },
  'BBAS3':  { cnpj: '00000000000191', name: 'BANCO DO BRASIL S.A.' },
  'SANB11': { cnpj: '90400888000142', name: 'BANCO SANTANDER (BRASIL) S.A.' },
  'BPAC11': { cnpj: '30306294000145', name: 'BANCO BTG PACTUAL S.A.' },
  // Varejo / consumo
  'MGLU3':  { cnpj: '47960950000121', name: 'MAGAZINE LUIZA S.A.' },
  'LREN3':  { cnpj: '33592510000154', name: 'LOJAS RENNER S.A.' },
  'AMER3':  { cnpj: '00776574000156', name: 'AMERICANAS S.A.' },
  'ASAI3':  { cnpj: '06057223000171', name: 'SENDAS DISTRIBUIDORA S/A' },
  'PCAR3':  { cnpj: '47508411000156', name: 'COMPANHIA BRASILEIRA DE DISTRIBUICAO' },
  // Alimentos / bebidas
  'ABEV3':  { cnpj: '07526557000100', name: 'AMBEV S.A.' },
  'JBSS3':  { cnpj: '02916265000160', name: 'JBS S.A.' },
  'BRFS3':  { cnpj: '01838723000127', name: 'BRF S.A.' },
  'MRFG3':  { cnpj: '03853896000140', name: 'MARFRIG GLOBAL FOODS S.A.' },
  // Utilities / saneamento
  'ELET3':  { cnpj: '00001180000126', name: 'CENTRAIS ELETRICAS BRASILEIRAS S.A. - ELETROBRAS' },
  'ELET6':  { cnpj: '00001180000126', name: 'CENTRAIS ELETRICAS BRASILEIRAS S.A. - ELETROBRAS' },
  'SBSP3':  { cnpj: '43776517000180', name: 'CIA SANEAMENTO BASICO EST SAO PAULO' },
  'CMIG4':  { cnpj: '17155730000164', name: 'CIA ENERGETICA DE MINAS GERAIS - CEMIG' },
  'EQTL3':  { cnpj: '03220438000173', name: 'EQUATORIAL ENERGIA S.A.' },
  'ENGI11': { cnpj: '01083200000118', name: 'ENERGISA S.A.' },
  // Aluguel / mobilidade
  'RENT3':  { cnpj: '16614075000195', name: 'LOCALIZA RENT A CAR S.A.' },
  'MOVI3':  { cnpj: '21314559000166', name: 'MOVIDA PARTICIPACOES S.A.' },
  // Papel / celulose
  'SUZB3':  { cnpj: '16404287000155', name: 'SUZANO S.A.' },
  'KLBN11': { cnpj: '89637490000145', name: 'KLABIN S.A.' },
  // Exchanges / financeiro não-banco
  'B3SA3':  { cnpj: '09346601000125', name: 'B3 S.A. - BRASIL, BOLSA, BALCAO' },
  // Saúde
  'RDOR3':  { cnpj: '06047087000139', name: 'REDE D\'OR SAO LUIZ S.A.' },
  'HAPV3':  { cnpj: '05197167000135', name: 'HAPVIDA PARTICIPAÇÕES E INVESTIMENTOS S.A.' },
  // Construção / imobiliário
  'CYRE3':  { cnpj: '73178600000118', name: 'CYRELA BRAZIL REALTY S.A.EMPREEND E PART' },
  // Transporte / logística
  'CCRO3':  { cnpj: '02846056000197', name: 'CCR S.A.' },
  'RAIL3':  { cnpj: '02387241000160', name: 'RUMO S.A.' },
  // Educação
  'COGN3':  { cnpj: '02800026000140', name: 'COGNA EDUCAÇÃO S.A.' },
  'YDUQ3':  { cnpj: '08807432000110', name: 'YDUQS PARTICIPACOES S.A.' },
};

// ── Cache ────────────────────────────────────────────────────────────
const _cache = new Map();
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — CVM publishes intraday
                                    // but the list changes slowly enough
                                    // that this covers a full session.
function cget(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cset(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── Helpers ──────────────────────────────────────────────────────────
function normCnpj(x) {
  return String(x || '').replace(/\D/g, '');
}

function normalizeTicker(input) {
  if (!input) return null;
  const s = String(input).toUpperCase().trim();
  // Strip common suffixes (".SA", ".SAO", "/BMFBOVESPA")
  const plain = s.replace(/\.SA$/,'').replace(/\.SAO$/,'').replace(/\/BMFBOVESPA$/,'');
  return plain;
}

// Split a CSV line that uses ';' as separator and may have quoted fields.
// CVM's IPE format is quite clean — quotes only appear for names with
// embedded semicolons — but we still need a quote-aware splitter.
function splitCsvLine(line, sep = ';') {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = false; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// Parse a CVM-style date string. Dates in the IPE CSV are YYYY-MM-DD
// already (ISO), but be defensive.
function toIsoDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// ── Fetch + parse IPE CSV for a year ─────────────────────────────────
async function fetchIpeYear(year) {
  const cacheKey = `cvm:ipe:${year}`;
  const cached = cget(cacheKey);
  if (cached) return cached;

  const url =
    `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/` +
    `ipe_cia_aberta_${year}.csv`;

  const res = await fetch(url, {
    timeout: 20000,
    headers: { Accept: 'text/csv, */*' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CVM IPE ${year} ${res.status}: ${body.slice(0, 120)}`);
  }

  // CVM CSVs are ISO-8859-1 encoded (Portuguese accents). Decode from
  // the raw buffer so "Relevância" etc. doesn't come out as mojibake.
  const buf = await res.buffer();
  const text = buf.toString('latin1');

  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]);
  const idx = {
    cnpj:         header.indexOf('CNPJ_Companhia'),
    name:         header.indexOf('Nome_Companhia'),
    codCvm:       header.indexOf('Codigo_CVM'),
    categoria:    header.indexOf('Categoria'),
    tipo:         header.indexOf('Tipo'),
    especie:      header.indexOf('Especie'),
    dataRef:      header.indexOf('Data_Referencia'),
    dataEntrega:  header.indexOf('Data_Entrega'),
    status:       header.indexOf('Status'),
    versao:       header.indexOf('Versao'),
    modalidade:   header.indexOf('Modalidade'),
    assunto:      header.indexOf('Assunto'),
    link:         header.indexOf('Link_Download'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    if (fields.length < 3) continue;
    rows.push({
      cnpj:          normCnpj(fields[idx.cnpj]),
      name:          (fields[idx.name] || '').trim(),
      codCvm:        (fields[idx.codCvm] || '').trim(),
      category:      (fields[idx.categoria] || '').trim(),
      type:          (fields[idx.tipo] || '').trim(),
      subtype:       (fields[idx.especie] || '').trim(),
      referenceDate: toIsoDate(fields[idx.dataRef]),
      date:          toIsoDate(fields[idx.dataEntrega]),
      status:        (fields[idx.status] || '').trim(),
      version:       (fields[idx.versao] || '').trim(),
      modality:      (fields[idx.modalidade] || '').trim(),
      subject:       (fields[idx.assunto] || '').trim(),
      link:          (fields[idx.link] || '').trim(),
    });
  }

  cset(cacheKey, rows, TTL_MS);
  return rows;
}

// ── Company resolution ───────────────────────────────────────────────
async function resolveCompany({ ticker, company, cnpj, year }) {
  // 1. Explicit CNPJ wins.
  const normalized = normCnpj(cnpj);
  if (normalized && normalized.length >= 8) {
    return { cnpj: normalized, name: null, ticker: null };
  }

  // 2. Ticker table.
  const tk = normalizeTicker(ticker || company);
  if (tk && TICKER_TO_CNPJ[tk]) {
    return { cnpj: TICKER_TO_CNPJ[tk].cnpj, name: TICKER_TO_CNPJ[tk].name, ticker: tk };
  }

  // 3. Substring match on Nome_Companhia from the loaded CSV. Pick the
  //    most frequent CNPJ for that substring (so a name like "Itaú"
  //    binds to the holding most often referenced in filings, not some
  //    obscure subsidiary).
  if (company) {
    const rows = await fetchIpeYear(year);
    const needle = String(company).toLowerCase()
      // accent-fold (very small subset — good enough for Portuguese)
      .replace(/[áàâã]/g, 'a')
      .replace(/[éê]/g, 'e')
      .replace(/[í]/g, 'i')
      .replace(/[óôõ]/g, 'o')
      .replace(/[ú]/g, 'u')
      .replace(/[ç]/g, 'c');
    const tallies = new Map();
    for (const r of rows) {
      const hay = String(r.name || '').toLowerCase()
        .replace(/[áàâã]/g, 'a')
        .replace(/[éê]/g, 'e')
        .replace(/[í]/g, 'i')
        .replace(/[óôõ]/g, 'o')
        .replace(/[ú]/g, 'u')
        .replace(/[ç]/g, 'c');
      if (hay.includes(needle)) {
        const prev = tallies.get(r.cnpj) || { count: 0, name: r.name };
        prev.count += 1;
        tallies.set(r.cnpj, prev);
      }
    }
    if (tallies.size === 0) return null;
    let best = null;
    for (const [cnpj, info] of tallies.entries()) {
      if (!best || info.count > best.count) best = { cnpj, name: info.name, ticker: null };
    }
    return best;
  }

  return null;
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * Search CVM IPE filings for one company.
 *
 * @param {Object} opts
 * @param {string} [opts.ticker]    B3 ticker (PETR4, VALE3, ITUB4).
 * @param {string} [opts.company]   Company name substring.
 * @param {string} [opts.cnpj]      CNPJ (digits only or formatted).
 * @param {string} [opts.category]  e.g. "Fato Relevante", "Comunicado ao Mercado", "DFP", "ITR".
 * @param {string} [opts.type]      "Tipo" filter (e.g. "Aviso aos Acionistas").
 * @param {string} [opts.from]      ISO date (YYYY-MM-DD). Inclusive lower bound on Data_Entrega.
 * @param {string} [opts.to]        ISO date (YYYY-MM-DD). Inclusive upper bound on Data_Entrega.
 * @param {number} [opts.limit=20]  1-100.
 * @param {number} [opts.year]      Year of the IPE CSV. Defaults to current year;
 *   we also auto-fallback to previous year if current-year returns zero rows.
 */
async function getCvmFilings(opts = {}) {
  const year = Number(opts.year) || new Date().getFullYear();
  const cap  = Math.max(1, Math.min(100, Number(opts.limit) || 20));

  let company;
  try {
    company = await resolveCompany({
      ticker:  opts.ticker,
      company: opts.company,
      cnpj:    opts.cnpj,
      year,
    });
  } catch (e) {
    logger.warn('cvmFilingsProvider', 'resolveCompany failed', { error: e.message });
    return {
      error: `CVM lookup failed: ${e.message}`,
      source: 'CVM IPE',
    };
  }

  if (!company) {
    return {
      query: { ticker: opts.ticker, company: opts.company, cnpj: opts.cnpj },
      count: 0,
      filings: [],
      coverage_note:
        `Couldn\'t resolve that issuer to a CNPJ. The ticker table covers ~40 B3 ` +
        `blue chips; for smaller names pass the exact company name substring as it ` +
        `appears on CVM (e.g. "Oi S.A." rather than "OIBR3"), or the CNPJ directly.`,
      source: 'CVM IPE',
    };
  }

  let rows;
  try {
    rows = await fetchIpeYear(year);
    // If the current year is too early in January and no filings are in
    // yet, fall back to prior year so the user sees the most recent
    // available filings rather than an empty list.
    if ((!Array.isArray(rows) || rows.length === 0) && !opts.year) {
      rows = await fetchIpeYear(year - 1);
    }
  } catch (e) {
    logger.warn('cvmFilingsProvider', 'fetchIpeYear failed', { year, error: e.message });
    return {
      company,
      error: `CVM IPE CSV unreachable for ${year}: ${e.message}`,
      source: 'CVM IPE',
    };
  }

  const from = opts.from ? toIsoDate(opts.from) : null;
  const to   = opts.to   ? toIsoDate(opts.to)   : null;
  const catFilter  = opts.category ? String(opts.category).toLowerCase() : null;
  const typeFilter = opts.type     ? String(opts.type).toLowerCase()     : null;

  const matches = rows.filter(r => {
    if (r.cnpj !== company.cnpj) return false;
    if (from && r.date && r.date < from) return false;
    if (to   && r.date && r.date > to)   return false;
    if (catFilter && !String(r.category).toLowerCase().includes(catFilter)) return false;
    if (typeFilter && !String(r.type).toLowerCase().includes(typeFilter))   return false;
    return true;
  });

  // Most-recent first.
  matches.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  return {
    company: {
      cnpj: company.cnpj,
      name: company.name || matches[0]?.name || null,
      ticker: company.ticker || null,
    },
    year,
    from: from || null,
    to: to || null,
    category: opts.category || null,
    type: opts.type || null,
    count: matches.length,
    filings: matches.slice(0, cap),
    source: 'CVM IPE',
    asOf: new Date().toISOString(),
  };
}

function listKnownTickers() {
  return Object.entries(TICKER_TO_CNPJ)
    .map(([ticker, info]) => ({ ticker, cnpj: info.cnpj, name: info.name }));
}

module.exports = {
  getCvmFilings,
  listKnownTickers,
  // test hooks
  _resolveCompany: resolveCompany,
  _splitCsvLine: splitCsvLine,
  _toIsoDate: toIsoDate,
  _normalizeTicker: normalizeTicker,
  _TICKER_TO_CNPJ: TICKER_TO_CNPJ,
};
