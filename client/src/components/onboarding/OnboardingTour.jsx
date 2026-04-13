/**
 * OnboardingTour.jsx — 5-step guided overlay tour for first-time users
 * Shows after workspace selection, guides users through key features.
 * Only shows once per user (tracked via localStorage).
 */
import { useState, useEffect, useCallback, memo } from 'react';
import './OnboardingTour.css';

const TOUR_STEPS = [
  {
    id: 'drag-panels',
    title: 'Drag & Drop Panels',
    description: 'Drag any panel to rearrange your workspace. Build the layout that works for you.',
    target: '.app-grid', // CSS selector for highlight
    position: 'center',
  },
  {
    id: 'search-bar',
    title: 'Search Everything',
    description: 'Search for any stock, ETF, currency, or crypto. Click a result to see full details.',
    target: '.sp-search-input, .m-search',
    position: 'below',
  },
  {
    id: 'portfolio',
    title: 'Your Portfolio',
    description: 'Track your real portfolio or practice with virtual money. See P&L, allocation, and AI insights.',
    target: '[data-panel="portfolio"], .pp-container',
    position: 'center',
  },
  {
    id: 'ai-chat',
    title: 'AI Assistant',
    description: 'Ask our AI anything about markets — earnings, analysis, strategy, or just "Why is AAPL moving?"',
    target: '[data-panel="chat"], .cp-container',
    position: 'center',
  },
  {
    id: 'settings',
    title: 'Customize & Configure',
    description: 'Set up data sources, alert preferences, and your profile in Settings.',
    target: '.app-settings-btn, .m-tab-settings',
    position: 'above',
  },
];

const STORAGE_KEY = 'particle_onboarding_complete';

function OnboardingTour({ onComplete }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Migrate legacy key
  try { const v = localStorage.getItem('senger_onboarding_complete'); if (v !== null) { localStorage.setItem('particle_onboarding_complete', v); localStorage.removeItem('senger_onboarding_complete'); } } catch {}
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    // Check if tour was already completed
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') return;
    } catch { /* storage unavailable */ }

    // Small delay to let the app render first
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  // Find and measure the target element for the current step
  useEffect(() => {
    if (!visible) return;
    const currentStep = TOUR_STEPS[step];
    if (!currentStep) return;

    const selectors = currentStep.target.split(', ');
    let el = null;
    for (const sel of selectors) {
      el = document.querySelector(sel.trim());
      if (el) break;
    }

    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [step, visible]);

  const handleNext = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  const handleFinish = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    onComplete?.();
  }, [onComplete]);

  if (!visible) return null;

  const currentStep = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div className="tour-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleNext(); }}>
      {/* Highlight ring around target element */}
      {targetRect && (
        <div
          className="tour-highlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* Tooltip card */}
      <div className="tour-card">
        {/* Step indicator dots */}
        <div className="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`tour-dot${i === step ? ' tour-dot--active' : ''}${i < step ? ' tour-dot--done' : ''}`}
            />
          ))}
        </div>

        <div className="tour-step-number">
          Step {step + 1} of {TOUR_STEPS.length}
        </div>

        <h3 className="tour-title">{currentStep.title}</h3>
        <p className="tour-description">{currentStep.description}</p>

        <div className="tour-actions">
          <button className="tour-skip-btn" onClick={handleFinish}>
            Skip tour
          </button>
          <div className="tour-nav">
            {step > 0 && (
              <button className="tour-back-btn" onClick={handleBack}>
                Back
              </button>
            )}
            <button className="tour-next-btn" onClick={handleNext}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Restart the tour (called from Settings)
 */
export function restartOnboardingTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default memo(OnboardingTour);
