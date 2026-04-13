/**
 * ReferralPanel.jsx — Referral code display, copy, redeem, and stats.
 *
 * Shows user's unique referral code, invite text, stats (invited, XP earned),
 * and a form to redeem someone else's code.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api';
import './ReferralPanel.css';

export default function ReferralPanel() {
  const [referralCode, setReferralCode] = useState('');
  const [invited, setInvited]           = useState(0);
  const [xpEarned, setXpEarned]         = useState(0);
  const [referredBy, setReferredBy]     = useState(null);
  const [loading, setLoading]           = useState(true);

  const [redeemCode, setRedeemCode]     = useState('');
  const [redeemMsg, setRedeemMsg]       = useState('');
  const [redeemOk, setRedeemOk]         = useState(false);
  const [redeeming, setRedeeming]       = useState(false);

  const [codeCopied, setCodeCopied]     = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [copyToast, setCopyToast]       = useState(false);

  // Fetch referral status
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/referrals/status');
        const data = await res.json();
        if (!cancelled && data.ok) {
          setReferralCode(data.referralCode || '');
          setInvited(data.invited || 0);
          setXpEarned(data.xpEarned || 0);
          setReferredBy(data.referredBy ?? null);
        }
      } catch { /* silent */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCodeCopied(true);
      setCopyToast(true);
      setTimeout(() => setCodeCopied(false), 2000);
      setTimeout(() => setCopyToast(false), 2000);
    } catch { /* silent */ }
  }, [referralCode]);

  const inviteText = `Join me on Particle — the AI-powered market terminal. Use my code ${referralCode}! https://senger.market`;

  const handleCopyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteText);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch { /* silent */ }
  }, [inviteText]);

  const handleRedeem = useCallback(async () => {
    if (!redeemCode.trim()) return;
    setRedeeming(true);
    setRedeemMsg('');
    try {
      const res = await apiFetch('/api/referrals/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: redeemCode.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRedeemOk(true);
        setRedeemMsg(data.message || 'Referral redeemed!');
        setReferredBy(true);
        setRedeemCode('');
      } else {
        setRedeemOk(false);
        setRedeemMsg(data.message || 'Failed to redeem');
      }
    } catch (e) {
      setRedeemOk(false);
      setRedeemMsg(e.message || 'Network error');
    }
    setRedeeming(false);
  }, [redeemCode]);

  if (loading) return <div className="ref-panel"><span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Loading...</span></div>;

  return (
    <div className="ref-panel">
      <span className="ref-title">REFERRALS</span>

      {/* Your referral code */}
      <div className="ref-code-section">
        <div className="ref-code-row">
          <span className="ref-code">{referralCode}</span>
          <button
            className={`ref-copy-btn ${codeCopied ? 'ref-copy-btn--done' : ''}`}
            onClick={handleCopyCode}
          >
            {codeCopied ? 'COPIED' : 'COPY'}
          </button>
        </div>
        <span className="ref-invite-text">
          Share your code with friends. They can use it when they join!
        </span>
        <button
          className="ref-copy-invite"
          onClick={handleCopyInvite}
        >
          {inviteCopied ? 'Invite text copied!' : 'Copy invite message'}
        </button>
      </div>

      {/* Stats */}
      <div className="ref-stats">
        <div className="ref-stat">
          <span className="ref-stat-label">INVITED</span>
          <span className="ref-stat-value">{invited}</span>
        </div>
        <div className="ref-stat">
          <span className="ref-stat-label">XP EARNED</span>
          <span className="ref-stat-value ref-stat-value--accent">{xpEarned}</span>
        </div>
      </div>

      {/* Redeem section */}
      <div className="ref-redeem">
        <span className="ref-title">REDEEM A CODE</span>
        {referredBy ? (
          <span className="ref-already-redeemed">You already redeemed a referral code.</span>
        ) : (
          <>
            <div className="ref-redeem-row">
              <input
                className="ref-redeem-input"
                type="text"
                placeholder="SGR-XXXXXX"
                value={redeemCode}
                onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                maxLength={10}
              />
              <button
                className="ref-redeem-btn"
                onClick={handleRedeem}
                disabled={redeeming || !redeemCode.trim()}
              >
                {redeeming ? '...' : 'REDEEM'}
              </button>
            </div>
            {redeemMsg && (
              <span className={`ref-redeem-msg ${redeemOk ? 'ref-redeem-msg--success' : 'ref-redeem-msg--error'}`}>
                {redeemMsg}
              </span>
            )}
          </>
        )}
      </div>

      {/* Code copied toast */}
      {copyToast && (
        <div style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid var(--accent)', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, zIndex: 99999, animation: 'fadeInUp 200ms ease-out' }}>
          Code copied!
        </div>
      )}
    </div>
  );
}
