/**
 * SectionHeader.jsx
 * Interactive section divider for panels — the thin labeled row that separates
 * subsections (e.g., "FX PAIRS", "CRYPTO", "METALS").
 *
 * Features:
 * - Double-click label to rename inline
 * - Hover reveals × toggle to hide the subsection
 * - Backwards-compatible: works as static label if no callbacks passed
 * - Uses design tokens for consistent styling across all panels
 */
import { useState, useRef, useEffect, memo } from 'react';

function SectionHeader({
  label,
  sectionKey,
  color = 'var(--text-muted)',
  onRename,
  onToggleVisibility,
  isHideable = false,
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(label);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = () => {
    const v = editVal.trim();
    if (v && v !== label && onRename) {
      onRename(sectionKey, v);
    }
    setEditing(false);
  };

  const startEdit = () => {
    if (onRename) {
      setEditVal(label);
      setEditing(true);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '2px 8px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-default)',
        borderBottom: '1px solid var(--border-default)',
        minHeight: 20,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setEditing(false);
          }}
          maxLength={30}
          style={{
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-strong)',
            color,
            fontSize: 'var(--font-xs)',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.12em',
            padding: '0 4px',
            outline: 'none',
            width: '100%',
            maxWidth: 200,
          }}
        />
      ) : (
        <span
          style={{
            color,
            fontSize: 'var(--font-xs)',
            fontWeight: 700,
            letterSpacing: '0.12em',
            cursor: onRename ? 'text' : 'default',
            flex: 1,
            userSelect: 'none',
          }}
          onDoubleClick={startEdit}
          title={onRename ? 'Double-click to rename' : undefined}
        >
          —— {label} ————————————————————————
        </span>
      )}

      {/* Hide toggle — shown on hover if hideable */}
      {isHideable && hovered && !editing && (
        <button
          onClick={() => onToggleVisibility?.(sectionKey)}
          title={`Hide ${label} section`}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: 10,
            lineHeight: 1,
            opacity: 0.7,
            display: 'flex',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.opacity = '0.7'; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}

export { SectionHeader };
export default memo(SectionHeader);
