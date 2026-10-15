# The Particle — App Store Readiness

Last updated: 2026-10-15 (commit series #292 W1–W6). Supersedes the April
"Senger Market" version of this file.

This is the honest state of the iOS (and Android) native wrapper as it sits
in `main`. Section 1 is what is done and verified in code. Section 2 is
what remains, split into (a) things that need a Mac + Xcode + App Store
Connect — i.e. Vinicius — and (b) product decisions. Section 3 is the
submission runbook in order.

---

## 1. Done and verified in code

### Identity + branding
- Bundle ID `com.the-particle.app` (iOS). Android `applicationId`
  `com.the_particle.app` — Android forbids hyphens, so the two diverge by
  one character; this is normal.
- Display name "The Particle" on both platforms. Capacitor `appName`,
  `ios.scheme`, Android `strings.xml`, Java package all match.
- iOS AppIcon is the orange Particle orb (regenerated Oct 15).
- Android launcher (legacy + round + adaptive foreground, all 5 densities)
  and splash (port + land, all densities) regenerated from
  `public/icon-1024.png` on the `#07070b` app background. Adaptive-icon
  background colour switched from `#FFFFFF` to `#07070B` (no white ring
  on masked launchers).
- No "Senger" strings remain in user-visible surfaces. The
  `senger-market-server` / `senger-market-client` Render service names
  and matching CORS/CSP origins are live infrastructure identifiers and
  are intentionally untouched.
- `public/terms.html` pricing paragraph now lists the three USD tiers and
  notes Apple IAP billing on iOS (was "£29 per month").

### Capacitor / native project
- `npx cap sync ios` run: `CapApp-SPM/Package.swift` links 8 plugins
  including `CapgoNativePurchases` (StoreKit) and
  `CapacitorCommunityAppleSignIn`. iOS uses SPM — open `App.xcodeproj`
  directly; there is no Podfile and none is needed on Capacitor 7.
- `npx cap sync android` run: `capacitor.settings.gradle` now includes
  all 8 plugin modules (was 1); `capacitor-cordova-android-plugins/`
  exists so the project configures.
- `@capacitor/push-notifications` REMOVED (plugin + config block). Nothing
  in the client registered for push and `App.entitlements` has no
  `aps-environment`; shipping the capability unused invites a review
  question. Re-add when push is wired end-to-end (APNs + server sender).
- `Info.plist`: `ITSAppUsesNonExemptEncryption=false` (kills the export-
  compliance prompt on every upload), iPhone-only
  (`TARGETED_DEVICE_FAMILY=1`), portrait-only, `arm64`.
- `App.entitlements`: Sign in with Apple only. Correct for current scope.
- `PrivacyInfo.xcprivacy` present: `NSPrivacyTracking=false`, UserDefaults
  CA92.1, eight collected-data types all "linked, not tracking". Sentry
  runs with `sendDefaultPii:false`. PostHog is now hard-gated OFF inside
  the native shell (`utils/analytics.js`) so the "no analytics SDK"
  declaration stays true even though the shell remote-loads the website.

### Billing (Guideline 3.1)
- Six auto-renewable products, ids identical on client
  (`services/iap.js IAP_PRODUCTS`), server (`config/tiers.js
  appleProductId`) and the `/products` endpoint:
  `com.theparticle.app.{new,dark,nuclear}.{monthly,annual}`.
- Purchase: `NativePurchases.purchaseProduct` → receipt → POST
  `/api/billing/iap/purchase` → server verifies with Apple (prod, sandbox
  on 21007) → activates with Apple-verified expiry. Fails closed in
  production without `APPLE_IAP_SHARED_SECRET` or a receipt. Cancel on
  the Apple sheet is reported as `{cancelled:true}` and shows no success
  message.
- Restore (3.1.1): REAL as of W5. Client runs `AppStore.sync()`, reads
  the device's subscription transactions via `getPurchases()`, sends the
  receipt of the active/latest Particle product; server verifies, picks
  the furthest-expiry entitlement for any of our product ids, and
  activates it on the signed-in account if unexpired. Replies
  distinguish restored / lapsed / none. `MobileAppV2.doRestore` refreshes
  the entitlement on success and shows the honest message otherwise.
  Restore button is on both the account sheet and the plans sheet.
- Subscription screen (3.1.2): title, period, price, auto-renew
  disclosure, cancel instructions, Terms (EULA) + Privacy links on the
  SAME sheet as the Subscribe button. Apple's localised price string is
  shown once StoreKit answers; the "LAUNCH PROMO · 50% OFF" badge and
  the strikethrough are both suppressed in that case (2.3.1).
- Manage subscription on iOS deep-links to
  `apps.apple.com/account/subscriptions` via `UIApplication.open`.

### Account (Guideline 5.1.1)
- Sign in with Apple via the native plugin (no web redirect inside the
  webview). Email/password also offered.
- Account deletion: account sheet → "Delete account" → two-step confirm →
  `DELETE /api/auth/account` → local wipe + reload.
- Logout on the account sheet.
- Terms-acceptance gate now mounted on mobile too (was desktop-only).

### UX verified for review screenshots
- Safe-area insets on header, tab bar, composer, search, sheets.
- Offline: header dot + "Offline" label; feed failures render a tappable
  "Market data unavailable · TAP TO RETRY" card.
- Empty states: watchlist (CTA into search), vault, AI chat.
- 44pt touch targets across the v2 shell (upstream "pre-submission pass").

---

## 2. What remains

### (a) Needs a Mac + Xcode + App Store Connect — Vinicius

1. **Signing.** `DEVELOPMENT_TEAM` is not set in `project.pbxproj`. Open
   `client/ios/App/App.xcodeproj`, select the App target → Signing &
   Capabilities → pick the Algotex team. Xcode will register the bundle
   id and generate the provisioning profile. Confirm "Sign in with Apple"
   shows as an enabled capability (it reads `App.entitlements`).
2. **App Store Connect record.** Create the app with bundle id
   `com.the-particle.app`, SKU `particle-market-001`. Paste listing copy
   from `APPSTORE_METADATA.md` (rewritten — no competitor trademarks in
   keywords or description).
3. **Six IAP products.** Features → In-App Purchases → one subscription
   group "Particle Terminal", six auto-renewables with the exact ids
   above, ranked nuclear > dark > new. Prices per `APPSTORE_METADATA.md`.
   Nuclear annual is 999 (Apple caps at 999.99) and the app frames it as
   a launch promo — if you want the badge to show on the live sheet, add
   a matching introductory offer in ASC; otherwise the app hides it.
4. **Shared secret.** ASC → App → App Information → App-Specific Shared
   Secret → copy into Render env `APPLE_IAP_SHARED_SECRET` on
   `senger-market-server`. Without it production `/purchase` and
   `/restore` return 503 by design.
5. **Sign in with Apple server config.** `APPLE_CLIENT_ID` on Render must
   equal the NATIVE bundle id (`com.the-particle.app`) for the
   `identityToken` audience check. If web SIWA also needs to work, the
   server must accept an array (web Services ID + native bundle id) —
   see `server/routes/auth.js` Apple route; currently a single value.
6. **Server-to-server notifications.** ASC → App Information → App Store
   Server Notifications → Production URL
   `https://<server>/api/billing/iap/webhook`. The handler currently
   acknowledges but does not verify Apple's JWS or act on
   renewal/cancellation — see decision (b)3.
7. **Build + TestFlight.** `cd client && npm run cap:build:ios`, then in
   Xcode Product → Archive → Distribute → App Store Connect. Test in a
   sandbox-tester account: purchase each tier, cancel on the sheet,
   restore on a second account, delete account.
8. **Screenshots.** Capture from the Simulator at 6.7" and 6.5" (iPhone
   only — iPad is not targeted). Captions in `APPSTORE_METADATA.md`.
9. **App Privacy questionnaire.** Answers must match
   `PrivacyInfo.xcprivacy`: the listed data types, all linked, none used
   for tracking, no third-party advertising. Say NO to "Unrestricted Web
   Access" and NO to gambling (Predictions is read-only odds).
10. **Support URL.** `https://the-particle.com/support` does not exist
    yet. Either create the page or point the field at a `mailto:`.
    Apple requires it be distinct from the privacy policy URL.
11. **Test account for review.** Provision one on Nuclear tier and put the
    credentials in the "Sign-in required" section of the submission.

### (b) Product / architecture decisions

1. **Remote-loading wrapper (Guideline 4.2 risk).** `capacitor.config.json`
   has `server.hostname: "the-particle.com"`, so the native app is a
   webview around the live site; `dist/` is bundled but ignored. Every
   web deploy changes the reviewed app, and Apple can reject "web
   wrappers" under minimum-functionality. Mitigation today: native SIWA,
   native StoreKit, native share/haptics/keyboard — enough to argue it
   is not a thin wrapper. The alternative is to remove `server.hostname`
   and ship bundled assets (then each native release is a Xcode archive,
   and `apiFetch`'s `API_BASE` must point at the server origin, which it
   already does). Recommend: ship v1 remote-loading, move to bundled
   assets for v1.1 once the review outcome is known.
2. **Android / Google Play.** Not in scope for this submission, but the
   project now configures. Android currently falls through to Stripe
   hosted checkout via `window.location.href`, which violates Play
   Billing policy for digital subscriptions — do not submit to Play
   until `@capgo/native-purchases` is wired for Google Play Billing on
   that path.
3. **Webhook verification.** `/api/billing/iap/webhook` does not verify
   Apple's JWS signature or process renewals/expirations. The daily IAP
   reconciler (W5.1) re-verifies stored receipts, which covers lapses
   within ~24h. Acceptable for launch; implement JWS verification +
   event handling before scale.
4. **Push.** Removed. If you want price-alert push on day one, that is a
   separate piece of work: APNs key in ASC, `aps-environment`
   entitlement, client registration + token POST, server sender.

---

## 3. Submission runbook (in order)

1. `git pull` on the Mac; `cd client && npm ci && npm run cap:build:ios`.
2. Open `client/ios/App/App.xcodeproj`. Set team. Confirm capabilities.
3. Product → Archive. Fix any signing errors. Upload to App Store Connect.
4. In ASC: create the app, the six IAP products, the shared secret,
   server notification URL. Put the shared secret in Render.
5. TestFlight internal test: full purchase / cancel / restore / delete
   cycle in sandbox on two accounts.
6. Screenshots, listing copy, privacy answers, support URL, review notes
   + test account.
7. Submit. Expect one round of questions; the likely ones are 4.2 (web
   wrapper — answer with the native features list above) and 3.1.2
   (confirm the Terms/Privacy links are on the purchase sheet — they
   are).
