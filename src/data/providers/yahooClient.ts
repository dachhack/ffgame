// Browser-side Yahoo OAuth glue. The client secret and token exchange live in
// the yahoo-oauth Edge Function; here we only kick off the redirect, cache the
// returned tokens, and auto-refresh the short-lived access token. The long-lived
// refresh_token is kept in localStorage (it grants only read access to the user's
// own Yahoo fantasy data, scoped by the app's permissions).
import { supabase } from '../supabaseClient';

const KEY = 'gc-yahoo-tok';
const AUTH = 'https://api.login.yahoo.com/oauth2/request_auth';
// Public Consumer Key (safe in the browser); the secret stays server-side.
const CLIENT_ID = (import.meta.env.VITE_YAHOO_CLIENT_ID as string | undefined) || '';

export const yahooConfigured = !!CLIENT_ID;
/** Yahoo requires the redirect URI to match the registered app exactly. */
export const yahooRedirectUri = () => `${window.location.origin}/`;

interface Tokens { accessToken: string; refreshToken: string; expiresAt: number }
function load(): Tokens | null { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
function save(t: Tokens | null) { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch { /* ignore */ } }
export const yahooConnected = () => !!load();
export function yahooDisconnect() { save(null); }

async function invoke(body: Record<string, unknown>): Promise<any> {
  if (!supabase) throw new Error('Yahoo import needs the backend, which isn’t configured here.');
  const { data, error } = await supabase.functions.invoke('yahoo-oauth', { body });
  if (error) throw new Error(error.message || 'Yahoo request failed.');
  if (!data?.ok) throw new Error(data?.error || 'Yahoo returned an error.');
  return data;
}

/** Send the user to Yahoo to authorize (state carries our provider marker). */
export function startYahooAuth() {
  const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: yahooRedirectUri(), response_type: 'code', language: 'en-us', state: 'yahoo' });
  window.location.href = `${AUTH}?${p.toString()}`;
}

/** Exchange the ?code from Yahoo's redirect for tokens and cache them. */
export async function yahooExchange(code: string): Promise<void> {
  const d = await invoke({ action: 'exchange', code, redirectUri: yahooRedirectUri() });
  save({ accessToken: d.accessToken, refreshToken: d.refreshToken, expiresAt: Date.now() + (Number(d.expiresIn) || 3600) * 1000 });
}

async function accessToken(): Promise<string> {
  const t = load();
  if (!t) throw new Error('Not connected to Yahoo.');
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken;
  const d = await invoke({ action: 'refresh', refreshToken: t.refreshToken });
  const next: Tokens = { accessToken: d.accessToken, refreshToken: d.refreshToken || t.refreshToken, expiresAt: Date.now() + (Number(d.expiresIn) || 3600) * 1000 };
  save(next);
  return next.accessToken;
}

/** Call the Yahoo Fantasy API for `path`, returning its `fantasy_content`. */
export async function yahooApi(path: string): Promise<any> {
  const d = await invoke({ action: 'get', accessToken: await accessToken(), path });
  return d.data?.fantasy_content ?? d.data;
}
