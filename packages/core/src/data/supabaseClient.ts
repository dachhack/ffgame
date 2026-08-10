// Browser Supabase client for the authenticated "Live H2H" pilot mode. Reads the
// project URL + ANON key from liveConfig.ts (Vite env with public defaults).
// The anon key is browser-safe — every table is RLS-guarded (supabase/migrations).
//
// LAZY: the SDK is dynamic-imported on first getSupabase() call, so modules that
// are eager on the landing page (store → liveApi) don't drag @supabase/supabase-js
// into the landing chunk. Callers are all async already; the singleton promise
// makes concurrent first calls share one client.
//
// Gated: if the env isn't set, getSupabase() resolves null and `liveConfigured`
// is false, so the static vs-AI demo and the Pages build keep working with no
// backend.
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnon, liveConfigured } from './liveConfig';

export { liveConfigured };

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = liveConfigured()
      ? import('@supabase/supabase-js').then(({ createClient }) =>
          createClient(supabaseUrl(), supabaseAnon(), { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }))
      : Promise.resolve(null);
  }
  return clientPromise;
}
