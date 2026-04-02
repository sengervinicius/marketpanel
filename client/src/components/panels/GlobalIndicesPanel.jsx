import { useState, useRef, useMemo, memo } from 'react';
import { useSettings } from '../../context/SettingsContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import { SectionHeader } from '../common/SectionHeader';
import ColumnHeaders from '../common/ColumnHeaders';

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

const COLS = '44px 1fr 56px 52px';

const SORT_COLS = [
  { key: 'symbol', label: 'TICK', align: 'left' },
  { key: 'name',   label: 'NAME', align: 'left' },
  { key: 'price',  label: 'LAST', align: 'right' },
  { key: 'chg',    label: 'CHG%', align: 'right' },
];

function GlobalIndicesPanel({ data = {}, loading, onTickerClick, onOpenDetail }) {
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

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

  const handleSortClick = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Filter and sort per region
  const REGIONS_filtered = useMemo(() => {
    let result = panelSymbols.length > 0
      ? Object.fromEntries(
          Object.entries(REGIONS).map(([key, region]) => [
            key,
            { ...region, tickers: region.tickers.filter(t => panelSymbols.includes(t)) }
          ])
        )
      : { ...REGIONS };

    if (searchFilter) {
      const sq = searchFilter.toLowerCase();
      result = Object.fromEntries(
        Object.entries(result).map(([key, region]) => [
          key,
          { ...region, tickers: region.tickers.filter(t =>
            t.toLowerCase().includes(sq) || (NAMES[t] || '').toLowerCase().includes(sq)
          )}
        ])
      );
    }

    if (sortKey && data) {
      result = Object.fromEntries(
        Object.entries(result).map(([key, region]) => [
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

    return result;
  }, [panelSymbols, searchFilter, sortKey, sortDir, data]);

  return (
    <PanelShell onDropTicker={handleDropTicker}>
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
        {loading && <span style={{ color: 'var(--text-faint)', fontSize: 'var(--font-xs)' }}>LOADING...</span>}
      </EditablePanelHeader>

      {/* Sortable column headers */}
      <ColumnHeaders
        columns={SORT_COLS}
        gridColumns={COLS}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortClick={handleSortClick}
      />

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {Object.entries(REGIONS_filtered).map(([key, region]) => (
          <div key={key}>
            {region.tickers.length > 0 && !hiddenSubsections.includes(key) && (
              <>
                <SectionHeader label={region.label} color="var(--accent)" />
                {region.tickers.map((ticker) => {
                  const d = data[ticker] || {};
                  return (
                    <PriceRow
                      key={ticker}
                      symbol={ticker}
                      ticker={ticker}
                      name={NAMES[ticker] || ticker}
                      price={d.price}
                      changePct={d.changePct}
                      symbolColor="var(--section-equity)"
                      columns={COLS}
                      draggable
                      dragData={{ symbol: ticker, name: NAMES[ticker] || ticker, type: 'ETF' }}
                      onClick={() => onTickerClick?.(ticker)}
                      onDoubleClick={() => onOpenDetail?.(ticker)}
                      onTouchHold={() => onOpenDetail?.(ticker)}
                      touchRef={ptRef}
                      onContextMenu={e => showInfo(e, ticker, NAMES[ticker] || ticker, 'ETF')}
                      dataAttrs={{
                        'data-ticker': ticker,
                        'data-ticker-label': NAMES[ticker] || ticker,
                        'data-ticker-type': 'ETF',
                      }}
                    />
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
    </PanelShell>
  );
}

export default memo(GlobalIndicesPanel);
