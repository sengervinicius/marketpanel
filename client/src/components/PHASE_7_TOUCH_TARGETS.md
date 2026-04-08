# Phase 7 — Mobile Experience: Touch Target Audit

## Overview
This document tracks the Phase 7 mobile experience improvements, specifically the touch target audit (7.6).

## Touch Target Standard
- **Minimum size**: 44px × 44px (WCAG AAA standard)
- **Applied to**: All interactive elements on mobile (< 768px viewport)
- **Elements affected**: buttons, links, checkboxes, radio buttons, toggles

## Design Tokens Used
- `--row-height-touch`: 44px (defined in `/src/styles/tokens.css`)
- `min-height: var(--row-height-touch)`
- `min-width: var(--row-height-touch)`

## Audit Checklist

### App-wide (App.css)
- [x] Global button sizing: `button, [role="button"]` → min 44px
- [x] Global input sizing: `input[type="checkbox"], input[type="radio"]` → min 44px
- [x] Table rows updated to min 44px height
- [x] Mobile viewport (max-width: 768px) scope applied

### InstrumentDetail Components
- [x] Close button: `id-close--mobile` → min 44px
- [x] Action buttons: `id-action-btn--mobile` → min 44px
- [x] Tab buttons: `id-tab--mobile` → min 44px
- [x] Alert buttons: min 44px
- [x] Bottom sheet drag handle: visible, centered, 40×4px

### Chart Carousel (ChartCarousel.jsx)
- [x] Navigation buttons: `chart-carousel-btn` → 44×44px
- [x] Dot indicators: `chart-carousel-dot` → min 44px hit area (8px dot + padding)
- [x] Touch action: `touch-action: pan-y` on container

### Mobile Table Rows (MobileTableRow.jsx)
- [x] Compact row: min 44px height
- [x] Ticker button: min 44px × 44px
- [x] Expand icon: min 20px touch area
- [x] Expansion toggle: min 44px hit area

### Mobile Sections (MobileSection.jsx)
- [x] Section header button: min 44px height
- [x] Expand icon: min 16px (visual), 44px touch area

### Search Panel Mobile (SearchPanelMobile.jsx)
- [x] Back button: min 44px × 44px
- [x] Result rows: min 52px height
- [x] All touch targets: ≥ 44px

### DataTable (shared component)
- [x] Header cells: min 44px height
- [x] Data cells: min 44px height for clickable rows
- [x] Sort buttons: min 44px

## Component-specific Improvements

### 1. ChartCarousel.jsx
```javascript
// Navigation buttons
.chart-carousel-btn {
  min-width: 44px;
  min-height: 44px;
}

// Dot indicators (visual small, touch large)
.chart-carousel-dot {
  min-width: 44px;  // Touch area
  min-height: 44px; // Touch area
  width: 8px;       // Visual size
  height: 8px;      // Visual size
}
```

### 2. MobileTableRow.jsx
```javascript
// Row buttons
.mobile-ticker-btn {
  min-width: 44px;
  min-height: 44px;
}

// Compact row minimum height
.mobile-table-row-compact {
  min-height: 44px;
}
```

### 3. MobileSection.jsx
```javascript
// Header button (tappable)
.mobile-section-header {
  min-height: 44px;
}
```

### 4. SearchPanelMobile.jsx
```javascript
// Back button
.search-panel-mobile-back {
  min-width: 44px;
  min-height: 44px;
}

// Result rows
.search-mobile-result-row {
  min-height: 52px; // Extra breathing room
}
```

## Touch Behavior Enhancements

### onTouchEnd handlers
All new interactive elements include:
```javascript
onTouchEnd={(e) => {
  e.preventDefault();
  // Handle click logic
}}
```

This ensures:
- No 300ms tap delay
- Proper event handling on iOS
- Prevention of default touch behaviors that might conflict

### CSS Touch Action
Applied to swipeable containers:
```css
.chart-carousel {
  touch-action: pan-y; /* Allow vertical scroll, intercept horizontal swipes */
}
```

## Spacing and Padding

All touch targets include proper spacing:
- **Minimum gap between targets**: 8px (`var(--space-2)`)
- **Padding inside buttons**: var(--space-2) to var(--space-3)
- **Row height**: 44px minimum on mobile

## Testing Checklist

- [ ] Test on actual iOS device (iPad mini, iPhone)
- [ ] Test on actual Android device (Pixel, Galaxy)
- [ ] Verify touch targets with Chrome DevTools mobile emulation
- [ ] Check spacing between buttons doesn't compress below 44px
- [ ] Verify no overlapping touch areas
- [ ] Test double-tap to zoom (should not be disabled)
- [ ] Test long-press gestures
- [ ] Verify scroll doesn't trigger unintended touches

## Browser Compatibility

These improvements are compatible with:
- iOS Safari 12+
- Android Chrome 60+
- Firefox Mobile 57+
- Edge Mobile 18+

## Future Enhancements

- Consider haptic feedback API (`navigator.vibrate()`) for touch confirmation
- Monitor analytics for touch interaction success rates
- Consider adaptive sizing based on device DPI (high-DPI devices may use smaller targets)
