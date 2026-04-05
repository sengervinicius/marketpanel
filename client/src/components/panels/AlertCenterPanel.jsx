/**
 * AlertCenterPanel.jsx — Unified Alert Center
 *
 * Full-featured alert management: Active / Triggered / Muted-Snoozed tabs.
 * Shows condition, channels, trigger reason, and management actions.
 * Works on both desktop (panel) and mobile (full screen).
 */

import { useState, useCallback, useMemo, memo } from 'react';
import PanelShell from '../common/PanelShell';
import AlertEditor from '../common/AlertEditor';
import EmptyState from '../common/EmptyState';
import { useAlerts } from '../../context/AlertsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import { apiFetch } from '../../utils/api';
import Badge from '../ui/Badge';
import './AlertCenterPanel.css';

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'triggered', label: 'Triggered' },
  { key: 'muted', label: 'Muted / Snoozed' },
];

const TYPE_LABELS = {
  price_above: '▲ Price',
  price_below: '▼ Price',
  pct_move_from_entry: '% Move',
  fx_level_above: '▲ FX',
  fx_level_below: '▼ FX',
  screener: 'Screener',
};

const CHANNEL_ICONS = {
  in_app: '🔔',
  email: '✉',
  discord: '💬',
  webhook: '🔗',
  push: '📱',
};

function conditionText(alert) {
  const p = alert.parameters || {};
  switch (alert.type) {
    case 'price_above':
    case 'fx_level_above':
      return `${alert.symbol} ≥ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'price_below':
    case 'fx_level_below':
      return `${alert.symbol} ≤ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'pct_move_from_entry': {
      const dir = p.direction === 'down' ? '↓' : p.direction === 'up' ? '↑' : '↕';
      return `${alert.symbol} ${dir} ${Math.abs(p.pctChange ?? 0).toFixed(1)}% from ${p.entryPrice?.toFixed(2) ?? '?'}`;
    }
    case 'screener':
      return `Screener: ${p.screenerUniverse || 'Custom'} (${p.matchMode === 'new_match' ? 'new matches' : 'count change'})`;
    default:
      return alert.type;
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

function TriggerReason({ alert }) {
  if (!alert.triggeredAt) return null;
  const ctx = alert.triggerContext || {};
  return (
    <div className="ac-trigger-reason">
      <span className="ac-trigger-label">Triggered {timeAgo(alert.triggeredAt)}</span>
      {ctx.price != null && (
        <span className="ac-trigger-value">Price: {ctx.price}</span>
      )}
      {ctx.matchMode && (
        <span className="ac-trigger-value">
          {ctx.matchMode === 'new_match' ? 'New matches found' : `Count: ${ctx.lastMatchCount ?? '?'}`}
        </span>
      )}
    </div>
  );
}

const SNOOZE_OPTIONS = [
  { label: '1 hour', value: '1h' },
  { label: '8 hours', value: '8h' },
  { label: '1 day', value: '1d' },
  { label: '1 week', value: '1w' },
];

const AlertCenterRow = memo(function AlertCenterRow({ alert, onEdit, onAction }) {
  const openDetail = useOpenDetail();
  const [showSnooze, setShowSnooze] = useState(false);
  const typeLabel = TYPE_LABELS[alert.type] || alert.type;
  const isMuted = alert.status === 'muted';
  const isSnoozed = alert.status === 'snoozed';
  const isTriggered = !!alert.triggeredAt;
  const channels = alert.overrideChannels && alert.channels?.length ? alert.channels : null;

  return (
    <div className={`ac-row ${!alert.active && !isTriggered ? 'ac-row--dim' : ''}`}>
      <div className="ac-row-main" onClick={() => openDetail(alert.symbol)}>
        <div className="ac-row-top">
          <span className="ac-row-symbol">{alert.symbol === '__SCREENER__' ? 'SCREENER' : alert.symbol}</span>
          <Badge variant={isTriggered ? 'error' : isMuted ? 'warning' : 'neutral'} size="xs">{typeLabel}</Badge>
          {channels && (
            <span className="ac-row-channels">
              {channels.map(ch => <span key={ch} title={ch}>{CHANNEL_ICONS[ch] || ch}</span>)}
            </span>
          )}
        </div>
        <div className="ac-row-condition">{conditionText(alert)}</div>
        {alert.note && <div className="ac-row-note">{alert.note}</div>}
        <TriggerReason alert={alert} />
        {isSnoozed && alert.snoozedUntil && (
          <div className="ac-row-snoozed">
            Snoozed until {new Date(alert.snoozedUntil).toLocaleString()}
          </div>
        )}
      </div>

      <div className="ac-row-actions">
        {isTriggered && !alert.dismissed && (
          <button className="btn ac-action-btn ac-action--dismiss" onClick={() => onAction('dismiss', alert)} title="Dismiss">✓</button>
        )}
        {isTriggered && (
          <button className="btn ac-action-btn ac-action--rearm" onClick={() => onAction('rearm', alert)} title="Re-arm">↻</button>
        )}
        {!isMuted && !isTriggered && (
          <button className="btn ac-action-btn ac-action--mute" onClick={() => onAction('mute', alert)} title="Mute">🔇</button>
        )}
        {isMuted && (
          <button className="btn ac-action-btn ac-action--unmute" onClick={() => onAction('unmute', alert)} title="Unmute">🔔</button>
        )}
        {!isSnoozed && !isTriggered && (
          <button className="btn ac-action-btn ac-action--snooze" onClick={() => setShowSnooze(!showSnooze)} title="Snooze">💤</button>
        )}
        <button className="btn ac-action-btn ac-action--edit" onClick={() => onEdit(alert)} title="Edit">✎</button>
        <button className="btn ac-action-btn ac-action--delete" onClick={() => onAction('delete', alert)} title="Delete">✕</button>
      </div>

      {showSnooze && (
        <div className="ac-snooze-bar">
          {SNOOZE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className="btn ac-snooze-option"
              onClick={() => { onAction('snooze', alert, opt.value); setShowSnooze(false); }}
            >{opt.label}</button>
          ))}
        </div>
      )}
    </div>
  );
});

