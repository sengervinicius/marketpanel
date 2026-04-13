/**
 * PricingModal.jsx — Full-screen tier selection overlay.
 *
 * Shows the three paid tiers with a monthly/annual toggle.
 * Calls startCheckout(tier, plan) when the user selects a tier.
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../../utils/api';
import './PricingModal.css';

const TIER_META = {
  new_particle: {
    popular: false,
    tagline: 'Essential intelligence',
    features: [
      { text: '50 vault documents', highlight: false },
      { text: '50 AI queries / day', highlight: false },
      { text: '10 deep analyses / day', highlight: false },
      { text: 'Basic morning brief', highlight: false },
      { text: 'Prediction markets (view)', highlight: false },
      { text: 'Central Vault read access', highlight: false },
    ],
  },
  dark_particle: {
    popular: true,
    tagline: 'Elevated intelligence',
    features: [
      { text: '250 vault documents', highlight: true },
      { text: '200 AI queries / day', highlight: true },
      { text: '50 deep analyses / day', highlight: true },
      { text: 'Full morning brief + vault enrichment', highlight: true },
      { text: 'Prediction market alerts', highlight: false },
      { text: 'Central Vault read access', highlight: false },
    ],
  },
  nuclear_particle: {
    popular: false,
    tagline: 'Unlimited intelligence',
    features: [
      { text: 'Unlimited vault documents', highlight: true },
      { text: 'Unlimited AI queries', highlight: true },
      { text: 'Unlimited deep analyses', highlight: true },
      { text: 'Full morning brief + behavioral profile', highlight: true },
      { text: 'Full prediction markets + custom tracking', highlight: true },
      { text: 'Central Vault suggest access', highlight: true },
      { text: 'Priority support', highlight: true },
    ],
  },
};

export default function PricingModal({ visible, onDismiss, onSelectTier, currentTier }) {
  const [tiers, setTiers] = useState(null);
  const [isAnnual, setIsAnnual] = useState(false);
  const [selected, setSelected] = useState('dark_particle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch tier data from server
  useEffect(() => {
    if (!visible) return;
    fetch(`${API_BASE}/api/billing/tiers`)
      .then(r => r.json())
      .then(data => {
        if (data.tiers) setTiers(data.tiers);
      })
      .catch(() => {
        // Use fallback tier data
        setTiers([
          { id: 'new_particle', label: 'New Particle', price: { monthly: 29, annual: 290 } },
          { id: 'dark_particle', label: 'Dark Particle', price: { monthly: 79, annual: 790 } },
          { id: 'nuclear_particle', label: 'Nuclear Particle', price: { monthly: 199, annual: 1990 } },
        ]);
      });
  }, [visible]);

  // Pre-select the next tier up from current
  useEffect(() => {
    if (currentTier === 'new_particle') setSelected('dark_particle');
    else if (currentTier === 'dark_particle') setSelected('nuclear_particle');
    else setSelected('dark_particle'); // default for trial/no-sub
  }, [currentTier]);

  const handleCheckout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await onSelectTier(selected, isAnnual ? 'annual' : 'monthly');
    } catch (err) {
      setError(err?.message || 'Could not start checkout.');
      setLoading(false);
    }
  }, [selected, isAnnual, onSelectTier]);

  if (!visible) return null;

  const tierList = tiers || [];

  return (
    <div className="pricing-overlay" onClick={onDismiss}>
      <div className="pricing-modal" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
        <button className="pricing-close" onClick={onDismiss} aria-label="Close">
          &#x2715;
        </button>

        {/* Header */}
        <div className="pricing-header">
          <div className="pricing-brand">PARTICLE</div>
          <div className="pricing-title">Choose your plan</div>
          <div className="pricing-subtitle">
            Real-time market data, AI insights, and deep analysis — all in one terminal.
          </div>
        </div>

        {/* Monthly / Annual toggle */}
        <div className="pricing-toggle-row">
          <span
            className={`pricing-toggle-label ${!isAnnual ? 'pricing-toggle-label--active' : ''}`}
            onClick={() => setIsAnnual(false)}
          >
            MONTHLY
          </span>
          <div
            className={`pricing-toggle ${isAnnual ? 'pricing-toggle--annual' : ''}`}
            onClick={() => setIsAnnual(prev => !prev)}
            role="switch"
            aria-checked={isAnnual}
          >
            <div className="pricing-toggle-knob" />
          </div>
          <span
            className={`pricing-toggle-label ${isAnnual ? 'pricing-toggle-label--active' : ''}`}
            onClick={() => setIsAnnual(true)}
          >
            ANNUAL
          </span>
          {isAnnual && <span className="pricing-save-badge">SAVE ~17%</span>}
        </div>

        {/* Tier cards */}
        <div className="pricing-grid">
          {tierList.map(tier => {
            const meta = TIER_META[tier.id] || {};
            const isSelected = selected === tier.id;
            const price = isAnnual ? tier.price.annual : tier.price.monthly;
            const monthlyEquiv = isAnnual ? Math.round(tier.price.annual / 12) : null;
            const isCurrent = currentTier === tier.id;

            return (
              <div
                key={tier.id}
                className={[
                  'pricing-card',
                  meta.popular ? 'pricing-card--popular' : '',
                  isSelected ? 'pricing-card--selected' : '',
                ].join(' ')}
                onClick={() => !isCurrent && setSelected(tier.id)}
              >
                {meta.popular && <div className="pricing-popular-tag">MOST POPULAR</div>}

                <div className="pricing-card-name">{tier.label}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 12, letterSpacing: '0.02em' }}>
                  {meta.tagline}
                </div>

                <div className="pricing-card-price">
                  <span className="pricing-card-amount">${price}</span>
                  <span className="pricing-card-period">/{isAnnual ? 'yr' : 'mo'}</span>
                </div>
                {isAnnual && monthlyEquiv && (
                  <div className="pricing-card-annual-note">
                    ${monthlyEquiv}/mo billed annually
                  </div>
                )}
                {!isAnnual && (
                  <div className="pricing-card-annual-note">
                    billed monthly
                  </div>
                )}

                <div className="pricing-card-divider" />

                <ul className="pricing-card-features">
                  {(meta.features || []).map((feat, i) => (
                    <li
                      key={i}
                      className={`pricing-card-feature ${feat.highlight ? 'pricing-card-feature--highlight' : ''}`}
                    >
                      {feat.text}
                    </li>
                  ))}
                </ul>

                {isCurrent && (
                  <div style={{
                    marginTop: 14, textAlign: 'center',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    color: 'var(--color-text-muted)',
                  }}>
                    CURRENT PLAN
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && <div className="pricing-error">{error}</div>}

        {/* CTA */}
        <div className="pricing-cta-row">
          <button
            className="pricing-cta"
            onClick={handleCheckout}
            disabled={loading || selected === currentTier}
          >
            {loading
              ? 'SETTING UP...'
              : selected === currentTier
                ? 'CURRENT PLAN'
                : `SUBSCRIBE TO ${(tierList.find(t => t.id === selected)?.label || 'PLAN').toUpperCase()}`
            }
          </button>
          <button className="pricing-dismiss" onClick={onDismiss}>
            {currentTier && currentTier !== 'trial' ? 'Keep current plan' : 'Continue with free trial'}
          </button>
          <div className="pricing-fine-print">
            Cancel anytime. Secure payment via Stripe.
          </div>
        </div>
      </div>
    </div>
  );
}
