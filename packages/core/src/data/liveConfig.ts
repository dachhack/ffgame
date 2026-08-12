// Live-mode configuration flags, SEPARATE from the Supabase client so that
// eager UI (the landing header, the request-a-code modal, LiveOnboard's gate)
// can check "is live mode on?" without pulling ~55KB gz of @supabase/supabase-js
// into the landing chunk. The SDK itself loads lazily via getSupabase()
// (supabaseClient.ts) on first real use.
//
// Defaults so the deployed Pages build has Live mode on with no CI env. These are
// PUBLIC by design — the publishable/anon key grants nothing on its own; every
// table is RLS-guarded (supabase/migrations). Override via .env.local if needed.
// auth.dripfantasy.com is the project's Custom Domain — Supabase routes Auth,
// REST, Realtime, Storage all through it, so this single change moves the whole
// API surface off supabase.co.
import { env } from '../platform';
const DEFAULT_URL = 'https://auth.dripfantasy.com';
const DEFAULT_ANON = 'sb_publishable_bEjQC0i5aZ36WFlBisxhbQ_9MwLo8d2';

// Read through the platform shim so this module loads under Vite, Metro and
// plain Node alike; hosts that set nothing fall through to the defaults above.
//
// FUNCTIONS, not constants, and deliberately so: a `const` here is evaluated
// when this module is first imported, which under ES module hoisting can happen
// before the host installs its platform adapter. That would silently latch the
// defaults and ignore a configured VITE_SUPABASE_URL — a failure that looks
// like "live mode points at the wrong project" and nothing else.
export const supabaseUrl = () => env('VITE_SUPABASE_URL') || DEFAULT_URL;
export const supabaseAnon = () => env('VITE_SUPABASE_ANON_KEY') || DEFAULT_ANON;

export const liveConfigured = () => !!(supabaseUrl() && supabaseAnon());

/** Google's WEB OAuth client id — the audience the native Play Services flow
 *  mints its ID token for, and the one Supabase verifies against its Authorized
 *  Client IDs.
 *
 *  Committed as a default for the same reason the anon key above is: an OAuth
 *  CLIENT id is public by construction — it ships inside every APK and is sent
 *  to Google in the clear on every sign-in. The secret in that pair is the
 *  client SECRET, which is not here and is not needed: the native flow proves
 *  the app's identity with the signing certificate's SHA-1, registered against
 *  the ANDROID client, which nobody can forge without the keystore.
 *
 *  A default rather than env-only because the failure mode of env-only is
 *  silent: a build that forgets to set it doesn't break, it quietly falls back
 *  to opening a browser, and the only symptom is the thing we removed coming
 *  back. */
const DEFAULT_GOOGLE_WEB_CLIENT_ID = '401564304167-pc9ivgpiootdvei6148n9msff5oin2qr.apps.googleusercontent.com';
export const googleWebClientId = () => env('VITE_GOOGLE_WEB_CLIENT_ID') || DEFAULT_GOOGLE_WEB_CLIENT_ID;
