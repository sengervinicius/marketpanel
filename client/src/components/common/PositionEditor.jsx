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

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { usePortfolio } from '../../context/PortfolioContext';
import { apiJSON } from '../../utils/api';
import './PositionEditor.css';

function PositionEditor({
  position,
  defaultSymbol,
  defaultPortfolioId,
  defaultSubportfolioId,
  onClose,
  mobile = false,
}) {
  const { portfolios, addPosition, updatePosition, removePosition } = usePortfolio();

  const isEditing = !!position;

  // Initialize form state
  const [symbol, setSymbol] = useState(position?.symbol || defaultSymbol || '');
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
  const [purchaseDate, setPurchaseDate] = useState(position?.purchaseDate || '');
  const [note, setNote] = useState(position?.note || '');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Search dropdown state
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchDebounceRef = useRef(null);
  const dropdownRef = useRef(null);

  // Live-computed Total Cost
  const totalCost = (quantity && entryPrice)
    ? (parseFloat(quantity) * parseFloat(entryPrice)).toFixed(2)
    : '';

  // Get subportfolios for selected portfolio
  const currentPortfolio = portfolios.find(p => p.id === portfolioId);
  const subportfolios = currentPortfolio?.subportfolios || [];

  // Auto-select first subportfolio if current becomes invalid
  const validSubportfolioId = subportfolios.some(sp => sp.id === subportfolioId)
    ? subportfolioId
    : (subportfolios[0]?.id || '');

  const handleSymbolChange = useCallback((e) => {
    const newSymbol = e.target.value.toUpperCase();
    setSymbol(newSymbol);

    // Only show search dropdown when not editing
    if (isEditing) {
      return;
    }

    // Clear previous debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!newSymbol.trim()) {
      setShowDropdown(false);
      setSearchResults([]);
      setSelectedIndex(-1);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setSelectedIndex(-1);

    // Debounce search by 250ms
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const data = await apiJSON(`/api/instruments/search?q=${encodeURIComponent(newSymbol)}&limit=10`);
        setSearchResults(data.results || []);
        setShowDropdown(true);
      } catch (err) {
        setSearchError(err.message || 'Search failed');
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
  }, [isEditing]);

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
    // Validate non-negative values
    const qty = quantity ? parseFloat(quantity) : null;
    const price = entryPrice ? parseFloat(entryPrice) : null;
    const invested = investedAmount ? parseFloat(investedAmount) : null;
    if (qty != null && qty < 0) {
      alert('Quantity cannot be negative');
      return;
    }
    if (price != null && price < 0) {
      alert('Entry price cannot be negative');
      return;
    }
    if (invested != null && invested < 0) {
      alert('Invested amount cannot be negative');
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
        purchaseDate: purchaseDate || null,
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
        purchaseDate: purchaseDate || null,
        currency,
        note: note.trim(),
      });
    }

    onClose();
  }, [symbol, portfolioId, validSubportfolioId, investedAmount, quantity, entryPrice, purchaseDate, currency, note, isEditing, position, updatePosition, addPosition, onClose]);

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

  const handleSelectSearchResult = useCallback((result) => {
    setSymbol(result.symbol.toUpperCase());
    setShowDropdown(false);
    setSearchResults([]);
    setSelectedIndex(-1);
  }, []);

  const handleSearchKeyDown = useCallback((e) => {
    if (!showDropdown || searchResults.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < searchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelectSearchResult(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowDropdown(false);
        break;
      default:
        break;
    }
  }, [showDropdown, searchResults, selectedIndex, handleSelectSearchResult]);

  const handleSearchBlur = useCallback(() => {
    // Delay hiding dropdown to allow click handler to fire
    setTimeout(() => {
      setShowDropdown(false);
    }, 150);
  }, []);

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

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
          <button className="btn pf-editor-close-btn"

            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Form Body */}
        <div className="pf-editor-body">
          {/* Symbol */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">SYMBOL</label>
            <div className="pf-search-container" style={{ position: 'relative' }} ref={dropdownRef}>
              <input
                type="text"
                className={`pf-editor-input ${isEditing ? 'pf-editor-input-readonly' : ''}`}
                value={symbol}
                onChange={handleSymbolChange}
                onKeyDown={handleSearchKeyDown}
                onBlur={handleSearchBlur}
                placeholder="e.g., AAPL"
                readOnly={isEditing}
                autoFocus={!isEditing}
              />
              {!isEditing && showDropdown && (
                <div className="pf-search-dropdown">
                  {searchLoading && (
                    <div className="pf-search-loading">Searching...</div>
                  )}
                  {searchError && (
                    <div className="pf-search-error">Error: {searchError}</div>
                  )}
                  {!searchLoading && searchResults.length === 0 && !searchError && (
                    <div className="pf-search-empty">No results found</div>
                  )}
                  {!searchLoading && searchResults.length > 0 && (
                    searchResults.map((result, idx) => (
                      <div
                        key={`${result.symbol}-${idx}`}
                        className={`pf-search-item ${selectedIndex === idx ? 'pf-search-item-selected' : ''}`}
                        onClick={() => handleSelectSearchResult(result)}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        <span className="pf-search-badge">{result.type || 'INST'}</span>
                        <span className="pf-search-sym">{result.symbol}</span>
                        <span className="pf-search-name">{result.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
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
              min="0"
            />
          </div>

          {/* Quantity */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">SHARES / UNITS (optional)</label>
            <input
              type="number"
              className="pf-editor-input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          {/* Entry Price */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">PRICE PER SHARE (optional)</label>
            <input
              type="number"
              className="pf-editor-input"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          {/* Purchase Date */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">PURCHASE DATE (optional)</label>
            <input
              type="date"
              className="pf-editor-input"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>

          {/* Total Cost (read-only computed) */}
          <div className="pf-editor-field-group">
            <label className="pf-editor-label">TOTAL COST</label>
            <input
              type="text"
              className="pf-editor-input pf-editor-input-readonly"
              value={totalCost ? `$${parseFloat(totalCost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Qty x Buy Price'}
              readOnly
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
            <button className="btn pf-editor-btn pf-editor-btn-delete"

              onClick={handleDelete}
              title={deleteConfirm ? 'Click again to confirm deletion' : 'Delete this position'}
            >
              {deleteConfirm ? 'CONFIRM DELETE' : 'DELETE'}
            </button>
          )}
          <div className="pf-editor-footer-spacer"></div>
          <button className="btn pf-editor-btn pf-editor-btn-cancel"

            onClick={onClose}
          >
            CANCEL
          </button>
          <button className="btn pf-editor-btn pf-editor-btn-primary"

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
