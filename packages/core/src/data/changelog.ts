// The changelog, and "how far behind is this build" (v0.393.0).
//
// Founder, once the APK had a link: "Can we have an in-app check that alerts
// users if they have an older version — 'You are X versions behind' — click
// for change log (I guess we need to keep a change log now too)."
//
// We already keep one: STATUS.md has carried a `### vX.Y.Z — title` section
// per version for months. scripts/gen-changelog.mjs turns those into
// public/changelog.json at web build time, so the site serves it, and both
// hosts read it here. The APK's own version rides a manifest.json beside the
// APK on the apk-latest release (release-apk.yml writes it), so the app can
// tell how many entries sit between the build it is and the build it could be.

export interface ChangelogEntry {
  version: string;      // "0.392.1" (no v)
  title: string;        // the heading after the dash
  notes: string;        // the section's paragraphs, plain text
  webOnly?: boolean;    // the entry says "web only" — nothing for the app in it
}
export interface Changelog { generated: string; latest: string; entries: ChangelogEntry[] }
/** What release-apk.yml publishes beside the APK. */
export interface ApkManifest { version: string; versionCode: number; built: string }

export const SITE_URL = 'https://dripfantasy.com';
export const CHANGELOG_URL = `${SITE_URL}/changelog.json`;
export const CHANGELOG_PAGE_URL = `${SITE_URL}/#/changelog`;
/** THE DIRECT .apk — the SECONDARY route since v0.410.0. Still published, still
 *  correct, and one tap shorter when a browser will take it. But GitHub serves
 *  a file called .apk as application/vnd.android.package-archive and will not
 *  be argued out of it (0409.0 tried), and a browser in package-archive
 *  handling can leave a download sitting at 100% for ever. Offered where there
 *  is room to explain the choice; never the button somebody lands on. */
export const APK_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk';
/** THE SAME APK, ZIPPED — and since v0.410.0 the DEFAULT for Android.
 *
 *  Founder: "the app downloads from the link but never finished and says
 *  failed despite showing all the data transferred", then, once this existed:
 *  "zip downloaded fine, make it the default for android."
 *
 *  It is served as an ordinary file rather than an Android package, which is
 *  the whole difference between a download that finishes and one that sits at
 *  100% with a pause icon. It costs an unzip — worth it, because a default has
 *  to work for the person who has never sideloaded anything and will read
 *  "Failed" as "this app is broken". Same signed build as APK_URL, byte for
 *  byte; release-apk.yml zips the very artifact it publishes. */
export const APK_ZIP_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk.zip';
export const APK_MANIFEST_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/manifest.json';
export const APK_RELEASE_PAGE_URL = 'https://github.com/dachhack/ffgame/releases/tag/apk-latest';
/** THE iPHONE APP — the TestFlight PUBLIC LINK (https://testflight.apple.com/join/…).
 *  Empty until Apple approves the first external build (Beta App Review);
 *  every "get the iOS app" surface hides while it is empty, so a link that
 *  can't work yet is never offered. Paste the link here to switch them on.
 *  Testers open it on the iPhone, install TestFlight, and get every later
 *  build automatically (each expires after 90 days). */
export const IOS_TESTFLIGHT_URL = '';

/** "v0.392.1" / "0.392.1" → [0, 392, 1]. Non-numeric tails read as 0. */
export function parseVersion(v: string | null | undefined): number[] {
  return String(v ?? '').trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
}
/** Semver-ish compare: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a), pb = parseVersion(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return d; }
  return 0;
}

/** The entries newer than `mine` and no newer than `latest`, newest first —
 *  what the build could pick up by updating. `latest` null = the whole tail
 *  above `mine` (the web reading its own changelog). */
export function entriesBehind(entries: ChangelogEntry[], mine: string, latest?: string | null): ChangelogEntry[] {
  return entries
    .filter((e) => compareVersions(e.version, mine) > 0 && (!latest || compareVersions(e.version, latest) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The number the banner says: "You are N versions behind." Counts entries the
 *  app can actually get — web-only entries are not a reason to reinstall. */
export function versionsBehind(entries: ChangelogEntry[], mine: string, latest: string | null | undefined, opts: { appOnly?: boolean } = {}): number {
  const list = entriesBehind(entries, mine, latest);
  return (opts.appOnly ? list.filter((e) => !e.webOnly) : list).length;
}
