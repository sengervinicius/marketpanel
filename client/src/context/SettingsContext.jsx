/**
 * SettingsContext.jsx
 * Per-user settings loaded from /api/settings. Provides helpers for updating
 * individual settings fields and panel configs.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { WORKSPACE_TEMPLATES, SCREEN_PRESETS, getTemplate } from '../config/templates';
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from '../config/panels';

const SettingsContext = createContext(null);

// ── Canonical CIO-spec default symbol lists ────────────────────────
// These MUST match PANEL_DEFINITIONS in config/panels.js. They are the
// single source of truth for default symbols. The settings migration
// below compares saved user settings against these lists and back-fills
// any CIO-mandated symbol that has silently disappeared (typical cause:
// an older deploy's defaults were persisted, then we added GBPBRL or
// SOYB/CPER/BHP to the canon, but the user's row never got them).
//
// NOTE: a user who explicitly removed a symbol via PanelConfigModal
// sees it come back once after the migration flag flips — this is a
// known tradeoff. Post-migration, their removals are respected.
const CIO_FOREX_DEFAULTS = [
  'EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD',
  'USDBRL','EURBRL','GBPBRL',
  'USDCNY','USDMXN',
  'BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD',
];
const CIO_COMMODITIES_DEFAULTS = [
  'BZ=F','GLD','SLV','USO','UNG',
  'CORN','WEAT','SOYB','CPER','BHP',
];
const CIO_BRAZIL_DEFAULTS = [
  'VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA',
  'B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA',
];

// Default settings (mirrors server defaultSettings()).
// Keep in sync with server/authStore.js defaultSettings() and with
// config/panels.js PANEL_DEFINITIONS.
function defaultSettings() {
  return {
    theme: 'dark',
    onboardingCompleted: false,
    particleOnboarded: true, // Arrival screen removed — always mark as onboarded
    termsAccepted: false,
    defaultStartTab: 'home',
    watchlist: [],
    // Bumped when we add a new CIO-mandated ticker to defaults; the
    // migration below uses this version to decide whether to back-fill.
    settingsVersion: 2,
    panels: {
      brazilB3:     { title: 'Brazil B3',      symbols: [...CIO_BRAZIL_DEFAULTS] },
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRK-B','GS','WMT','LLY'] },
      globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'] },
      forex:        { title: 'FX Rates / Crypto', symbols: [...CIO_FOREX_DEFAULTS] },
      crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'] },
      commodities:  { title: 'Commodities',    symbols: [...CIO_COMMODITIES_DEFAULTS] },
      debt:         { title: 'Yields & Rates', symbols: [] },
    },
    layout: DEFAULT_LAYOUT,
    home: { sections: DEFAULT_HOME_SECTIONS },
    charts: DEFAULT_CHARTS_CONFIG,
  };
}

/**
 * One-shot back-fill: if a user's saved settings are missing any
 * CIO-mandated symbol (e.g. GBPBRL was added to the forex default
 * after the user's last save), insert the missing symbols into the
 * user's saved list at a sensible position. Also drops the legacy
 * "ADDED" custom subsection that was created by drop-to-panel — those
 * tickers are merged into the main symbols list instead.
 *
 * Safe because we bump `settingsVersion` afterwards, so repeated opens
 * don't keep re-adding things the user explicitly removes.
 *
 * @param {object} saved — the settings returned from /api/settings
 * @returns {{ settings: object, migrated: boolean }}
 */
