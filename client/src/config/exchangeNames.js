/**
 * exchangeNames.js — human-readable exchange names (S4.5.C)
 *
 * Maps exchange codes (as used in NO_DATA_EXCHANGES / SearchPanel) to
 * display names for use in InstrumentDetail banners and SearchPanel tooltips.
 */

const EXCHANGE_NAMES = {
  // London
  LSE: 'London Stock Exchange', LON: 'London Stock Exchange', L: 'London Stock Exchange',
  // Tokyo
  TYO: 'Tokyo Stock Exchange', TSE: 'Tokyo Stock Exchange', T: 'Tokyo Stock Exchange',
  // Hong Kong
  HKG: 'Hong Kong Stock Exchange', HK: 'Hong Kong Stock Exchange',
  // China
  SHH: 'Shanghai Stock Exchange', SHZ: 'Shenzhen Stock Exchange',
  // India
  BOM: 'Bombay Stock Exchange', NSE: 'National Stock Exchange of India',
  NS: 'National Stock Exchange of India', BO: 'Bombay Stock Exchange',
  // Australia
  ASX: 'Australian Securities Exchange', AX: 'Australian Securities Exchange',
  // Germany
  FRA: 'Frankfurt Stock Exchange', ETR: 'Deutsche Boerse XETRA', F: 'Frankfurt Stock Exchange',
  // France
  EPA: 'Euronext Paris', PA: 'Euronext Paris',
  // Netherlands
  AMS: 'Euronext Amsterdam', AS: 'Euronext Amsterdam',
  // Spain
  BME: 'Bolsa de Madrid', MC: 'Bolsa de Madrid',
  // Italy
  MIL: 'Borsa Italiana', MI: 'Borsa Italiana',
  // Sweden
  STO: 'Nasdaq Stockholm', ST: 'Nasdaq Stockholm',
  // Denmark
  CPH: 'Nasdaq Copenhagen', CO: 'Nasdaq Copenhagen',
  // Norway
  OSL: 'Oslo Bors', OL: 'Oslo Bors',
  // Finland
  HEL: 'Nasdaq Helsinki', HE: 'Nasdaq Helsinki',
  // Poland
  WSE: 'Warsaw Stock Exchange', WAR: 'Warsaw Stock Exchange',
  WA: 'Warsaw Stock Exchange',
  // #215 — previously-missing EU exchanges that users actually hold.
  // Greece
  ATH: 'Athens Stock Exchange', AT: 'Athens Stock Exchange', ATHEX: 'Athens Stock Exchange',
  // Portugal
  LIS: 'Euronext Lisbon', LS: 'Euronext Lisbon',
  // Belgium
  BRU: 'Euronext Brussels', BR: 'Euronext Brussels',
  // Austria
  WBO: 'Wiener Börse', VIE: 'Wiener Börse', VI: 'Wiener Börse',
  // Ireland
  DUB: 'Euronext Dublin', IR: 'Euronext Dublin', ISE: 'Euronext Dublin',
  // Czechia
  PRA: 'Prague Stock Exchange', PR: 'Prague Stock Exchange',
  // Iceland
  REY: 'Nasdaq Iceland', IC: 'Nasdaq Iceland',
  // Singapore
  SGX: 'Singapore Exchange', SI: 'Singapore Exchange',
  // Korea
  KRX: 'Korea Exchange', KS: 'Korea Exchange', KQ: 'Korea Exchange (KOSDAQ)',
  // US live exchanges (for completeness)
  NYQ: 'New York Stock Exchange', NMS: 'Nasdaq', PCX: 'NYSE Arca',
  ARCX: 'NYSE Arca', BVSP: 'B3 (Brasil Bolsa Balcao)', SAO: 'B3 (Brasil Bolsa Balcao)',
  // OTC
  OTC: 'OTC Markets', PNK: 'OTC Pink Sheets', OTCM: 'OTC Markets',
  GREY: 'OTC Grey Market', OTCQX: 'OTCQX Best Market', OTCQB: 'OTCQB Venture Market',
};

/**
 * getExchangeName — resolve an exchange code to a human-readable name.
 * Falls back to the raw code if unknown.
 */
export function getExchangeName(code) {
  if (!code) return 'Unknown Exchange';
  return EXCHANGE_NAMES[code.toUpperCase()] || code;
}

export default EXCHANGE_NAMES;