function AlertCenterPanel() {
  const openDetail = useOpenDetail();
  const { alerts, updateAlert, deleteAlert, dismissAlert, refreshAlerts } = useAlerts();
  const [tab, setTab] = useState('active');
  const [editorAlert, setEditorAlert] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'active':
        return alerts.filter(a => a.active && a.status !== 'muted' && a.status !== 'snoozed');
      case 'triggered':
        return alerts.filter(a => !!a.triggeredAt);
      case 'muted':
        return alerts.filter(a => a.status === 'muted' || a.status === 'snoozed');
      default:
        return alerts;
    }
  }, [alerts, tab]);

  const handleAction = useCallback(async (action, alert, extra) => {
    try {
      switch (action) {
        case 'dismiss':
          await dismissAlert(alert.id);
          break;
        case 'rearm':
          await apiFetch(`/api/alerts/${alert.id}/rearm`, { method: 'POST' });
          await refreshAlerts();
          break;
        case 'mute':
          await apiFetch(`/api/alerts/${alert.id}/mute`, { method: 'POST' });
          await refreshAlerts();
          break;
        case 'unmute':
          await apiFetch(`/api/alerts/${alert.id}/unmute`, { method: 'POST' });
          await refreshAlerts();
          break;
        case 'snooze':
          await apiFetch(`/api/alerts/${alert.id}/snooze`, { method: 'POST', body: JSON.stringify({ duration: extra }) });
          await refreshAlerts();
          break;
        case 'delete':
          await deleteAlert(alert.id);
          break;
      }
    } catch (e) {
      console.warn(`Alert action "${action}" failed:`, e.message);
    }
  }, [dismissAlert, deleteAlert, refreshAlerts]);

  const triggeredCount = alerts.filter(a => a.triggeredAt && !a.dismissed).length;

  return (
    <PanelShell>
      <div className="ac-header">
        <span className="ac-header-title">ALERT CENTER</span>
        {triggeredCount > 0 && <Badge variant="error" size="xs">{triggeredCount}</Badge>}
        <div className="ac-header-spacer" />
        <button className="btn ac-new-btn" onClick={() => setShowNew(true)}>+ NEW</button>
      </div>

      <div className="ac-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`btn ac-tab ${tab === t.key ? 'ac-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'triggered' && triggeredCount > 0 && (
              <span className="ac-tab-badge">{triggeredCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="ac-rows">
        {filtered.length === 0 ? (
          <EmptyState
            icon=""
            title={tab === 'active' ? 'No active alerts' : tab === 'triggered' ? 'No triggered alerts' : 'No muted alerts'}
            message={tab === 'active' ? 'Create alerts to monitor price conditions.' : ''}
          />
        ) : (
          filtered.map(a => (
            <AlertCenterRow
              key={a.id}
              alert={a}
              onEdit={setEditorAlert}
              onAction={handleAction}
            />
          ))
        )}
      </div>

      {editorAlert && <AlertEditor alert={editorAlert} onClose={() => setEditorAlert(null)} />}
      {showNew && <AlertEditor alert={null} onClose={() => setShowNew(false)} />}
    </PanelShell>
  );
}

export default memo(AlertCenterPanel);
