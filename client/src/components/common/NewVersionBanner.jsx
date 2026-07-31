/**
 * NewVersionBanner.jsx
 *
 * ONE app-level notice when a new client version was deployed while the tab was open.
 *
 * A stale tab holds old lazy-chunk hashes, so after a deploy every lazily-loaded
 * panel fails its dynamic import at once. Previously each panel's error boundary
 * rendered its own big "Updating to the latest version… RELOAD" card — nine of them
 * across the grid, which reads as "the app is broken" rather than "press reload".
 *
 * Now the boundaries stay quiet and dispatch `particle:new-version`; this renders a
 * single unobtrusive banner with one action.
 */
import { useEffect, useState } from 'react';

export default function NewVersionBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onNewVersion = () => setShow(true);
    window.addEventListener('particle:new-version', onNewVersion);
    return () => window.removeEventListener('particle:new-version', onNewVersion);
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '9px 16px',
        background: 'var(--accent, #e55a00)', color: '#fff',
        fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 500,
        boxShadow: '0 2px 14px rgba(0,0,0,.35)',
      }}
    >
      <span>A new version of Particle was deployed. Reload to get the update.</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: '#fff', color: 'var(--accent, #e55a00)', border: 'none',
          borderRadius: 4, padding: '5px 14px', fontSize: 12, fontWeight: 700,
          letterSpacing: '.5px', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        RELOAD
      </button>
    </div>
  );
}
