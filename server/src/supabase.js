// Service-role Supabase client (bypasses RLS — see supabase/migrations/0001_init.sql).
// Lazy so modules can be imported (and syntax-checked) without credentials.
import { createClient } from '@supabase/supabase-js';
import { config, requireSupabase } from './config.js';

let client = null;

export function db() {
  if (!client) {
    requireSupabase();
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
