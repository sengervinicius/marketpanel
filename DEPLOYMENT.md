# The Particle — Deployment Guide

## Part 1: the-particle.com (Landing Page on Cloudflare Pages)

Your domain `the-particle.com` is already purchased on Cloudflare for 10 years. The landing page lives in the `landing/` directory — a static HTML file, no build step needed.

### Step-by-step

1. **Log into Cloudflare Dashboard** — dash.cloudflare.com

2. **Create a Pages project**
   - Sidebar → Workers & Pages → Create → Pages → Connect to Git
   - Select your GitHub repo: `sengervinicius/marketpanel`
   - Configuration:
     - Project name: `the-particle`
     - Production branch: `main`
     - Root directory: `landing`
     - Build command: *(leave empty)*
     - Build output directory: `.` (just a dot — the landing dir IS the output)
   - Click "Save and Deploy"

3. **Connect your custom domain**
   - After first deploy succeeds, go to: Pages → `the-particle` → Custom domains
   - Click "Set up a custom domain"
   - Enter: `the-particle.com`
   - Cloudflare auto-creates the DNS CNAME record (since the domain is already on Cloudflare)
   - Also add: `www.the-particle.com` (optional, redirects to apex)
   - SSL is automatic — no certificates to configure

4. **Verify**
   - Wait 1–2 minutes for DNS propagation
   - Visit https://the-particle.com — should show your landing page
   - Visit https://www.the-particle.com — should redirect to apex

### Updating the landing page

Every push to `main` that changes files in `landing/` triggers an automatic re-deploy. No action needed.

### Alternative: CLI deploy (for manual pushes)

```bash
npm install -g wrangler
wrangler login
cd landing/
wrangler pages deploy . --project-name=the-particle
```

---

## Part 2: Main App (app.sengermarket.com → the-particle.com/app or keep separate)

The main Vite + React app is deployed separately from the landing page. Current setup points to `app.sengermarket.com`.

### Option A: Keep separate domain (recommended for now)

Keep the app on its current host (Railway/Render/VPS). The landing page at `the-particle.com` links to the app. Update the link URL in `landing/index.html` when ready.

### Option B: Move app to Cloudflare Pages too

1. In Cloudflare Pages, create a second project: `particle-app`
2. Configuration:
   - Root directory: `client`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: set any `VITE_*` vars needed
3. Custom domain: `app.the-particle.com`

### Server (API) deployment

The Express server (`server/`) needs a Node.js host (Railway, Render, Fly.io, or VPS). It cannot run on Cloudflare Pages.

Required environment variables — see `server/.env.example` for the full list.

---

## Part 3: iOS App Store (Apple)

The app uses Capacitor to wrap the web app as a native iOS app. Current bundle ID: `com.senger.market`.

### Prerequisites

- Apple Developer account ($99/year) — developer.apple.com
- Mac with Xcode 15+ installed
- Capacitor CLI: `npm install -g @capacitor/cli`

### Step-by-step

1. **Update Capacitor config** — edit `client/capacitor.config.json`:
   ```json
   {
     "appId": "com.theparticle.app",
     "appName": "Particle",
     "server": {
       "hostname": "the-particle.com"
     }
   }
   ```

2. **Build the web app**
   ```bash
   cd client/
   npm run build
   npx cap sync ios
   ```

3. **Open in Xcode**
   ```bash
   npx cap open ios
   ```

4. **Configure signing in Xcode**
   - Select the "App" target
   - Signing & Capabilities tab
   - Team: select your Apple Developer team
   - Bundle Identifier: `com.theparticle.app`
   - Enable "Sign in with Apple" capability
   - Enable "Push Notifications" capability (if using push)

5. **App icons & splash screen**
   - Replace images in `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
   - Update `Splash.imageset` with your splash screen
   - All required sizes: 20pt, 29pt, 40pt, 60pt, 76pt, 83.5pt at 2x and 3x

6. **Create App Store listing** — appstoreconnect.apple.com
   - Click "+" → New App
   - Platform: iOS
   - Name: "Particle — Market Intelligence"
   - Primary language: English (U.S.)
   - Bundle ID: select `com.theparticle.app`
   - SKU: `particle-market-001`
   - Fill in: description, keywords, support URL, screenshots

7. **Screenshots needed** (mandatory):
   - 6.7" (iPhone 15 Pro Max): 1290 × 2796px
   - 6.5" (iPhone 14 Plus): 1284 × 2778px
   - 5.5" (iPhone 8 Plus): 1242 × 2208px
   - 12.9" iPad Pro (if supporting iPad): 2048 × 2732px

8. **In-App Purchases** — appstoreconnect.apple.com → your app → In-App Purchases
   - Create subscriptions for each tier:
     - `new_particle_monthly` — $29.99/month
     - `dark_particle_monthly` — $79.99/month
     - `nuclear_particle_monthly` — $199.99/month
   - Set up a Subscription Group: "Particle Pro"
   - Configure pricing for all territories

9. **Submit for review**
   - In Xcode: Product → Archive
   - Upload to App Store Connect via Xcode Organizer
   - In App Store Connect: select the build, add review notes
   - Submit for review (typically 24–48 hours)

### App Review tips

- Include a demo account in review notes so Apple can test without subscribing
- Make sure the app works offline (shows a graceful error, not a blank screen)
- Ensure the "Restore Purchases" button is visible (required for subscriptions)
- Privacy nutrition label: mark what data you collect (analytics, purchases, identifiers)

---

## Part 4: DNS Summary

| Record | Type | Value | Purpose |
|--------|------|-------|---------|
| the-particle.com | CNAME | `the-particle.pages.dev` | Landing page (auto-created by Cloudflare Pages) |
| www.the-particle.com | CNAME | `the-particle.pages.dev` | WWW redirect |
| app.the-particle.com | CNAME | your app host | Main app (when ready to migrate) |

All DNS records are managed in Cloudflare since the domain is registered there. SSL is automatic for all subdomains proxied through Cloudflare.
