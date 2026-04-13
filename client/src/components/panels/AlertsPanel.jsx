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
import { useOpenDetail } from '../../context/OpenDetailContext';
import Badge from '../ui/Badge';
import './AlertsPanel.css';

const ALERT_TYPE_LABELS = {
  price_above:         '\u{1F514} Price Above',
  price_below:         '\u{1F514} Price Below',
  pct_move_from_entry: '% Move',
  fx_level_above:      '\u{1F4B1} FX Above',
  fx_level_below:      '\u{1F4B1} FX Below',
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

const AlertRow = memo(function AlertRow({ alert, onEdit, onToggle, onDismiss }) {
  const openDetail = useOpenDetail();
  const isTriggered = !!alert.triggeredAt;
  const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;

  return (
    <div
      className={`ap-row ${!alert.active && !isTriggered ? 'ap-row--inactive' : ''}`}
      onClick={() => openDetail(alert.symbol)}
      onTouchEnd={(e) => { e.preventDefault(); openDetail(alert.symbol); }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {/* Symbol */}
      <span className={`ap-row-symbol ${isTriggered ? 'ap-row-symbol--triggered' : 'ap-row-symbol--default'}`}>
        {alert.symbol}
      </span>

      {/* Type badge */}
      <Badge variant="neutral" size="xs">
        {typeLabel}
      </Badge>

      {/* Condition + status */}
      <div className="ap-condition">
        <span className="ap-condition-text">
          {conditionSummary(alert)}
        </span>
        {isTriggered && (
          <Badge variant="error" size="xs" className="ap-condition-triggered">
            Triggered {timeAgo(alert.triggeredAt)}
          </Badge>
        )}
        {!isTriggered && !alert.active && (
          <Badge variant="warning" size="xs" className="ap-condition-inactive">
            Inactive
          </Badge>
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
      ><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>

      {/* Dismiss / toggle */}
      {isTriggered && !alert.dismissed ? (
        <button className="btn ap-dismiss-btn"
          onClick={e => { e.stopPropagation(); onDismiss(alert.id); }}
          title="Dismiss notification"
        ><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>
      ) : (
        <button className={`btn ap-toggle-btn ${alert.active ? 'ap-toggle-btn--active' : 'ap-toggle-btn--inactive'}`}
          onClick={e => { e.stopPropagation(); onToggle(alert); }}
          title={alert.active ? 'Deactivate' : 'Reactivate'}
        >{alert.active ? '●' : '○'}</button>
      )}
    </div>
  );
});

function AlertsPanel() {
  const openDetail = useOpenDetail();
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
          ALERTS
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
            icon=""
            title="No alerts"
            message="Create alerts to get notified when conditions are met."
          />
        ) : (
          alerts.map(a => (
            <AlertRow
              key={a.id}
              alert={a}
              onEdit={handleEdit}
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
