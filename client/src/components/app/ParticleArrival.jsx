/**
 * ParticleArrival.jsx — First-launch arrival sequence for the Particle screen.
 *
 * A cinematic 3-step intro shown once on first login:
 *   Step 0: Logo fade-in with breathing + "Welcome to Particle"
 *   Step 1: "Your AI market assistant" — explains the Particle screen
 *   Step 2: "The Terminal is still here" — explains the 2-state toggle
 *   → Dismiss to start using the app
 *
 * Controlled by settings.particleOnboarded. Once dismissed, never shows again.
 */
import { useState, useEffect, useCallback } from 'react';
import ParticleLogo from '../ui/ParticleLogo';
import './ParticleArrival.css';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Particle',
    body: 'A new way to experience markets — powered by AI.',
  },
  {
    id: 'ai',
    title: 'Ask anything',
    body: 'Type a question in the search bar and Particle will give you real-time market intelligence. Try "What\'s moving today?" to get started.',
  },
  {
    id: 'terminal',
    title: 'Terminal mode',
    body: 'All your charts, portfolio, and data are one tap away. Switch between Particle and Terminal using the bottom bar.',
  },
];

export default function ParticleArrival({ onComplete }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Fade in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const advance = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      // Exit animation, then call onComplete
      setExiting(true);
      setTimeout(() => onComplete?.(), 400);
    }
  }, [step, onComplete]);

  const skip = useCallback(() => {
    setExiting(true);
    setTimeout(() => onComplete?.(), 400);
  }, [onComplete]);

  const current = STEPS[step];

  return (
    <div
      className="pa-overlay"
      style={{ opacity: visible && !exiting ? 1 : 0 }}
      onClick={advance}
    >
      <div className="pa-content" onClick={e => e.stopPropagation()}>
        {/* Logo with glow */}
        <div className="pa-logo-wrap" style={{
          transform: step === 0 ? 'scale(1)' : 'scale(0.7)',
          opacity: step === 0 ? 1 : 0.6,
          transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <ParticleLogo size={step === 0 ? 80 : 48} glow />
        </div>

        {/* Step content */}
        <div className="pa-step" key={current.id}>
          <h2 className="pa-title">{current.title}</h2>
          <p className="pa-body">{current.body}</p>
        </div>

        {/* Step indicator dots */}
        <div className="pa-dots">
          {STEPS.map((_, i) => (
            <span key={i} className={`pa-dot${i === step ? ' pa-dot--active' : ''}`} />
          ))}
        </div>

        {/* Actions */}
        <div className="pa-actions">
          <button className="pa-btn-primary" onClick={advance}>
            {step < STEPS.length - 1 ? 'Next' : 'Get started'}
          </button>
          {step < STEPS.length - 1 && (
            <button className="pa-btn-skip" onClick={skip}>
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
