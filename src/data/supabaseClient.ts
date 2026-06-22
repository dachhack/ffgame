// Browser Supabase client for the authenticated "Live H2H" pilot mode. Reads the
// project URL + ANON key from Vite env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
// The anon key is browser-safe — every table is RLS-guarded (supabase/migrations).
//
// Gated: if the env isn't set, `supabase` is null and `liveConfigured` is false,
// so the static vs-AI demo and the Pages build keep working with no backend.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const liveConfigured = !!(URL && ANON);

export const supabase: SupabaseClient | null = liveConfigured
  ? createClient(URL!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
