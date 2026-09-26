// @expo/fingerprint config — what counts as "the native app" for OTA updates.
//
// runtimeVersion is { policy: 'fingerprint' } (app.json): an update published
// by `eas update` only reaches builds whose native fingerprint matches. The
// expo config is part of that fingerprint, and app.config.js stamps
// android.versionCode from each CI run (ANDROID_VERSION_CODE = 40000 + run
// number) while EAS auto-increments ios.buildNumber — so without this skip
// every build would get a fingerprint no published update ever matched, and
// OTA would silently deliver nothing. Version numbers name a build; they
// don't change what native code it runs.
/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('expo/fingerprint');

module.exports = {
  // extra carries the VITE_* build keys app.config.js layers in; an update
  // ships its own copy of the config, so they are not native either.
  sourceSkips: SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigExtraSection,
};
