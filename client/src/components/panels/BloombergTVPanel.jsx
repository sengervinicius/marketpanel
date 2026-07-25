/**
 * BloombergTVPanel.jsx — live Bloomberg Television in a home panel.
 *
 * Embeds Bloomberg TV's 24/7 stream by resolving the channel's CURRENT live
 * video id server-side (/api/market/bloomberg-tv) and embedding that video
 * directly. YouTube deprecated the /embed/live_stream?channel= endpoint (it
 * now returns "video unavailable"), which is why the old panel stopped
 * connecting — so we no longer use it.
 *
 * Controls: mute/unmute (remounts the iframe with the mute flag — reliable
 * because the toggle is a user gesture, so unmuted autoplay is allowed) and a
 * power button to fully stop the stream. Starts MUTED so autoplay is allowed.
 */
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import './BloombergTVPanel.css';

const CHANNEL_ID = 'UCIALMKvObZNtJ6AmdCLP7Lg'; // Bloomberg Television (@markets)
const CHANNEL_LIVE_URL = `https://www.youtube.com/channel/${CHANNEL_ID}/live`;

function embedSrc(videoId, muted) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`
    + `?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1`;
}

export default function BloombergTVPanel() {
  const [on, setOn] = useState(true);
  const [muted, setMuted] = useState(true);
  const [videoId, setVideoId] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | offline

  const resolve = useCallback(() => {
    // Only show the loading state when we have nothing to play. The periodic
    // refresh below must NOT flip status to 'loading' — that unmounted the
    // iframe and restarted the live stream (audio and all) every 10 minutes.
    setStatus(prev => (prev === 'ready' ? prev : 'loading'));
    apiFetch('/api/market/bloomberg-tv')
      .then(r => (r && r.ok ? r.json() : null))
      .then(d => {
        if (d && d.videoId) {
          // Keep the same iframe when the live id hasn't changed.
          setVideoId(prev => (prev === d.videoId ? prev : d.videoId));
          setStatus('ready');
        } else {
          setVideoId(null); setStatus('offline');
        }
      })
      .catch(e => { swallow(e, 'btv.resolve'); setStatus(prev => (prev === 'ready' ? prev : 'offline')); });
  }, []);

  // Resolve on mount, and refresh the live id every 10 min (streams rotate).
  useEffect(() => {
    resolve();
    const t = setInterval(resolve, 600000);
    return () => clearInterval(t);
  }, [resolve]);

  const toggleMute = useCallback(() => setMuted(m => !m), []);
  const shutDown = useCallback(() => setOn(false), []);
  const start = useCallback(() => { setMuted(true); setOn(true); if (!videoId) resolve(); }, [videoId, resolve]);

  return (
    <div className="btv">
      <div className="btv-head">
        <span className="btv-title">BLOOMBERG&nbsp;TV</span>
        {on && status === 'ready' && <span className="btv-live"><i />LIVE</span>}
        <div className="btv-spacer" />
        {on && status === 'ready' && (
          <button
            className="btv-btn"
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >{muted ? '\u{1F507}' : '\u{1F50A}'}</button>
        )}
        <button
          className="btv-btn btv-power"
          onClick={on ? shutDown : start}
          title={on ? 'Stop stream' : 'Start stream'}
          aria-label={on ? 'Stop stream' : 'Start stream'}
        >{on ? '⏻' : '▶'}</button>
      </div>
      <div className="btv-body">
        {!on ? (
          <button className="btv-resume" onClick={start}>{'▶'}&nbsp;&nbsp;Start Bloomberg TV</button>
        ) : status === 'loading' ? (
          <div className="btv-msg">Connecting to Bloomberg TV…</div>
        ) : status === 'ready' && videoId ? (
          <iframe
            key={muted ? 'btv-muted' : 'btv-unmuted'}
            className="btv-frame"
            src={embedSrc(videoId, muted)}
            title="Bloomberg Television Live"
            frameBorder="0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <div className="btv-msg">
            <div>Bloomberg TV isn’t live right now.</div>
            <div className="btv-msg-actions">
              <button className="btv-resume btv-resume--sm" onClick={resolve}>Retry</button>
              <a className="btv-resume btv-resume--sm" href={CHANNEL_LIVE_URL} target="_blank" rel="noreferrer">Open on YouTube</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
