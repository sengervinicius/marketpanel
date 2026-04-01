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
      onClick={() => onOpenDetail?.(alert.symbol)}
      style={{
        display: 'grid', gridTemplateColumns: COLS, padding: '3px 8px',
        borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
        alignItems: 'center', transition: 'background-color 0.1s',
        opacity: !alert.active && !isTriggered ? 0.5 : 1,
      }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-hover)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      {/* Symbol */}
      <span style={{
        color: isTriggered ? 'var(--price-up)' : 'var(--section-watchlist)',
        fontSize: 'var(--font-base)', fontWeight: 700,
      }}>
        {alert.symbol}
      </span>

      {/* Type badge */}
      <span style={{
        color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
        fontWeight: 600, letterSpacing: '0.3px',
      }}>
        {typeLabel}
      </span>

      {/* Condition + status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
        <span style={{
          color: 'var(--text-primary)', fontSize: 'var(--font-base)',
          fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {conditionSummary(alert)}
        </span>
        {isTriggered && (
          <span style={{ color: 'var(--price-up)', fontSize: 'var(--font-sm)' }}>
            Triggered {timeAgo(alert.triggeredAt)}
          </span>
        )}
        {!isTriggered && !alert.active && (
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-sm)' }}>
            Inactive
          </span>
        )}
        {alert.note && (
          <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {alert.note}
          </span>
        )}
      </div>

      {/* Edit button */}
      <button
        onClick={e => { e.stopPropagation(); onEdit(alert); }}
        title="Edit alert"
        style={{
          background: 'none', border: 'none', color: 'var(--text-faint)',
          cursor: 'pointer', fontSize: 'var(--font-base)', padding: 0, textAlign: 'center',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
      >✎</button>

      {/* Dismiss / toggle */}
      {isTriggered && !alert.dismissed ? (
        <button
          onClick={e => { e.stopPropagation(); onDismiss(alert.id); }}
          title="Dismiss notification"
          style={{
            background: 'none', border: 'none', color: 'var(--price-up)',
            cursor: 'pointer', fontSize: 'var(--font-base)', padding: 0, textAlign: 'center',
          }}
        >✓</button>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onToggle(alert); }}
          title={alert.active ? 'Deactivate' : 'Reactivate'}
          style={{
            background: 'none', border: 'none',
            color: alert.active ? 'var(--price-up)' : 'var(--text-faint)',
            cursor: 'pointer', fontSize: 10, padding: 0, textAlign: 'center',
          }}
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
      <div style={{
        padding: '4px 8px', borderBottom: '1px solid var(--border-strong)',
        background: 'var(--bg-elevated)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: 'var(--accent)', fontSize: 'var(--font-base)', fontWeight: 700, letterSpacing: '1px' }}>
          🔔 ALERTS
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowNew(true)}
          style={{
            background: 'none', border: '1px solid var(--border-strong)',
            color: 'var(--accent)', fontSize: 9, padding: '1px 6px',
            cursor: 'pointer', fontFamily: 'inherit', borderRadius: 'var(--radius-sm)',
          }}
        >+ NEW</button>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid', gridTemplateColumns: COLS, padding: '2px 8px',
        borderBottom: '1px solid var(--border-default)', flexShrink: 0,
      }}>
        {['SYMBOL', 'TYPE', 'CONDITION', '', ''].map((h, i) => (
          <span key={i} style={{
            color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
            fontWeight: 700, letterSpacing: '1px',
          }}>{h}</span>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
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
