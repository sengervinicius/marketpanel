/**
 * FeedbackInbox.jsx — admin-only viewer for user-submitted feedback.
 *
 * Feedback submitted via the floating pill / mobile link is stored durably in
 * the `feedback_submissions` table (support.js) and also attempts an email
 * notification. When no email provider is configured the email silently no-ops
 * (emailed=false), so the DB was the only record — with no UI to read it.
 * This surfaces GET /api/admin/feedback in Settings. Non-admins get 403 → the
 * whole section hides itself.
 */
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../utils/api';

function timeAgo(iso) {
  try {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  } catch { return ''; }
}

export default function FeedbackInbox() {
  const [state, setState] = useState('loading'); // loading | hidden | ok | empty | error
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/feedback?limit=50');
      if (res.status === 403 || res.status === 401) { setState('hidden'); return; }
      if (!res.ok) { setState('error'); return; }
      const j = await res.json().catch(() => null);
      const list = j?.feedback || [];
      setRows(list);
      setState(list.length ? 'ok' : 'empty');
    } catch { setState('hidden'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ack = useCallback(async (id) => {
    try {
      await apiFetch(`/api/admin/feedback/${id}/ack`, { method: 'POST' });
      setRows(rs => rs.map(r => (String(r.id) === String(id) ? { ...r, acknowledged: true } : r)));
    } catch { /* non-fatal */ }
  }, []);

  if (state === 'loading' || state === 'hidden') return null;

  const unread = rows.filter(r => !r.acknowledged).length;

  return (
    <>
      <div className="app-settings-header">
        <span className="app-text-accent-header">{`FEEDBACK INBOX${unread ? ` \u00b7 ${unread} NEW` : ''}`}</span>
      </div>

      {state === 'error' && (
        <div style={{ padding: '8px 12px', fontSize: 9, color: 'var(--text-faint)' }}>
          Couldn’t load feedback — try reopening settings.
        </div>
      )}
      {state === 'empty' && (
        <div style={{ padding: '8px 12px', fontSize: 9, color: 'var(--text-faint)' }}>
          No feedback submissions yet.
        </div>
      )}

      {state === 'ok' && rows.map(r => (
        <div key={r.id} style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle, #1e1e1e)',
          opacity: r.acknowledged ? 0.55 : 1,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 8.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              {r.category || 'general'}
            </span>
            <span style={{ fontSize: 8.5, color: 'var(--text-faint)' }}>
              {timeAgo(r.created_at)}{!r.emailed ? ' · not emailed' : ''}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-primary)', margin: '4px 0', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {r.message}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 8.5, color: 'var(--text-muted)' }}>
              {r.reply_to ? `↩ ${r.reply_to}` : 'no reply address'}
            </span>
            {!r.acknowledged && (
              <button
                onClick={() => ack(r.id)}
                style={{
                  background: 'transparent', border: '1px solid var(--border-strong)',
                  color: 'var(--text-muted)', borderRadius: 3, padding: '2px 8px',
                  fontSize: 8.5, letterSpacing: '0.06em', cursor: 'pointer',
                }}
              >MARK DONE</button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
