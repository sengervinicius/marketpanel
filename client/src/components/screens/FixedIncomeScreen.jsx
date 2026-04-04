/**
 * FixedIncomeScreen.jsx — Phase D1
 * Fixed Income & Credit sector screen.
 */
import { memo } from 'react';
import SectorScreenBase from './SectorScreenBase';
import { getScreen } from '../../config/screenRegistry';

const SCREEN = getScreen('fixed-income');

function FixedIncomeScreen({ onTickerClick, onOpenDetail }) {
  return (
    <SectorScreenBase
      screen={SCREEN}
      onTickerClick={onTickerClick}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default memo(FixedIncomeScreen);
