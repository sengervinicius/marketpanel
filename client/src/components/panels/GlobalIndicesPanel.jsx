import { useState, useRef, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import { handlePanelDragOver, makePanelDropHandler } from '../../utils/dropHelper';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

const REGIONS = {
  AMERICAS: { label: 'AMERICAS',  tickers: ['SPY','QQQ','DIA','EWZ','EWW','EWC'] },
  EMEA:     { label: 'EMEA',      tickers: ['EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD'] },
  ASIA:     { label: 'ASIA-PAC',  tickers: ['EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'] },
};

const NAMES = {
  SPY:'S&P 500', QQQ:'NASDAQ 100', DIA:'DOW JONES', EWZ:'BRAZIL', EWW:'MEXICO', EWC:'CANADA',
  EZU:'EURO STOXX', EWU:'UK FTSE', EWG:'GERMANY DAX', EWQ:'FRANCE CAC', EWP:'SPAIN IBEX',
  EWI:'ITALY MIB', EWL:'SWITZERLAND', EWD:'SWEDEN',
  EWJ:'JAPAN NIKKEI', EWH:'HONG KONG', EWY:'KOREA KOSPI', EWA:'AUSTRALIA ASX',
  MCHI:'CHINA', EWT:'TAIWAN', EWS:'SINGAPORE', INDA:'INDIA',
};

function GlobalIndicesPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  // Panel config from settings (with fallback defaults)
  const panelCfg = settings?.panels?.globalIndices || {
    title: 'Global Indexes',
    symbols: ['SPY','QQQ','DIA','EWZ','EWW','EWC','EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD','EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'],
    hiddenSubsections: [],
  };
  const panelTitle           = panelCfg.title                || 'Global Indexes';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const availableSubsections = [
    { key: 'AMERICAS', label: 'AMERICAS' },
    { key: 'EMEA', label: 'EMEA' },
    { key: 'ASIA', label: 'ASIA-PAC' },
  ];

  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const handleDropTicker = (ticker) => {
    const sym = ticker.toUpperCase();
    if (!panelSymbols.includes(sym)) {
      updatePanelConfig('globalIndices', { ...panelCfg, symbols: [...panelSymbols, sym] });
    }
  };

  const fmtPrice = p => (!p || p === 0) ? '—'
    : p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct   = p => (!p && p !== 0) ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;
  const color    = p => !p ? '#888' : p >= 0 ? '#00c853' : '#f44336';

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const panelStyle = {
    background: '#0d0d14', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
    height: '100%',
  };
  const regionHeader = {
    color: '#e55a00', fontSize: 7, fontWeight: 600, letterSpacing: '0.1em',
    padding: '3px 6px 2px', background: '#111118',
    borderBottom: '1px solid #1a1a2e', textTransform: 'uppercase',
  };
  const rowStyle = i => ({
    display: 'grid', gridTemplateColumns: '44px 1fr 56px 52px',
    padding: '2px 6px', borderBottom: '1px solid #0f0f1a',
    background: i % 2 === 0 ? 'transparent' : '#060608',
    cursor: 'grab',
  });

  // Filter displayed tickers to only the configured symbols (if configured)
  let REGIONS_filtered = panelSymbols.length > 0
    ? Object.fromEntries(
        Object.entries(REGIONS).map(([key, region]) => [
          key,
          { ...region, tickers: region.tickers.filter(t => panelSymbols.includes(t)) }
        ])
      )
    : { ...REGIONS };

  // Apply search filter
  if (searchFilter) {
    const sq = searchFilter.toLowerCase();
    REGIONS_filtered = Object.fromEntries(
      Object.entries(REGIONS_filtered).map(([key, region]) => [
        key,
        { ...region, tickers: region.tickers.filter(t =>
          t.toLowerCase().includes(sq) || (NAMES[t] || '').toLowerCase().includes(sq)
        )}
      ])
    );
  }

  // Apply sorting within regions
  if (sortKey && data) {
    REGIONS_filtered = Object.fromEntries(
      Object.entries(REGIONS_filtered).map(([key, region]) => [
        key,
        { ...region, tickers: [...region.tickers].sort((a, b) => {
          let va, vb;
          if (sortKey === 'symbol') { va = a; vb = b; }
          else if (sortKey === 'name') { va = NAMES[a] || a; vb = NAMES[b] || b; }
          else if (sortKey === 'price') { va = data[a]?.price ?? -Infinity; vb = data[b]?.price ?? -Infinity; }
          else if (sortKey === 'chg')   { va = data[a]?.changePct ?? -Infinity; vb = data[b]?.changePct ?? -Infinity; }
          if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortDir === 'asc' ? va - vb : vb - va;
        })}
      ])
    );
  }

  return (
    <div style={panelStyle} onDragOver={handlePanelDragOver} onDrop={makePanelDropHandler(handleDropTicker)}>
      <EditablePanelHeader
        title={panelTitle}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        onToggleSubsection={(key) => {
          const current = hiddenSubsections || [];
          const updated = current.includes(key)
            ? current.filter(k => k !== key)
            : [...current, key];
          updatePanelConfig('globalIndices', { ...panelCfg, hiddenSubsections: updated });
        }}
        onTitleChange={(v) => updatePanelConfig('globalIndices', { ...panelCfg, title: v })}
        onConfigOpen={() => setConfigOpen(true)}
        onDropTicker={handleDropTicker}
        onSearchChange={setSearchFilter}
      >
        {loading && <span style={{ color: '#444', fontSize: 7 }}>LOADING...</span>}
      </EditablePanelHeader>

      {/* Sortable column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 56px 52px', padding: '2px 6px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 }}>
        {[
          { key: 'symbol', label: 'TICK', align: 'left' },
          { key: 'name', label: 'NAME', align: 'left' },
          { key: 'price', label: 'LAST', align: 'right' },
          { key: 'chg', label: 'CHG%', align: 'right' },
        ].map(({ key, label, align }) => {
          const active = sortKey === key;
          const arrow = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
          return (
            <span
              key={key}
              onClick={() => handleSortClick(key)}
              style={{
                color: active ? '#ff9900' : '#444',
                fontSize: '8px',
                fontWeight: 700,
                letterSpacing: '1px',
                textAlign: align === 'right' ? 'right' : 'left',
                paddingRight: align === 'right' ? 4 : 0,
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {label}{arrow}
            </span>
          );
        })}
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {Object.entries(REGIONS_filtered).map(([key, region]) => (
          <div key={key}>
            {region.tickers.length > 0 && !hiddenSubsections.includes(key) && (
              <>
                <div style={regionHeader}>{region.label}</div>
                {region.tickers.map((ticker, i) => {
              const d = data[ticker] || {};
              return (
                <div
                  key={ticker}
                  data-ticker={ticker}
                  data-ticker-label={NAMES[ticker] || ticker}
                  data-ticker-type="ETF"
                  style={rowStyle(i)}
                  draggable
                  onDragStart={e => {
                    // Use application/x-ticker so ChartPanel can receive it
                    e.dataTransfer.setData('application/x-ticker',
                      JSON.stringify({ symbol: ticker, label: NAMES[ticker] || ticker }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onTickerClick?.(ticker)}
                  onDoubleClick={() => onOpenDetail?.(ticker)}
                  onContextMenu={e => showInfo(e, ticker, NAMES[ticker] || ticker, 'ETF')}
                  onTouchStart={(e) => { e.stopPropagation(); ptRef.current = setTimeout(() => onOpenDetail?.(ticker), 500); }}
                  onTouchEnd={() => clearTimeout(ptRef.current)}
                  onTouchMove={() => clearTimeout(ptRef.current)}
                >
                  <span style={{ color: '#e8a020', fontWeight: 500, fontSize: 9 }}>{ticker}</span>
                  <span style={{ color: '#777', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {NAMES[ticker]}
                  </span>
                  <span style={{ textAlign: 'right', color: '#ccc' }}>{fmtPrice(d.price)}</span>
                  <span style={{ textAlign: 'right', color: color(d.changePct), fontWeight: 500 }}>
                    {fmtPct(d.changePct)}
                  </span>
                </div>
              );
            })}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Panel config modal */}
      {configOpen && (
        <PanelConfigModal
          panelId="globalIndices"
          currentTitle={panelTitle}
          currentSymbols={panelSymbols}
          onSave={({ title, symbols }) => {
            updatePanelConfig('globalIndices', { title, symbols });
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

export default memo(GlobalIndicesPanel);
