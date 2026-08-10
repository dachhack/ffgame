// Supabase client for the authenticated "Live H2H" pilot mode. Reads the
// project URL + ANON key from liveConfig.ts (env with public defaults).
// The anon key is client-safe — every table is RLS-guarded (supabase/migrations).
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
import { platform } from '../platform';

export { liveConfigured };

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** Session storage for the auth SDK, backed by whatever the host persists to.
 *
 *  This has to be passed explicitly. Left unset, supabase-js reaches for
 *  `localStorage` — which exists on web but NOT in React Native, where it
 *  silently degrades to an in-memory store and the user is signed out again
 *  every time the app restarts. Routing it through the platform shim gives web
 *  localStorage and native MMKV with no branch here.
 *
 *  The SDK accepts sync or async returns; ours are sync, wrapped in the
 *  promises its interface expects. */
function authStorage() {
  const p = platform();
  return {
    getItem: async (k: string) => p.storage.get(k),
    setItem: async (k: string, v: string) => { p.storage.set(k, v); },
    removeItem: async (k: string) => { p.storage.remove(k); },
  };
}

export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = liveConfigured()
      ? import('@supabase/supabase-js').then(({ createClient }) =>
          createClient(supabaseUrl(), supabaseAnon(), {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              storage: authStorage(),
              // Web: the magic-link callback lands in the address bar and the
              // SDK reads it. Native: it arrives as a deep link the app routes,
              // so scanning here only produces false positives on cold start.
              detectSessionInUrl: platform().detectSessionInUrl,
            },
          }))
      : Promise.resolve(null);
  }
  return clientPromise;
}
