# Senger Market — App Store Readiness Assessment

Last updated: Phase 5C (April 2026)

## What Is Ready

- **Core mobile UX**: 5-tab navigation (Home, Search, Portfolio, Alerts, More) with clean touch targets, safe-area handling, and app-like navigation patterns.
- **PWA manifest**: standalone display mode, theme colors, app name/short name consistent, orientation support, categories declared.
- **Key flows working**: search → instrument detail → add to portfolio/create alert, portfolio management with P&L, alerts with triggered badges, settings/account/billing access.
- **Mobile-first components**: HomePanelMobile, PortfolioMobile, AlertsMobile, ChartsPanelMobile, MobileMoreScreen all use tokenized CSS primitives.
- **iOS PWA tags**: apple-mobile-web-app-capable, status bar style, apple-touch-icon.
- **Safe-area handling**: env(safe-area-inset-*) applied to header, tab bar, content areas, and toast notifications.
- **Input zoom prevention**: font-size: 16px on mobile inputs prevents iOS auto-zoom.
- **Overscroll behavior**: disabled rubber-banding for native feel.

## What Blocks App Store Submission

### Required Before Submission

1. **Native wrapper (Capacitor or similar)**: The App Store requires a native binary (.ipa/.apk). The current PWA needs to be wrapped using Capacitor, Cordova, or a similar tool. Capacitor is recommended — it wraps the existing web app with minimal code changes.

2. **App icons**: The following icon files are referenced but not yet created:
   - `/client/public/icon-192.png` (192×192)
   - `/client/public/icon-512.png` (512×512)
   - `/client/public/icon-maskable-192.png` (192×192, with safe zone padding)
   - `/client/public/icon-maskable-512.png` (512×512, with safe zone padding)
   - Apple requires additional sizes for App Store: 1024×1024, plus launch screen images.

3. **App Store screenshots**: Required for listing:
   - iPhone 6.7" (1290×2796)
   - iPhone 6.5" (1242×2688)
   - iPad 12.9" (2048×2732)
   - `/client/public/screenshot-mobile.png` and `/client/public/screenshot-desktop.png` are referenced in manifest but not yet created.

4. **Privacy policy URL**: Apple requires a publicly accessible privacy policy.

5. **App Store metadata**: description, keywords, support URL, marketing URL.

### Apple Review Considerations

- **Financial data disclaimer**: The app shows real-time market data. Apple may require a disclaimer that data is for informational purposes only and not investment advice.
- **Subscription handling**: If billing goes through Stripe web (current implementation), Apple requires in-app purchases for digital content sold within iOS apps. This is the most significant architectural consideration — options include:
  - Using Apple's In-App Purchase for iOS users.
  - Offering a "reader app" model if Senger qualifies.
  - Linking to web checkout (allowed under recent regulatory changes in some regions).
- **Account deletion**: Apple requires apps to offer account deletion if they offer account creation.
- **Network dependency**: The app requires an internet connection. The App Store expects a graceful offline state or clear messaging.

## Recommended Next Steps (In Order)

1. **Create final icon assets** — design the "S" brand mark at required sizes.
2. **Add Capacitor** — `npm install @capacitor/core @capacitor/cli`, init with `npx cap init`, add iOS/Android platforms. The existing web build output (`client/dist`) becomes the web asset folder.
3. **Build and test in Xcode/Simulator** — verify the wrapped app behaves identically to the PWA.
4. **Implement offline fallback** — show a cached last-viewed state or clear "no connection" screen when offline.
5. **Create App Store listing assets** — screenshots, description, privacy policy page.
6. **Resolve Apple IAP requirement** — decide on billing strategy for iOS (see considerations above).
7. **Submit to TestFlight** — internal testing before public submission.
8. **Submit to App Store Review**.

## Architecture Note

The app is a React 18 + Vite SPA with an Express.js backend. The entire frontend builds to a static `dist/` folder, making it straightforward to wrap with Capacitor. No React Native migration is needed — the PWA is already optimized for mobile viewports and touch interactions.
