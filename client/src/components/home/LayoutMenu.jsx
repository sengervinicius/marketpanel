/**
 * LayoutMenu.jsx — H3: dropdown behind the header LAYOUT button when the
 * `home_grid_v2` flag is on. Lazy-loaded from App.jsx.
 *
 * Operations: switch layout, rename (inline), duplicate, new (seeded from
 * the app-default rows), delete (always keeps at least one layout).
 */

import { useEffect, useRef, useState } from 'react';

const S = {
  root: {
    position: 'fixed', top: 46, right: 12, zIndex: 1000,
    minWidth: 240, maxWidth: 320,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 4,
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    fontFamily: 'var(--font-mono)', fontSize: 11,
    color: 'var(--text-secondary)',
    padding: 4,
  },
  head: {
    padding: '6px 8px', fontSize: 9, letterSpacing: '1px',
    color: 'var(--text-faint)',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 8px', borderRadius: 3, cursor: 'pointer',
  },
  name: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit' },
  iconBtn: {
    background: 'none', border: '1px solid transparent', color: 'var(--text-faint)',
    cursor: 'pointer', padding: '1px 4px', borderRadius: 2, fontSize: 10, fontFamily: 'inherit',
  },
  input: {
    flex: 1, background: 'var(--bg-app)', color: 'var(--text-primary)',
    border: '1px solid var(--accent)', borderRadius: 2, padding: '2px 4px',
    fontFamily: 'inherit', fontSize: 'inherit', minWidth: 0,
  },
  footer: {
    borderTop: '1px solid var(--border-subtle)', marginTop: 4, paddingTop: 4,
  },
  newBtn: {
    width: '100%', background: 'none', border: '1px dashed var(--border-strong)',
    color: 'var(--text-faint)', cursor: 'pointer', padding: '5px 8px',
    borderRadius: 3, fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.5px',
  },
};

export default function LayoutMenu({ layouts, onSwitch, onRename, onDuplicate, onCreate, onDelete, onClose }) {
  const ref = useRef(null);
  const [renamingId, setRenamingId] = useState(null);
  const [nameVal, setNameVal] = useState('');

  // Close on outside click / Escape
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const ids = Object.keys(layouts?.items || {});
  const activeId = layouts?.activeId;

  const saveRename = (id) => {
    if (nameVal.trim()) onRename(id, nameVal);
    setRenamingId(null);
  };

  return (
    <div ref={ref} style={S.root} role="menu" aria-label="Workspace layouts">
      <div style={S.head}>LAYOUTS</div>
      {ids.map(id => {
        const item = layouts.items[id];
        const isActive = id === activeId;
        return (
          <div key={id} style={{ ...S.row, background: isActive ? 'rgba(255,102,0,0.08)' : 'none' }}>
            <span style={{ width: 10, color: 'var(--accent)' }}>{isActive ? '>' : ''}</span>
            {renamingId === id ? (
              <input
                autoFocus
                style={S.input}
                value={nameVal}
                maxLength={40}
                onChange={e => setNameVal(e.target.value)}
                onBlur={() => saveRename(id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveRename(id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                style={{ ...S.name, color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
                onClick={() => { onSwitch(id); onClose(); }}
                title={`Switch to ${item.name || id}`}
              >{item.name || id}</button>
            )}
            <button style={S.iconBtn} title="Rename layout"
              onClick={() => { setRenamingId(id); setNameVal(item.name || id); }}>REN</button>
            <button style={S.iconBtn} title="Duplicate layout"
              onClick={() => onDuplicate(id)}>DUP</button>
            <button
              style={{ ...S.iconBtn, opacity: ids.length <= 1 ? 0.3 : 1, cursor: ids.length <= 1 ? 'default' : 'pointer' }}
              title={ids.length <= 1 ? 'At least one layout must remain' : 'Delete layout'}
              disabled={ids.length <= 1}
              onClick={() => { if (ids.length > 1) onDelete(id); }}
            >DEL</button>
          </div>
        );
      })}
      <div style={S.footer}>
        <button style={S.newBtn} onClick={() => onCreate()} title="New layout from the default arrangement">
          + NEW LAYOUT
        </button>
      </div>
    </div>
  );
}