function migrateLegacySettings(saved) {
  if (!saved || typeof saved !== 'object') return { settings: saved, migrated: false };
  if (saved.settingsVersion >= 2) return { settings: saved, migrated: false };

  const next = { ...saved, panels: { ...(saved.panels || {}) } };
  let changed = false;

  // ── Forex back-fill + drop ADDED bucket ────────────────────────
  const fx = next.panels.forex;
  if (fx && typeof fx === 'object') {
    const cur = Array.isArray(fx.symbols) ? [...fx.symbols] : [];
    let fxSymbols = cur;
    const missing = CIO_FOREX_DEFAULTS.filter(s => !cur.includes(s));
    if (missing.length) {
      // Preserve user ordering; append missing CIO defaults at the end
      // of the FX block (before any crypto). For simplicity: append.
      fxSymbols = [...cur, ...missing];
      changed = true;
    }

    // Merge legacy "ADDED" custom subsection symbols into main list.
    let customSubs = Array.isArray(fx.customSubsections) ? fx.customSubsections : [];
    const legacyDropped = customSubs.find(s => s && s.key === 'custom-dropped');
    if (legacyDropped && Array.isArray(legacyDropped.symbols) && legacyDropped.symbols.length > 0) {
      for (const sym of legacyDropped.symbols) {
        // Strip any "C:" / "X:" polygon prefixes for the FX symbols list.
        const clean = String(sym).replace(/^(C:|X:)/, '');
        if (!fxSymbols.includes(clean)) fxSymbols.push(clean);
      }
      customSubs = customSubs.filter(s => s && s.key !== 'custom-dropped');
      next.panels.forex = { ...fx, symbols: fxSymbols, customSubsections: customSubs };
      changed = true;
    } else if (changed) {
      next.panels.forex = { ...fx, symbols: fxSymbols };
    }
  }

  // ── Commodities back-fill + drop ADDED bucket ──────────────────
  const cmd = next.panels.commodities;
  if (cmd && typeof cmd === 'object') {
    const cur = Array.isArray(cmd.symbols) ? [...cmd.symbols] : [];
    let cmdSymbols = cur;
    const missing = CIO_COMMODITIES_DEFAULTS.filter(s => !cur.includes(s));
    if (missing.length) {
      cmdSymbols = [...cur, ...missing];
      changed = true;
    }

    let customSubs = Array.isArray(cmd.customSubsections) ? cmd.customSubsections : [];
    const legacyDropped = customSubs.find(s => s && s.key === 'custom-dropped');
    if (legacyDropped && Array.isArray(legacyDropped.symbols) && legacyDropped.symbols.length > 0) {
      for (const sym of legacyDropped.symbols) {
        if (!cmdSymbols.includes(sym)) cmdSymbols.push(sym);
      }
      customSubs = customSubs.filter(s => s && s.key !== 'custom-dropped');
      next.panels.commodities = { ...cmd, symbols: cmdSymbols, customSubsections: customSubs };
      changed = true;
    } else if (changed) {
      next.panels.commodities = { ...cmd, symbols: cmdSymbols };
    }
  }

  // ── Same for US equities / Brazil B3 custom-dropped bucket ─────
  for (const pid of ['usEquities', 'brazilB3']) {
    const p = next.panels[pid];
    if (!p || typeof p !== 'object') continue;
    const customSubs = Array.isArray(p.customSubsections) ? p.customSubsections : [];
    const legacy = customSubs.find(s => s && s.key === 'custom-dropped');
    if (!legacy || !Array.isArray(legacy.symbols) || legacy.symbols.length === 0) continue;
    const cur = Array.isArray(p.symbols) ? [...p.symbols] : [];
    for (const sym of legacy.symbols) {
      if (!cur.includes(sym)) cur.push(sym);
    }
    next.panels[pid] = {
      ...p,
      symbols: cur,
      customSubsections: customSubs.filter(s => s && s.key !== 'custom-dropped'),
    };
    changed = true;
  }

  next.settingsVersion = 2;
  return { settings: next, migrated: changed };
}

