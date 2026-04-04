/**
 * FxCryptoScreen.jsx — Phase D1
 * FX & Crypto sector screen.
 */
import { memo } from 'react';
import SectorScreenBase from './SectorScreenBase';
import { getScreen } from '../../config/screenRegistry';

const SCREEN = getScreen('fx-crypto');

function FxCryptoScreen({ onTickerClick, onOpenDetail }) {
  return (
    <SectorScreenBase
      screen={SCREEN}
      onTickerClick={onTickerClick}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default memo(FxCryptoScreen);
