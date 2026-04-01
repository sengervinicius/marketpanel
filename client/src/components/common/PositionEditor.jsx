/**
 * PositionEditor.jsx
 * Modal/overlay for adding or editing a position in the portfolio.
 * Supports both desktop and mobile layouts.
 *
 * Props:
 *   position: existing position object to edit (null for new)
 *   defaultPortfolioId: default portfolio ID for new positions
 *   defaultSubportfolioId: default subportfolio ID for new positions
 *   onClose: callback when editor closes
 *   mobile: boolean for mobile-friendly layout
 */

import { memo, useState, useCallback } from 'react';
import { usePortfolio } from '../../context/PortfolioContext';
import './PositionEditor.css';

function PositionEditor({
  position,
  defaultPortfolioId,
  defaultSubportfolioId,
  onClose,
  mobile = false,
}) {
  const { portfolios, addPosition, updatePosition, removePosition } = usePortfolio();

  const isEditing = !!position;

  // Initialize form state
  const [symbol, setSymbol] = useState(position?.symbol || '');
  const [portfolioId, setPortfolioId] = useState(
    position?.portfolioId || defaultPortfolioId || (portfolios[0]?.id || '')
  );
  const [subportfolioId, setSubportfolioId] = useState(
    position?.subportfolioId || defaultSubportfolioId || (portfolios[0]?.subportfolios[0]?.id || '')
  );
  const [investedAmount, setInvestedAmount] = useState(position?.investedAmount ?? '');
  const [quantity, setQuantity] = useState(position?.quantity ?? '');
  const [entryPrice, setEntryPrice] = useState(position?.entryPrice ?? '');
  const [currency, setCurrency] = useState(position?.currency || 'USD');
  const [note, setNote] = useState(position?.note || '');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Get subportfolios for selected portfolio
  const currentPortfolio = portfolios.find(p => p.id === portfolioId);
  const subportfolios = currentPortfolio?.subportfolios || [];

  // Auto-select first subportfolio if current becomes invalid
  const validSubportfolioId = subportfolios.some(sp => sp.id === subportfolioId)
    ? subportfolioId
    : (subportfolios[0]?.id || '');

  const handleSymbolChange = useCallback((e) => {
    setSymbol(e.target.value.toUpperCase());
  }, []);

  const handlePortfolioChange = useCallback((e) => {
    const newPortfolioId = e.target.value;
    setPortfolioId(newPortfolioId);
    // Auto-select first subportfolio of new portfolio
    const newPortfolio = portfolios.find(p => p.id === newPortfolioId);
    if (newPortfolio?.subportfolios[0]) {
      setSubportfolioId(newPortfolio.subportfolios[0].id);
    }
  }, [portfolios]);

  const handleSave = useCallback(() => {
    if (!symbol.trim()) {
      alert('Symbol is required');
      return;
    }

    if (isEditing) {
      updatePosition(position.id, {
        symbol: symbol.trim().toUpperCase(),
        portfolioId,
        subportfolioId: validSubportfolioId,
        investedAmount: investedAmount ? parseFloat(investedAmount) : null,
        quantity: quantity ? parseFloat(quantity) : null,
        entryPrice: entryPrice ? parseFloat(entryPrice) : null,
        currency,
        note: note.trim(),
      });
    } else {
      addPosition({
        symbol: symbol.trim().toUpperCase(),
        portfolioId,
        subportfolioId: validSubportfolioId,
        investedAmount: investedAmount ? parseFloat(investedAmount) : null,
        quantity: quantity ? parseFloat(quantity) : null,
        entryPrice: entryPrice ? parseFloat(entryPrice) : null,
        currency,
        note: note.trim(),
      });
    }

    onClose();
  }, [symbol, portfolioId, validSubportfolioId, investedAmount, quantity, entryPrice, currency, note, isEditing, position, updatePosition, addPosition, onClose]);

  const handleDelete = useCallback(() => {
    if (deleteConfirm) {
      removePosition(position.id);
      onClose();
    } else {
      setDeleteConfirm(true);
    }
  }, [deleteConfirm, position, removePosition, onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  }, [onClose, handleSave]);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      className={`pf-editor-overlay ${mobile ? 'pf-editor-mobile' : ''}`}
      onClick={handleBackdropClick}
      onMouseDown={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="pf-editor-modal">
        {/* Header */}
        <div className="pf-editor-header">
          <span className="pf-editor-title">
            {isEditing ? 'EDIT POSITION' : 'ADD POSITION'}
          </span>
          <button
            className="pf-editor-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="pf-editor-body">
          {/* Symbol */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">SYMBOL</label>
            <input
              type="text"
              className={`pf-editor-input ${isEditing ? 'pf-editor-input-readonly' : ''}`}
              value={symbol}
              onChange={handleSymbolChange}
              placeholder="e.g., AAPL"
              readOnly={isEditing}
              autoFocus={!isEditing}
            />
          </div>

          {/* Portfolio */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">PORTFOLIO</label>
            <select
              className="pf-editor-select"
              value={portfolioId}
              onChange={handlePortfolioChange}
            >
              {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Subportfolio */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">SUBPORTFOLIO</label>
            <select
              className="pf-editor-select"
              value={validSubportfolioId}
              onChange={(e) => setSubportfolioId(e.target.value)}
            >
              {subportfolios.map(sp => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
          </div>

          {/* Invested Amount */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">INVESTED AMOUNT (optional)</label>
            <input
              type="number"
              className="pf-editor-input"
              value={investedAmount}
              onChange={(e) => setInvestedAmount(e.target.value)}
              placeholder="0.00"
              step="0.01"
            />
          </div>

          {/* Quantity */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">QUANTITY (optional)</label>
            <input
              type="number"
              className="pf-editor-input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              step="0.01"
            />
          </div>

          {/* Entry Price */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">ENTRY PRICE (optional)</label>
            <input
              type="number"
              className="pf-editor-input"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
            />
          </div>

          {/* Currency */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">CURRENCY</label>
            <select
              className="pf-editor-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="USD">USD</option>
              <option value="BRL">BRL</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>

          {/* Note */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">NOTE (optional)</label>
            <input
              type="text"
              className="pf-editor-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="pf-editor-footer">
          {isEditing && (
            <button
              className="pf-editor-btn pf-editor-btn-delete"
              onClick={handleDelete}
              title={deleteConfirm ? 'Click again to confirm deletion' : 'Delete this position'}
            >
              {deleteConfirm ? 'CONFIRM DELETE' : 'DELETE'}
            </button>
          )}
          <div className="pf-editor-footer-spacer"></div>
          <button
            className="pf-editor-btn pf-editor-btn-cancel"
            onClick={onClose}
          >
            CANCEL
          </button>
          <button
            className="pf-editor-btn pf-editor-btn-primary"
            onClick={handleSave}
            title="Save (Ctrl+Enter)"
          >
            {isEditing ? 'UPDATE' : 'ADD'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(PositionEditor);
export { PositionEditor };
