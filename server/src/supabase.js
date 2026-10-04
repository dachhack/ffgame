// Service-role Supabase client (bypasses RLS — see supabase/migrations/0001_init.sql).
// Lazy so modules can be imported (and syntax-checked) without credentials.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config, requireSupabase } from './config.js';

let client = null;

/** Test-only: inject a fake client (see test/resolve-batch.mjs). Never used in prod. */
export function __setClientForTest(c) { client = c; }

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

/** EVERY ROW, PAGE BY PAGE (v0.627.3). PostgREST answers at most 1000 rows
 *  to one select, silently. The MLB directory passed 1000 players and the
 *  ADP match saw the first thousand of them — 310 of 597 matched where the
 *  same code against the whole directory matched 581. `select(from, to)`
 *  returns the query with `.range(from, to)` applied, ordered by a key so no
 *  row falls between pages. Throws on the first error. */
export async function allRows(select, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await select(from, from + page - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}
