/**
 * lazyPanels.js — #253 P3.1 extract of lazy-loaded panel/screen imports from App.jsx.
 *
 * Every top-level route/panel that App.jsx renders behind a Suspense boundary
 * lives here, so the shell file stays focused on composition and state wiring.
 * Each module uses lazyWithRetry so stale-deploy chunk-load errors auto-recover.
 */

import { lazyWithRetry } from './utils/lazyWithRetry';

// ── Primary panels ───────────────────────────────────────────────────────
export const ETFPanel          = lazyWithRetry(() => import('./components/panels/ETFPanel'));
export const AlertCenterPanel  = lazyWithRetry(() => import('./components/panels/AlertCenterPanel'));
export const NewsPanel         = lazyWithRetry(() => import('./components/panels/NewsPanel'));
export const ScreenerPanel     = lazyWithRetry(() => import('./components/panels/ScreenerPanel'));
export const MacroPanel        = lazyWithRetry(() => import('./components/panels/MacroPanel'));
export const ChatPanel         = lazyWithRetry(() => import('./components/panels/ChatPanel'));
export const PredictionPanel   = lazyWithRetry(() => import('./components/panels/PredictionPanel'));

// ── Mobile-only panels ───────────────────────────────────────────────────
export const PortfolioMobile   = lazyWithRetry(() => import('./components/panels/PortfolioMobile'));
export const HomePanelMobile   = lazyWithRetry(() => import('./components/panels/HomePanelMobile'));
export const ChartsPanelMobile = lazyWithRetry(() => import('./components/panels/ChartsPanelMobile'));
export const MobileMoreScreen  = lazyWithRetry(() => import('./components/panels/MobileMoreScreen'));

// ── Onboarding / app-level ───────────────────────────────────────────────
export const WelcomeTour       = lazyWithRetry(() => import('./components/onboarding/WelcomeTour'));
export const VaultPanel        = lazyWithRetry(() => import('./components/app/VaultPanel'));
export const AdminDashboard    = lazyWithRetry(() => import('./components/admin/AdminDashboard'));

// ── Sector / region screens ──────────────────────────────────────────────
export const DefenceScreen          = lazyWithRetry(() => import('./components/screens/DefenceScreen'));
export const CommoditiesScreen      = lazyWithRetry(() => import('./components/screens/CommoditiesScreen'));
export const GlobalMacroScreen      = lazyWithRetry(() => import('./components/screens/GlobalMacroScreen'));
export const FixedIncomeScreen      = lazyWithRetry(() => import('./components/screens/FixedIncomeScreen'));
export const BrazilScreen           = lazyWithRetry(() => import('./components/screens/BrazilScreen'));
export const TechAIScreen           = lazyWithRetry(() => import('./components/screens/TechAIScreen'));
export const GlobalRetailScreen     = lazyWithRetry(() => import('./components/screens/GlobalRetailScreen'));
export const AsianMarketsScreen     = lazyWithRetry(() => import('./components/screens/AsianMarketsScreen'));
export const EuropeanMarketsScreen  = lazyWithRetry(() => import('./components/screens/EuropeanMarketsScreen'));
export const CryptoScreen           = lazyWithRetry(() => import('./components/screens/CryptoScreen'));

// ── Instrument detail / editors ──────────────────────────────────────────
export const InstrumentDetail  = lazyWithRetry(() => import('./components/common/InstrumentDetail'));
export const AlertEditor       = lazyWithRetry(() => import('./components/common/AlertEditor'));
