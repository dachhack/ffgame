// Intl BEFORE everything: core derives NFL game windows in Eastern Time via
// Intl.DateTimeFormat, and Hermes's own Intl can't do IANA time zones. This
// has to be installed before any module that might format a date runs. See
// src/intl-polyfill.ts.
import './src/intl-polyfill';

// Then the platform adapter, also as an import side effect, because everything
// below reaches into @drip/core, which reads storage, env and the launch URL
// through it. Same constraint as the web app's main.tsx — see the note in
// src/platform.native.ts.
import './src/platform.native';

// The home-screen widget (v0.421.0): its headless task handler and the silent
// push task have to be registered when the BUNDLE loads — HeadlessJS runs this
// file with no root component — and after the platform adapter, because the
// handler reads the session and the per-widget league out of storage.
import { registerMatchupWidget } from './src/widget/widgetTask';

import { registerRootComponent } from 'expo';
import { setInjurySeason } from '@drip/core/data/injuries';
import { LIVE_SEASON } from '@drip/core/data/realPbp';
import { initAnalytics } from '@drip/core/analytics';
import { initNativeAnalytics } from './src/analytics.native';
import { App } from './App';
import { installOtaUpdates } from './src/updates';

// Analytics before the first render, mirroring the web's main.tsx: the sink is
// registered first so `app_open` is the first event out rather than the first
// one buffered. A build without VITE_POSTHOG_KEY registers nothing and sends
// nothing — see src/analytics.native.ts.
initNativeAnalytics();
// `native: true` is what separates app traffic from the web/PWA in every chart;
// the web sends `standalone` from the same seam.
initAnalytics({ native: true });

// THE PHONE PLAYS THE LIVE SEASON (v0.712.2). injuryFor falls back to the
// baked 2025 report whenever the live one is not installed for the week asked
// (another screen or the widget loaded a different week, or the read failed),
// and only setActiveLeague / resetToDemoLeague ever move that season off 2025:
// the web calls them, the phone never did. So a Wednesday week-6 board wore
// 2025's week 6: Brock Bowers and Terry McLaurin "O" at 0.0, both healthy on
// every 2026 feed. The phone has no 2025 board to protect; set it before the
// widget's headless task or any screen can ask.
setInjurySeason(LIVE_SEASON);
registerMatchupWidget();
// Over-the-air updates: check on every return to the foreground and apply a
// downloaded update after a long enough absence (src/updates.ts).
installOtaUpdates();
registerRootComponent(App);
