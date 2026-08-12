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

import { registerRootComponent } from 'expo';
import { initAnalytics } from '@drip/core/analytics';
import { initNativeAnalytics } from './src/analytics.native';
import { App } from './App';

// Analytics before the first render, mirroring the web's main.tsx: the sink is
// registered first so `app_open` is the first event out rather than the first
// one buffered. A build without VITE_POSTHOG_KEY registers nothing and sends
// nothing — see src/analytics.native.ts.
initNativeAnalytics();
// `native: true` is what separates app traffic from the web/PWA in every chart;
// the web sends `standalone` from the same seam.
initAnalytics({ native: true });

registerRootComponent(App);
