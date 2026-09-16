// WHAT'S NEW (v0.393.0) — #/changelog. Renders public/changelog.json, which
// scripts/gen-changelog.mjs writes from STATUS.md at build time, and carries
// the Android playtest link at the top. The app's "You are N versions behind"
// banner deep-links here for the long form.
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { Brand, SiteSettings } from '../app/ui';
import { APP_VERSION } from '@drip/core/version';
import { APK_URL, APK_RELEASE_PAGE_URL, compareVersions, type Changelog as Log } from '@drip/core/data/changelog';

export function Changelog() {
  const { navigate } = useStore();
  const [log, setLog] = useState<Log | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    fetch(`${import.meta.env.BASE_URL}changelog.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Log>; })
      .then((l) => { if (!dead) setLog(l); })
      .catch((e) => { if (!dead) setErr(String(e?.message ?? e)); });
    return () => { dead = true; };
  }, []);
  const mine = APP_VERSION.replace(/^v/, '');
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--bd)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Brand onClick={() => navigate({ name: 'live' })} hideDataSource />
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)' }}>WHAT'S NEW</span>
        </div>
        <SiteSettings />
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '18px 16px 60px' }}>
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--surface)', marginBottom: 18 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700 }}>📱 Drip Fantasy for Android</div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 3, lineHeight: 1.5 }}>
              The playtest build, always the newest. Android asks once to allow installs from your browser.
              iOS is not built yet — the site works in Safari.
            </div>
          </div>
          <a href={APK_URL} className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '9px 14px', textDecoration: 'none', whiteSpace: 'nowrap' }}>⬇ DOWNLOAD APK</a>
          <a href={APK_RELEASE_PAGE_URL} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>which build? →</a>
        </section>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 10 }}>
          THIS SITE IS {APP_VERSION.toUpperCase()}{log?.latest ? ` · LOG TO V${log.latest.toUpperCase()}` : ''}
        </div>
        {err && <div className="mono" style={{ fontSize: 10, color: 'var(--warn)' }}>Couldn't load the changelog ({err}).</div>}
        {!log && !err && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>Loading…</div>}
        {log?.entries.map((e) => {
          const newer = compareVersions(e.version, mine) > 0;
          return (
            <article key={e.version} id={`v${e.version}`} style={{ padding: '14px 0', borderTop: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: newer ? 'var(--warn)' : 'var(--you)' }}>v{e.version}</span>
                <span className="grotesk" style={{ fontSize: 14, fontWeight: 700 }}>{e.title}</span>
                {e.webOnly && <span className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '2px 5px' }}>WEB ONLY</span>}
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--dimstrong)', whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{e.notes}</p>
            </article>
          );
        })}
      </main>
    </div>
  );
}