export function SettingsProvider({ children, isAuthenticated }) {
  const [settings, setSettingsState] = useState(defaultSettings);
  const [subscription, setSubscription] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const debounceTimerRef = useRef(null);

  // Load from server when user logs in
  useEffect(() => {
    let mounted = true;
    if (!isAuthenticated) {
      setSettingsState(defaultSettings());
      setLoaded(true);
      return;
    }
    apiFetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (!mounted) return;
        if (data.settings) {
          const defaults = defaultSettings();
          // One-shot back-fill: back-fills missing CIO-mandated symbols
          // (e.g. GBPBRL, SOYB, CPER, BHP) and drops the legacy
          // "ADDED" custom subsection that drop-to-panel used to
          // create. See migrateLegacySettings() above.
          const { settings: migrated, migrated: didMigrate } = migrateLegacySettings(data.settings || {});
          const s = migrated;
          const merged = {
            ...defaults,
            ...s,
            panels:  { ...defaults.panels,  ...(s.panels  || {}) },
            layout:  { ...defaults.layout,  ...(s.layout  || {}) },
            home:    { ...defaults.home,    ...(s.home    || {}) },
            charts:  { ...defaults.charts,  ...(s.charts  || {}) },
          };
          setSettingsState(merged);

          // Persist the migrated settings back to the server so the
          // user doesn't re-run the migration on every page load.
          // Fire-and-forget: we already rendered with the migrated
          // state, and the server is non-critical here.
          if (didMigrate) {
            apiFetch('/api/settings', {
              method: 'POST',
              body: JSON.stringify({
                panels: merged.panels,
                settingsVersion: merged.settingsVersion,
              }),
            }).catch(() => {});
          }

          // ── Hydrate localStorage from server for UI state continuity ──
          try {
            if (s.panelVisible)      localStorage.setItem('panelVisible_v1', JSON.stringify(s.panelVisible));
            if (s.sidebarCollapsed != null) localStorage.setItem('particleSidebarCollapsed', String(s.sidebarCollapsed));
            if (s.mobileMode)        localStorage.setItem('mobileMode', s.mobileMode);
            if (s.activeTab)         localStorage.setItem('activeTab_m3', s.activeTab);
            if (s.rowFlexSizes)      localStorage.setItem('rowFlexSizes_v2', JSON.stringify(s.rowFlexSizes));
            if (s.colSizes && typeof s.colSizes === 'object') {
              for (const [k, v] of Object.entries(s.colSizes)) {
                localStorage.setItem(k, JSON.stringify(v));
              }
            }
            if (Array.isArray(s.chartGrid) && s.chartGrid.length) {
              localStorage.setItem('chartGrid_v3', JSON.stringify(s.chartGrid));
            }
          } catch {}
        }
        if (data.subscription) setSubscription(data.subscription);
        setLoaded(true);
      })
      .catch(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, [isAuthenticated]);

  const persistSettings = useCallback(async (partial) => {
    if (!isAuthenticated) return;
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(partial),
      });
      setSettingsDirty(false);
    } catch {}
  }, [isAuthenticated]);

  // Debounced server save (500ms delay) to batch rapid setting changes
  const debouncedPersist = useCallback((partial) => {
    setSettingsDirty(true);
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      persistSettings(partial);
    }, 500);
  }, [persistSettings]);

  const updateSettings = useCallback(async (partial) => {
    setSettingsState(prev => {
      const next = { ...prev, ...partial };
      if (partial.panels)  next.panels = { ...prev.panels,  ...partial.panels };
      if (partial.layout)  next.layout = { ...prev.layout,  ...partial.layout };
      if (partial.home)    next.home   = { ...prev.home,    ...partial.home };
      if (partial.charts)  next.charts = { ...prev.charts,  ...partial.charts };
      return next;
    });
    debouncedPersist(partial);
  }, [debouncedPersist]);

  const updatePanelConfig = useCallback(async (panelId, cfg) => {
    setSettingsState(prev => ({
      ...prev,
      panels: { ...prev.panels, [panelId]: cfg },
    }));
    await persistSettings({ panels: { [panelId]: cfg } });
  }, [persistSettings]);

  const applyPreset = useCallback(async (presetKey) => {
    const preset = getTemplate(presetKey);
    if (!preset) return;
    const partial = {
      panels:              preset.panels  || {},
      watchlist:           preset.watchlist || [],
      theme:               preset.theme   || 'dark',
      layout:              preset.layout  || DEFAULT_LAYOUT,
      home:                preset.home    || { sections: DEFAULT_HOME_SECTIONS },
      charts:              preset.charts  || DEFAULT_CHARTS_CONFIG,
      onboardingCompleted: true,
      activeTemplate:      presetKey,
    };
    // Persist defaultStartTab if the preset defines one
    if (preset.defaultStartTab) partial.defaultStartTab = preset.defaultStartTab;
    setSettingsState(prev => ({ ...prev, ...partial }));
    await persistSettings(partial);
  }, [persistSettings]);

  /**
   * Apply a workspace template by ID. mode controls what gets overwritten:
   *   'full'   — overwrite panels, layout, home, charts, watchlist (default)
   *   'layout' — only overwrite layout + panels that the template defines
   */
  const applyTemplate = useCallback(async (templateId, mode = 'full') => {
    const template = getTemplate(templateId);
    if (!template) return;
    let partial;
    if (mode === 'layout') {
      partial = { activeTemplate: templateId };
      if (template.layout)  partial.layout  = template.layout;
      if (template.panels)  partial.panels  = template.panels;
      if (template.charts)  partial.charts  = template.charts;
    } else {
      partial = {
        panels:              template.panels    || {},
        watchlist:           template.watchlist  || [],
        theme:               template.theme     || 'dark',
        layout:              template.layout    || DEFAULT_LAYOUT,
        home:                template.home      || { sections: DEFAULT_HOME_SECTIONS },
        charts:              template.charts    || DEFAULT_CHARTS_CONFIG,
        onboardingCompleted: true,
        activeTemplate:      templateId,
      };
    }
    setSettingsState(prev => ({
      ...prev,
      ...partial,
      panels: { ...prev.panels, ...(partial.panels || {}) },
    }));
    await persistSettings(partial);
  }, [persistSettings]);

  const completeOnboarding = useCallback(async () => {
    await updateSettings({ onboardingCompleted: true });
  }, [updateSettings]);

  const updateLayout = useCallback(async (layout) => {
    await updateSettings({ layout });
  }, [updateSettings]);

  const updateHomeSection = useCallback(async (sections) => {
    await updateSettings({ home: { sections } });
  }, [updateSettings]);

  const addToHomeSectionTimeoutRef = useRef(null);

  const addToHomeSection = useCallback(async (symbol, title) => {
    let newSections;
    setSettingsState(prev => {
      const existing = prev.home?.sections || [];
      // Don't add duplicate
      if (existing.some(s => s.symbols?.includes(symbol))) return prev;
      const newSection = {
        id: symbol.toLowerCase().replace(/[^a-z0-9]/g, ''),
        title: title || symbol,
        symbols: [symbol]
      };
      newSections = [...existing, newSection];
      return { ...prev, home: { ...prev.home, sections: newSections } };
    });
    // Debounce: clear previous timeout and set a new one
    clearTimeout(addToHomeSectionTimeoutRef.current);
    addToHomeSectionTimeoutRef.current = setTimeout(async () => {
      if (newSections) {
        await debouncedPersist({ home: { sections: newSections } });
      }
    }, 300);
  }, [debouncedPersist]);

  const updateChartsConfig = useCallback(async (charts) => {
    await updateSettings({ charts });
  }, [updateSettings]);

  // ── Onboarding tour ──────────────────────────────────────────────────────
  // These use persistSettings (immediate) instead of debouncedPersist so the
  // critical one-time flags are saved to the server without a 500ms delay that
  // could be lost if the component unmounts or the user navigates away.
  const markTourCompleted = useCallback(async () => {
    setSettingsState(prev => ({ ...prev, onboardingCompleted: true }));
    await persistSettings({ onboardingCompleted: true });
  }, [persistSettings]);

  const acceptTerms = useCallback(async () => {
    setSettingsState(prev => ({ ...prev, termsAccepted: true }));
    await persistSettings({ termsAccepted: true });
  }, [persistSettings]);

  const completeParticleOnboarding = useCallback(async () => {
    setSettingsState(prev => ({ ...prev, particleOnboarded: true }));
    await persistSettings({ particleOnboarded: true });
  }, [persistSettings]);

  const resetTour = useCallback(async () => {
    await updateSettings({ onboardingCompleted: false });
  }, [updateSettings]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        // Fire the save immediately if there's a pending change
        if (settingsDirty) {
          persistSettings(settings);
        }
      }
    };
  }, [settingsDirty, settings, persistSettings]);

  return (
    <SettingsContext.Provider value={{
      settings, subscription, loaded, settingsDirty,
      updateSettings, updatePanelConfig, applyPreset, applyTemplate, completeOnboarding,
      updateLayout, updateHomeSection, addToHomeSection, updateChartsConfig,
      markTourCompleted, resetTour, acceptTerms, completeParticleOnboarding,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be inside SettingsProvider');
  return ctx;
};
