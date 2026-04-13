/**
 * OnboardingTourOverlay.jsx
 * 5-step product tour shown after onboarding completes.
 */
import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import './OnboardingTourOverlay.css';

const STEPS = [
  {
    id: 'welcome',
    title: 'WELCOME',
    body: 'Welcome to Particle. A Bloomberg-grade terminal built for real investors.',
  },
  {
    id: 'charts',
    title: 'CHARTS',
    body: 'The 4x4 chart grid. Drag tickers from any panel to add them.',
  },
  {
    id: 'search',
    title: 'SEARCH & AI',
    body: 'Type any ticker or question. AI research summaries appear automatically.',
  },
  {
    id: 'detail',
    title: 'IN-DEPTH',
    body: 'Click any ticker to open the full detail view: chart, fundamentals, news.',
  },
  {
    id: 'workspace',
    title: 'WORKSPACE',
    body: 'Use the workspace switcher to switch between pre-built trading setups.',
  },
];

export default function OnboardingTourOverlay({ isMobile }) {
  const { markTourCompleted } = useSettings();
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleComplete = async () => {
    await markTourCompleted();
  };

  // Adjust copy for mobile
  const bodyText = isMobile && current.id === 'charts'
    ? 'Open the Charts tab to see a full interactive chart. Tap any ticker to view it.'
    : isMobile && current.id === 'workspace'
    ? 'Open More > Workspace to switch between pre-built trading setups.'
    : current.body;

  return (
    <div className="tour-backdrop">
      <div className="tour-card">
        {/* Step indicator */}
        <div className="tour-step-label">
          STEP {step + 1} OF {STEPS.length}
        </div>

        <div className="tour-title">{current.title}</div>
        <div className="tour-body">{bodyText}</div>

        {/* Dots */}
        <div className="tour-dots">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`tour-dot ${i === step ? 'tour-dot--active' : ''}`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="tour-actions">
          <button className="tour-next-btn" onClick={handleNext}>
            {isLast ? 'GET STARTED' : 'NEXT \u2192'}
          </button>
          {!isLast && (
            <button className="tour-skip-btn" onClick={handleComplete}>
              Skip for now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
