/**
 * BrazilScreen.jsx — Phase D1
 * Brazil & LatAm sector screen.
 */
import { memo } from 'react';
import SectorScreenBase from './SectorScreenBase';
import { getScreen } from '../../config/screenRegistry';

const SCREEN = getScreen('brazil-latam');

function BrazilScreen({ onTickerClick, onOpenDetail }) {
  return (
    <SectorScreenBase
      screen={SCREEN}
      onTickerClick={onTickerClick}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default memo(BrazilScreen);
