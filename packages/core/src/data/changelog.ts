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
export const APK_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk';
/** THE SAME APK, ZIPPED (v0.408.0). Founder: "the app downloads from the link
 *  but never finished and says failed despite showing all the data
 *  transferred." A browser that refuses a package archive after the bytes have
 *  already arrived will take an ordinary zip without complaint, so this is the
 *  second door: download, unzip, install. Same signed build, published beside
 *  the APK by release-apk.yml. */
export const APK_ZIP_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/drip-fantasy.apk.zip';
export const APK_MANIFEST_URL = 'https://github.com/dachhack/ffgame/releases/download/apk-latest/manifest.json';
export const APK_RELEASE_PAGE_URL = 'https://github.com/dachhack/ffgame/releases/tag/apk-latest';

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
