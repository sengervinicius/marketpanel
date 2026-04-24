/**
 * PersonaPickerChip.jsx — R0.3 persona selector for the AI chat header.
 *
 * A compact inline chip with a dropdown. Picks one of:
 *   - null               → default Particle AI (existing streaming path)
 *   - persona.id         → next message routes to /api/personas/:id/ask
 *
 * Self-contained. No new CSS file — we reuse the existing
 * chat-header-btn inline-style pattern already used by "+ New" and
 * "Clear" buttons so the visual language is identical.
 *
 * 404-safe: if /api/personas returns 404 (flag OFF for this user) we
 * render null. The picker only appears to users who have
 * PERSONA_AGENTS_V1 turned on.
 */

'use strict';

import { useEffect, useState, useRef, useCallback } from 'react';

const CACHE_KEY = 'particle_personas_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function readCached() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.personas)) return null;
    if (Date.now() - (parsed.cachedAt || 0) > CACHE_TTL_MS) return null;
    return parsed.personas;
  } catch { return null; }
}

function writeCached(personas) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ personas, cachedAt: Date.now() }));
    }
  } catch { /* storage can be disabled */ }
}

export default function PersonaPickerChip({ selected, onSelect }) {
  const [personas, setPersonas] = useState(() => readCached() || []);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(personas.length > 0);
  const wrapRef = useRef(null);

  const fetchPersonas = useCallback(async () => {
    try {
      const { API_BASE } = await import('../../utils/api');
      const res = await fetch(`${API_BASE}/api/personas`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        setAvailable(false);
        return;
      }
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.personas)) {
        setPersonas(data.personas);
        setAvailable(true);
        writeCached(data.personas);
      } else {
        setAvailable(false);
      }
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    // Always refresh on mount; the cached list is a fast path for the
    // first paint but never authoritative.
    fetchPersonas();
  }, [fetchPersonas]);

  // Outside-click closes the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!available || personas.length === 0) return null;

  const selectedPersona = selected
    ? personas.find((p) => p.id === selected)
    : null;

  const chipStyle = {
    background: selectedPersona
      ? 'var(--accent-subtle, rgba(46,90,158,0.12))'
      : 'none',
    border: '1px solid var(--border, #2a2a2a)',
    cursor: 'pointer',
    padding: '4px 10px',
    marginRight: 6,
    borderRadius: 4,
    color: selectedPersona
      ? 'var(--accent, #2e5a9e)'
      : 'var(--text-secondary, #999)',
    fontSize: 12,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };

  const menuStyle = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
    minWidth: 220,
    maxWidth: 320,
    background: 'var(--bg-panel, #1a1a1a)',
    border: '1px solid var(--border, #2a2a2a)',
    borderRadius: 4,
    padding: 4,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 20,
  };

  const menuItemStyle = (active) => ({
    display: 'block',
    width: '100%',
    background: active ? 'var(--bg-hover, rgba(255,255,255,0.04))' : 'none',
    border: 'none',
    color: 'var(--text, #e6e6e6)',
    cursor: 'pointer',
    padding: '6px 8px',
    borderRadius: 3,
    fontSize: 12,
    textAlign: 'left',
  });

  return (
    <div ref={wrapRef} style={{ position: 'relative', marginRight: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selectedPersona
          ? `Replies come from ${selectedPersona.name}`
          : 'Ask a specific investor persona'}
        style={chipStyle}
      >
        <span aria-hidden="true">{'\u25B8'}</span>
        <span>
          {selectedPersona
            ? `Ask ${selectedPersona.name.split(' ').slice(-1)[0]}`
            : 'Ask a persona'}
        </span>
      </button>
      {open && (
        <div style={menuStyle} role="menu">
          <button
            type="button"
            style={{ ...menuItemStyle(selected == null), opacity: selected == null ? 1 : 0.75 }}
            onClick={() => { onSelect(null); setOpen(false); }}
            role="menuitem"
          >
            <div style={{ fontWeight: 600 }}>Default (Particle AI)</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary, #999)' }}>
              Tools + context, no persona lens
            </div>
          </button>
          {personas.map((p) => (
            <button
              key={p.id}
              type="button"
              style={menuItemStyle(selected === p.id)}
              onClick={() => { onSelect(p.id); setOpen(false); }}
              role="menuitem"
            >
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary, #999)', lineHeight: 1.3 }}>
                {p.one_liner}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
