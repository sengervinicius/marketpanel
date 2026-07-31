/**
 * BloombergTVPanel.jsx — live business television in a home panel.
 *
 * Bloomberg is the default and stays first; the channel row exists because no
 * single network is on air continuously, so when one drops off we can fall back
 * instead of showing an empty box.
 *
 * The live video id is resolved server-side (/api/market/live-tv?channel=) and
 * that specific video is embedded. YouTube retired /embed/live_stream?channel=
 * (it renders "video unavailable"), which is why the original panel stopped
 * connecting — so we no longer use it.
 *
 * Controls: mute/unmute (remounts the iframe with the mute flag — reliable
 * because the toggle is a user gesture, so unmuted autoplay is allowed) and a
 * power button to fully stop the stream. Starts MUTED so autoplay is allowed.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/api';
import { swallow } from '../../utils/swallow';
import './BloombergTVPanel.css';

const CHANNELS = [
  { key: 'bloomberg', label: 'BLOOMBERG', short: 'BBG' },
  { key: 'yahoo',     label: 'YAHOO FINANCE', short: 'YF' },
  { key: 'cnbc',      label: 'CNBC', short: 'CNBC' },
  { key: 'reuters',   label: 'REUTERS', short: 'RTRS' },
];

function embedSrc(videoId, muted) {
  return `https://www.youtube-nocookie.com/embed/${videoId}`
    + `?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1`;
}

export default function BloombergTVPanel() {
  const [on, setOn] = useState(true);
  const [muted, setMuted] = useState(true);
  const [chan, setChan] = useState('bloomberg');
  const [videoId, setVideoId] = useState(null);
  const [title, setTitle] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | offline
  // Tracks which channel the in-flight request was for, so a slow response for a
  // channel the user has already switched away from cannot overwrite the state.
  const wantRef = useRef(chan);

  const resolve = useCallback((key) => {
    const target = key || wantRef.current;
    wantRef.current = target;
    // Only show the loading state when we have nothing to play. The periodic
    // refresh below must NOT flip status to 'loading' — that unmounted the
    // iframe and restarted the live stream (audio and all) every 10 minutes.
    setStatus(prev => (prev === 'ready' ? prev : 'loading'));
    apiFetch(`/api/market/live-tv?channel=${encodeURIComponent(target)}`)
      .then(r => (r && r.ok ? r.json() : null))
      .then(d => {
        if (wantRef.current !== target) return; // stale response
        if (d && d.videoId) {
          setVideoId(prev => (prev === d.videoId ? prev : d.videoId));
          setTitle(d.title || null);
          setStatus('ready');
        } else {
          setVideoId(null); setTitle(null); setStatus('offline');
        }
      })
      .catch(e => {
        swallow(e, 'btv.resolve');
        if (wantRef.current !== target) return;
        setStatus(prev => (prev === 'ready' ? prev : 'offline'));
      });
  }, []);

  // Resolve on mount and whenever the channel changes; refresh every 10 min
  // because live ids rotate when a network restarts its stream.
  useEffect(() => {
    resolve(chan);
    const t = setInterval(() => resolve(chan), 600000);
    return () => clearInterval(t);
  }, [chan, resolve]);

  const pick = useCallback((key) => {
    if (key === chan) return;
    setVideoId(null); setTitle(null); setStatus('loading'); setChan(key);
  }, [chan]);

  const toggleMute = useCallback(() => setMuted(m => !m), []);
  const shutDown = useCallback(() => setOn(false), []);
  const start = useCallback(() => {
    setMuted(true); setOn(true);
    if (!videoId) resolve(chan);
  }, [videoId, resolve, chan]);

  const active = CHANNELS.find(c => c.key === chan) || CHANNELS[0];
  const channelUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(active.label + ' live')}`;

  return (
    <div className="btv">
      <div className="btv-head">
        <span className="btv-title">LIVE&nbsp;TV</span>
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

      <div className="btv-chans" role="tablist" aria-label="Channel">
        {CHANNELS.map(c => (
          <button
            key={c.key}
            role="tab"
            aria-selected={c.key === chan}
            className={`btv-chan${c.key === chan ? ' is-on' : ''}`}
            onClick={() => pick(c.key)}
            title={c.label}
          >{c.short}</button>
        ))}
      </div>

      <div className="btv-body">
        {!on ? (
          <button className="btv-resume" onClick={start}>{'▶'}&nbsp;&nbsp;Start live TV</button>
        ) : status === 'loading' ? (
          <div className="btv-msg">Connecting to {active.label}…</div>
        ) : status === 'ready' && videoId ? (
          <iframe
            key={`${chan}-${videoId}-${muted ? 'm' : 'u'}`}
            className="btv-frame"
            src={embedSrc(videoId, muted)}
            title={title || `${active.label} Live`}
            frameBorder="0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <div className="btv-msg">
            <div>{active.label} isn’t live right now.</div>
            <div className="btv-msg-sub">Try another channel above.</div>
            <div className="btv-msg-actions">
              <button className="btv-resume btv-resume--sm" onClick={() => resolve(chan)}>Retry</button>
              <a className="btv-resume btv-resume--sm" href={channelUrl} target="_blank" rel="noreferrer">Open on YouTube</a>
            </div>
          </div>
        )}
      </div>
      {on && status === 'ready' && title && <div className="btv-foot" title={title}>{title}</div>}
    </div>
  );
}
