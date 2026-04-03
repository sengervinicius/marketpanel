/**
 * NotificationPrefs.jsx — Notification Preferences UI
 *
 * Allows users to configure default alert channels, quiet hours,
 * Discord/webhook URL, and daily digest toggle.
 * Accessible from Settings and Alert Center.
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { apiFetch } from '../../utils/api';
import './NotificationPrefs.css';

const CHANNELS = [
  { key: 'in_app', label: 'In-App', icon: '🔔', description: 'Badge & Alert Center', alwaysOn: true },
  { key: 'email', label: 'Email', icon: '✉', description: 'Receive alert emails' },
  { key: 'discord', label: 'Discord', icon: '💬', description: 'Discord webhook' },
  { key: 'webhook', label: 'Webhook', icon: '🔗', description: 'Generic HTTP POST' },
  { key: 'push', label: 'Push', icon: '📱', description: 'Mobile push (coming soon)', disabled: true },
];

function NotificationPrefs({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState('');
  const [error, setError] = useState('');

  // Load preferences
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/notifications/preferences');
        if (res.ok) {
          const json = await res.json();
          setPrefs(json.data || { defaultChannels: ['in_app'], quietHours: null, dailyDigest: false, webhookUrl: '', discordWebhookUrl: '' });
        }
      } catch (e) {
        setError('Failed to load preferences');
      }
    })();
  }, []);

  const save = useCallback(async (updates) => {
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/notifications/preferences', {
        method: 'POST',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const json = await res.json();
        setPrefs(prev => ({ ...prev, ...json.data }));

      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.message || 'Save failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [prefs]);

  const toggleChannel = useCallback((ch) => {
    if (ch === 'in_app') return; // Always on
    const current = prefs?.defaultChannels || ['in_app'];
    const next = current.includes(ch)
      ? current.filter(c => c !== ch)
      : [...current, ch];
    setPrefs(p => ({ ...p, defaultChannels: next }));
    save({ defaultChannels: next });
  }, [prefs, save]);

  const testWebhook = useCallback(async () => {
    const url = prefs?.discordWebhookUrl || prefs?.webhookUrl;
    if (!url) return;
    setTestStatus('testing');
    try {
      const res = await apiFetch('/api/notifications/preferences/test-webhook', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setTestStatus(res.ok ? 'success' : 'failed');
    } catch {
      setTestStatus('failed');
    }
    setTimeout(() => setTestStatus(''), 3000);
  }, [prefs]);

  if (!prefs) {
    return (
      <div className="np-container">
        <div className="np-header">
          <span className="np-title">Notification Preferences</span>
          {onClose && <button className="btn np-close" onClick={onClose}>✕</button>}
        </div>
        <div className="np-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="np-container">
      <div className="np-header">
        <span className="np-title">Notification Preferences</span>
        {onClose && <button className="btn np-close" onClick={onClose}>✕</button>}
      </div>

      {error && <div className="np-error">{error}</div>}

      {/* Channels */}
      <div className="np-section">
        <div className="np-section-title">Default Channels</div>
        <div className="np-section-desc">Choose how you want to receive alert notifications.</div>
        <div className="np-channels">
          {CHANNELS.map(ch => (
            <button
              key={ch.key}
              className={`btn np-channel ${(prefs.defaultChannels || []).includes(ch.key) ? 'np-channel--active' : ''} ${ch.disabled ? 'np-channel--disabled' : ''}`}
              onClick={() => !ch.disabled && !ch.alwaysOn && toggleChannel(ch.key)}
              disabled={ch.disabled || ch.alwaysOn}
            >
              <span className="np-channel-icon">{ch.icon}</span>
              <span className="np-channel-label">{ch.label}</span>
              <span className="np-channel-desc">{ch.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Webhook URLs */}
      {((prefs.defaultChannels || []).includes('discord') || (prefs.defaultChannels || []).includes('webhook')) && (
        <div className="np-section">
          <div className="np-section-title">Webhook Configuration</div>
          <label className="np-field">
            <span className="np-field-label">Discord Webhook URL</span>
            <input
              className="np-input"
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={prefs.discordWebhookUrl || ''}
              onChange={e => setPrefs(p => ({ ...p, discordWebhookUrl: e.target.value }))}
              onBlur={() => save({ discordWebhookUrl: prefs.discordWebhookUrl || null })}
            />
          </label>
          <label className="np-field">
            <span className="np-field-label">Generic Webhook URL</span>
            <input
              className="np-input"
              type="url"
              placeholder="https://your-server.com/webhook"
              value={prefs.webhookUrl || ''}
              onChange={e => setPrefs(p => ({ ...p, webhookUrl: e.target.value }))}
              onBlur={() => save({ webhookUrl: prefs.webhookUrl || null })}
            />
          </label>
          <button className="btn np-test-btn" onClick={testWebhook} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' ? 'Testing...' : testStatus === 'success' ? '✓ Sent!' : testStatus === 'failed' ? '✕ Failed' : 'Test Webhook'}
          </button>
        </div>
      )}

      {/* Quiet Hours */}
      <div className="np-section">
        <div className="np-section-title">Quiet Hours</div>
        <div className="np-section-desc">No email/webhook/push notifications during these hours. In-app alerts still work.</div>
        <div className="np-quiet-row">
          <label className="np-field np-field--inline">
            <span className="np-field-label">From</span>
            <input
              className="np-input np-input--time"
              type="time"
              value={prefs.quietHours?.start || '22:00'}
              onChange={e => {
                const qh = { ...(prefs.quietHours || {}), start: e.target.value };
                setPrefs(p => ({ ...p, quietHours: qh }));
              }}
              onBlur={() => save({ quietHours: prefs.quietHours })}
            />
          </label>
          <label className="np-field np-field--inline">
            <span className="np-field-label">To</span>
            <input
              className="np-input np-input--time"
              type="time"
              value={prefs.quietHours?.end || '07:00'}
              onChange={e => {
                const qh = { ...(prefs.quietHours || {}), end: e.target.value };
                setPrefs(p => ({ ...p, quietHours: qh }));
              }}
              onBlur={() => save({ quietHours: prefs.quietHours })}
            />
          </label>
          <button
            className={`btn np-toggle ${prefs.quietHours?.start ? 'np-toggle--on' : ''}`}
            onClick={() => {
              const next = prefs.quietHours?.start ? null : { start: '22:00', end: '07:00' };
              setPrefs(p => ({ ...p, quietHours: next }));
              save({ quietHours: next });
            }}
          >{prefs.quietHours?.start ? 'ON' : 'OFF'}</button>
        </div>
      </div>

      {/* Daily Digest */}
      <div className="np-section">
        <div className="np-section-title">Daily Digest</div>
        <div className="np-section-desc">Get a summary of all triggered alerts from the past 24 hours.</div>
        <button
          className={`btn np-toggle ${prefs.dailyDigest ? 'np-toggle--on' : ''}`}
          onClick={() => {
            const next = !prefs.dailyDigest;
            setPrefs(p => ({ ...p, dailyDigest: next }));
            save({ dailyDigest: next });
          }}
        >{prefs.dailyDigest ? 'ENABLED' : 'DISABLED'}</button>
      </div>

      <div className="np-footer">
        <span className="np-footer-text">Changes auto-save. Alert channels can also be overridden per-alert.</span>
      </div>

      {saving && <div className="np-saving">Saving...</div>}
    </div>
  );
}

export default memo(NotificationPrefs);
