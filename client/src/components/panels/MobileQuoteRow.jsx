/**
 * MobileQuoteRow.jsx — shared tappable price row for Mobile Wave 1
 * (Home "your book", Markets lists, Watchlist). Live price via
 * PriceContext; tap opens the instrument detail bottom-sheet.
 */
import { memo } from 'react';
import { useTickerPrice } from '../../context/PriceContext';
import { useOpenDetail } from '../../context/OpenDetailContext';

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const dp = Math.abs(v) < 10 ? 4 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: dp });
}

function MobileQuoteRow({ symbol, display, name, trailing }) {
  const q = useTickerPrice(symbol);
  const openDetail = useOpenDetail();
  const price = fmtPrice(q?.price);
  const pct = q?.changePct;
  const cls = pct == null ? 'flat' : pct >= 0 ? 'u' : 'd';

  return (
    <div className="mw-row tap" onClick={(e) => { e.stopPropagation(); openDetail(symbol); }}>
      <div className="mw-row-l">
        <span className="mw-tk">{display || symbol}</span>
        {name ? <span className="mw-nm">{name}</span> : null}
      </div>
      <div className="mw-row-r">
        <span className="mw-price">{price != null ? price : '—'}</span>
        <span className={`mw-chg ${cls}`}>
          {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '·'}
        </span>
        {trailing}
      </div>
    </div>
  );
}

export default memo(MobileQuoteRow);
