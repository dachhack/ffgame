// Service-role Supabase client (bypasses RLS — see supabase/migrations/0001_init.sql).
// Lazy so modules can be imported (and syntax-checked) without credentials.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, requireSupabase } from './config.js';

let client = null;

export function db() {
  if (!client) {
    requireSupabase();
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      // The worker never uses realtime, but createClient builds a RealtimeClient
      // eagerly, and @supabase/realtime-js throws on Node < 22 unless given a
      // WebSocket transport. Provide `ws` so the worker runs on any Node version.
      realtime: { transport: WebSocket },
    });
  }
  return client;
}
