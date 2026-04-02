/**
 * ShareModal.jsx — Modal for generating + sharing social cards.
 *
 * Props:
 *   isOpen:    boolean
 *   onClose:   () => void
 *   cardType:  'portfolio' | 'ticker' | 'leaderboard' | 'weekly'
 *   cardData:  object — payload for the POST body (portfolioId, symbol, board, etc.)
 *   triggerGamificationEvent: (type) => void
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, API_BASE } from '../../utils/api';
import './ShareModal.css';

const CARD_ENDPOINTS = {
  portfolio:   '/api/share/portfolio-card',
  ticker:      '/api/share/ticker-card',
  leaderboard: '/api/share/leaderboard-card',
  weekly:      '/api/share/weekly-card',
};

const GAMIFICATION_EVENTS = {
  portfolio:   'share_portfolio',
  ticker:      'share_ticker',
  leaderboard: 'share_leaderboard',
  weekly:      'share_weekly',
};

export default function ShareModal({ isOpen, onClose, cardType, cardData, triggerGamificationEvent }) {
  const [state, setState]   = useState('idle'); // idle | generating | success | error
  const [imageUrl, setImageUrl] = useState(null);
  const [shareText, setShareText] = useState('');
  const [error, setError]   = useState('');
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    const endpoint = CARD_ENDPOINTS[cardType];
    if (!endpoint) return;

    setState('generating');
    setError('');
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(cardData || {}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || 'Card generation failed');
      setImageUrl(json.imageUrl);
      setShareText(json.shareText || '');
      setState('success');

      // Fire gamification event
      const evt = GAMIFICATION_EVENTS[cardType];
      if (evt && triggerGamificationEvent) triggerGamificationEvent(evt);
    } catch (e) {
      setState('error');
      setError(e.message || 'Failed to generate card');
    }
  }, [cardType, cardData, triggerGamificationEvent]);

  // Auto-generate when modal opens
  useEffect(() => {
    if (isOpen && state === 'idle') generate();
  }, [isOpen, state, generate]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setState('idle');
      setImageUrl(null);
      setShareText('');
      setError('');
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const fullImageUrl = imageUrl ? `${API_BASE}${imageUrl}` : null;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  };

  const handleDownload = () => {
    if (!fullImageUrl) return;
    const a = document.createElement('a');
    a.href = fullImageUrl;
    a.download = `senger-${cardType}-card.png`;
    a.click();
  };

  const shareUrl = 'https://senger.market';

  const handleWhatsApp = () => {
    const text = encodeURIComponent(`${shareText}\n${shareUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleX = () => {
    const text = encodeURIComponent(shareText);
    const url  = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank');
  };

  const handleLinkedIn = () => {
    const url = encodeURIComponent(shareUrl);
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank');
  };

  const titles = {
    portfolio: 'Share Portfolio',
    ticker: 'Share Ticker',
    leaderboard: 'Share Ranking',
    weekly: 'Share Weekly Result',
  };

  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <div className="share-header">
          <span className="share-title">{titles[cardType] || 'Share'}</span>
          <button className="share-close" onClick={onClose}>&times;</button>
        </div>
        <div className="share-body">
          {/* Preview */}
          <div className="share-preview">
            {state === 'generating' && (
              <span className="share-preview--loading">Generating card...</span>
            )}
            {state === 'error' && (
              <div className="share-preview--error">
                {error}
                <br />
                <button className="share-copy-btn" style={{ marginTop: 8 }} onClick={generate}>RETRY</button>
              </div>
            )}
            {state === 'success' && fullImageUrl && (
              <img src={fullImageUrl} alt={`${cardType} share card`} />
            )}
          </div>

          {/* Share text + copy */}
          {state === 'success' && shareText && (
            <div className="share-text-row">
              <span className="share-text">{shareText}</span>
              <button
                className={`share-copy-btn ${copied ? 'share-copy-btn--done' : ''}`}
                onClick={handleCopyText}
              >
                {copied ? 'COPIED' : 'COPY'}
              </button>
            </div>
          )}

          {/* Social intents */}
          {state === 'success' && (
            <div className="share-social">
              <button className="share-social-btn share-social-btn--wa" onClick={handleWhatsApp}>WhatsApp</button>
              <button className="share-social-btn share-social-btn--x" onClick={handleX}>X / Twitter</button>
              <button className="share-social-btn share-social-btn--li" onClick={handleLinkedIn}>LinkedIn</button>
            </div>
          )}

          {/* Download */}
          {state === 'success' && (
            <button className="share-download" onClick={handleDownload}>DOWNLOAD IMAGE</button>
          )}
        </div>
      </div>
    </div>
  );
}
