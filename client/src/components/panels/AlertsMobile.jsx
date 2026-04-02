/**
 * AlertsMobile.jsx — Mobile alerts panel
 *
 * Lists all user alerts in a mobile-friendly layout.
 * Uses shared mobile CSS primitives (.m-search, .m-chip, .m-row, .m-toast, etc.)
 */

import { memo, useState, useMemo, useCallback } from 'react';
import AlertEditor from '../common/AlertEditor';
import { useAlerts } from '../../context/AlertsContext';
import './AlertsMobile.css';

const ALERT_TYPE_LABELS = {
  price_above:         'Price Above',
  price_below:         'Price Below',
  pct_move_from_entry: '% Move',
  fx_level_above:      'FX Above',
  fx_level_below:      'FX Below',
};

function conditionText(alert) {
  const p = alert.parameters || {};
  switch (alert.type) {
    case 'price_above':
    case 'fx_level_above':
      return `≥ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'price_below':
    case 'fx_level_below':
      return `≤ ${p.targetPrice?.toFixed(2) ?? '?'}`;
    case 'pct_move_from_entry': {
      const dir = p.direction === 'down' ? '↓' : p.direction === 'up' ? '↑' : '↕';
      return `${dir} ${Math.abs(p.pctChange ?? 0).toFixed(1)}% from ${p.entryPrice?.toFixed(2) ?? '?'}`;
    }
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

function AlertsMobile({ onOpenDetail }) {
  const { alerts, updateAlert, dismissAlert } = useAlerts();
  const [filter, setFilter] = useState('all'); // 'all' | 'active' | 'triggered'
  const [editorAlert, setEditorAlert] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'active') return alerts.filter(a => a.active);
    if (filter === 'triggered') return alerts.filter(a => !!a.triggeredAt);
    return alerts;
  }, [alerts, filter]);

  const handleToggle = useCallback(async (alert) => {
    try {
      await updateAlert(alert.id, { active: !alert.active });
    } catch (e) {
      console.warn('Failed to toggle:', e.message);
    }
  }, [updateAlert]);

  const handleDismiss = useCallback(async (alertId) => {
    try {
      await dismissAlert(alertId);
    } catch (e) {
      console.warn('Failed to dismiss:', e.message);
    }
  }, [dismissAlert]);

  const handleCloseEditor = useCallback(() => {
    setEditorAlert(null);
    setShowNew(false);
  }, []);

  return (
    <div className="am-container">
      {/* Header */}
      <div className="am-header">
        <span className="am-header-title">
          Alerts
        </span>
        <div className="am-header-actions">
          {alerts.length > 0 && (
            <div className="am-badge">{alerts.length}</div>
          )}
          <button className="btn am-new-btn" onClick={() => setShowNew(true)} title="New alert">+</button>
        </div>
      </div>

      {/* Filter chips */}
      {alerts.length > 0 && (
        <div className="am-filters">
          {[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'triggered', label: 'Triggered' },
          ].map(f => (
            <button className="btn m-chip"
              key={f.key}
              data-active={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      {alerts.length === 0 ? (
        <div className="m-empty">
          <div className="m-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
          <div className="m-empty-text">
            No alerts yet.
            <br />
            Create one to monitor prices.
          </div>
          <button className="m-btn-primary" onClick={() => setShowNew(true)}>
            Create Alert
          </button>
        </div>
      ) : (
        <div className="am-list-container">
          {filtered.length === 0 ? (
            <div className="am-list-empty-msg">
              No {filter} alerts
            </div>
          ) : (
            filtered.map(alert => {
              const isTriggered = !!alert.triggeredAt;
              const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;

              return (
                <div
                  key={alert.id}
                  className={`m-row am-alert-row ${!alert.active && !isTriggered ? 'am-alert-row.inactive' : ''}`}
                  onClick={() => onOpenDetail?.(alert.symbol)}
                >
                  {/* Symbol + type + condition */}
                  <div className="am-alert-content">
                    <div className="am-alert-header">
                      <span className={`am-alert-symbol ${isTriggered ? 'am-alert-symbol.triggered' : ''}`}>
                        {alert.symbol}
                      </span>
                      <span className="am-alert-type">
                        {typeLabel}
                      </span>
                    </div>
                    <div className="am-alert-condition">
                      {conditionText(alert)}
                    </div>
                    {isTriggered && (
                      <div className="am-alert-triggered-time">
                        Triggered {timeAgo(alert.triggeredAt)}
                      </div>
                    )}
                    {alert.note && (
                      <div className="am-alert-note">
                        {alert.note}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="am-alert-actions">
                    {isTriggered && !alert.dismissed ? (
                      <button className="btn am-dismiss-btn"
                        onClick={e => { e.stopPropagation(); handleDismiss(alert.id); }}
                      >Dismiss</button>
                    ) : (
                      <button className={`btn am-toggle-btn ${alert.active ? 'am-toggle-btn.active' : 'am-toggle-btn.inactive'}`}
                        onClick={e => { e.stopPropagation(); handleToggle(alert); }}
                      >{alert.active ? '●' : '○'}</button>
                    )}
                    <button className="btn am-edit-btn"
                      onClick={e => { e.stopPropagation(); setEditorAlert(alert); }}
                    >✎</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Editor modals */}
      {editorAlert && (
        <AlertEditor alert={editorAlert} onClose={handleCloseEditor} mobile />
      )}
      {showNew && (
        <AlertEditor alert={null} onClose={handleCloseEditor} mobile />
      )}
    </div>
  );
}

export default memo(AlertsMobile);
