import { useState, useRef, useMemo, memo, useEffect } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useOpenDetail } from '../../context/OpenDetailContext';
import PanelConfigModal from '../common/PanelConfigModal';
import EditablePanelHeader from '../common/EditablePanelHeader';
import PanelShell from '../common/PanelShell';
import { PriceRow } from '../common/PriceRow';
import { SectionHeader } from '../common/SectionHeader';
import ColumnHeaders from '../common/ColumnHeaders';
import { useSparklineData } from '../../hooks/useSparklineData';
import SkeletonLoader from '../shared/SkeletonLoader';
import { COLS_TIGHT } from '../../utils/panelColumns';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

const REGIONS = {
  AMERICAS: { label: 'AMERICAS',  tickers: ['SPY','QQQ','DIA','EWZ','EWW','EWC'] },
  EMEA:     { label: 'EMEA',      tickers: ['VGK','EWU','EZU','EWG','EWQ','EWP','EWI','EWL','EWD'] },
  ASIA:     { label: 'ASIA-PAC',  tickers: ['EWJ','EWH','EWY','EWA','FXI','MCHI','EWT','EWS','INDA'] },
  BROAD:    { label: 'BROAD',     tickers: ['EEM','EFA','IWM'] },
};

const NAMES = {
  SPY:'S&P 500', QQQ:'NASDAQ 100', DIA:'DOW JONES', IWM:'RUSSELL 2000',
  EWZ:'BRAZIL', EWW:'MEXICO', EWC:'CANADA',
  VGK:'EUROPE', EZU:'EURO STOXX', EWU:'UK FTSE', EWG:'GERMANY DAX', EWQ:'FRANCE CAC', EWP:'SPAIN IBEX',
  EWI:'ITALY MIB', EWL:'SWITZERLAND', EWD:'SWEDEN',
  EWJ:'JAPAN NIKKEI', EWH:'HONG KONG', EWY:'KOREA KOSPI', EWA:'AUSTRALIA ASX',
  FXI:'CHINA', MCHI:'CHINA A-SHARES', EWT:'TAIWAN', EWS:'SINGAPORE', INDA:'INDIA',
  EEM:'EMERGING MKTS', EFA:'EAFE',
};

// Was '44px 1fr 56px 52px' — both price and chg% too narrow.
// Shared template: 44px symbol | 1fr name | 80px price | 76px chg%.
const COLS = COLS_TIGHT;

const SORT_COLS = [
  { key: 'symbol', label: 'TICK', align: 'left' },
  { key: 'name',   label: 'NAME', align: 'left' },
  { key: 'price',  label: 'LAST', align: 'right' },
  { key: 'chg',    label: 'CHG%', align: 'right' },
];

function GlobalIndicesPanel({ data = {}, loading, onTickerClick }) {
  const openDetail = useOpenDetail();
  const ptRef = useRef(null);
  const { settings, updatePanelConfig } = useSettings();

  const [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => {
    if (data && Object.keys(data).length > 0) setLastUpdated(new Date());
  }, [data]);

  const panelCfg = settings?.panels?.globalIndices || {
    title: 'Global Indexes',
    symbols: ['SPY','QQQ','DIA','EWZ','EWW','EWC','EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD','EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'],
    hiddenSubsections: [],
    subsectionLabels: {},
  };
  const panelTitle           = panelCfg.title                || 'Global Indexes';
  const panelSymbols         = panelCfg.symbols              || [];
  const hiddenSubsections    = panelCfg.hiddenSubsections    || [];
  const subsectionLabels     = panelCfg.subsectionLabels     || {};
  const availableSubsections = [
    { key: 'AMERICAS', label: 'AMERICAS' },
    { key: 'EMEA', label: 'EMEA' },
    { key: 'ASIA', label: 'ASIA-PAC' },
  ];

  const [configOpen, setConfigOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  const handleToggleSubsection = (key) => {
    const cur = panelCfg.hiddenSubsections || [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    updatePanelConfig('globalIndices', { ...panelCfg, hiddenSubsections: next });
  };

  const handleRenameSubsection = (key, newLabel) => {
    const labels = { ...(panelCfg.subsectionLabels || {}), [key]: newLabel };
    updatePanelConfig('globalIndices', { ...panelCfg, subsectionLabels: labels });
  };

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

  const allIndexTickers = useMemo(() =>
    Object.values(REGIONS).flatMap(r => r.tickers),
  []);
  const sparklines = useSparklineData(allIndexTickers);

  return (
    <PanelShell onDropTicker={handleDropTicker}>
      <EditablePanelHeader
        title={panelTitle}
        availableSubsections={availableSubsections}
        hiddenSubsections={hiddenSubsections}
        lastUpdated={lastUpdated}
        source="Yahoo"
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
        {loading && <SkeletonLoader type="table" rows={6} columns={4} width="100%" height="auto" />}
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
                <SectionHeader label={subsectionLabels[key] || region.label} sectionKey={key} color="var(--accent)" onRename={handleRenameSubsection} onToggleVisibility={handleToggleSubsection} isHideable={true} />
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
                      onDoubleClick={() => openDetail(ticker)}
                      onTouchHold={() => openDetail(ticker)}
                      touchRef={ptRef}
                      sparklineData={sparklines[ticker]}
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
