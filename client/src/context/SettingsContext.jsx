/**
 * SettingsContext.jsx
 * Per-user settings loaded from /api/settings. Provides helpers for updating
 * individual settings fields and panel configs.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { SCREEN_PRESETS } from '../config/presets';
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from '../config/panels';

const SettingsContext = createContext(null);

// Default settings (mirrors server defaultSettings())
function defaultSettings() {
  return {
    theme: 'dark',
    onboardingCompleted: false,
    defaultStartPage: '/',
    watchlist: [],
    panels: {
      brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'] },
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ'] },
      globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','FXI'] },
      forex:        { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
      crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD'] },
      commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG'] },
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
    const preset = SCREEN_PRESETS[presetKey];
    if (!preset) return;
    const partial = {
      panels:              preset.panels  || {},
      watchlist:           preset.watchlist || [],
      theme:               preset.theme   || 'dark',
      layout:              preset.layout  || DEFAULT_LAYOUT,
      home:                preset.home    || { sections: DEFAULT_HOME_SECTIONS },
      charts:              preset.charts  || DEFAULT_CHARTS_CONFIG,
      onboardingCompleted: true,
    };
    // Persist defaultStartPage if the preset defines one
    if (preset.defaultStartPage) partial.defaultStartPage = preset.defaultStartPage;
    setSettingsState(prev => ({ ...prev, ...partial }));
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
      updateSettings, updatePanelConfig, applyPreset, completeOnboarding,
      updateLayout, updateHomeSection, addToHomeSection, updateChartsConfig,
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
