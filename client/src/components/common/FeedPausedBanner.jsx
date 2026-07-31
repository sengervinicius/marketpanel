/**
 * FeedPausedBanner.jsx
 *
 * The live market feed can be refused by the server's per-user WebSocket
 * connection cap (too many Particle tabs/devices open at once). Previously the
 * client just reconnected forever — observed 38 consecutive silent attempts —
 * while the footer showed a permanent "STOCKS CONNECTING". The user had no way to
 * know the feed was capped, let alone what to do about it.
 *
 * Now useWebSocket stops after a few cap rejections and emits
 * `particle:feed-paused`; this states the cause plainly and offers a retry that
 * re-arms the connection (`particle:feed-retry`).
 */
import { useEffect, useState } from 'react';

export default function FeedPausedBanner() {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onPaused  = () => setPaused(true);
    const onResumed = () => setPaused(false);
    window.addEventListener('particle:feed-paused', onPaused);
    window.addEventListener('particle:feed-resumed', onResumed);
    return () => {
      window.removeEventListener('particle:feed-paused', onPaused);
      window.removeEventListener('particle:feed-resumed', onResumed);
    };
  }, []);

  if (!paused) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '8px 16px',
        background: 'var(--color-down, #ef4444)', color: '#fff',
        fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 500,
        boxShadow: '0 -2px 14px rgba(0,0,0,.35)',
      }}
    >
      <span>
        Live feed paused — too many Particle windows open on this account.
        Close another tab or device, then retry.
      </span>
      <button
        onClick={() => { window.dispatchEvent(new CustomEvent('particle:feed-retry')); }}
        style={{
          background: '#fff', color: 'var(--color-down, #ef4444)', border: 'none',
          borderRadius: 4, padding: '4px 14px', fontSize: 11.5, fontWeight: 700,
          letterSpacing: '.5px', cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        RETRY
      </button>
    </div>
  );
}
