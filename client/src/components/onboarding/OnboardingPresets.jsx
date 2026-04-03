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
  const [step,     setStep]     = useState('persona'); // 'persona' | 'workspace'
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const options = useMemo(() =>
    getTemplatesByCategory('onboarding').map(t => ({
      key:         t.id,
      title:       t.label,
      description: t.description,
      includes:    t.focus,
      panels:      t.panels ? Object.keys(t.panels) : [],
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
    await completeOnboarding();
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
    // Always advance to workspace selection after persona
    setStep('workspace');
  };

  // Step 1: Persona selector (mandatory — shown first)
  if (step === 'persona') {
    return <PersonaSelector onSelect={handlePersonaSelected} />;
  }

  // Step 2: Workspace picker
  return (
    <div className="obp-container">
      <div className="obp-header">
        <div className="obp-header-label">SENGER MARKET TERMINAL</div>
        <div className="obp-header-title">Choose your starting workspace</div>
        <div className="obp-header-subtitle">You can customize everything later.</div>
      </div>

      <div className="obp-grid">
        {options.map(({ key, title, description, includes, panels }) => {
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
              {panels && panels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '6px' }}>
                  {panels.slice(0, 6).map((p, i) => (
                    <span key={i} style={{ fontSize: '8px', padding: '1px 4px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <button onClick={() => setShowSkipConfirm(true)} disabled={loading} className="obp-skip-btn">
        {loading ? 'SETTING UP...' : 'SKIP — USE DEFAULTS'}
      </button>

      {showSkipConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 24, maxWidth: 320, textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: '0 0 12px' }}>Skip workspace setup?</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px' }}>You can always change your layout later in Settings.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setShowSkipConfirm(false)} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => { setShowSkipConfirm(false); skip(); }} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, background: 'var(--accent)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Skip anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
