/**
 * AlertsPanel.jsx — Desktop alerts panel
 *
 * Lists all user alerts (active + triggered).
 * Shows symbol, condition, status, triggered time.
 * Quick actions: edit, delete, toggle active, dismiss.
 * Links to InstrumentDetail.
 */

import { useState, useCallback, memo } from 'react';
import PanelShell from '../common/PanelShell';
import AlertEditor from '../common/AlertEditor';
import EmptyState from '../common/EmptyState';
import { useAlerts } from '../../context/AlertsContext';
import './AlertsPanel.css';

const ALERT_TYPE_LABELS = {
  price_above:         '> Price',
  price_below:         '< Price',
  pct_move_from_entry: '% Move',
  fx_level_above:      '> FX',
  fx_level_below:      '< FX',
};

function conditionSummary(alert) {
  const p = alert.parameters || {};
  switch (alert.type) {
    case 'price_above':
    case 'fx_level_above':
      return `≥ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'price_below':
    case 'fx_level_below':
      return `≤ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'pct_move_from_entry':
      return `${p.direction === 'down' ? '↓' : p.direction === 'up' ? '↑' : '↕'} ${Math.abs(p.pctChange ?? 0).toFixed(1)}% from ${p.entryPrice?.toFixed(2) ?? '?'}`;
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

const COLS = '72px 56px 1fr 56px 24px';

const AlertRow = memo(function AlertRow({ alert, onEdit, onOpenDetail, onToggle, onDismiss }) {
  const isTriggered = !!alert.triggeredAt;
  const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;

  return (
    <div
      className={`ap-row ${!alert.active && !isTriggered ? 'ap-row.inactive' : ''}`}
      onClick={() => onOpenDetail?.(alert.symbol)}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {/* Symbol */}
      <span className={`ap-row-symbol ${isTriggered ? 'ap-row-symbol.triggered' : 'ap-row-symbol.default'}`}>
        {alert.symbol}
      </span>

      {/* Type badge */}
      <span className="ap-type-badge">
        {typeLabel}
      </span>

      {/* Condition + status */}
      <div className="ap-condition">
        <span className="ap-condition-text">
          {conditionSummary(alert)}
        </span>
        {isTriggered && (
          <span className="ap-condition-triggered">
            Triggered {timeAgo(alert.triggeredAt)}
          </span>
        )}
        {!isTriggered && !alert.active && (
          <span className="ap-condition-inactive">
            Inactive
          </span>
        )}
        {alert.note && (
          <span className="ap-condition-note">
            {alert.note}
          </span>
        )}
      </div>

      {/* Edit button */}
      <button className="btn ap-edit-btn"
        onClick={e => { e.stopPropagation(); onEdit(alert); }}
        title="Edit alert"
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >✎</button>

      {/* Dismiss / toggle */}
      {isTriggered && !alert.dismissed ? (
        <button className="btn ap-dismiss-btn"
          onClick={e => { e.stopPropagation(); onDismiss(alert.id); }}
          title="Dismiss notification"
        >✓</button>
      ) : (
        <button className={`btn ap-toggle-btn ${alert.active ? 'ap-toggle-btn.active' : 'ap-toggle-btn.inactive'}`}
          onClick={e => { e.stopPropagation(); onToggle(alert); }}
          title={alert.active ? 'Deactivate' : 'Reactivate'}
        >{alert.active ? '●' : '○'}</button>
      )}
    </div>
  );
});

function AlertsPanel({ onOpenDetail }) {
  const { alerts, updateAlert, dismissAlert } = useAlerts();
  const [editorAlert, setEditorAlert] = useState(null); // null or alert obj to edit
  const [showNew, setShowNew] = useState(false);

  const handleEdit = useCallback((alert) => setEditorAlert(alert), []);
  const handleCloseEditor = useCallback(() => { setEditorAlert(null); setShowNew(false); }, []);

  const handleToggle = useCallback(async (alert) => {
    try {
      await updateAlert(alert.id, { active: !alert.active });
    } catch (e) {
      console.warn('Failed to toggle alert:', e.message);
    }
  }, [updateAlert]);

  const handleDismiss = useCallback(async (alertId) => {
    try {
      await dismissAlert(alertId);
    } catch (e) {
      console.warn('Failed to dismiss:', e.message);
    }
  }, [dismissAlert]);

  return (
    <PanelShell>
      {/* Header */}
      <div className="ap-header flex-row">
        <span className="ap-header-title">
          🔔 ALERTS
        </span>
        <span className="ap-header-count">
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
        <div className="ap-header-spacer" />
        <button className="btn ap-new-btn"
          onClick={() => setShowNew(true)}
        >+ NEW</button>
      </div>

      {/* Column headers */}
      <div className="ap-col-header">
        {['SYMBOL', 'TYPE', 'CONDITION', '', ''].map((h, i) => (
          <span key={i} className="ap-col-header-cell">{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="ap-rows-container">
        {alerts.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No alerts"
            message="Create alerts to get notified when conditions are met."
          />
        ) : (
          alerts.map(a => (
            <AlertRow
              key={a.id}
              alert={a}
              onEdit={handleEdit}
              onOpenDetail={onOpenDetail}
              onToggle={handleToggle}
              onDismiss={handleDismiss}
            />
          ))
        )}
      </div>

      {/* Alert editor modals */}
      {editorAlert && (
        <AlertEditor
          alert={editorAlert}
          onClose={handleCloseEditor}
        />
      )}
      {showNew && (
        <AlertEditor
          alert={null}
          onClose={handleCloseEditor}
        />
      )}
    </PanelShell>
  );
}

export default memo(AlertsPanel);
