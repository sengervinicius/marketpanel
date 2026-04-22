/**
 * FeedbackButton.jsx — Feedback surface split into two entry points.
 *
 * History:
 *   - v1 (f24b7f5): Launched as a single orange floating pill visible on
 *     every screen, desktop and mobile. On phones the pill sat at
 *     bottom-right above the tab bar and — between its orange dot, bright
 *     ink, and the fact it was mounted globally — ended up visually
 *     shouting louder than the primary nav. CIO flagged it as "ridiculous,
 *     super highlighted and on top of one of the most important sections"
 *     during the mobile incident sweep.
 *
 *   - v2 (this file): Two entry points, same modal.
 *       • <FeedbackButton/>   — floating pill, DESKTOP ONLY. On viewports
 *         <=768px the pill is not rendered at all (display:none). Palette
 *         toned down from orange "signal" ink to muted surface + neutral
 *         grey so it stops competing with the Particle brand orange.
 *       • <FeedbackLink label={…} onOpened={…}/> — a plain anchor that
 *         opens the same modal. Mounted inside AppSettings → HELP so
 *         phone users still have a one-tap path to report issues.
 *
 *   The modal itself is unchanged from v1 — same POST, same categories,
 *   same validation — so the server contract (/api/support/feedback) is
 *   untouched. Only the entry points and styling change.
 */

import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

const CATEGORIES = [
  { value: 'bug',        label: 'Something broken' },
  { value: 'data',       label: 'Wrong or missing data' },
  { value: 'ai',         label: 'AI gave a bad answer' },
  { value: 'suggestion', label: 'Feature suggestion' },
  { value: 'other',      label: 'Something else' },
];

