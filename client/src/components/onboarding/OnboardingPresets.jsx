/**
 * OnboardingPresets.jsx
 * First-login workspace picker. Professional 6-card grid.
 * Only shown once (settings.onboardingCompleted = false).
 * Now reads from the unified WORKSPACE_TEMPLATES registry.
 */

import { useState, useMemo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { getTemplatesByCategory } from '../../config/templates';
import './OnboardingPresets.css';

export default function OnboardingPresets() {
  const { applyTemplate, completeOnboarding } = useSettings();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);

  // Only show onboarding-category templates
  const options = useMemo(() =>
    getTemplatesByCategory('onboarding').map(t => ({
      key:         t.id,
      title:       t.label,
      description: t.description,
      includes:    t.focus,
    })),
  []);

  const pick = async (key) => {
    if (loading) return;
    setSelected(key);
    setLoading(true);
    try { await applyTemplate(key, 'full'); } catch {}
    setLoading(false);
  };

  const skip = async () => {
    if (loading) return;
    setLoading(true);
    try { await completeOnboarding(); } catch {}
    setLoading(false);
  };

  return (
    <div className="obp-container">

      {/* Header */}
      <div className="obp-header">
        <div className="obp-header-label">
          SENGER MARKET TERMINAL
        </div>
        <div className="obp-header-title">
          Choose your starting workspace
        </div>
        <div className="obp-header-subtitle">
          You can customize everything later.
        </div>
      </div>

      {/* Cards — 2 columns on desktop, 1 on mobile */}
      <div className="obp-grid">
        {options.map(({ key, title, description, includes }) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => pick(key)}
              disabled={loading}
              className={`obp-card ${active ? 'obp-card-active' : ''}`}
            >
              <div className="obp-card-header">
                <div className="obp-card-title">
                  {title}
                </div>
                <div className="obp-card-radio">
                  {active && <div className="obp-card-radio-inner" />}
                </div>
              </div>
              <div className="obp-card-description">
                {description}
              </div>
              <div className="obp-card-includes">
                INCLUDES: {includes}
              </div>
            </button>
          );
        })}
      </div>

      {/* Skip */}
      <button
        onClick={skip}
        disabled={loading}
        className="obp-skip-btn"
      >
        {loading ? 'SETTING UP...' : 'SKIP — USE DEFAULTS'}
      </button>

    </div>
  );
}
