/**
 * SectorScreenBase.jsx — Phase D1
 * Shared base component for all 8 sector/thematic screens.
 * Renders: header (with AI button), AI insight card, ticker strip, tab bar, and content area.
 *
 * Props:
 *   - screen: config object from screenRegistry.js
 *   - onTickerClick: (symbol) => void — navigate to chart
 *   - onOpenDetail: (symbol) => void — open instrument detail
 *   - children: optional panel content to render in the content area
 */

import { useState, useCallback, memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { apiFetch } from '../../utils/api';
import './SectorScreen.css';

/* ── Ticker Chip with live price ──────────────────────────────────────────── */
const TickerChip = memo(function TickerChip({ symbol, onClick }) {
  const quote = useTickerPrice(symbol);
  const price = quote?.price;
  const pct = quote?.changePct;

  const displaySym = symbol
    .replace(/^C:/, '').replace(/^X:/, '')
    .replace('.SA', '').replace('=F', 'f');

  return (
    <div className="ss-ticker-chip" onClick={() => onClick?.(symbol)}>
      <span className="ss-ticker-sym">{displaySym}</span>
      {price != null && (
        <span className="ss-ticker-price">
          {price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )}
      {pct != null && (
        <span className={`ss-ticker-chg ${pct >= 0 ? 'up' : 'down'}`}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
        </span>
      )}
    </div>
  );
});

/* ── Main component ───────────────────────────────────────────────────────── */
function SectorScreenBase({ screen, onTickerClick, onOpenDetail, children }) {
  const [aiInsight, setAiInsight] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [activeTab, setActiveTab] = useState(0);

  const fetchAiInsight = useCallback(async () => {
    if (aiLoading || !screen.aiEndpoint) return;
    setAiInsight(null);
    setAiError(null);
    setAiLoading(true);

    try {
      const res = await apiFetch(screen.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(screen.aiContext || {}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error (${res.status})`);
      }
      const data = await res.json();
      if (data?.summary) {
        setAiInsight(data.summary);
      } else if (data?.error) {
        setAiError(data.error);
      } else {
        setAiError('No AI response received');
      }
    } catch (e) {
      setAiError(e.message || 'Failed to load AI insight');
    } finally {
      setAiLoading(false);
    }
  }, [aiLoading, screen.aiEndpoint, screen.aiContext]);

  // Merge all symbols: tickers + etfs + forex + crypto
  const allTickers = [
    ...(screen.tickers || []),
    ...(screen.etfs || []),
  ].slice(0, 20); // Show top 20 in strip

  const fxTickers = screen.forex || [];
  const cryptoTickers = screen.crypto || [];

  const panelTabs = screen.panels || [];

  return (
    <div className="ss-container">
      {/* Header */}
      <div className="ss-header">
        <div className="ss-header-accent" style={{ background: screen.color }} />
        <div className="ss-header-info">
          <div className="ss-header-title">{screen.label}</div>
          <div className="ss-header-desc">{screen.description}</div>
        </div>
        {screen.aiEndpoint && (
          <button
            className="ss-header-ai-btn"
            onClick={fetchAiInsight}
            disabled={aiLoading}
          >
            {aiLoading ? 'ANALYZING...' : 'AI BRIEF'}
          </button>
        )}
      </div>

      {/* AI Insight Card */}
      {(aiInsight || aiLoading || aiError) && (
        <div className="ss-ai-card">
          <span className="ss-ai-badge">AI INSIGHT</span>
          {aiLoading && <div className="ss-ai-loading">Analyzing {screen.shortLabel} markets...</div>}
          {aiError && <div className="ss-ai-error">{aiError}</div>}
          {aiInsight && <div className="ss-ai-text">{aiInsight}</div>}
        </div>
      )}

      {/* Equity Ticker Strip */}
      {allTickers.length > 0 && (
        <>
          <div className="ss-section-label">EQUITIES & ETFS</div>
          <div className="ss-ticker-strip">
            {allTickers.map(sym => (
              <TickerChip key={sym} symbol={sym} onClick={onOpenDetail || onTickerClick} />
            ))}
          </div>
        </>
      )}

      {/* FX Strip */}
      {fxTickers.length > 0 && (
        <>
          <div className="ss-section-label">FX RATES</div>
          <div className="ss-ticker-strip">
            {fxTickers.map(sym => (
              <TickerChip key={sym} symbol={sym} onClick={onOpenDetail || onTickerClick} />
            ))}
          </div>
        </>
      )}

      {/* Crypto Strip */}
      {cryptoTickers.length > 0 && (
        <>
          <div className="ss-section-label">CRYPTO</div>
          <div className="ss-ticker-strip">
            {cryptoTickers.map(sym => (
              <TickerChip key={sym} symbol={sym} onClick={onOpenDetail || onTickerClick} />
            ))}
          </div>
        </>
      )}

      {/* Futures Strip */}
      {screen.futures?.length > 0 && (
        <>
          <div className="ss-section-label">FUTURES</div>
          <div className="ss-etf-strip">
            {screen.futures.map(sym => (
              <div key={sym} className="ss-etf-chip" onClick={() => (onOpenDetail || onTickerClick)?.(sym)}>
                {sym.replace('=F', '')}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Panel tabs */}
      {panelTabs.length > 1 && (
        <div className="ss-tabs">
          {panelTabs.map((tab, i) => (
            <button
              key={tab}
              className={`ss-tab ${i === activeTab ? 'ss-tab--active' : ''}`}
              onClick={() => setActiveTab(i)}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="ss-content">
        {children}
      </div>
    </div>
  );
}

export default memo(SectorScreenBase);
