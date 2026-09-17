// WHAT'S NEW (v0.393.0) — #/changelog. Renders public/changelog.json, which
// scripts/gen-changelog.mjs writes from STATUS.md at build time, and carries
// the Android playtest link at the top. The app's "You are N versions behind"
// banner deep-links here for the long form.
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { Brand, SiteSettings } from '../app/ui';
import { APP_VERSION } from '@drip/core/version';
import { APK_URL, APK_ZIP_URL, APK_MANIFEST_URL, APK_RELEASE_PAGE_URL, compareVersions, type ApkManifest, type Changelog as Log } from '@drip/core/data/changelog';

/** "3 hours ago" / "2 days ago" — enough to tell a fresh build from a stale
 *  one without turning a timestamp into a reading exercise. */
function builtAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'recently';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function Changelog() {
  const { navigate } = useStore();
  const [log, setLog] = useState<Log | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // WHICH BUILD IS BEHIND THE BUTTON (v0.394.7). release-apk.yml publishes a
  // manifest.json beside the APK; the app has always read it to count how far
  // behind it is, and the site never did — so the download said "always the
  // newest" and asked you to take its word. A failed fetch is not an error
  // worth showing: the button still works, it just goes back to saying that.
  const [apk, setApk] = useState<ApkManifest | null>(null);
  useEffect(() => {
    let dead = false;
    fetch(`${import.meta.env.BASE_URL}changelog.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Log>; })
      .then((l) => { if (!dead) setLog(l); })
      .catch((e) => { if (!dead) setErr(String(e?.message ?? e)); });
    fetch(`${APK_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ApkManifest>) : null))
      .then((m) => { if (!dead && m?.version) setApk(m); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  const mine = APP_VERSION.replace(/^v/, '');
  // The site deploys in ~2 minutes and the APK takes ~10, so right after a
  // release the button honestly offers an older build. Say so rather than let
  // somebody install it and wonder why the fix is missing.
  const apkBehind = !!apk && compareVersions(apk.version, mine) < 0;
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
              {apk
                ? <>Build <strong style={{ color: 'var(--text)' }}>{apk.versionCode}</strong>, carrying <strong style={{ color: 'var(--text)' }}>{apk.version}</strong> · published {builtAgo(apk.built)}. Installs over any earlier playtest build.</>
                : <>The playtest build, always the newest.</>}
              {' '}Android asks once to allow installs from your browser. iOS is not built yet — the site works in Safari.
            </div>
            {apkBehind && (
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', marginTop: 5, lineHeight: 1.5 }}>
                ⚠ THE SITE IS ON {APP_VERSION.toUpperCase()} — THE APK IS STILL BEING BUILT. GIVE IT ~10 MINUTES.
              </div>
            )}
          </div>
          <a href={APK_URL} className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '9px 14px', textDecoration: 'none', whiteSpace: 'nowrap' }}>⬇ DOWNLOAD APK</a>
          {/* THE ZIP IS A BUTTON, NOT A SENTENCE (v0.409.1). It is the route
              that demonstrably completes when the direct one stalls, and
              somebody whose download just hung should not have to read a
              paragraph to find it. */}
          <a href={APK_ZIP_URL} className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 14px', textDecoration: 'none', whiteSpace: 'nowrap' }}>⬇ ZIP</a>
          <a href={APK_RELEASE_PAGE_URL} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>release notes →</a>
          {/* WHEN THE DOWNLOAD SAYS FAILED (v0.408.0). Founder: "the app
              downloads from the link but never finished and says failed
              despite showing all the data transferred." The build is fine —
              the browser is refusing a package archive after the fact — and
              somebody staring at that word needs to be told so, next to the
              button that produced it, rather than left to conclude the app is
              broken. */}
          <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--dim)', lineHeight: 1.5, borderTop: '1px solid var(--bd)', paddingTop: 9 }}>
            Download stalls at 100%, or says <strong style={{ color: 'var(--text)' }}>Failed</strong> once the bar is full? Nothing is wrong with the build — the browser is refusing a file served as an Android package.
            {' '}Take <strong style={{ color: 'var(--text)' }}>⬇ ZIP</strong> instead: it downloads as an ordinary file. Unzip it with any file manager and tap the APK inside — same build, same signature, byte for byte.
          </div>
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
