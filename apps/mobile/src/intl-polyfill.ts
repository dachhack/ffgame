// Intl polyfill for Hermes.
//
// WHY: core derives a week's game windows from real kickoff times, and it does
// that in Eastern Time — `new Intl.DateTimeFormat('en-US', { timeZone:
// 'America/New_York', … })` in packages/core/src/data/nflSlate.ts. That is
// correct and not negotiable: an NFL slate's TNF / SUN 1PM / SNF / MNF windows
// are defined in ET, and computing them in the device's local zone would put
// games in the wrong window for anyone outside it.
//
// Hermes ships an Intl implementation, but its support for IANA time zones and
// for `formatToParts` is partial and platform-dependent. On a release build an
// exception thrown during render is not a red box — it closes the app. That is
// exactly what happened: sign in, LivePicks renders, `windowForTeam()` derives
// the week inside a useMemo, Intl throws, the process dies with no message.
//
// So the app installs a complete Intl before anything else runs. `add-golden-tz`
// carries the common IANA zones (America/New_York among them) rather than
// `add-all-tz`, which is several hundred KB of zones a football app will never
// ask for.
//
// ORDER IS LOAD-BEARING — each polyfill builds on the previous one, and this is
// the sequence formatjs documents. Do not reorder or tree-shake it.
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-pluralrules/polyfill';
import '@formatjs/intl-pluralrules/locale-data/en';
import '@formatjs/intl-numberformat/polyfill';
import '@formatjs/intl-numberformat/locale-data/en';
import '@formatjs/intl-datetimeformat/polyfill';
import '@formatjs/intl-datetimeformat/locale-data/en';
import '@formatjs/intl-datetimeformat/add-golden-tz';

// The polyfilled DateTimeFormat has no idea what the device's zone is — it
// defaults to UTC unless told. Anything that formats WITHOUT an explicit
// timeZone (a lock time shown in the user's own zone, say) would otherwise
// silently render as UTC.
try {
  // Hermes exposes the device zone here even when its Intl is incomplete.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz) {
    // @ts-expect-error — __setDefaultTimeZone is formatjs's own hook, untyped.
    if (typeof Intl.DateTimeFormat.__setDefaultTimeZone === 'function') {
      // @ts-expect-error — see above.
      Intl.DateTimeFormat.__setDefaultTimeZone(tz);
    }
  }
} catch {
  // Leave it at UTC. Every window derivation passes an explicit ET zone, so the
  // game logic is unaffected either way.
}
