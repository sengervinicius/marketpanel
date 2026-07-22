/**
 * BloombergTVPanel.jsx — live Bloomberg Television in a home panel.
 *
 * Embeds Bloomberg TV's 24/7 YouTube live stream (channel UCIALMKvObZNtJ6AmdCLP7Lg).
 * Controls: mute/unmute (remounts the iframe with the mute flag — reliable
 * because the toggle is a user gesture, so unmuted autoplay is allowed) and a
 * power button to fully stop the stream (unmounts the iframe → playback stops,
 * shows a resume button). Starts MUTED so autoplay is permitted by browsers.
 *
 * NOTE: depends on Bloomberg keeping its channel live-stream public + embeddable.
 * If Bloomberg changes/removes the stream, swap CHANNEL_ID / the embed URL here.
 */
import { useState, useCallback } from 'react';
import './BloombergTVPanel.css';

const CHANNEL_ID = 'UCIALMKvObZNtJ6AmdCLP7Lg'; // Bloomberg Television

function embedSrc(muted) {
  return `https://www.youtube.com/embed/live_stream?channel=${CHANNEL_ID}`
    + `&autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1`;
}

export default function BloombergTVPanel() {
  const [on, setOn] = useState(true);
  const [muted, setMuted] = useState(true);

  const toggleMute = useCallback(() => setMuted(m => !m), []);
  const shutDown = useCallback(() => setOn(false), []);
  const start = useCallback(() => { setMuted(true); setOn(true); }, []);

  return (
    <div className="btv">
      <div className="btv-head">
        <span className="btv-title">BLOOMBERG&nbsp;TV</span>
        {on && <span className="btv-live"><i />LIVE</span>}
        <div className="btv-spacer" />
        {on && (
          <button
            className="btv-btn"
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >{muted ? '🔇' : '🔊'}</button>
        )}
        <button
          className="btv-btn btv-power"
          onClick={on ? shutDown : start}
          title={on ? 'Stop stream' : 'Start stream'}
          aria-label={on ? 'Stop stream' : 'Start stream'}
        >{on ? '⏻' : '▶'}</button>
      </div>
      <div className="btv-body">
        {on ? (
          <iframe
            key={muted ? 'btv-muted' : 'btv-unmuted'}
            className="btv-frame"
            src={embedSrc(muted)}
            title="Bloomberg Television Live"
            frameBorder="0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button className="btv-resume" onClick={start}>{'▶'}&nbsp;&nbsp;Start Bloomberg TV</button>
        )}
      </div>
    </div>
  );
}
