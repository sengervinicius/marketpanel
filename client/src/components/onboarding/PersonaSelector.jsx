/**
 * PersonaSelector.jsx
 * Horizontal-scroll carousel of investor persona cards.
 * Shown during onboarding as the FIRST mandatory step.
 */
import { useState, useRef, useEffect } from 'react';
import { PERSONAS, getAvatarSrc } from '../../config/avatars';
import { apiFetch } from '../../utils/api';
import './PersonaSelector.css';

export default function PersonaSelector({ onSelect, onBack }) {
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const scrollRef = useRef(null);

  // Auto-scroll to center the selected card
  useEffect(() => {
    if (!selected || !scrollRef.current) return;
    const idx = PERSONAS.findIndex(p => p.type === selected);
    const card = scrollRef.current.children[idx];
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selected]);

  const handleConfirm = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/users/persona', {
        method: 'PATCH',
        body: JSON.stringify({ type: selected }),
      });
      if (!res.ok) throw new Error('Failed to save persona');
      onSelect?.(selected);
    } catch (e) {
      setError(e.message || 'Failed to save persona');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ps-container">
      <div className="ps-header">
        {onBack && (
          <button className="ps-back-btn" onClick={onBack}
            style={{ position: 'absolute', top: 12, left: 12, background: 'none', border: 'none', color: 'var(--accent, #ff6600)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', padding: '4px 8px' }}>
            ← Back
          </button>
        )}
        <div className="ps-header-label">PARTICLE</div>
        <div className="ps-header-title">Who are you on the Street?</div>
        <div className="ps-header-subtitle">Pick your investor persona. This sets your avatar and vibe.</div>
      </div>

      {/* Horizontal scroll carousel */}
      <div className="ps-carousel" ref={scrollRef}>
        {PERSONAS.map(p => {
          const src = getAvatarSrc(p.type);
          const isActive = selected === p.type;
          return (
            <button
              key={p.type}
              className={`ps-card ${isActive ? 'ps-card--active' : ''}`}
              onClick={() => setSelected(p.type)}
              disabled={loading}
            >
              <div className="ps-card-avatar" style={{ borderColor: isActive ? p.color : 'transparent' }}>
                {src
                  ? <img src={src} alt={p.label} className="ps-card-img" />
                  : <span className="ps-card-badge" style={{ background: p.color }}>{p.badge}</span>}
              </div>
              <div className="ps-card-label">{p.label}</div>
              <div className="ps-card-desc">{p.description}</div>
            </button>
          );
        })}
      </div>

      {error && <div className="ps-error">{error}</div>}

      <div className="ps-actions">
        <button
          className="ps-confirm-btn"
          disabled={!selected || loading}
          onClick={handleConfirm}
        >
          {loading ? 'SAVING...' : selected ? `I'M A ${PERSONAS.find(p => p.type === selected)?.label.toUpperCase() || ''}` : 'SELECT A PERSONA'}
        </button>
      </div>
    </div>
  );
}
