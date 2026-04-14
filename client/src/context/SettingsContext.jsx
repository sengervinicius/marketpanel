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

// Default settings (mirrors server defaultSettings())
function defaultSettings() {
  return {
    theme: 'dark',
    onboardingCompleted: false,
    particleOnboarded: true, // Arrival screen removed — always mark as onboarded
    termsAccepted: false,
    defaultStartTab: 'home',
    watchlist: [],
    panels: {
      brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'] },
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRK-B','VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ'] },
      globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','FXI'] },
      forex:        { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'], hiddenSubsections: ['crypto'] },
      crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD'] },
      commodities:  { title: 'Commodities',    symbols: ['BZ=F','GLD','SLV','USO','UNG'] },
      debt:         { title: 'Debt Markets',   symbols: ['US10Y','US2Y','BR10Y','DE10Y'] },
    },
    layout: DEFAULT_LAYOUT,
    home: { sections: DEFAULT_HOME_SECTIONS },
    charts: DEFAULT_CHARTS_CONFIG,
  };
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
          const s = data.settings || {};
          setSettingsState({
            ...defaults,
            ...s,
            panels:  { ...defaults.panels,  ...(s.panels  || {}) },
            layout:  { ...defaults.layout,  ...(s.layout  || {}) },
            home:    { ...defaults.home,    ...(s.home    || {}) },
            charts:  { ...defaults.charts,  ...(s.charts  || {}) },
          });
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
