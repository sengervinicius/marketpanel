# Senger Market — App Store Readiness Assessment

Last updated: Phase 5E (April 2026)

## What Is Ready

- **Core mobile UX**: 5-tab navigation (Home, Search, Portfolio, Alerts, More) with clean touch targets, safe-area handling, and app-like navigation patterns.
- **PWA manifest**: standalone display mode, theme colors, app name/short name consistent, orientation support, categories declared.
- **Key flows working**: search → instrument detail → add to portfolio/create alert, portfolio management with P&L, alerts with triggered badges, settings/account/billing access.
- **Mobile-first components**: HomePanelMobile, PortfolioMobile, AlertsMobile, ChartsPanelMobile, MobileMoreScreen all use tokenized CSS primitives.
- **iOS PWA tags**: apple-mobile-web-app-capable, status bar style, apple-touch-icon.
- **Safe-area handling**: env(safe-area-inset-*) applied to header, tab bar, content areas, and toast notifications.
- **Input zoom prevention**: font-size: 16px on mobile inputs prevents iOS auto-zoom.
- **Overscroll behavior**: disabled rubber-banding for native feel.
- **Capacitor native wrapper**: configured with `com.arccapital.senger` bundle ID, iOS/Android platform settings, and remote server hostname.
- **App icons**: all required sizes generated (192, 512, maskable-192, maskable-512, 1024) via `scripts/generate-icons.js`.
- **Privacy policy**: publicly accessible at `/privacy.html`, covering data collection, storage, third-party services, deletion rights, and children's privacy.
- **Account deletion**: `DELETE /api/auth/account` endpoint removes user account plus all portfolio, alert, and settings data. Two-step confirmation dialog in MobileMoreScreen. Satisfies Apple's account deletion requirement.
- **Offline fallback**: service worker with stale-while-revalidate for static assets, network-first for API calls with cache fallback, and a dedicated `/offline.html` page for navigation failures.
- **App Store screenshots**: Generated at all required App Store sizes (iPhone 6.7", 6.5", iPad 12.9") plus manifest screenshots (1080x1920 mobile, 2560x1440 desktop).
- **App Store metadata**: Complete `APPSTORE_METADATA.md` with App Store Connect fields, description, keywords, review notes, screenshot captions.
- **iOS and Android native projects**: Capacitor iOS (`ios/`) and Android (`android/`) platforms initialized, web assets synced, app icon in Xcode asset catalog.
- **Apple IAP integration**: Server-side IAP routes (`/api/billing/iap/*`) for product listing, purchase validation, restore, and Apple webhook. Client-side platform detection (`services/platform.js`), IAP service (`services/iap.js`), platform-aware checkout in AuthContext, "Restore Purchases" button on iOS subscription screen.

## What Blocks App Store Submission

### Required Before Submission

1. **Xcode build and TestFlight**: Open `client/ios/App/App.xcworkspace` in Xcode, configure signing, build, test in Simulator, submit to TestFlight.
2. **Apple Developer account setup**: Create app in App Store Connect, configure IAP products, upload screenshots.
3. **Replace placeholder screenshots**: The generated screenshots are programmatic mockups. Capture final screenshots from Xcode Simulator at required resolutions.
4. **Configure Apple IAP shared secret**: Set `APPLE_IAP_SHARED_SECRET` env var on Render for receipt validation.

### Resolved Blockers (Phase 5D + 5E)

| Blocker | Resolution |
|---|---|
| Native wrapper | Capacitor configured + iOS/Android platforms added |
| App icons | 5 PNG files generated at all required sizes, 1024px in Xcode assets |
| Privacy policy | `/privacy.html` — publicly accessible |
| Account deletion | `DELETE /api/auth/account` + MobileMoreScreen UI |
| Offline fallback | Service worker v2 + `/offline.html` page |
| App Store screenshots | Generated at iPhone 6.7", 6.5", iPad 12.9", mobile, desktop |
| App Store metadata | `APPSTORE_METADATA.md` with description, keywords, review notes |
| iOS/Android platforms | `npx cap add ios` + `npx cap add android` complete |
| Apple IAP integration | Server routes `/api/billing/iap/*`, client platform detection, Restore Purchases |

## Apple In-App Purchase Strategy

### Current Billing Architecture
Senger Market currently uses **Stripe** for subscription billing via web checkout. Payment information is handled entirely by Stripe and never touches our servers.

### iOS Billing Options

**Option A — Apple IAP for iOS (Recommended for Launch)**
- Implement `@capacitor-community/in-app-purchases` or RevenueCat SDK.
- Create subscription products in App Store Connect matching current tiers.
- Detect platform at runtime: iOS native → Apple IAP; web/Android → Stripe.
- Apple takes a 15-30% commission depending on revenue tier (15% for Small Business Program if under $1M/year).
- Pros: full App Store compliance, no review risk.
- Cons: revenue share, maintaining two billing systems.

**Option B — Reader App Exemption**
- If Senger qualifies as a "reader app" (users consume previously purchased content), it may be exempt from IAP requirements.
- Financial data apps can sometimes qualify, but Apple's interpretation is narrow.
- Pros: avoid Apple's commission.
- Cons: uncertain eligibility, possible rejection.

**Option C — External Purchase Links (EU / US Regulatory)**
- Under EU DMA and US court rulings, apps can link to external payment pages with proper disclosures.
- Implement `StoreKit External Purchase Link` entitlement.
- Pros: use existing Stripe flow, lower fees.
- Cons: region-specific, requires Apple-approved disclosure UI.

### Recommended Approach
Start with **Option A** for initial launch to ensure smooth App Store approval. Revenue under $1M/year qualifies for Apple's 15% Small Business Program rate. Evaluate Option C as regulations mature.

### Implementation Steps
1. Create subscription products in App Store Connect.
2. Add `@capacitor-community/in-app-purchases` to the project.
3. Implement platform detection in the billing flow.
4. Add receipt validation on the server (verify with Apple's `/verifyReceipt` endpoint).
5. Map Apple subscription events to existing user subscription fields (`isPaid`, `subscriptionActive`, `trialEndsAt`).

## Recommended Next Steps (In Order)

1. **Open in Xcode** — `cd client && npx cap open ios`. Configure signing with your Apple Developer team.
2. **Create App Store Connect app** — Bundle ID `com.arccapital.senger`, add IAP subscription products matching `IAP_PRODUCTS` in `services/iap.js`.
3. **Set env vars on Render** — `APPLE_IAP_SHARED_SECRET` for receipt validation, `APPLE_CLIENT_ID` for Sign In with Apple.
4. **Capture final screenshots** — Replace the generated placeholder screenshots with real captures from Xcode Simulator at required resolutions.
5. **Test in Simulator** — Verify all flows: login, portfolio, alerts, charts, account deletion, offline fallback.
6. **Submit to TestFlight** — Upload build, invite testers, validate IAP sandbox purchases.
7. **Submit to App Store Review** — Use metadata from `APPSTORE_METADATA.md`.

## Architecture Note

The app is a React 18 + Vite SPA with an Express.js backend. The entire frontend builds to a static `dist/` folder, making it straightforward to wrap with Capacitor. No React Native migration is needed — the PWA is already optimized for mobile viewports and touch interactions.