/* ── Shared modal (used by both entry points) ────────────────────────── */
function FeedbackModal({ open, onClose }) {
  const auth = useAuth() || {};
  const user = auth.user || null;

  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('bug');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (open && user?.email && !email) setEmail(user.email);
  }, [open, user, email]);

  useEffect(() => {
    if (open && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const reset = () => {
    setMessage('');
    setError(null);
    setSubmitted(false);
  };

  const close = () => {
    onClose();
    setTimeout(reset, 200);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    if (submitting) return;
    const trimmed = message.trim();
    if (trimmed.length < 3) {
      setError('Please tell us what happened (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const context = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search || ''}`
        : '';
      const resp = await apiFetch('/api/support/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          email: email || undefined,
          context,
          category,
        }),
      });
      if (!resp || resp.ok === false) {
        throw new Error(resp?.message || 'Something went wrong. Please try again.');
      }
      setSubmitted(true);
      setTimeout(close, 1400);
    } catch (err) {
      setError(err?.message || 'Could not send. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="particle-feedback-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <form className="particle-feedback-modal" onSubmit={submit}>
        <div className="particle-feedback-modal__header">
          <h2 className="particle-feedback-modal__title">Tell us what's up</h2>
          <button
            type="button"
            className="particle-feedback-modal__close"
            onClick={close}
            aria-label="Close feedback form"
          >
            ×
          </button>
        </div>

        {submitted ? (
          <div className="particle-feedback-modal__done">
            Thanks — we got it. We'll follow up if we need more context.
          </div>
        ) : (
          <>
            <label className="particle-feedback-modal__label">
              What are you reporting?
              <select
                className="particle-feedback-modal__select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <label className="particle-feedback-modal__label">
              Details
              <textarea
                ref={textareaRef}
                className="particle-feedback-modal__textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened, and what did you expect to happen?"
                rows={5}
                maxLength={4000}
                disabled={submitting}
              />
            </label>

            <label className="particle-feedback-modal__label">
              Reply-to email (optional)
              <input
                type="email"
                className="particle-feedback-modal__input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={submitting}
              />
            </label>

            {error && (
              <div className="particle-feedback-modal__error" role="alert">{error}</div>
            )}

            <div className="particle-feedback-modal__actions">
              <button
                type="button"
                className="particle-feedback-modal__btn particle-feedback-modal__btn--ghost"
                onClick={close}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="particle-feedback-modal__btn particle-feedback-modal__btn--primary"
                disabled={submitting || message.trim().length < 3}
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </form>

      {/* Shared style block — covers the modal AND the floating pill.
          The pill is hidden below 768px so it never competes with the
          bottom tab bar on phones. */}
      <style>{`
        .particle-feedback-btn {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 9998;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(20, 22, 28, 0.82);
          color: #8a8f99;
          font: 500 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.02em;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          backdrop-filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
          transition: transform 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .particle-feedback-btn:hover {
          border-color: rgba(255, 255, 255, 0.18);
          color: #d0d4db;
          transform: translateY(-1px);
        }
        .particle-feedback-btn__dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #5b6070;
        }
        @media (max-width: 768px) {
          /* CIO feedback — the floating pill is too loud on phones and
             sits above the bottom nav. Use the Settings → HELP entry
             point instead. */
          .particle-feedback-btn { display: none !important; }
        }

        .particle-feedback-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          backdrop-filter: blur(2px);
        }
        .particle-feedback-modal {
          width: 100%;
          max-width: 440px;
          background: #16181e;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 20px;
          color: #e6e6e6;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
        }
        .particle-feedback-modal__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .particle-feedback-modal__title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #e6e6e6;
        }
        .particle-feedback-modal__close {
          background: none;
          border: none;
          color: #999;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          padding: 4px 8px;
        }
        .particle-feedback-modal__close:hover { color: #fff; }

        .particle-feedback-modal__label {
          display: block;
          font-size: 11px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #888;
          margin-bottom: 12px;
        }
        .particle-feedback-modal__select,
        .particle-feedback-modal__input,
        .particle-feedback-modal__textarea {
          display: block;
          width: 100%;
          margin-top: 6px;
          padding: 10px 12px;
          border-radius: 6px;
          border: 1px solid #2a2d36;
          background: #1c1e25;
          color: #e6e6e6;
          font-size: 13px;
          font-family: inherit;
          box-sizing: border-box;
        }
        .particle-feedback-modal__textarea {
          resize: vertical;
          min-height: 90px;
          font-family: inherit;
        }
        .particle-feedback-modal__select:focus,
        .particle-feedback-modal__input:focus,
        .particle-feedback-modal__textarea:focus {
          outline: none;
          border-color: rgba(255, 150, 80, 0.45);
        }

        .particle-feedback-modal__error {
          background: rgba(220, 60, 60, 0.15);
          border: 1px solid rgba(220, 60, 60, 0.4);
          color: #f0a0a0;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 12px;
          margin-bottom: 12px;
        }
        .particle-feedback-modal__done {
          padding: 20px 8px;
          color: #cfd4dc;
          font-size: 14px;
          text-align: center;
        }
        .particle-feedback-modal__actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 6px;
        }
        .particle-feedback-modal__btn {
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          font-family: inherit;
        }
        .particle-feedback-modal__btn--ghost {
          background: transparent;
          border: 1px solid #333;
          color: #aaa;
        }
        .particle-feedback-modal__btn--ghost:hover { color: #fff; border-color: #555; }
        .particle-feedback-modal__btn--primary {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #e6e6e6;
        }
        .particle-feedback-modal__btn--primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .particle-feedback-modal__btn--primary:not(:disabled):hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.25);
        }
      `}</style>
    </div>
  );
}

/* ── Entry point 1: floating pill (desktop only) ─────────────────────── */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="particle-feedback-btn"
        onClick={() => setOpen(true)}
        aria-label="Report an issue or send feedback"
        title="Report an issue"
      >
        <span className="particle-feedback-btn__dot" aria-hidden="true" />
        Feedback
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ── Entry point 2: inline link (Settings → HELP) ────────────────────── */
export function FeedbackLink({ className, children = 'Send feedback to the team' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-label="Send feedback to the team"
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span className="app-text-muted-small">{children}</span>
        <span className="app-text-faint-small">&#9998; REPORT</span>
      </button>
      <FeedbackModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
