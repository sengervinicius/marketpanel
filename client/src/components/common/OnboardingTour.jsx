/**
 * OnboardingTour.jsx
 * A 5-step interactive tour for new Senger Market Terminal users.
 *
 * Uses react-joyride to guide users through:
 * 1. Welcome to Senger Market Terminal
 * 2. Home screen layout (charts, watchlist, market data panels)
 * 3. Click any ticker to open InstrumentDetail
 * 4. Sector Screens for thematic analysis
 * 5. AI-powered search functionality
 */

import { useState, useCallback } from 'react';
import Joyride from 'react-joyride';
import { useSettings } from '../../context/SettingsContext';

export default function OnboardingTour() {
  const { settings, markTourCompleted } = useSettings();
  const [runTour, setRunTour] = useState(!settings?.onboardingCompleted);
  const [tourStepIndex, setTourStepIndex] = useState(0);

  const steps = [
    {
      target: 'body',
      content: 'Welcome to Senger Market Terminal! Let me show you around your powerful trading dashboard.',
      title: 'Welcome to Senger',
      placement: 'center',
      disableBeacon: true,
    },
    {
      target: '.app-header-bar',
      content: 'This is your control center. You can see the market status, access sector screens, and manage your layout from here.',
      title: 'Header & Controls',
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '.display-contents',
      content: 'Your customizable workspace is here! Each panel shows market data, charts, watchlists, and more. Click on any ticker symbol to dive deep into that instrument.',
      title: 'Your Workspace',
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '.app-header-bar button',
      content: 'Click here to explore Sector Screens - deep-dive into Defence, Tech, Commodities, and other thematic markets.',
      title: 'Sector Screens',
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '.app-search-strip',
      content: 'Use the AI-powered search bar to find tickers, ask questions about markets, or get insights. Type a company name, ticker, or your market question.',
      title: 'Smart Search',
      placement: 'bottom',
      disableBeacon: true,
    },
  ];

  const handleJoyrideCallback = useCallback(async (data) => {
    const { action, index, type, status } = data;

    // When tour is finished or skipped
    if (status === 'finished' || status === 'skipped') {
      setRunTour(false);
      await markTourCompleted();
    }

    // Update step index
    if (type === 'step:after') {
      setTourStepIndex(index + 1);
    }
  }, [markTourCompleted]);

  if (!runTour) {
    return null;
  }

  return (
    <Joyride
      steps={steps}
      run={runTour}
      stepIndex={tourStepIndex}
      continuous={true}
      showSkipButton={true}
      showProgress={true}
      scrollToFirstStep={true}
      disableCloseOnEsc={false}
      callback={handleJoyrideCallback}
      styles={{
        options: {
          backgroundColor: '#1a1a1a',
          textColor: '#e8e8e8',
          primaryColor: '#ff6600',
          zIndex: 10000,
        },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderRadius: '8px',
          color: '#e8e8e8',
          fontSize: '14px',
          padding: '16px',
          border: '1px solid #333333',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        tooltipTitle: {
          fontSize: '16px',
          fontWeight: 600,
          marginBottom: '8px',
          color: '#ff6600',
        },
        tooltipContent: {
          fontSize: '13px',
          lineHeight: '1.5',
          color: '#b0b0b0',
        },
        buttonNext: {
          backgroundColor: '#ff6600',
          color: '#000',
          fontSize: '13px',
          fontWeight: 600,
          padding: '8px 20px',
          borderRadius: '4px',
          border: 'none',
          cursor: 'pointer',
          marginRight: '8px',
          transition: 'all 200ms ease-out',
        },
        buttonSkip: {
          color: '#666666',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          border: 'none',
          background: 'none',
          padding: '8px 0',
        },
        beacon: {
          backgroundColor: '#ff6600',
          color: '#ff6600',
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip Tour',
      }}
    />
  );
}
