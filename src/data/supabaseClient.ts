// Browser Supabase client for the authenticated "Live H2H" pilot mode. Reads the
// project URL + ANON key from Vite env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// The anon key is browser-safe — every table is RLS-guarded (supabase/migrations).
//
// Gated: if the env isn't set, `supabase` is null and `liveConfigured` is false,
// so the static vs-AI demo and the Pages build keep working with no backend.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
const URL = ENV?.VITE_SUPABASE_URL || DEFAULT_URL;
const ANON = ENV?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON;

export const liveConfigured = !!(URL && ANON);

export const supabase: SupabaseClient | null = liveConfigured
  ? createClient(URL!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
