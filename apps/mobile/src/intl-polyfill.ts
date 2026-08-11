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
//
// Only DateTimeFormat is polyfilled: nothing in core or the app uses
// Intl.NumberFormat or PluralRules, and formatjs's versions of those are ~200KB
// of bundle for an API we never call.
import '@formatjs/intl-getcanonicallocales/polyfill';
import '@formatjs/intl-locale/polyfill';
import '@formatjs/intl-datetimeformat/polyfill';
import '@formatjs/intl-datetimeformat/locale-data/en';
import '@formatjs/intl-datetimeformat/add-golden-tz';

// The polyfilled DateTimeFormat defaults to UTC unless told the device's zone,
// and anything formatted WITHOUT an explicit timeZone then renders as UTC. That
// is not cosmetic here: lock times are shown with the device's zone, so a SUN
// 4PM window read "locks 8:25 PM" instead of 4:25 PM — four hours late, in a
// game where missing the lock costs you the window.
//
// The zone comes from expo-localization rather than
// `Intl.DateTimeFormat().resolvedOptions().timeZone`, which is what shipped
// first and silently returned nothing: asking the freshly-installed polyfill
// what zone it is in only ever answers "the one you haven't set yet".
import * as Localization from 'expo-localization';

try {
  const tz = Localization.getCalendars()[0]?.timeZone;
  // @ts-expect-error — __setDefaultTimeZone is formatjs's own hook, untyped.
  if (tz && typeof Intl.DateTimeFormat.__setDefaultTimeZone === 'function') {
    // @ts-expect-error — see above.
    Intl.DateTimeFormat.__setDefaultTimeZone(tz);
  }
} catch {
  // Falls back to UTC. Window derivation always passes an explicit ET zone, so
  // the game logic is unaffected — only displayed times would be off.
}
