/**
 * PersonaSelector.jsx
 * Grid of investor persona cards. Shown during onboarding after workspace selection.
 */
import { useState } from 'react';
import { PERSONAS, getAvatarSrc } from '../../config/avatars';
import { apiFetch } from '../../utils/api';
import './PersonaSelector.css';

export default function PersonaSelector({ onSelect }) {
  const [selected, setSelected] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

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
        <div className="ps-header-label">SENGER MARKET TERMINAL</div>
        <div className="ps-header-title">Choose your investor persona</div>
        <div className="ps-header-subtitle">This sets your avatar and profile. You can change it later.</div>
      </div>

      <div className="ps-grid">
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
              <div className="ps-card-avatar" style={{ background: p.color }}>
                {src
                  ? <img src={src} alt={p.label} className="ps-card-img" />
                  : <span className="ps-card-badge">{p.badge}</span>}
              </div>
              <div className="ps-card-label">{p.label}</div>
              <div className="ps-card-desc">{p.description}</div>
              {isActive && <div className="ps-card-check">●</div>}
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
          {loading ? 'SAVING...' : 'CONFIRM PERSONA'}
        </button>
        <button
          className="ps-skip-btn"
          onClick={() => onSelect?.(null)}
          disabled={loading}
        >
          SKIP FOR NOW
        </button>
      </div>
    </div>
  );
}
