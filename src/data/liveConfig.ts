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
const DEFAULT_URL = 'https://auth.dripfantasy.com';
const DEFAULT_ANON = 'sb_publishable_bEjQC0i5aZ36WFlBisxhbQ_9MwLo8d2';

// Optional-chained so the module also loads outside Vite (e.g. Node test
// harnesses), where `import.meta.env` is undefined.
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env;
export const SUPABASE_URL = ENV?.VITE_SUPABASE_URL || DEFAULT_URL;
export const SUPABASE_ANON = ENV?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON;

export const liveConfigured = !!(SUPABASE_URL && SUPABASE_ANON);
