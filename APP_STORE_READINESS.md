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

### (a) Build + upload — Codemagic (no Mac needed)

`codemagic.yaml` (workflow `Particle iOS Release`) runs on a cloud Mac
mini M2 with Xcode 26: `npm ci && npm run build` → `cap sync ios` →
mints an Apple Distribution certificate + App Store provisioning profile
via the `CodemagicASCKey` App Store Connect API-key integration → builds
the IPA from `App.xcodeproj` (SPM, no Pods) → uploads to TestFlight.
`VITE_API_URL` / `VITE_WS_URL` are baked in as the live
`senger-server.onrender.com` origin. No `triggering:` block, so builds
are started by hand in the Codemagic UI (or wire push-to-main there).

To ship a build: codemagic.io → app → Start new build → `main` →
`Particle iOS Release`. ~15 min. If it fails, read the log for the step
name; the last ten commits on this file were exactly that loop.

Known risk in the signing step: `fetch-signing-files --create` makes the
bundle-id + profile, but the **Sign in with Apple capability must be
enabled on the bundle id in the Apple Developer portal** (Identifiers →
`com.the-particle.app` → Capabilities → Sign In with Apple) or the
profile won't carry the `applesignin` entitlement and signing fails.
Do that once, by hand, before the first build.

### (a′) App Store Connect — web forms, can be done in the Claude browser pane

Sign in to appstoreconnect.apple.com yourself in the pane; the forms can
then be filled from the metadata file. Steps:

1. **App record.** My Apps → + → iOS, name "The Particle", bundle id
   `com.the-particle.app`, SKU `particle-market-001`. Listing copy from
   `APPSTORE_METADATA.md` (no competitor trademarks).
2. **Six IAP products.** Features → In-App Purchases → one subscription
   group "Particle Terminal", six auto-renewables with the exact ids in
   §1 (Billing), ranked nuclear > dark > new. Nuclear annual is 999
   (Apple caps at 999.99); the app hides its "launch promo" badge unless
   ASC also carries a matching introductory offer.
3. **Shared secret.** App Information → App-Specific Shared Secret →
   copy into Render → `senger-server` → `APPLE_IAP_SHARED_SECRET`.
   Production `/purchase` and `/restore` return 503 without it, by
   design. **Only Vinicius can set Render env vars.**
4. **Sign in with Apple server config.** Render `APPLE_CLIENT_ID` must
   equal the native bundle id `com.the-particle.app` for the
   `identityToken` audience check. (If web SIWA must also work, the
   server needs to accept an array — see `server/routes/auth.js`.)
5. **Server notifications URL** (optional for v1): App Information →
   App Store Server Notifications → `https://senger-server.onrender.com/api/billing/iap/webhook`.
6. **Screenshots.** iPhone 6.7" (1290×2796) required; 6.5" optional.
   Can be captured from the live site at a mobile viewport — Apple
   checks dimensions, not provenance. Captions in `APPSTORE_METADATA.md`.
7. **App Privacy questionnaire.** Must match `PrivacyInfo.xcprivacy`:
   email, user id, user content, customer support — linked, not
   tracking, no ads. "Unrestricted Web Access" NO. Gambling NO.
8. **Support URL.** `https://the-particle.com/support` doesn't exist yet;
   create it or use a `mailto:`. Must differ from the privacy URL.
9. **Review test account.** Provision one on Nuclear tier; put it in the
   "Sign-in required" section.

### (a″) TestFlight check — on an iPhone (Vinicius)

Install TestFlight, open the build, and run the four flows Apple will:
subscribe (sandbox Apple ID) → cancel on the sheet → Restore on a
second account → Delete account. All four must behave before Submit.

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

1. Apple Developer portal: enable Sign In with Apple on
   `com.the-particle.app` (one-time).
2. Codemagic: Start new build on `main`. Wait for the TestFlight email.
3. App Store Connect: app record, six IAP products, shared secret →
   Render, `APPLE_CLIENT_ID` → Render.
4. TestFlight on a phone: purchase / cancel / restore / delete.
5. ASC: screenshots, listing copy, privacy answers, support URL, review
   notes + test account.
6. Submit. Expect one round of questions; the likely ones are 4.2 (web
   wrapper — answer with the native features list in §2(b)1) and 3.1.2
   (confirm Terms/Privacy links are on the purchase sheet — they are).
