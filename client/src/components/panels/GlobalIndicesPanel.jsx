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
import { COLS_TIGHT_SPARK } from '../../utils/panelColumns';

const showInfo = (e, symbol, label, type) => {
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('ticker:rightclick', {
    detail: { symbol, label, type, x: e.clientX + 6, y: e.clientY + 6 },
  }));
};

// P2 item 2 — defaults switched from ETF proxies to REAL index symbols
// (Yahoo ^ tickers). The legacy ETF tickers stay in each region's list so
// saved user lists keep rendering under the right section header.
const REGIONS = {
  AMERICAS: { label: 'AMERICAS',  tickers: ['^GSPC','^IXIC','^DJI','^RUT','^BVSP','SPY','QQQ','DIA','EWZ','EWW','EWC'] },
  EMEA:     { label: 'EMEA',      tickers: ['^STOXX50E','^FTSE','VGK','EWU','EZU','EWG','EWQ','EWP','EWI','EWL','EWD'] },
  ASIA:     { label: 'ASIA-PAC',  tickers: ['^N225','^HSI','EWJ','EWH','EWY','EWA','FXI','MCHI','EWT','EWS','INDA'] },
  BROAD:    { label: 'BROAD',     tickers: ['EEM','EFA','IWM'] },
  // #230 P1.6b: CUSTOM bucket for user-dropped tickers that don't belong to a
  // hardcoded region. Without this, the REGIONS_filtered logic below silently
  // drops any ticker the user drags in (e.g. AAPL, PETR4.SA) because every
  // region's tickers array is intersected with panelSymbols. Tickers in this
  // bucket are computed dynamically inside REGIONS_filtered.
  CUSTOM:   { label: 'CUSTOM',    tickers: [] },
};

// All tickers that belong to a non-CUSTOM hardcoded region — used to compute
// the CUSTOM bucket dynamically as (panelSymbols − canonical region tickers).
const CANONICAL_REGION_TICKERS = new Set(
  Object.entries(REGIONS)
    .filter(([k]) => k !== 'CUSTOM')
    .flatMap(([, r]) => r.tickers)
);

const NAMES = {
  '^GSPC':'S&P 500', '^IXIC':'NASDAQ', '^DJI':'DOW JONES', '^RUT':'RUSSELL 2000',
  '^BVSP':'IBOVESPA', '^STOXX50E':'EURO STOXX 50', '^FTSE':'FTSE 100',
  '^N225':'NIKKEI 225', '^HSI':'HANG SENG',
  SPY:'S&P 500 ETF', QQQ:'NASDAQ 100 ETF', DIA:'DOW JONES ETF', IWM:'RUSSELL 2000 ETF',
  EWZ:'BRAZIL', EWW:'MEXICO', EWC:'CANADA',
  VGK:'EUROPE', EZU:'EURO STOXX', EWU:'UK FTSE', EWG:'GERMANY DAX', EWQ:'FRANCE CAC', EWP:'SPAIN IBEX',
  EWI:'ITALY MIB', EWL:'SWITZERLAND', EWD:'SWEDEN',
  EWJ:'JAPAN NIKKEI', EWH:'HONG KONG', EWY:'KOREA KOSPI', EWA:'AUSTRALIA ASX',
  FXI:'CHINA', MCHI:'CHINA A-SHARES', EWT:'TAIWAN', EWS:'SINGAPORE', INDA:'INDIA',
  EEM:'EMERGING MKTS', EFA:'EAFE',
};

// Was '44px 1fr 56px 52px' — both price and chg% too narrow.
// Shared template: 44px symbol | 1fr name | 80px price | 76px chg%.
const COLS = COLS_TIGHT_SPARK;

// P2 item 2 — per-row ETF proxy fallback. When a real-index (^) quote is
// missing from the snapshot (Yahoo hiccup, older server build), the row
// falls back to the corresponding ETF proxy already in the batch instead
// of rendering an em-dash. PriceRow's own useMergedTickerQuote (extras)
// still tries the ^ symbol first via /api/snapshot/tickers.
const ETF_PROXY = {
  '^GSPC': 'SPY', '^IXIC': 'QQQ', '^DJI': 'DIA', '^RUT': 'IWM',
  '^BVSP': 'EWZ', '^STOXX50E': 'FEZ', '^FTSE': 'EWU',
  '^N225': 'EWJ', '^HSI': 'EWH',
};
const hasQuote = (d) => d != null && typeof d.price === 'number' && !Number.isNaN(d.price);

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
    symbols: ['^GSPC','^IXIC','^DJI','^BVSP','^STOXX50E','^FTSE','^N225','^HSI','^RUT'],
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
    { key: 'CUSTOM', label: 'CUSTOM' },
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
    // Derive the CUSTOM bucket: any panelSymbol not owned by a canonical region.
    // #230 P1.6b — the Global Indices panel silently dropped user-dragged
    // tickers before this because each region's static ticker list was
    // intersected with panelSymbols; an unknown symbol had nowhere to land.
    const customTickers = panelSymbols.filter(t => !CANONICAL_REGION_TICKERS.has(t));

    let result = panelSymbols.length > 0
      ? Object.fromEntries(
          Object.entries(REGIONS).map(([key, region]) => [
            key,
            {
              ...region,
              tickers: key === 'CUSTOM'
                ? customTickers
                : region.tickers.filter(t => panelSymbols.includes(t)),
            },
          ])
        )
      : { ...REGIONS, CUSTOM: { ...REGIONS.CUSTOM, tickers: [] } };

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

  // #230 P1.6b: fetch sparklines for the canonical regions *and* whatever the
  // user has dropped into the panel (CUSTOM bucket), otherwise dragged-in
  // tickers render without the mini-chart.
  const allIndexTickers = useMemo(() => {
    const canonical = Object.values(REGIONS).flatMap(r => r.tickers);
    const extras    = panelSymbols.filter(t => !CANONICAL_REGION_TICKERS.has(t));
    return Array.from(new Set([...canonical, ...extras]));
  }, [panelSymbols]);
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
                  // Real index first; ETF proxy fills in when the ^ quote is
                  // missing (never the other way around).
                  const primary = data[ticker] || {};
                  const proxy = ETF_PROXY[ticker];
                  const d = hasQuote(primary) ? primary
                    : (proxy && hasQuote(data[proxy]) ? data[proxy] : primary);
                  const instrumentType = ticker.startsWith('^') ? 'INDEX' : 'ETF';
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
                      dragData={{ symbol: ticker, name: NAMES[ticker] || ticker, type: instrumentType }}
                      onClick={() => onTickerClick?.(ticker)}
                      onDoubleClick={() => openDetail(ticker)}
                      onTouchHold={() => openDetail(ticker)}
                      touchRef={ptRef}
                      sparklineData={sparklines[ticker]}
                      onContextMenu={e => showInfo(e, ticker, NAMES[ticker] || ticker, instrumentType)}
                      dataAttrs={{
                        'data-ticker': ticker,
                        'data-ticker-label': NAMES[ticker] || ticker,
                        'data-ticker-type': instrumentType,
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
