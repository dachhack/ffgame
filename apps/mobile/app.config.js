// Dynamic Expo config. Everything static lives in app.json; this file receives
// it as `config` and layers the environment on top.
//
// WHY THIS EXISTS: core reads its configuration through `platform().env(key)`,
// which on native resolves to `expo.extra`. `extra` in app.json is static and
// committed, so without this file the only way to point a build at a different
// Supabase project would be to edit and commit a JSON file — which also means
// every branch and every build shares one target.
//
// Values are read at BUILD time (this runs in Node during `expo start` /
// `prebuild` / EAS build), not at runtime. Changing one means rebuilding.
//
// HOW TO SET THEM, in the order the tooling resolves:
//   1. `apps/mobile/.env.local`  — your machine, gitignored. Best for day-to-day.
//   2. shell:  VITE_SUPABASE_URL=… npx expo run:android
//   3. EAS:    the `env` block on a profile in eas.json (per build profile)
//
// Anything left unset falls through to the defaults baked into
// packages/core/src/data/liveConfig.ts — which are the PRODUCTION project and
// are public by design (the anon key grants nothing on its own; every table is
// RLS-guarded). So a build with no env at all is a working production build.
// Set these only to point somewhere else.

// Same names as the web build's Vite vars, deliberately: one key name per
// setting across both hosts, so `platform().env('VITE_SUPABASE_URL')` in core
// means the same thing everywhere and nobody has to maintain a mapping.
const KEYS = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_YAHOO_CLIENT_ID',
  'VITE_MARK_FREE',
];

module.exports = ({ config }) => {
  const extra = { ...config.extra };
  for (const k of KEYS) {
    // Only set keys that are actually present. Writing `undefined` would be
    // harmless, but writing `''` would NOT — core's `env(k) || DEFAULT` treats
    // an empty string as unset, while a stray empty value in `extra` is the
    // kind of thing that reads as "configured" when you inspect the config.
    if (process.env[k]) extra[k] = process.env[k];
  }
  return { ...config, extra };
};
