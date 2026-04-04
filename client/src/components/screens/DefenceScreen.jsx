/**
 * DefenceScreen.jsx — Phase D1
 * Defence & Aerospace sector screen.
 */
import { memo } from 'react';
import SectorScreenBase from './SectorScreenBase';
import { getScreen } from '../../config/screenRegistry';

const SCREEN = getScreen('defence-aerospace');

function DefenceScreen({ onTickerClick, onOpenDetail }) {
  return (
    <SectorScreenBase
      screen={SCREEN}
      onTickerClick={onTickerClick}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default memo(DefenceScreen);
