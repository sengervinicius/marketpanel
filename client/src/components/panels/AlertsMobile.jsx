/**
 * AlertsMobile.jsx — Mobile alerts panel
 *
 * Lists all user alerts in a mobile-friendly layout.
 * Uses shared mobile CSS primitives (.m-search, .m-chip, .m-row, .m-toast, etc.)
 */

import { memo, useState, useMemo, useCallback } from 'react';
import AlertEditor from '../common/AlertEditor';
import { useAlerts } from '../../context/AlertsContext';

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
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-app)', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--sp-4)',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px' }}>
          Alerts
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {alerts.length > 0 && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(255, 102, 0, 0.12)',
              color: 'var(--accent)',
              fontSize: 12, fontWeight: 600,
              borderRadius: '50%', width: 24, height: 24,
            }}>{alerts.length}</div>
          )}
          <button onClick={() => setShowNew(true)} style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '2px solid var(--accent)',
            background: 'none', color: 'var(--accent)',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'rgba(255, 102, 0, 0.1)',
          }} title="New alert">+</button>
        </div>
      </div>

      {/* Filter chips */}
      {alerts.length > 0 && (
        <div style={{
          display: 'flex', gap: 8,
          padding: 'var(--sp-3) var(--sp-4)',
          flexShrink: 0, overflowX: 'auto',
        }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'triggered', label: 'Triggered' },
          ].map(f => (
            <button
              key={f.key}
              className="m-chip"
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
          <div className="m-empty-icon">🔔</div>
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
        <div style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: 'var(--sp-8) var(--sp-4)',
              textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
            }}>
              No {filter} alerts
            </div>
          ) : (
            filtered.map(alert => {
              const isTriggered = !!alert.triggeredAt;
              const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;

              return (
                <div
                  key={alert.id}
                  className="m-row"
                  onClick={() => onOpenDetail?.(alert.symbol)}
                  style={{
                    padding: '0 var(--sp-4)', minHeight: 60,
                    opacity: !alert.active && !isTriggered ? 0.5 : 1,
                  }}
                >
                  {/* Symbol + type + condition */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{
                        color: isTriggered ? 'var(--price-up)' : 'var(--text-primary)',
                        fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px',
                      }}>
                        {alert.symbol}
                      </span>
                      <span style={{
                        color: 'var(--text-muted)', fontSize: 10,
                        padding: '1px 4px', borderRadius: 2,
                        background: 'var(--bg-elevated)',
                      }}>
                        {typeLabel}
                      </span>
                    </div>
                    <div style={{
                      color: 'var(--text-secondary)', fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {conditionText(alert)}
                    </div>
                    {isTriggered && (
                      <div style={{ color: 'var(--price-up)', fontSize: 11, marginTop: 2 }}>
                        Triggered {timeAgo(alert.triggeredAt)}
                      </div>
                    )}
                    {alert.note && (
                      <div style={{
                        color: 'var(--text-faint)', fontSize: 11, marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {alert.note}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {isTriggered && !alert.dismissed ? (
                      <button
                        onClick={e => { e.stopPropagation(); handleDismiss(alert.id); }}
                        style={{
                          background: 'rgba(76,175,80,0.12)', border: 'none',
                          color: 'var(--price-up)', borderRadius: 4,
                          padding: '4px 8px', fontSize: 11, fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >Dismiss</button>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); handleToggle(alert); }}
                        style={{
                          background: 'none', border: 'none',
                          color: alert.active ? 'var(--price-up)' : 'var(--text-faint)',
                          cursor: 'pointer', fontSize: 16, padding: 4,
                        }}
                      >{alert.active ? '●' : '○'}</button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); setEditorAlert(alert); }}
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--text-faint)', cursor: 'pointer',
                        fontSize: 16, padding: 4,
                      }}
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
