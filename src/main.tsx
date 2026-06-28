import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './app/store';
import { App } from './App';
import { initAnalytics, registerSink } from './app/analytics';
import './styles.css';

// Wire PostHog as the analytics sink IF a project token is configured (VITE_POSTHOG_KEY,
// a public phc_ ingestion token). Lazy-loaded so an unset key is a true no-op — posthog-js
// isn't even fetched. See docs/analytics-plan.md.
const PH_KEY = import.meta.env.VITE_POSTHOG_KEY;
if (PH_KEY) {
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(PH_KEY, { api_host: 'https://us.i.posthog.com', capture_pageview: false, person_profiles: 'identified_only' });
    registerSink({ track: (e, p) => { posthog.capture(e, p); }, identify: (id, t) => { posthog.identify(id, t); } });
  }).catch(() => { /* analytics is best-effort */ });
}

initAnalytics();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
