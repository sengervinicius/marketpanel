/**
 * avatarAccessories.js — XP-based unlockable avatar accessories
 */

// XP thresholds for accessory tiers
const ACCESSORY_TIERS = [
  { level: 10, id: 'gold_ring',     label: 'Gold Ring',   type: 'border' },
  { level: 25, id: 'crown',         label: 'Crown',       type: 'overlay' },
  { level: 50, id: 'radial_glow',   label: 'Radial Glow', type: 'background' },
];

/**
 * Get user's XP level from total XP points
 * Assumes 100 XP per level
 */
export function getXPLevel(xp) {
  return Math.floor((xp || 0) / 100);
}

/**
 * Get applicable accessories based on user XP
 */
export function getUserAccessories(xp) {
  const level = getXPLevel(xp);
  return ACCESSORY_TIERS.filter(t => level >= t.level).map(t => t.id);
}

/**
 * Get CSS classes/styles for avatar based on accessories
 */
export function getAvatarAccessoryStyles(xp) {
  const accessories = getUserAccessories(xp);
  const styles = {};
  const classNames = [];

  if (accessories.includes('gold_ring')) {
    classNames.push('avatar-gold-ring');
  }
  if (accessories.includes('crown')) {
    classNames.push('avatar-crown');
  }
  if (accessories.includes('radial_glow')) {
    classNames.push('avatar-radial-glow');
  }

  return { classNames, styles };
}

export { ACCESSORY_TIERS };
