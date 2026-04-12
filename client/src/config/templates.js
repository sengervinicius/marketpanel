/**
 * templates.js
 * Single source of truth for workspace configuration.
 *
 * PRODUCT MODEL (current):
 *   - ONE curated home screen (the default experience)
 *   - Sector screens are standalone full-page components (not templates)
 *   - Legacy "investor profile" templates (brazilianInvestor, globalInvestor,
 *     debtInvestor, cryptoInvestor, commoditiesInvestor) were removed —
 *     the product now has a single curated home + sector screens.
 *
 * @typedef {Object} WorkspaceTemplate
 * @property {string}   id
 * @property {string}   label
 * @property {string}   description
 * @property {string}   focus
 * @property {string}   category
 * @property {string}   group
 * @property {string}   kind
 * @property {string}   theme
 * @property {string[]} watchlist
 * @property {Object}   panels
 * @property {Object}   layout
 * @property {Object}   home
 * @property {Object}   charts
 */
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from './panels.js';

// ═══════════════════════════════════════════════════════════════════
// DEFAULT — The single curated home experience
// ═══════════════════════════════════════════════════════════════════

const defaultHome = {
  id:          'default',
  label:       'Senger Terminal',
  description: 'Global market terminal with curated panels, charts, and live data.',
  focus:       'SPY, QQQ, EUR/USD, BTC, GLD — globally representative',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Home',
  subtitle:    'Global Markets',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['SPY', 'BTCUSD', 'GLD'],
  mobileCardStyle: '#1a4d7a',
  theme:       'dark',
  watchlist:   ['SPY', 'QQQ', 'AAPL', 'NVDA', 'GLD', 'BTCUSD', 'EWZ'],
  panels: {
    usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRK-B','GS','WMT','LLY'] },
    globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'] },
    forex:        { title: 'FX Markets',      symbols: ['EURUSD','USDJPY','GBPUSD','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'] },
    crypto:       { title: 'Crypto',          symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'] },
    commodities:  { title: 'Commodities',     symbols: ['BZ=F','GLD','SLV','USO','UNG','CORN','WEAT','SOYB','CPER','BHP'] },
    brazilB3:     { title: 'Brazil B3',       symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA'] },
    debt:         { title: 'Yields & Rates',  symbols: [] },
  },
  layout: DEFAULT_LAYOUT,
  home: { sections: DEFAULT_HOME_SECTIONS },
  charts: DEFAULT_CHARTS_CONFIG,
};

// Legacy aliases — existing users with saved activeTemplate IDs
// still resolve to the default home experience.
const LEGACY_ALIASES = {
  brazilianInvestor: defaultHome,
  globalInvestor:    defaultHome,
  debtInvestor:      defaultHome,
  cryptoInvestor:    defaultHome,
  commoditiesInvestor: defaultHome,
  custom:            defaultHome,
};


// ═══════════════════════════════════════════════════════════════════
// UNIFIED REGISTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * All workspace templates indexed by ID.
 * @type {Object<string, WorkspaceTemplate>}
 */
export const WORKSPACE_TEMPLATES = {
  default: defaultHome,
};

/**
 * Get a template by ID. Supports legacy aliases for existing users.
 * @param {string} templateId
 * @returns {WorkspaceTemplate|null}
 */
export function getTemplate(templateId) {
  return WORKSPACE_TEMPLATES[templateId] || LEGACY_ALIASES[templateId] || null;
}

/**
 * Get templates filtered by category.
 * @param {'onboarding'|'layout'|'both'|null} category - null for all
 * @returns {WorkspaceTemplate[]}
 */
export function getTemplatesByCategory(category) {
  const all = Object.values(WORKSPACE_TEMPLATES);
  if (!category) return all;
  return all.filter(t => t.category === category || t.category === 'both');
}

/**
 * Get templates filtered by kind.
 * @param {'home'|'market-screen'|null} kind - null for all
 * @returns {WorkspaceTemplate[]}
 */
export function getTemplatesByKind(kind) {
  const all = Object.values(WORKSPACE_TEMPLATES);
  if (!kind) return all;
  return all.filter(t => t.kind === kind);
}

/**
 * Get market screens visible in mobile home gallery.
 * Sector screens are now standalone components — this returns empty.
 * @returns {WorkspaceTemplate[]}
 */
export function getMobileHomeScreens() {
  return [];
}

/**
 * Get templates grouped by their `group` field.
 * @param {'onboarding'|'layout'|'both'|null} category - optional filter
 * @returns {Object<string, WorkspaceTemplate[]>}
 */
export function getTemplatesGrouped(category) {
  const templates = category ? getTemplatesByCategory(category) : Object.values(WORKSPACE_TEMPLATES);
  const groups = {};
  for (const t of templates) {
    const g = t.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(t);
  }
  return groups;
}

/**
 * Get a flat list of template summaries for UI rendering.
 * @param {'onboarding'|'layout'|'both'|null} category
 * @returns {Array<{id: string, label: string, description: string, focus: string, group: string}>}
 */
export function getTemplateList(category) {
  const templates = category ? getTemplatesByCategory(category) : Object.values(WORKSPACE_TEMPLATES);
  return templates.map(t => ({
    id:          t.id,
    label:       t.label,
    description: t.description,
    focus:       t.focus,
    group:       t.group,
  }));
}

// Legacy compatibility — re-export as SCREEN_PRESETS for gradual migration
export const SCREEN_PRESETS = WORKSPACE_TEMPLATES;
