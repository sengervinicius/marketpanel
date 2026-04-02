/**
 * AlertEditor.jsx
 * Modal for creating or editing price/FX/pct alerts.
 * Reuses PositionEditor CSS classes for consistent styling.
 *
 * Props:
 *   alert:        existing alert object to edit (null for new)
 *   defaultSymbol: pre-filled symbol (from portfolio row or instrument detail)
 *   defaultPrice:  pre-filled current price
 *   defaultEntryPrice: pre-filled entry price (from portfolio position)
 *   defaultPositionId: link to portfolio position ID
 *   onClose:      callback when editor closes
 *   mobile:       boolean for mobile-friendly layout
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { useAlerts } from '../../context/AlertsContext';
import './PositionEditor.css'; // reuse same CSS

const ALERT_TYPES = [
  { value: 'price_above',          label: 'Price Above' },
  { value: 'price_below',          label: 'Price Below' },
  { value: 'pct_move_from_entry',  label: '% Move from Entry' },
  { value: 'fx_level_above',       label: 'FX Level Above' },
  { value: 'fx_level_below',       label: 'FX Level Below' },
];

function AlertEditor({
  alert,
  defaultSymbol = '',
  defaultPrice = null,
  defaultEntryPrice = null,
  defaultPositionId = null,
  onClose,
  mobile = false,
}) {
  const { createAlert, updateAlert, deleteAlert } = useAlerts();

  const isEditing = !!alert;

  // Form state
  const [symbol, setSymbol]           = useState(alert?.symbol || defaultSymbol);
  const [type, setType]               = useState(alert?.type || 'price_above');
  const [targetPrice, setTargetPrice] = useState(
    alert?.parameters?.targetPrice?.toString() || defaultPrice?.toString() || ''
  );
  const [pctChange, setPctChange]     = useState(
    alert?.parameters?.pctChange?.toString() || ''
  );
  const [entryPrice, setEntryPrice]   = useState(
    alert?.parameters?.entryPrice?.toString() || defaultEntryPrice?.toString() || ''
  );
  const [direction, setDirection]     = useState(alert?.parameters?.direction || 'up');
  const [note, setNote]               = useState(alert?.note || '');
  const [positionId]                  = useState(alert?.portfolioPositionId || defaultPositionId);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Auto-detect FX types from symbol
  useEffect(() => {
    if (!isEditing && symbol) {
      const sym = symbol.toUpperCase();
      if (sym.startsWith('C:') || (/^[A-Z]{6}$/.test(sym) && !sym.endsWith('USD'))) {
        if (type === 'price_above') setType('fx_level_above');
        if (type === 'price_below') setType('fx_level_below');
      }
    }
  }, [symbol, isEditing, type]);

  const isPctType = type === 'pct_move_from_entry';
  const symbolReadOnly = !!(defaultSymbol || isEditing);

  const handleSave = useCallback(async () => {
    setError('');
    const sym = symbol.trim().toUpperCase();
    if (!sym) { setError('Symbol is required'); return; }

    const params = {};
    if (isPctType) {
      const pct = parseFloat(pctChange);
      const entry = parseFloat(entryPrice);
      if (isNaN(pct)) { setError('% threshold is required'); return; }
      if (isNaN(entry) || entry <= 0) { setError('Entry price must be positive'); return; }
      params.pctChange = pct;
      params.entryPrice = entry;
      params.direction = direction;
    } else {
      const target = parseFloat(targetPrice);
      if (isNaN(target) || target <= 0) { setError('Target price must be positive'); return; }
      params.targetPrice = target;
    }

    const payload = {
      type,
      symbol: sym,
      parameters: params,
      note: note.trim() || null,
      portfolioPositionId: positionId,
    };

    setSaving(true);
    try {
      if (isEditing) {
        await updateAlert(alert.id, payload);
      } else {
        await createAlert(payload);
      }
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save alert');
    } finally {
      setSaving(false);
    }
  }, [symbol, type, targetPrice, pctChange, entryPrice, direction, note, positionId, isPctType, isEditing, alert, createAlert, updateAlert, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true);
    try {
      await deleteAlert(alert.id);
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to delete');
    } finally {
      setSaving(false);
    }
  }, [confirmDelete, alert, deleteAlert, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, handleSave]);

  return (
    <div
      className="pf-editor-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pf-editor-modal">
        {/* Header */}
        <div className="pf-editor-header">
          <span className="pf-editor-title">
            {isEditing ? 'Edit Alert' : 'New Alert'}
          </span>
          <button className="pf-editor-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="pf-editor-body">
          {/* Symbol */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">Symbol</label>
            <input
              className={`pf-editor-input ${symbolReadOnly ? 'pf-editor-input-readonly' : ''}`}
              value={symbol}
              onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. AAPL, C:EURUSD, X:BTCUSD"
              readOnly={symbolReadOnly}
              autoFocus={!symbolReadOnly}
            />
          </div>

          {/* Alert Type */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">Alert Type</label>
            <select
              className="pf-editor-select"
              value={type}
              onChange={e => setType(e.target.value)}
            >
              {ALERT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Price threshold (for price_above/below, fx_level_above/below) */}
          {!isPctType && (
            <div className="pf-editor-field-group">
              <label className="pf-editor-label">Target Price</label>
              <input
                className="pf-editor-input"
                type="number"
                step="any"
                min="0"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="e.g. 150.00"
                autoFocus={symbolReadOnly}
              />
            </div>
          )}

          {/* Pct move fields */}
          {isPctType && (
            <>
              <div className="pf-editor-field-group">
                <label className="pf-editor-label">% Change Threshold</label>
                <input
                  className="pf-editor-input"
                  type="number"
                  step="any"
                  value={pctChange}
                  onChange={e => setPctChange(e.target.value)}
                  placeholder="e.g. 5 (for 5%)"
                  autoFocus={symbolReadOnly}
                />
              </div>
              <div className="pf-editor-field-group">
                <label className="pf-editor-label">Entry / Reference Price</label>
                <input
                  className="pf-editor-input"
                  type="number"
                  step="any"
                  min="0"
                  value={entryPrice}
                  onChange={e => setEntryPrice(e.target.value)}
                  placeholder="e.g. 142.50"
                />
              </div>
              <div className="pf-editor-field-group">
                <label className="pf-editor-label">Direction</label>
                <select
                  className="pf-editor-select"
                  value={direction}
                  onChange={e => setDirection(e.target.value)}
                >
                  <option value="up">Up (price rises)</option>
                  <option value="down">Down (price falls)</option>
                  <option value="">Either direction</option>
                </select>
              </div>
            </>
          )}

          {/* Note */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">Note (optional)</label>
            <input
              className="pf-editor-input"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Take profit target"
              maxLength={200}
            />
          </div>

          {/* Linked position indicator */}
          {positionId && (
            <div style={{
              fontSize: 'var(--font-sm, 9px)', color: 'var(--text-muted)',
              padding: '4px 0', borderTop: '1px solid var(--border-default)',
            }}>
              Linked to portfolio position
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              color: 'var(--price-down, #ff1744)',
              fontSize: 'var(--font-sm, 9px)',
              padding: '4px 0',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pf-editor-footer">
          {isEditing && (
            <button className="btn pf-editor-btn pf-editor-btn-delete"

              onClick={handleDelete}
              disabled={saving}
            >
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </button>
          )}
          <div className="pf-editor-footer-spacer" />
          <button className="btn pf-editor-btn pf-editor-btn-cancel"

            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="btn pf-editor-btn pf-editor-btn-primary"

            onClick={handleSave}
            disabled={saving || !symbol.trim()}
          >
            {saving ? 'Saving…' : isEditing ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(AlertEditor);
