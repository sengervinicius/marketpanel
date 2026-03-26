/**
 * SettingsContext.jsx
 * Per-user settings loaded from /api/settings. Provides helpers for updating
 * individual settings fields and panel configs.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { SCREEN_PRESETS } from '../config/presets';

const SettingsContext = createContext(null);

// Default settings (mirrors server defaultSettings())
function defaultSettings() {
  return {
    theme: 'dark',
    onboardingCompleted: false,
    watchlist: [],
    panels: {
      brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA'] },
      usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM'] },
      globalIndices:{ title: 'Global Indices', symbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','FXI'] },
      forex:        { title: 'FX',             symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL'] },
      crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD'] },
      commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG'] },
      debt:         { title: 'Debt Markets',   symbols: ['US10Y','US2Y','BR10Y','DE10Y'] },
    },
    layout: {},
  };
}

export function SettingsProvider({ children, isAuthenticated }) {
  const [settings, setSettingsState] = useState(defaultSettings);
  const [subscription, setSubscription] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Load from server when user logs in
  useEffect(() => {
    if (!isAuthenticated) {
      setSettingsState(defaultSettings());
      setLoaded(true);
      return;
    }
    apiFetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          setSettingsState({ ...defaultSettings(), ...data.settings });
        }
        if (data.subscription) setSubscription(data.subscription);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [isAuthenticated]);

  const persistSettings = useCallback(async (partial) => {
    if (!isAuthenticated) return;
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        body: JSON.stringify(partial),
      });
    } catch {}
  }, [isAuthenticated]);

  const updateSettings = useCallback(async (partial) => {
    setSettingsState(prev => {
      const next = { ...prev, ...partial };
      if (partial.panels) {
        next.panels = { ...prev.panels, ...partial.panels };
      }
      return next;
    });
    await persistSettings(partial);
  }, [persistSettings]);

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
      panels: preset.panels,
      watchlist: preset.watchlist || [],
      theme: preset.theme || 'dark',
      onboardingCompleted: true,
    };
    setSettingsState(prev => ({ ...prev, ...partial }));
    await persistSettings(partial);
  }, [persistSettings]);

  const completeOnboarding = useCallback(async () => {
    await updateSettings({ onboardingCompleted: true });
  }, [updateSettings]);

  return (
    <SettingsContext.Provider value={{
      settings, subscription, loaded,
      updateSettings, updatePanelConfig, applyPreset, completeOnboarding,
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
