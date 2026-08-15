// "A new version shipped — reload" (0199). We deploy near-daily and hotfix
// during live games; a long-lived tab quietly running last week's engine is
// how the 8/15 playtest got a web board disagreeing with the app. The build
// emits dist/version.json (vite.config.ts); this polls it — every 5 minutes
// and whenever the tab regains focus — and offers one tap to reload when the
// deployed version stops matching the one this bundle was built from.
// Navigations are network-first in the service worker, so the reload IS the
// upgrade; nothing else to orchestrate.
import { useEffect, useState } from 'react';
import { APP_VERSION } from '@drip/core/version';

const POLL_MS = 5 * 60_000;

export function UpdateBanner() {
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return; // dev serves no version.json and reloads constantly anyway
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const v = (await res.json() as { version?: string }).version;
        if (!stop && v && v !== APP_VERSION) setNext(v);
      } catch { /* offline — next poll */ }
    };
    const t = window.setInterval(() => { void check(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis);
    void check();
    return () => { stop = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  if (!next) return null;
  return (
    <button onClick={() => window.location.reload()} className="mono"
      style={{
        position: 'fixed', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
        background: 'var(--you)', color: 'var(--on-accent)', border: 'none', cursor: 'pointer',
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
      }}>
      ⬆ NEW VERSION {next} IS OUT — TAP TO RELOAD
    </button>
  );
}
