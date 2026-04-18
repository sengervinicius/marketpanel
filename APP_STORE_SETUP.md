# Senger — Apple App Store Setup Guide

## Prerequisites (Already Done)
- [x] Apple Developer Program enrollment
- [x] Capacitor installed and configured (`capacitor.config.json`)
- [x] Capacitor plugins installed (SplashScreen, StatusBar, Keyboard, Haptics, PushNotifications, Share, App)

## Step-by-Step Setup (On Mac with Xcode)

### 1. Add iOS Platform
```bash
cd client
npx cap add ios
npx cap sync
```

### 2. Open in Xcode
```bash
npx cap open ios
```

### 3. Configure Signing in Xcode
- Select the "App" target
- Go to "Signing & Capabilities"
- Team: Select your Apple Developer team (Algotex Ltd)
- Bundle Identifier: `com.senger.market`
- Enable: Push Notifications capability
- Enable: In-App Purchase capability
- Enable: Sign in with Apple capability

### 4. App Icons
- Open `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- Add icons in required sizes:
  - 1024x1024 (App Store)
  - 180x180 (iPhone @3x)
  - 120x120 (iPhone @2x)
  - 167x167 (iPad Pro)
  - 152x152 (iPad)
  - 76x76 (iPad @1x)

### 5. Launch Screen
- Edit `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- Set background color to #0a0a0f (dark theme)
- Add Senger logo centered

### 6. Info.plist Additions
Add to `ios/App/App/Info.plist`:
```xml
<key>NSCameraUsageDescription</key>
<string>Senger needs camera access for document scanning</string>
<key>NSFaceIDUsageDescription</key>
<string>Use Face ID to unlock Senger</string>
```

### 7. Build & Archive
```bash
npx cap sync
```
Then in Xcode:
1. Select "Any iOS Device" as destination
2. Product → Archive
3. Distribute App → App Store Connect
4. Upload

### 8. App Store Connect Configuration
- **App Name**: Senger Market Terminal
- **Subtitle**: Professional Market Intelligence
- **Category**: Finance
- **Keywords**: stocks, market, terminal, trading, finance, bloomberg, portfolio, investing, forex, crypto
- **Privacy Policy URL**: https://the-particle.com/privacy
- **Support URL**: https://the-particle.com/support

### 9. Screenshots Needed
- 6.7" (iPhone 15 Pro Max): 1290 x 2796 px — minimum 3
- 6.1" (iPhone 15): 1179 x 2556 px — minimum 3
- 12.9" iPad Pro: 2048 x 2732 px — minimum 3

### 10. IAP Products
Configure in App Store Connect → In-App Purchases:
- `com.senger.market.pro.monthly` — $9.99/month
- `com.senger.market.pro.yearly` — $69.99/year

### 11. Review Notes
Include demo account credentials:
- Email: reviewer@arccapital.com.br
- Password: [create a demo account before submission]

Mention native features to avoid rejection:
- Push notifications for price alerts
- Biometric authentication (Face ID)
- Haptic feedback on interactions
- Offline cached data
- Native share sheet
