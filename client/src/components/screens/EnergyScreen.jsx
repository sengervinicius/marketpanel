/**
 * EnergyScreen.jsx — Phase D1
 * Energy & Transition sector screen.
 */
import { memo } from 'react';
import SectorScreenBase from './SectorScreenBase';
import { getScreen } from '../../config/screenRegistry';

const SCREEN = getScreen('energy-transition');

function EnergyScreen({ onTickerClick, onOpenDetail }) {
  return (
    <SectorScreenBase
      screen={SCREEN}
      onTickerClick={onTickerClick}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default memo(EnergyScreen);
