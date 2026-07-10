// Client helper for the generic `fantasy-proxy` Edge Function: GET an
// allowlisted upstream URL (Fleaflicker / MFL) server-side and return its JSON.
// Used by providers that aren't client-side (no CORS) but need no credentials.
import { supabase } from '../supabaseClient';

export async function proxyGetJson(url: string): Promise<any> {
  if (!supabase) throw new Error('League import needs the backend, which isn’t configured here.');
  const { data, error } = await supabase.functions.invoke('fantasy-proxy', { body: { url } });
  if (error) throw new Error(error.message || 'Proxy request failed.');
  const res = data as { ok: boolean; error?: string; data?: unknown };
  if (!res?.ok) throw new Error(res?.error || 'Proxy returned an error.');
  return res.data;
}
