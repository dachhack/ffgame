import { useEffect, useSyncExternalStore } from 'react';
import { canPromptInstall, dismissInstall, isIosSafari, onInstallStateChange, promptInstall } from './pwa';
import { track, Ev } from '@drip/core/analytics';

/** "Add to home screen" — a dismissible bottom banner.
 *
 *  Two flavours, because the platforms differ: Chromium gives us a real install
 *  API (a button that opens the native dialog), iOS Safari gives us nothing, so
 *  all we can do is point at the Share sheet. Everything about *when* it appears
 *  — warm-up, snooze, already-installed — lives in pwa.ts; this only draws it.
 *
 *  `raised` lifts it over the request-a-code FAB's lane (bottom-left, see
 *  RequestCode.tsx) on the screens that show one. */
export function InstallPrompt({ raised = false }: { raised?: boolean }) {
  const show = useSyncExternalStore(onInstallStateChange, canPromptInstall, () => false);
  const ios = show && isIosSafari();

  useEffect(() => { if (show) track(Ev.pwaInstallShown, { ios }); }, [show, ios]);
  if (!show) return null;

  return (
    <div
      style={{ ...wrap, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${raised ? 62 : 16}px)` }}
      role="dialog"
      aria-label="Install Drip Fantasy"
    >
      <img src={`${import.meta.env.BASE_URL}icons/pwa/icon-192.png`} alt="" width={38} height={38} style={icon} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          Keep Drip one tap away
        </div>
        <div className="mono" style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--faint)', marginTop: 2 }}>
          {ios
            ? <>Tap <b style={{ color: 'var(--text)' }}>Share</b>, then <b style={{ color: 'var(--text)' }}>Add to Home Screen</b>.</>
            : 'Add it to your home screen — no browser, no tab to lose.'}
        </div>
      </div>
      {!ios && (
        <button onClick={() => void promptInstall()} className="mono" style={install}>install</button>
      )}
      <button onClick={dismissInstall} className="mono" style={close} aria-label="Dismiss">✕</button>
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed', zIndex: 58,
  left: 12, right: 12,   // `bottom` is set per-render — see `raised`
  maxWidth: 420, margin: '0 auto',
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 12px', borderRadius: 12,
  background: 'var(--surface)', border: '1px solid var(--bd)',
  borderLeft: '3px solid var(--you)',
  boxShadow: '0 6px 22px rgba(0,0,0,0.34)',
};
const icon: React.CSSProperties = { borderRadius: 9, flex: 'none' };
const install: React.CSSProperties = {
  flex: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--you) 50%, var(--bd))', borderRadius: 999,
  padding: '7px 13px',
};
const close: React.CSSProperties = {
  flex: 'none', fontSize: 11, color: 'var(--faint)',
  background: 'none', border: 'none', padding: '6px 2px', lineHeight: 1,
};
