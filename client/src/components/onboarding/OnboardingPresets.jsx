/**
 * OnboardingPresets.jsx
 * First-login flow: workspace picker → persona selector.
 * Only shown once (settings.onboardingCompleted = false).
 */

import { useState, useMemo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { getTemplatesByCategory } from '../../config/templates';
import PersonaSelector from './PersonaSelector';
import './OnboardingPresets.css';

export default function OnboardingPresets() {
  const { applyTemplate, completeOnboarding } = useSettings();
  const { user, setUser, triggerGamificationEvent } = useAuth();
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [step,     setStep]     = useState('workspace'); // 'workspace' | 'persona'

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
    try {
      await applyTemplate(key, 'full');
      triggerGamificationEvent('apply_workspace');
    } catch {}
    setLoading(false);
    // Advance to persona selection if user hasn't picked one
    if (!user?.persona?.type) {
      setStep('persona');
    } else {
      await completeOnboarding();
    }
  };

  const skip = async () => {
    if (loading) return;
    setLoading(true);
    try { await completeOnboarding(); } catch {}
    setLoading(false);
  };

  const handlePersonaSelected = async (personaType) => {
    if (personaType) {
      setUser(prev => prev ? { ...prev, persona: { ...prev.persona, type: personaType } } : prev);
      triggerGamificationEvent('select_persona');
    }
    await completeOnboarding();
  };

  // Step 2: Persona selector
  if (step === 'persona') {
    return <PersonaSelector onSelect={handlePersonaSelected} />;
  }

  // Step 1: Workspace picker
  return (
    <div className="obp-container">
      <div className="obp-header">
        <div className="obp-header-label">SENGER MARKET TERMINAL</div>
        <div className="obp-header-title">Choose your starting workspace</div>
        <div className="obp-header-subtitle">You can customize everything later.</div>
      </div>

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
                <div className="obp-card-title">{title}</div>
                <div className="obp-card-radio">
                  {active && <div className="obp-card-radio-inner" />}
                </div>
              </div>
              <div className="obp-card-description">{description}</div>
              <div className="obp-card-includes">INCLUDES: {includes}</div>
            </button>
          );
        })}
      </div>

      <button onClick={skip} disabled={loading} className="obp-skip-btn">
        {loading ? 'SETTING UP...' : 'SKIP — USE DEFAULTS'}
      </button>
    </div>
  );
}
