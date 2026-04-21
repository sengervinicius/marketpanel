/**
 * FeedbackButton.jsx — Small floating "Report issue" pill.
 *
 * Mounted globally so any screen has a one-tap path to send us feedback.
 * Before this existed the only feedback surface was thumbs-up/down on AI
 * answers, which meant any non-AI bug silently churned the user.
 *
 * Behaviour:
 *   - Pill sits bottom-right, just above the mobile bottom nav on phones
 *     and above the status strip on desktop so it never overlaps panel
 *     chrome.
 *   - Tapping opens a compact modal with a textarea + optional reply-to
 *     email (prefilled if logged in) + category dropdown.
 *   - Posts to /api/support/feedback. On success shows a small inline
 *     confirmation then auto-closes.
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

export default function FeedbackButton() {
  const auth = useAuth() || {};
  const user = auth.user || null;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('bug');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  // Prefill reply-to from signed-in user. Keep editable — user might want
  // a teammate's address on the thread.
  useEffect(() => {
    if (open && user?.email && !email) setEmail(user.email);
  }, [open, user, email]);

  // Focus the textarea when the modal opens.
  useEffect(() => {
    if (open && textareaRef.current) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  // Close with Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const reset = () => {
    setMessage('');
    setError(null);
    setSubmitted(false);
  };

  const close = () => {
    setOpen(false);
    // Small delay so the user sees the confirmation before the modal unmounts.
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
      // apiFetch returns the parsed body for JSON responses; 202 still
      // serialises fine.
      if (!resp || resp.ok === false) {
        throw new Error(resp?.message || 'Something went wrong. Please try again.');
      }
      setSubmitted(true);
      // Auto-close after a beat so the user sees the confirmation.
      setTimeout(close, 1400);
    } catch (err) {
      setError(err?.message || 'Could not send. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

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

      {open && (
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
        </div>
      )}

      <style>{`
        .particle-feedback-btn {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 9998;
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(255, 120, 50, 0.45);
          background: rgba(20, 22, 28, 0.92);
          color: #f0a87a;
          font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.02em;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          backdrop-filter: blur(6px);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
          transition: transform 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .particle-feedback-btn:hover {
          border-color: rgba(255, 150, 80, 0.85);
          color: #ffbb87;
          transform: translateY(-1px);
        }
        .particle-feedback-btn__dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ff8a3d;
          box-shadow: 0 0 8px rgba(255, 120, 50, 0.6);
        }
        @media (max-width: 768px) {
          /* Sit above the mobile bottom nav (~56px) with breathing room. */
          .particle-feedback-btn { bottom: 72px; right: 12px; }
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
          border: 1px solid rgba(255, 120, 50, 0.25);
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
          color: #f0a87a;
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
          border-color: rgba(255, 150, 80, 0.65);
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
          color: #f0a87a;
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
          background: #ff8a3d;
          border: 1px solid #ff8a3d;
          color: #16181e;
        }
        .particle-feedback-modal__btn--primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .particle-feedback-modal__btn--primary:not(:disabled):hover {
          background: #ffa05a;
          border-color: #ffa05a;
        }
      `}</style>
    </>
  );
}
