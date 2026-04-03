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
 * De-gamification: always returns 0 (no XP system)
 */
export function getXPLevel(xp) {
  return 0;
}

/**
 * Get applicable accessories based on user XP
 * De-gamification: always returns empty array (no accessories unlock)
 */
export function getUserAccessories(xp) {
  return [];
}

/**
 * Get CSS classes/styles for avatar based on accessories
 * De-gamification: always returns empty styles
 */
export function getAvatarAccessoryStyles(xp) {
  return { classNames: [], styles: {} };
}

export { ACCESSORY_TIERS };
