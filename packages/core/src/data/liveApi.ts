// Live-pilot client API: magic-link auth + invite-code redemption, on top of the
// Supabase client. All table access is RLS-guarded; enrollment goes through the
// redeem_invite RPC (migration 0002), never a direct membership write.
import { getSupabase } from './supabaseClient';
import { platform, storeGet } from '../platform';
import { track, Ev, type Props } from '../analytics';
import { readPool, type PoolGroup } from './poolEntry';
import { setLiveInjuries, type InjuryRow } from './injuries';
import { setTeamOverrides } from './playerTeam';
import { resolveUser } from './sleeper';
import { PRESEASON_BOARD_WEEKS } from './nflSlate';
import { assignSealedRows } from '../engine/seatPicks';
import type { Session } from '@supabase/supabase-js';

// ── Analytics at the chokepoint (0186) ───────────────────────────────────────
// The write RPCs both hosts share fire their product event HERE, on the
// server's yes — one seam instead of two UIs, and a failed write never
// counts. UI-context events (screens, tiles, sheets) stay host-side.
const tracked = <T,>(p: Promise<T>, event: string, props?: Props): Promise<T> =>
  p.then((r) => { if ((r as { ok?: boolean } | null)?.ok) track(event, props); return r; });
/** GIF-vs-text for chat_posted: a whole-URL body that renders inline. */
const looksImage = (s: string): boolean =>
  /^https?:\/\/\S+$/.test(s.trim()) && (/(tenor|giphy|imgur)\.com\//i.test(s) || /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(s));

async function client() {
  const sb = await getSupabase();
  if (!sb) throw new Error('Live mode is not configured');
  return sb;
}

/** Turn a raw Supabase / auth / network error into calm, player-facing copy.
 *  Unknown messages fall through lightly cleaned (capitalized, trailing period). */
export function friendlyError(x: unknown): string {
  // A Supabase/PostgREST failure is a PLAIN OBJECT ({message, details, hint,
  // code}), not an Error — so `x instanceof Error` alone threw away the only
  // part of the response that explains anything. That is how a lineup that hit
  // the slot-cap trigger ("lineup is full — 8 slots max") reported itself as
  // "Something went wrong": the server said exactly what was wrong and the
  // client dropped it on the floor.
  const raw = (
    x instanceof Error ? x.message
      : typeof x === 'string' ? x
      : typeof (x as { message?: unknown })?.message === 'string' ? (x as { message: string }).message
      : ''
  ).trim();
  if (!raw) return 'Something went wrong. Please try again.';
  const m = raw.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('fetch failed'))
    return 'Network error — check your connection and try again.';
  if (m.includes('invalid login credentials'))
    return 'That email and password don’t match. Try again, or reset your password.';
  if (m.includes('email not confirmed'))
    return 'Confirm your email first — check your inbox for the link we sent.';
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already'))
    return 'An account with that email already exists — sign in instead.';
  if (m.includes('expired') || (m.includes('token') && m.includes('invalid')) || m.includes('otp_expired'))
    return 'That code has expired or was already used. Request a fresh link.';
  if (m.includes('rate limit') || m.includes('only request this after') || m.includes('too many'))
    return 'Too many attempts — wait a minute, then try again.';
  if (m.includes('password should be at least') || m.includes('password is too short'))
    return 'Password must be at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid format') || m.includes('invalid email'))
    return 'That doesn’t look like a valid email address.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled') || m.includes('signups disabled'))
    return 'Sign-ups are closed right now. Reach out to your commissioner.';
  if (m.includes('not a manager'))
    return 'That Sleeper account isn’t a manager in this league. Double-check your handle — or ask your commissioner to confirm you’re in the Sleeper league.';
  if (m.includes('already linked to another login'))
    return 'That Sleeper account is already linked to a different login. Sign in with that account, or ask your commissioner for help.';
  if (m.includes('invalid code'))
    return 'That code didn’t match a league. Double-check it with your commissioner.';
  return raw.charAt(0).toUpperCase() + raw.slice(1) + (/[.!?]$/.test(raw) ? '' : '.');
}

/** Where the magic-link returns the user — back into Live mode (?live=1). Must be
 *  added to Supabase Auth → URL Configuration → Redirect URLs. Carries a pending
 *  commish/invite code in the URL so it survives the round trip even when the
 *  redirect lands on a different origin (e.g. apex → www), where localStorage
 *  wouldn't carry over. */
function redirectTo(): string {
  let extra = '';
  try {
    const p = platform().url.query();
    const commish = p.get('commish') || storeGet('dripCommishCode');
    // A pending solo pass (0097) rides the same &code= param — App.tsx routes
    // SOLO-prefixed codes back to the dripSoloPass stash on landing.
    const code = p.get('code') || storeGet('dripInviteCode') || storeGet('dripSoloPass');
    if (commish) extra = `&commish=${encodeURIComponent(commish)}`;
    else if (code) extra = `&code=${encodeURIComponent(code)}`;
  } catch { /* ignore */ }
  return `${platform().url.redirectBase()}?live=1${extra}`;
}

/** True when the current URL is a Supabase auth callback — an OAuth / magic-link /
 *  recovery return carrying session tokens (or an auth error) in the hash. The SDK
 *  loads lazily and reads the URL only when created (detectSessionInUrl), so boot
 *  code must NOT rewrite the URL while this is true or the tokens are destroyed
 *  and the user bounces back to the sign-in form. */
export function hasAuthTokensInUrl(): boolean {
  try {
    if (/[#&](access_token|refresh_token|error_description|error_code|error)=/.test(platform().url.hash())) return true;
    // A FAILED return arrives in the QUERY, not the hash (see authUrlError).
    // This guard is what every boot path asks before touching the URL — including
    // the store's route normaliser — so missing the query half meant a failed
    // sign-in got its URL rewritten out from under it before anything could read
    // the reason.
    const q = platform().url.query();
    return q.has('error_code') || q.has('error_description') || q.has('error');
  } catch { return false; }
}

/** A FAILED auth return, e.g.
 *  `?error=invalid_request&error_code=bad_oauth_state&error_description=…`.
 *
 *  Supabase splits these two ways: a SUCCESS comes back in the hash (implicit
 *  flow — `#access_token=…`), but a failure from its own callback comes back in
 *  the QUERY. hasAuthTokensInUrl above reads the hash only, so a failed sign-in
 *  was invisible to boot code: the user landed on the marketing page, signed
 *  out, with the raw error still in the address bar and nothing explaining it.
 *  Most people just try again — which usually works, since the retry starts a
 *  fresh state — but "it silently did nothing" is the worst thing a sign-in
 *  button can do. Read both, so neither half is missed. */
export interface AuthUrlError { code: string; description: string }
export function authUrlError(): AuthUrlError | null {
  try {
    const q = platform().url.query();
    // The hash arrives as "#a=1&b=2"; parse it with the same reader.
    const h = new URLSearchParams(platform().url.hash().replace(/^#/, ''));
    const code = q.get('error_code') || h.get('error_code') || q.get('error') || h.get('error');
    if (!code) return null;
    const description = q.get('error_description') || h.get('error_description') || '';
    return { code, description: description.replace(/\+/g, ' ') };
  } catch { return null; }
}

// Captured at boot BEFORE the URL is cleaned, so the sign-in screen can still
// explain what happened after the params are gone. Lives for this page load
// only — a reload starts clean.
let pendingAuthError: AuthUrlError | null = null;
/** Stash the current URL's auth failure (if any). Returns what it captured. */
export function captureAuthUrlError(): AuthUrlError | null {
  const e = authUrlError();
  if (e) pendingAuthError = e;
  return e;
}
/** The captured failure. NON-destructive on purpose: a read-once version looks
 *  right until React StrictMode double-mounts the sign-in screen in dev, the
 *  first mount swallows the message and the surviving one renders nothing. The
 *  retry clears it instead (clearAuthUrlError), which is also when it stops
 *  being true. */
export function pendingAuthUrlError(): AuthUrlError | null { return pendingAuthError; }
/** Drop the stashed failure — called when a fresh sign-in attempt starts, so a
 *  stale message can't outlive the attempt it describes. */
export function clearAuthUrlError(): void { pendingAuthError = null; }

/** Human-readable cause for a failed auth return. `bad_oauth_state` is the
 *  common one and almost never means anything is broken: the sign-in was
 *  finished in a different browser than it was started in (an in-app browser or
 *  the installed app handing off to the system browser), or a stale callback URL
 *  was opened a second time. */
export function authErrorMessage(e: AuthUrlError): string {
  if (/bad_oauth_state|flow_state_not_found|flow_state_expired/i.test(e.code)) {
    return 'Sign-in didn’t complete — the link was opened in a different browser, or it had already been used. Please try again.';
  }
  if (/access_denied/i.test(e.code)) return 'Sign-in was cancelled.';
  if (/expired/i.test(e.code)) return 'That sign-in link has expired. Please request a new one.';
  return e.description || 'Sign-in didn’t complete. Please try again.';
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await (await client()).auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

/** Sign in with the 6-digit code from the email (magic-link fallback for mobile). */
export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await (await client()).auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  if (error) throw error;
}

/** Third-party OAuth (Google / Apple). Redirects the page to the provider and
 *  back to ?live=1. Each provider must be enabled in Supabase → Auth → Providers. */
export async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  const { error } = await (await client()).auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

/** OAuth step 1 for hosts with no page to navigate (native).
 *
 *  `signInWithProvider` above works by redirecting the browser; an app has to
 *  open the provider in an in-app browser and handle the return itself, so it
 *  needs the URL rather than a navigation. `skipBrowserRedirect` is what hands
 *  it back.
 *
 *  The provider still sees SUPABASE's callback URL, not ours — Supabase then
 *  redirects on to `redirectTo()`. So enabling this needs no new client in the
 *  Google console; it needs the app's deep link added to Supabase → Auth → URL
 *  Configuration → Redirect URLs. */
export async function oauthAuthorizeUrl(provider: 'google' | 'apple'): Promise<string> {
  const { data, error } = await (await client()).auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('The provider didn’t return a sign-in URL.');
  return data.url;
}

/** OAuth step 2: turn the callback URL into a session.
 *
 *  Handles BOTH shapes on purpose rather than pinning a flow. PKCE comes back
 *  as `?code=…` and is exchanged; the implicit flow comes back with the tokens
 *  in the fragment and is set directly. Which one arrives depends on the
 *  client's `flowType`, and hard-coding either here would break the moment that
 *  default changes under us.
 *
 *  Parsed with regex, not `new URL()`: React Native's URL polyfill is partial
 *  and unreliable on custom schemes like `dripfantasy://`, which is exactly
 *  what this receives. */
export async function completeOAuthCallback(callbackUrl: string): Promise<void> {
  const grab = (re: RegExp): string | null => {
    const m = re.exec(callbackUrl);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  };

  // The provider can decline before any token exists — surface its reason
  // rather than a generic "no session".
  const errDesc = grab(/[?#&]error_description=([^&]+)/);
  const errCode = grab(/[?#&]error(?:_code)?=([^&]+)/);
  if (errDesc || errCode) throw new Error(errDesc || errCode || 'Sign-in was declined.');

  const sb = await client();

  const code = grab(/[?&]code=([^&#]+)/);
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const access_token = grab(/[#&]access_token=([^&]+)/);
  const refresh_token = grab(/[#&]refresh_token=([^&]+)/);
  if (access_token && refresh_token) {
    const { error } = await sb.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  throw new Error('Sign-in didn’t return a session. Please try again.');
}

// ── Password auth ───────────────────────────────────────────────────────────────
/** Sign in from a Google ID TOKEN the native SDK already obtained.
 *
 *  The browser round trip above exists because the web has no other way to talk
 *  to Google. A phone does: the Play Services account picker hands back a signed
 *  ID token directly, and this trades it for a Supabase session — so the flash
 *  of a Custom Tab opening and closing never happens.
 *
 *  Supabase verifies the token's `aud` against the client IDs listed under
 *  Authentication → Providers → Google → Authorized Client IDs. An ID token from
 *  a client that isn't listed is rejected, which is the whole security model
 *  here: the caller can't mint one. */
export async function signInWithGoogleIdToken(idToken: string, nonce?: string): Promise<void> {
  const { error } = await (await client()).auth.signInWithIdToken({ provider: 'google', token: idToken, nonce });
  if (error) throw error;
}

export async function signInPassword(email: string, password: string): Promise<void> {
  const { error } = await (await client()).auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
/** Create an account. needsConfirm=true when the project requires email confirmation. */
export async function signUpPassword(email: string, password: string): Promise<{ needsConfirm: boolean }> {
  const { data, error } = await (await client()).auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
  return { needsConfirm: !data.session };
}
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await (await client()).auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
  if (error) throw error;
}
export async function updatePassword(password: string): Promise<void> {
  const { error } = await (await client()).auth.updateUser({ password });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await (await client()).auth.getSession();
  return data.session;
}

export function onAuth(cb: (s: Session | null, event?: string) => void): () => void {
  // The SDK loads lazily, so subscribe once it lands; if the caller already
  // unsubscribed by then, drop the subscription immediately.
  let unsub: (() => void) | null = null;
  let dead = false;
  getSupabase().then((sb) => {
    if (!sb || dead) return;
    const { data } = sb.auth.onAuthStateChange((event, session) => cb(session, event));
    unsub = () => data.subscription.unsubscribe();
    if (dead) unsub();
  }).catch(() => {});
  return () => { dead = true; unsub?.(); };
}

export async function signOut(): Promise<void> {
  await (await client()).auth.signOut();
}

/** Ensure the caller's app_user row exists (FK target for enrollment). */
export async function ensureAppUser(session: Session): Promise<void> {
  await (await client()).from('app_user').upsert(
    { id: session.user.id, email: session.user.email ?? null },
    { onConflict: 'id', ignoreDuplicates: false },
  );
}

/** The signed-in user's previously-linked Sleeper account, if any (set on a prior
 *  join or commish-verify). Lets a returning player skip re-typing their username.
 *  RLS (`app_user_self`) restricts this to the caller's own row. */
export async function myLinkedSleeper(userId: string): Promise<{ userId: string; username: string } | null> {
  const { data } = await (await client()).from('app_user')
    .select('sleeper_user_id, sleeper_username').eq('id', userId).maybeSingle();
  return data?.sleeper_user_id
    ? { userId: data.sleeper_user_id as string, username: (data.sleeper_username as string | null) ?? '' }
    : null;
}

export interface LeaguePreview { league_id: string; name: string; season: string; provider?: string; }

/** Preview a league by invite code (so we can show "You're joining <name>"). */
export async function previewLeague(code: string): Promise<LeaguePreview | null> {
  const { data, error } = await (await client()).rpc('league_by_invite', { code: code.trim() });
  if (error) throw error;
  return (data && data[0]) || null;
}

export interface RedeemResult { ok: boolean; error?: string; league_id?: string; roster_id?: number; team?: string; }

export interface PreviewRedeem { ok: boolean; error?: string; league?: string; team?: string; avatar?: string | null; }

/** ★ favorites (0139): plain RLS table ops — the row is the feature. Never
 *  throws; a failed read renders an unlit star, not an error. */
export async function myFavorites(): Promise<Set<string>> {
  try {
    const { data } = await (await client()).from('favorite_player').select('player_slug');
    return new Set(((data ?? []) as { player_slug: string }[]).map((r) => r.player_slug));
  } catch { return new Set(); }
}
export async function setFavorite(userId: string, slug: string, on: boolean): Promise<void> {
  const c = await client();
  if (on) await c.from('favorite_player').upsert({ app_user_id: userId, player_slug: slug }, { onConflict: 'app_user_id,player_slug' });
  else await c.from('favorite_player').delete().eq('app_user_id', userId).eq('player_slug', slug);
  track(Ev.playerStarred, { on, kind: 'favorite' });
}

/** Ask the worker to re-pull this league's member list from Sleeper (0133).
 *  For the claim flow's "your Sleeper account is not a manager in this league"
 *  bounce — which, when the claimant JUST joined on Sleeper, means our copy of
 *  the members is behind, not that they're wrong. The poke stamps the league;
 *  the worker's next tick (~25s) syncs; the caller should retry the preview
 *  until the seat appears. Rate-limited server-side, so retry loops are cheap. */
export const requestMemberSync = (code: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string }>('request_member_sync', { p_code: code.trim() });

/** (league, week) pairs under an admin lock hold (0136) — while a pair is
 *  listed, that league's board must NOT derive locked/live window states from
 *  the wall clock; the week is open for edits until the admin relocks it.
 *  Keyed "leagueId:week" for cheap membership tests. Never throws: no hold
 *  information degrades to normal kickoff-driven locks. */
export async function lockHolds(): Promise<Set<string>> {
  try {
    const { data, error } = await (await client()).rpc('lock_holds');
    if (error) return new Set();
    const rows = (data ?? []) as { league_id: string; week: number }[];
    return new Set(rows.map((r) => `${r.league_id}:${r.week}`));
  } catch { return new Set(); }
}

/** Super-admin week lock switch (0136). locked=false reopens the week (hold +
 *  matchups back to scheduled with far-future lock_at + picks unsealed);
 *  locked=true releases the hold and NULLs lock_at so the worker restores the
 *  natural lock time — immediate when past due, on schedule when not. */
export const adminSetWeekLock = (leagueId: string, week: number, locked: boolean) =>
  rpc<{ ok: boolean; error?: string; locked?: boolean; matchups?: number; picks?: number }>(
    'admin_set_week_lock', { p_league_id: leagueId, p_week: week, p_locked: locked });

/** Which team a code + Sleeper username would join — without enrolling. */
export async function redeemPreview(code: string, sleeperUsername: string): Promise<PreviewRedeem> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await (await client()).rpc('redeem_preview', { p_code: code.trim(), p_sleeper_user_id: user.userId });
  if (error) return { ok: false, error: error.message };
  return data as PreviewRedeem;
}

/** Redeem: resolve the Sleeper username, then link + enroll via the RPC. */
export async function redeemInvite(code: string, sleeperUsername: string): Promise<RedeemResult> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await (await client()).rpc('redeem_invite', {
    code: code.trim(), p_sleeper_user_id: user.userId, p_sleeper_username: user.username,
  });
  if (error) return { ok: false, error: error.message };
  return data as RedeemResult;
}

// ── Public pods (migration 0089) ────────────────────────────────────────────────
export interface PodJoin { ok: boolean; error?: string; already?: boolean; league_id?: string; league?: string; roster_id?: number; team?: string; }

/** Join (or found) a public drop-in pod — no invite code, no Sleeper league.
 *  Idempotent: already seated this season → returns that seat with already:true. */
export async function joinPod(teamName?: string): Promise<PodJoin> {
  const { data, error } = await (await client()).rpc('join_pod', { p_team_name: teamName?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as PodJoin;
}

/** Join (or found) this week's one-shot showdown (0090). The server derives the
 *  target NFL week from the slate; `week` comes back in the result. Idempotent
 *  per week — a new contest every week, the old one is tossed by the worker. */
export async function joinWeekly(teamName?: string): Promise<PodJoin & { week?: number }> {
  const { data, error } = await (await client()).rpc('join_weekly', { p_team_name: teamName?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as PodJoin & { week?: number };
}

// ── Feature gates + commissioner DFS leagues (migration 0094) ───────────────
/** The caller's per-account feature flags ({} when none). Known keys:
 *  solo (standalone pods/showdowns) · dfs_commish (may create DFS leagues). */
export async function myFeatures(): Promise<Record<string, boolean>> {
  const { data } = await (await client()).rpc('my_features');
  return (data as Record<string, boolean>) ?? {};
}

/** Owner-only: flip a feature flag for an account by email. */
export async function adminSetFeature(email: string, feature: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await (await client()).rpc('admin_set_feature', { p_email: email.trim(), p_feature: feature, p_on: on });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}

/** Approved commissioners: found a private DFS league; returns its invite code. */
export async function createDfsLeague(name: string, teams: number, teamName?: string): Promise<PodJoin & { invite_code?: string }> {
  const { data, error } = await (await client()).rpc('create_dfs_league', { p_name: name.trim(), p_teams: teams, p_team_name: teamName?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as PodJoin & { invite_code?: string };
}

/** Join a commissioner's DFS league by invite code (the invite IS the access). */
export async function joinDfs(code: string, teamName?: string): Promise<PodJoin> {
  const { data, error } = await (await client()).rpc('join_dfs', { p_code: code.trim(), p_team_name: teamName?.trim() || null });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as PodJoin;
}

// ── DFS-style team building (migration 0092) ────────────────────────────────
export const POD_SALARY_CAP = 50000;
export interface PodSalaryRow { slug: string; name: string; pos: string; team: string; salary: number; proj: number; }

/** The week's frozen salary board (public game data — priced weekly projections). */
export async function podSalaries(week: number, season = '2026'): Promise<PodSalaryRow[]> {
  const { data } = await (await client()).from('pod_salary')
    .select('slug, name, pos, team, salary, proj')
    .eq('season', season).eq('week', week)
    .order('salary', { ascending: false });
  return (data ?? []) as PodSalaryRow[];
}

/** Load the live NFL injury report into core's cache for `week`.
 *
 *  The worker keeps `injury_status` current from ESPN; this is the read side.
 *  The table is plain public NFL info with an authenticated-read policy from
 *  0001, so it needs no RPC — a direct select is the whole story.
 *
 *  Never throws. A missing report has to degrade to "no badges", exactly as it
 *  behaved before, rather than taking down the league open that called it.
 *  Returns how many designations landed (0 on failure) for the caller to log. */
/** Load the worker-published player→team drift (0142) into the playerTeam
 *  module cache. Small by construction (only players whose team differs from
 *  the bake). Returns rows loaded; never throws — a failed load just leaves
 *  the baked answers standing. */
export async function loadTeamOverrides(): Promise<number> {
  try {
    const { data, error } = await (await client()).from('player_team_override').select('slug, team');
    if (error) return 0;
    const rows = (data ?? []) as { slug: string; team: string | null }[];
    setTeamOverrides(rows);
    return rows.length;
  } catch { return 0; }
}

export async function loadLiveInjuries(week: number): Promise<number> {
  try {
    const { data, error } = await (await client()).from('injury_status')
      .select('player_slug, status, return_date, comment, team, updated_at');
    if (error) return 0;
    const rows: Record<string, InjuryRow> = {};
    for (const r of (data ?? []) as InjuryStatusRow[]) {
      // Trust the worker's normalizer, but never let an unexpected status
      // through — a stray value would render as a mystery badge on a card.
      if (r.status !== 'O' && r.status !== 'D' && r.status !== 'Q' && r.status !== 'IR') continue;
      rows[r.player_slug] = {
        status: r.status,
        returnDate: r.return_date, comment: r.comment,
        team: r.team, updatedAt: r.updated_at,
      };
    }
    setLiveInjuries(week, rows);
    return Object.keys(rows).length;
  } catch { return 0; }
}

interface InjuryStatusRow {
  player_slug: string; status: string;
  return_date: string | null; comment: string | null;
  team: string | null; updated_at: string | null;
}

/** Per-team entry-lock times for a week (0093 late swap): each game locks its
 *  players one hour before kickoff. Map team → lock epoch-ms (absent = never). */
export async function weekGameLocks(week: number, season = '2026'): Promise<Map<string, number>> {
  const { data } = await (await client()).from('nfl_slate')
    .select('home, away, kickoff').eq('season', season).eq('week', week);
  const m = new Map<string, number>();
  for (const g of (data ?? []) as { home: string; away: string; kickoff: string | null }[]) {
    if (!g.kickoff) continue;
    const lock = Date.parse(g.kickoff) - 3_600_000;
    m.set(g.home, lock); m.set(g.away, lock);
  }
  return m;
}

/** Save the caller's pod/showdown entry (9 slugs). Server validates membership,
 *  week, per-game locks (0093), roster shape (QB·2RB·3WR·TE·K·DST), and the $50k cap. */
export async function savePodEntry(leagueId: string, week: number, picks: string[]): Promise<{ ok: boolean; error?: string; spent?: number; cap?: number }> {
  const { data, error } = await (await client()).rpc('save_pod_entry', { p_league: leagueId, p_week: week, p_picks: picks });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string; spent?: number; cap?: number };
}

// ── "Request a code" lead capture (migration 0016) ───────────────────────────────
/** Pre-auth request to have a pilot code set up for the visitor's league. Routes
 *  through a SECURITY DEFINER RPC granted to anon, so it works before sign-in. */
export async function requestCode(input: { email?: string; sleeper?: string; league?: string; leagueRef?: string; note?: string; attribution?: Record<string, unknown> }): Promise<{ ok: boolean; error?: string }> {
  const sb = await getSupabase();
  if (!sb) return { ok: false, error: 'Live mode is not configured.' };
  const base = {
    p_email: input.email ?? null, p_sleeper: input.sleeper ?? null, p_league: input.league ?? null,
    p_league_ref: input.leagueRef ?? null, p_note: input.note ?? null,
  };
  const attr = input.attribution && Object.keys(input.attribution).length ? input.attribution : null;
  let { data, error } = await (await client()).rpc('request_code', attr ? { ...base, p_attribution: attr } : base);
  // A fresh bundle can briefly race the 0088 migration (Pages deploy vs the
  // migrate Action) — never lose a lead to that window: retry without the arg.
  if (error && attr) ({ data, error } = await (await client()).rpc('request_code', base));
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}

export interface Enrollment {
  league_id: string; team_name: string; sleeper_roster_id: number; avatar_url: string | null;
  /** The app_user_id sealed picks must be written AS — the seat OWNER's id.
   *  Your own on seats you own; the owner's on seats you co-manage (0125).
   *  Absent only on rows from builds older than the my_teams switch. */
  pick_user_id?: string;
  /** You steer this team but the seat isn't yours. */
  comanager?: boolean;
  league: { name: string; season: string; preseason_at?: string | null; provider?: string; avatar_url?: string | null; is_mock?: boolean; kind?: string; contest_week?: number | null; dynasty?: boolean; continuity?: LeagueContinuity } | null;
}

/** Every seat the caller can act for — owned AND co-managed (0125's my_teams).
 *  Was a direct league_membership select, which by construction could never
 *  show a co-managed seat: RLS scopes that table to your own rows, and a
 *  co-manager's whole point is acting on somebody else's. The userId param
 *  survives for signature compatibility; the server answers for auth.uid(). */
export async function myEnrollments(_userId: string): Promise<Enrollment[]> {
  const r = await rpc<Enrollment[] | { error?: string }>('my_teams');
  if (!Array.isArray(r)) throw new Error((r as { error?: string })?.error ?? 'could not load teams');
  return r;
}
/** my_teams() for an arbitrary user — the browse-as twin (0149). my_teams
 *  keys on auth.uid(), so a browse-as session calling it gets the ADMIN's
 *  teams; this reads the VIEWED user's, admin-gated server-side. */
export async function adminUserTeams(appUserId: string): Promise<Enrollment[]> {
  const r = await rpc<Enrollment[] | { error?: string }>('admin_user_teams', { p_app_user_id: appUserId });
  if (!Array.isArray(r)) throw new Error((r as { error?: string })?.error ?? 'could not load teams');
  return r;
}

// ── Commissioner verification (migration 0003) ──────────────────────────────────
export interface StartCommish { ok: boolean; error?: string; tag?: string; league?: string; }
export interface ConfirmCommish { ok: boolean; error?: string; invite_code?: string; league?: string; }

/** Step 1: validate the commissioner code, confirm Sleeper ownership, get a team-name tag. */
export async function startCommishVerify(commishCode: string, sleeperUsername: string): Promise<StartCommish> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await (await client()).rpc('start_commish_verify', {
    p_code: commishCode.trim(), p_sleeper_user_id: user.userId, p_sleeper_username: user.username,
  });
  if (error) return { ok: false, error: error.message };
  return data as StartCommish;
}

/** Step 2: confirm the tag is now in the Sleeper team name → become commissioner + get the invite code. */
export async function confirmCommishVerify(commishCode: string): Promise<ConfirmCommish> {
  const { data, error } = await (await client()).rpc('confirm_commish_verify', { p_code: commishCode.trim() });
  if (error) return { ok: false, error: error.message };
  return data as ConfirmCommish;
}

/** Admin-assigned commissioner: redeem the commish code the admin sent you → become
 *  this league's commissioner (platform-agnostic, no Sleeper team-tagging). */
export async function redeemCommish(commishCode: string): Promise<ConfirmCommish & { league_id?: string }> {
  const { data, error } = await (await client()).rpc('redeem_commish', { p_code: commishCode.trim() });
  if (error) return { ok: false, error: error.message };
  return data as ConfirmCommish & { league_id?: string };
}

// ── Sealed picks (live-H2H lineup) ──────────────────────────────────────────────
export interface LiveMatchup { id: string; league_id: string; week: number; status: string; lock_at: string | null; home_roster_id: number; away_roster_id: number; home_coin: number | null; away_coin: number | null; }
/** `grp` is which part of the manager's roster the player sits on — the pool is
 *  their WHOLE roster (starters, bench, IR, taxi), not just who Sleeper has
 *  starting. Untagged rows read as 'start'; see entryGroup in poolEntry.ts. */
export interface PoolPlayer { slug: string; full: string; pos: string; team: string; grp: PoolGroup; }
export interface PickRow { game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; locked?: boolean; }

/** The caller's enrolled roster — when that is UNAMBIGUOUS.
 *
 *  This used to be `limit(1)` with no ORDER BY: an arbitrary enrolled
 *  membership, different between calls at the database's whim. Every live
 *  screen passes leagueId/rosterId explicitly now, so this is the fallback for
 *  a board opened with neither — and a fallback that GUESSES between leagues
 *  quietly opens a board that is correct about a league you did not mean,
 *  which reads as wrong data rather than wrong league (HANDOFF #3, v0.231.0's
 *  league-name chip was the visibility half of this fix).
 *
 *  One enrollment → that league. More than one → null, the same answer as
 *  none: the caller renders its no-board state and the user opens the league
 *  they meant. Refusing is the point — an ORDER BY would be stable and still
 *  a guess. */
export async function myRoster(userId: string): Promise<{ leagueId: string; rosterId: number } | null> {
  const { data } = await (await client()).from('league_membership')
    .select('league_id, sleeper_roster_id').eq('app_user_id', userId).eq('enrolled', true).limit(2);
  return data?.length === 1 ? { leagueId: data[0].league_id, rosterId: data[0].sleeper_roster_id } : null;
}

/** The caller's next/earliest matchup in a league. */
export async function myMatchup(leagueId: string, rosterId: number, week?: number): Promise<LiveMatchup | null> {
  let q = (await client()).from('matchup').select('*')
    .eq('league_id', leagueId).or(`home_roster_id.eq.${rosterId},away_roster_id.eq.${rosterId}`);
  if (week != null) q = q.eq('week', week);
  const { data } = await q.order('week').limit(1).maybeSingle();
  return (data as LiveMatchup) ?? null;
}

/** The week a league's board should open to: the current NFL week (its games in
 *  progress), or — when none is live — the next upcoming week, across the league's
 *  whole matchup timeline. Preseason (offset) weeks sort ahead of the regular
 *  season by real kickoff, so a preseason league opens on its next preseason game
 *  and rolls into Week 1 once preseason is done. Falls back to the first week. */
/** Every week this league actually has matchups for, in PLAY ORDER —
 *  preseason (0110's 101+) first, then the regular season and playoffs.
 *
 *  The week steppers used to count 1..REG_SEASON_WEEKS, which cannot reach a
 *  preseason week at all: those are numbered from PRESEASON_BASE, so a league
 *  playing PRE 1–4 had four boards its own manager could not open (founder,
 *  on Turf Warriors). Reading the matchup table is the same source
 *  defaultOpenWeek trusts, and it answers for whatever the league scheduled
 *  rather than for what the calendar usually looks like. */
export async function leagueWeeks(leagueId: string): Promise<number[]> {
  const { data } = await (await client()).from('matchup').select('week').eq('league_id', leagueId);
  const weeks = [...new Set(((data ?? []) as { week: number }[]).map((r) => r.week))];
  // Preseason sorts BEFORE week 1 — it is played first, however it is numbered.
  const key = (w: number) => (w > 100 ? w - 200 : w);
  return weeks.sort((a, b) => key(a) - key(b));
}

export async function defaultOpenWeek(leagueId: string, season: string, preseasonEnabled: boolean): Promise<number> {
  const [msRes, slRes] = await Promise.all([
    (await client()).from('matchup').select('week').eq('league_id', leagueId),
    (await client()).from('nfl_slate').select('week, kickoff').eq('season', season),
  ]);
  const weeks = [...new Set(((msRes.data ?? []) as { week: number }[]).map((r) => r.week))];
  if (!weeks.length) return preseasonEnabled ? 101 : 1;
  const kicks: Record<number, { first: number; last: number }> = {};
  for (const r of (slRes.data ?? []) as { week: number; kickoff: string | null }[]) {
    if (!r.kickoff) continue;
    const t = Date.parse(r.kickoff);
    const e = kicks[r.week] ?? (kicks[r.week] = { first: t, last: t });
    e.first = Math.min(e.first, t); e.last = Math.max(e.last, t);
  }
  // Ordered by real kickoff (weeks with no known slate sort last). Open the first
  // week that isn't fully over — i.e. live now or the soonest upcoming.
  const ordered = weeks.slice().sort((a, b) => (kicks[a]?.first ?? Infinity) - (kicks[b]?.first ?? Infinity) || a - b);
  const now = Date.now();
  const GAME_MS = 4 * 3_600_000;
  for (const w of ordered) { const k = kicks[w]; if (!k || now <= k.last + GAME_MS) return w; }
  return ordered[ordered.length - 1];
}

export interface MatchupResult { id: string; week: number; home_roster_id: number; away_roster_id: number; home_final: number | null; away_final: number | null; status: string; }
/** Every matchup in a league (all weeks) with its final totals — the scoreboard/
 *  results feed. Readable by any league member (finals live on the matchup row). */
export async function leagueResults(leagueId: string): Promise<MatchupResult[]> {
  const { data } = await (await client()).from('matchup')
    .select('id, week, home_roster_id, away_roster_id, home_final, away_final, status')
    .eq('league_id', leagueId).order('week');
  return (data ?? []) as MatchupResult[];
}

/** The caller's player pool for a week (their Sleeper roster, from sleeper_lineup). */
export async function myPool(leagueId: string, week: number, rosterId: number): Promise<PoolPlayer[]> {
  const { data, error } = await (await client()).from('sleeper_lineup').select('starters_json')
    .eq('league_id', leagueId).eq('week', week).eq('roster_id', rosterId).maybeSingle();
  // SURFACE the error. This used to destructure `data` alone, which made an RLS
  // denial, a dropped connection and a genuinely empty roster all arrive as the
  // same empty array — so a broken read looked exactly like a manager with
  // nobody rostered, and every explanation for one was equally consistent with
  // the other. Two wrong diagnoses came out of that ambiguity. A read that
  // failed should say it failed.
  if (error) throw new Error(`roster read failed (league ${leagueId.slice(0, 8)}… wk ${week} roster ${rosterId}): ${error.message}`);
  // Read through the shared reader, NOT `p.slug`. That column is written in two
  // shapes and a Sleeper-synced league uses `player_slug` — reading only `slug`
  // dropped every entry and reported the roster as empty. See poolEntry.ts.
  return readPool(data?.starters_json);
}

/** The caller's saved picks for a matchup (locked = that window has sealed). */
export async function myPicks(matchupId: string, userId: string): Promise<PickRow[]> {
  const { data } = await (await client()).from('sealed_pick')
    .select('game_window, roster_slot, player_slug, metric_id, locked')
    .eq('matchup_id', matchupId).eq('app_user_id', userId);
  return (data ?? []) as PickRow[];
}

/** Upsert the caller's sealed picks. RLS + the window-lock trigger (migration
 *  0058) only accept rows in windows that haven't kicked off — callers must
 *  pre-filter locked windows out or the whole upsert fails. `locked` is stripped:
 *  only the server sets it (the RLS WITH CHECK rejects it from clients anyway). */
export async function savePicks(matchupId: string, userId: string, rows: PickRow[]): Promise<void> {
  const payload = rows.map(({ locked: _locked, ...r }) => ({ matchup_id: matchupId, app_user_id: userId, ...r }));
  const { error } = await (await client()).from('sealed_pick').upsert(payload, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' });
  if (error) throw error;
}

// ── Live board (Realtime) ───────────────────────────────────────────────────────
/** One slot's engine score inside a window (matchup_state.slot_scores, migration
 *  0020) — the worker only publishes rows for windows that have kicked off, so
 *  sealed picks never appear here. */
export interface SlotScoreRow { side: 'home' | 'away'; slot: string; slug: string | null; metric: string | null; score: number; hot?: boolean; nuked?: boolean; }
export interface WindowScore { game_window: string; home_score: number; away_score: number; slot_scores?: SlotScoreRow[]; }
export interface RevealedPick { app_user_id: string; game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; locked: boolean; }

/** Re-read a matchup's row (status / lock_at / finals may have changed). */
export async function getMatchup(matchupId: string): Promise<LiveMatchup | null> {
  const { data } = await (await client()).from('matchup').select('*').eq('id', matchupId).maybeSingle();
  return (data as LiveMatchup) ?? null;
}

/** Per-window engine scores for a matchup (written by the worker's resolver),
 *  including per-slot detail for the card-table board. */
export async function getMatchupState(matchupId: string): Promise<WindowScore[]> {
  const { data } = await (await client()).from('matchup_state').select('game_window, home_score, away_score, slot_scores').eq('matchup_id', matchupId);
  return (data ?? []) as WindowScore[];
}

/** The live NFL slate for a week (worker-written from ESPN, migration 0029) —
 *  drives slate-gating + the K/DST bye check for the real current season. Empty
 *  until the worker has synced that week (then the client falls back to baked). */
export interface SlateGame { away: string; home: string; win: string; kickoff?: string | null }
export async function liveSlate(week: number, season?: string): Promise<SlateGame[]> {
  let q = (await client()).from('nfl_slate').select('season, away, home, win, kickoff').eq('week', week);
  if (season) q = q.eq('season', season); // 2025 (demo) + 2026 rows share week #s — scope by season
  const { data } = await q;
  const rows = (data ?? []) as (SlateGame & { season?: string })[];
  // Unscoped: keep only the newest season carrying this week, so a stale prior
  // season's (past) kickoffs can never drive window-lock gating (window_kickoff()
  // in migration 0058 scopes the same way).
  if (!season && rows.length) {
    const top = rows.map((r) => r.season ?? '').sort().pop();
    return rows.filter((r) => (r.season ?? '') === top);
  }
  return rows;
}

/** Both teams' display identity (name + avatar) for a matchup — league members can
 *  read all memberships (RLS), so this drives the live board's team headers. */
export interface TeamInfo { roster_id: number; team_name: string | null; avatar: string | null }
export async function matchupTeams(leagueId: string, rosterIds: number[]): Promise<Record<number, TeamInfo>> {
  const { data } = await (await client()).from('league_membership')
    .select('sleeper_roster_id, team_name, avatar_url').eq('league_id', leagueId).in('sleeper_roster_id', rosterIds);
  const out: Record<number, TeamInfo> = {};
  for (const m of (data ?? []) as { sleeper_roster_id: number; team_name: string | null; avatar_url: string | null }[]) {
    out[m.sleeper_roster_id] = { roster_id: m.sleeper_roster_id, team_name: m.team_name, avatar: m.avatar_url };
  }
  return out;
}

/** Sealed picks visible under RLS: always yours; the opponent's only once locked.
 *
 *  Passed through the SAME seat-assignment rule the worker's resolver runs
 *  (assignSealedRows): rows outlive a seat reassignment — they key on the
 *  saving account with no roster column — so a reassigned seat's lineup is
 *  ADOPTED by the seat that plainly owns it (and rendered under its current
 *  occupant's id, so the boards place it on the right side), while ambiguous
 *  orphans are dropped rather than rendered as if they will score. What
 *  members watch is what the worker fields. If the matchup/membership read
 *  fails (offline blip), return unfiltered rather than blank the board. */
export async function getRevealedPicks(matchupId: string): Promise<RevealedPick[]> {
  const c = await client();
  const { data } = await c.from('sealed_pick')
    .select('app_user_id, game_window, roster_slot, player_slug, metric_id, locked').eq('matchup_id', matchupId);
  const rows = (data ?? []) as RevealedPick[];
  if (!rows.length) return rows;
  try {
    const { data: m } = await c.from('matchup')
      .select('league_id, home_roster_id, away_roster_id').eq('id', matchupId).maybeSingle();
    if (!m) return rows;
    const { data: mems } = await c.from('league_membership').select('sleeper_roster_id, app_user_id')
      .eq('league_id', m.league_id).in('sleeper_roster_id', [m.home_roster_id, m.away_roster_id]);
    const userOf = (rid: number) =>
      (mems ?? []).find((x: { sleeper_roster_id: number; app_user_id: string | null }) => x.sleeper_roster_id === rid)?.app_user_id ?? null;
    const homeUser = userOf(m.home_roster_id);
    const awayUser = userOf(m.away_roster_id);
    if (homeUser == null && awayUser == null) return rows; // memberships unreadable — leave the board alone
    const { home, away } = assignSealedRows(rows, homeUser, awayUser);
    const rehome = (rs: RevealedPick[], uid: string | null) =>
      rs.map((r) => (uid && r.app_user_id !== uid ? { ...r, app_user_id: uid } : r));
    return [...rehome(home, homeUser), ...rehome(away, awayUser)];
  } catch {
    return rows;
  }
}

/** All worker-ingested plays for a week (live_play is readable by any authed user).
 *  Drives the live full-board resolution off real plays. */
export interface LivePlayRow { player_slug: string; c: number; t: number | null; pid: number | null; k: string; y: number; td: number; ca: number; tg: number; to: number | null; fd?: number | null; cp?: number | null; ic?: number | null; sk?: number | null; rk?: string | null; tt?: string | null; hf?: number | null; p6?: number | null; }
export async function weekLivePlays(week: number): Promise<LivePlayRow[]> {
  // Page through the full result set. PostgREST caps an un-ranged select at its
  // max-rows default (1000), so a busy NFL Sunday (several thousand plays) would
  // silently truncate — and the board would score off an incomplete play set.
  const PAGE = 1000;
  const rows: LivePlayRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (await client()).from('live_play')
      .select('player_slug, c, t, pid, k, y, td, ca, tg, to, fd, cp, ic, sk, rk, tt, hf, p6')
      .eq('week', week)
      .order('id', { ascending: true }) // stable total order (bigint PK) for paging
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as LivePlayRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** The week's per-game field-visual feeds (game_feed, readable by any authed
 *  user) — drives FieldView/FieldBoard on the live board. */
export interface GameFeedRow { key: string; away: string; home: string; plays: import('./gameFeed').GamePlay[]; state?: string | null; }
export async function weekGameFeeds(week: number): Promise<GameFeedRow[]> {
  const { data } = await (await client()).from('game_feed')
    .select('key, away, home, plays, state').eq('week', week);
  return (data ?? []) as GameFeedRow[];
}

/** The opponent's revealed armed buffs — readable only AFTER the matchup locks
 *  (applied_read_after_lock RLS). Returns null when the opponent's row isn't
 *  visible yet (pre-lock) so callers can keep the AI default; an array (possibly
 *  empty) once revealed. */
export async function revealedOppBuffs(matchupId: string, userId: string): Promise<string[] | null> {
  const { data } = await (await client()).from('applied_state').select('app_user_id, payload_json').eq('matchup_id', matchupId);
  const opp = (data ?? []).find((r) => r.app_user_id && r.app_user_id !== userId) as { payload_json: { buffs?: string[] } | null } | undefined;
  if (!opp) return null;
  return opp.payload_json?.buffs ?? [];
}

// ── Super admin ─────────────────────────────────────────────────────────────────
export type Controller = 'human' | 'ai';
export type LineupPolicy = 'best_lineup' | 'ai' | 'empty';
export interface AdminLeague { league_id: string; sleeper_league_id: string; name: string; season: string; provider?: string; avatar_url?: string | null; commish_code: string; invite_code: string; commissioner: boolean; rosters: number; enrolled: number; lineup_policy?: LineupPolicy; ai_teams?: number; weekly_budget?: number; test_live_at?: string | null; preseason_at?: string | null; /** Window Pot: the per-league flag (0 = off) + its ceiling, and how many pots are in flight right now. */ pot_ante?: number; pot_cap?: number; pot_open?: number; }
export interface AdminUser { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; enrolled: number; created_at: string; }
/** `drifted` (0117): this seat's occupant is no longer the roster's Sleeper owner
 *  — they left the league, it changed hands, or they unlinked. Sleeper leagues
 *  only, and never set for hand-assigned seats (those carry claim_email and are
 *  deliberately independent of Sleeper). Advisory: a refresh flags it, it never
 *  clears the seat on its own. */
export interface AdminMember { roster_id: number; team: string; owner: string | null; enrolled: boolean; email: string | null; sleeper: string | null; controller?: Controller; avatar?: string | null; claim_email?: string | null; drifted?: boolean; /** Drip-coin balance (0130); 0 for a wallet never minted. */ coin?: number; }
export interface AdminAdmin { email: string; note: string | null; }
export interface MemberRow { roster_id: number; owner_id: string | null; team_name: string; }
export interface MatchupRow { sleeper_matchup_id: number | null; home_roster_id: number; away_roster_id: number; }
export interface LineupRow { roster_id: number; starters: { slug: string; full: string; pos: string; team?: string }[]; }
export interface AdminMatchup { id: string; week: number; home_roster_id: number; away_roster_id: number; status: string; lock_at: string | null; home_final: number | null; away_final: number | null; home_coin?: number | null; away_coin?: number | null; }
export interface AdminOverride { sleeper_user_id: string; note: string | null; }
export interface AdminAudit { table: string; op: string; row_id: string | null; at: string; detail?: string | null; actor?: string | null; }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (await client()).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const isAdmin = () => rpc<boolean>('is_admin');

// Global premium-tier config (which positions / power-ups are free vs premium).
export interface PremiumTier { free_positions: string[]; free_powerups: string[]; updated_at?: string }
export const getPremiumTier = () => rpc<PremiumTier>('get_premium_tier');
export const matchupPremium = (matchupId: string) => rpc<boolean>('matchup_premium', { m_id: matchupId });
/** Start a Stripe Checkout for a premium purchase → redirects to Stripe. The edge
 *  function derives the season from the league; the webhook grants on payment. */
export async function startCheckout(kind: 'personal' | 'league' | 'split', leagueId: string, amountCents?: number): Promise<void> {
  const { data, error } = await (await client()).functions.invoke('stripe-checkout', { body: { kind, leagueId, amountCents } });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (url) platform().openUrl(url);
}
export const adminSetPremiumTier = (freePositions: string[], freePowerups: string[]) =>
  rpc<{ ok: boolean; error?: string }>('admin_set_premium_tier', { p_free_positions: freePositions, p_free_powerups: freePowerups });

// Card-table theme flag (migration 0074): per-league presentation switch for the
// live board. Members read it; only super admins flip it.
export const leagueCardTheme = (leagueId: string) => rpc<boolean>('league_card_theme', { p_league: leagueId });
/** The card-table flag by a league's Sleeper id — for the vs-AI demo, which
 *  loads a Sleeper league client-side and has no DB league uuid to key on. */
export const leagueCardThemeBySleeper = (sleeperId: string) => rpc<boolean>('league_card_theme_by_sleeper', { p_sleeper: sleeperId });
/** Global card-theme flag for the generic front-door demo (baked demo league).
 *  Default on; super admins can flip it back to the simple view. */
export const demoCardTheme = () => rpc<boolean>('demo_card_theme');
export const adminSetDemoCardTheme = (on: boolean) =>
  rpc<{ ok: boolean; error?: string; card_theme?: boolean }>('admin_set_demo_card_theme', { p_on: on });
export const adminSetCardTheme = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; card_theme?: boolean }>('admin_set_card_theme', { p_league: leagueId, p_on: on });

// ── Solo passes (0097): auto-issued, capped, self-serve solo access ──────────
/** Anonymous mint from the request funnel's solo path. Over quota → waitlisted. */
export const issueSoloPass = (email: string) =>
  rpc<{ ok: boolean; error?: string; code?: string; already?: boolean; waitlisted?: boolean }>('issue_solo_pass', { p_email: email });
/** Signed-in redemption — claims the pass and unlocks the 'solo' feature. */
export const redeemSoloPass = (code: string) =>
  rpc<{ ok: boolean; error?: string; already?: boolean }>('redeem_solo_pass', { p_code: code });
export interface SoloPassAdmin { weekly_quota: number; minted_7d: number; claimed_7d: number; passes: { code: string; created_at: string; email: string; claimed: boolean; claimed_at: string | null }[] }
export const adminSoloPasses = () => rpc<SoloPassAdmin | { error: string }>('admin_solo_passes');
export const adminSetSoloQuota = (quota: number) =>
  rpc<{ ok: boolean; error?: string; weekly_quota?: number }>('admin_set_solo_quota', { p_quota: quota });

export const adminOverview = () => rpc<AdminLeague[]>('admin_overview');
export const adminMatchups = (leagueId: string) => rpc<AdminMatchup[]>('admin_matchups', { p_league_id: leagueId });
export const adminSetMatchup = (matchupId: string, status: string, lockNow = false) =>
  rpc<{ ok: boolean; error?: string }>('admin_set_matchup', { p_matchup_id: matchupId, p_status: status, p_lock_now: lockNow });
export const adminOverrides = () => rpc<AdminOverride[]>('admin_overrides');
export const adminSetOverride = (sleeperUserId: string, note: string, remove = false) =>
  rpc<{ ok: boolean }>('admin_set_override', { p_sleeper_user_id: sleeperUserId, p_note: note, p_remove: remove });
export const adminAudit = (limit = 50) => rpc<AdminAudit[]>('admin_audit', { p_limit: limit });
export const commishAudit = (leagueId: string, limit = 50) => rpc<AdminAudit[]>('commish_audit', { p_league_id: leagueId, p_limit: limit });

// Setup writers (the client fetches/parses Sleeper, these just persist).
export const adminUpsertLeague = (sleeperId: string, season: string, name: string, settings: unknown, provider?: string, avatar?: string | null) =>
  rpc<{ ok: boolean; error?: string; league_id?: string }>('admin_upsert_league', {
    p_sleeper_id: sleeperId, p_season: season, p_name: name, p_settings: settings,
    p_provider: provider ?? 'sleeper',
    // platform crest — stored only while the league has no crest yet (a null
    // gets a random first-party tile server-side)
    p_avatar: avatar ?? null,
  });
export const adminUpsertMemberships = (leagueId: string, members: MemberRow[]) =>
  rpc<{ ok: boolean; count?: number; error?: string }>('admin_upsert_memberships', { p_league_id: leagueId, p_members: members });
export const adminUpsertMatchups = (leagueId: string, week: number, matchups: MatchupRow[], lockAt: string | null) =>
  rpc<{ ok: boolean; count?: number }>('admin_upsert_matchups', { p_league_id: leagueId, p_week: week, p_matchups: matchups, p_lock_at: lockAt });
export const adminUpsertLineups = (leagueId: string, week: number, lineups: LineupRow[]) =>
  rpc<{ ok: boolean; count?: number }>('admin_upsert_lineups', { p_league_id: leagueId, p_week: week, p_lineups: lineups });

// Admin management + audit.
export const adminAdmins = () => rpc<AdminAdmin[]>('admin_admins');
export const adminSetAdmin = (email: string, note: string, remove = false) =>
  rpc<{ ok: boolean; error?: string }>('admin_set_admin', { p_email: email, p_note: note, p_remove: remove });
export const adminUsers = () => rpc<AdminUser[]>('admin_users');
export interface CodeRequest { id: string; created_at: string; email: string | null; sleeper_username: string | null; league_name: string | null; league_ref: string | null; note: string | null; handled: boolean; }
export const adminCodeRequests = () => rpc<CodeRequest[]>('admin_code_requests');
export const adminSetCodeRequestHandled = (id: string, handled: boolean) => rpc<{ ok: boolean }>('admin_set_code_request_handled', { p_id: id, p_handled: handled });
/** Correct a mistyped (or missing) email on a lead so the invite can actually be
 *  sent — the address came from an anonymous form and is nobody's to fix but ours. */
export const adminSetCodeRequestEmail = (id: string, email: string) =>
  rpc<{ ok: boolean; error?: string; email?: string }>('admin_set_code_request_email', { p_id: id, p_email: email });
export interface BoardPick { slug: string; metric: string | null; }
export interface BoardSlotScore { side: 'home' | 'away'; slot: string; slug: string | null; metric: string | null; score: number; }
export interface BoardState { game_window: string; home_score: number; away_score: number; slot_scores: BoardSlotScore[]; home_picks: BoardPick[]; away_picks: BoardPick[]; }
export interface MatchupBoard {
  matchup: { id: string; week: number; status: string; home_roster_id: number; away_roster_id: number; home_final: number | null; away_final: number | null; home_coin: number | null; away_coin: number | null; lock_at: string | null };
  home_team: string | null; away_team: string | null;
  home_avatar?: string | null; away_avatar?: string | null;
  states: BoardState[];
  updated_at: string | null;
}
export const adminMatchupBoard = (matchupId: string) => rpc<MatchupBoard>('admin_matchup_board', { p_matchup_id: matchupId });
export const adminResetMatchup = (matchupId: string) => rpc<{ ok: boolean; error?: string }>('admin_reset_matchup', { p_matchup_id: matchupId });

// ── Pilot ops (migration 0021) ───────────────────────────────────────────────
export interface PickSide { roster_id: number; team: string | null; app_user_id: string | null; enrolled: boolean; controller: Controller; email: string | null; sleeper: string | null; lineup_size: number; picks_set: number; }
export interface PickReadiness { matchup_id: string; week: number; status: string; lock_at: string | null; home_roster_id: number; away_roster_id: number; home: PickSide; away: PickSide; }
export const adminPickReadiness = (leagueId: string, week: number) => rpc<PickReadiness[]>('admin_pick_readiness', { p_league_id: leagueId, p_week: week });
/** `last_lineup_sync` (0122) is the WEEKLY sync's heartbeat — the only one that
 *  means anything outside game hours, since ingest and publish sit still all
 *  week. Not to be confused with league.synced_at, which is the league IMPORT
 *  time and reads days old on a perfectly healthy worker. */
export interface AdminHealth { now: string; leagues: number; enrolled: number; matchups_by_status: Record<string, number>; live_matchups: number; live_play_count: number; sim_play_count: number; last_play_ingest: string | null; last_state_update: string | null; last_lineup_sync: string | null; }
export const adminHealth = () => rpc<AdminHealth>('admin_health');
export const adminSetPicks = (matchupId: string, appUserId: string, rows: { game_window: string; roster_slot: string; player_slug: string; metric_id: string }[]) =>
  rpc<{ ok: boolean; count?: number; error?: string }>('admin_set_picks', { p_matchup_id: matchupId, p_app_user_id: appUserId, p_rows: rows });
export const adminClearPicks = (matchupId: string, appUserId: string) =>
  rpc<{ ok: boolean; error?: string }>('admin_clear_picks', { p_matchup_id: matchupId, p_app_user_id: appUserId });

// ── AI control (migration 0022) ──────────────────────────────────────────────
export const setTeamController = (leagueId: string, rosterId: number, controller: Controller) =>
  rpc<{ ok: boolean; error?: string; controller?: Controller }>('set_team_controller', { p_league_id: leagueId, p_roster_id: rosterId, p_controller: controller });
export const setLineupPolicy = (leagueId: string, policy: LineupPolicy) =>
  rpc<{ ok: boolean; error?: string; lineup_policy?: LineupPolicy }>('set_lineup_policy', { p_league_id: leagueId, p_policy: policy });
export const myMembership = (leagueId: string, rosterId: number) =>
  rpc<{ controller: Controller } | null>('my_membership', { p_league_id: leagueId, p_roster_id: rosterId });

// ── K/DST fill (migration 0028) ──────────────────────────────────────────────
export type KdstMode = 'off' | 'random' | 'manual';
export interface LeagueKdst {
  mode: KdstMode; needs_k: boolean; needs_def: boolean;
  teams: { roster_id: number; team: string | null; k_slug: string | null; dst_slug: string | null }[];
}
export const leagueKdst = (leagueId: string) => rpc<LeagueKdst>('league_kdst', { p_league_id: leagueId });
export const setKdstMode = (leagueId: string, mode: KdstMode) =>
  rpc<{ ok: boolean; error?: string; mode?: KdstMode }>('set_kdst_mode', { p_league_id: leagueId, p_mode: mode });
export const setTeamKdst = (leagueId: string, rosterId: number, kSlug: string | null, dstSlug: string | null) =>
  rpc<{ ok: boolean; error?: string }>('set_team_kdst', { p_league_id: leagueId, p_roster_id: rosterId, p_k_slug: kSlug, p_dst_slug: dstSlug });

/** Launch the real server-driven live feed sim via the dispatch-sim edge function
 *  (admin-only; the function re-checks is_admin and holds the GitHub token). */
export async function dispatchSim(input: { mode?: 'live' | 'reset' | 'check' | 'dry'; league: string; week?: number | string; src?: number | string; speed?: number; jitter?: number; corrections?: number }): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await (await client()).functions.invoke('dispatch-sim', { body: input });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}
/** Email an invite (share link + code) to a code-request, via the send-invite edge
 *  function (admin-only; the function re-checks is_admin and sends through Gmail). */
export async function sendInvite(input: { to: string; code: string; link: string; leagueName?: string; kind?: 'player' | 'commish' }): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await (await client()).functions.invoke('send-invite', { body: input });
  if (error) {
    // On a non-2xx the FunctionsHttpError only says "non-2xx status code"; the real
    // reason is in the response body (.context is the Response). Surface it.
    let detail = '';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') detail = (await ctx.json())?.error ?? '';
    } catch { /* body wasn't JSON — fall back to the generic message */ }
    return { ok: false, error: detail || friendlyError(error) };
  }
  return data as { ok: boolean; error?: string };
}
export const adminLeagueMembers = (leagueId: string) => rpc<AdminMember[]>('admin_league_members', { p_league_id: leagueId });
/** Super-admin: permanently delete a league and all its data (cascades). */
export const adminDeleteLeague = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; name?: string }>('admin_delete_league', { p_league_id: leagueId });
/** Commissioner/admin enrolls THEMSELVES on a roster — claim a team to play.
 *  Call once per roster to claim multiple teams. */
export const commishClaimRoster = (leagueId: string, rosterId: number) =>
  rpc<{ ok: boolean; error?: string; status?: string }>('commish_claim_roster', { p_league_id: leagueId, p_roster_id: rosterId });
/** Commissioner/admin grants drip coin to a team (additive). */
export const commishSeedCoin = (leagueId: string, rosterId: number, amount: number) =>
  rpc<{ ok: boolean; error?: string; balance?: number }>('commish_seed_coin', { p_league_id: leagueId, p_roster_id: rosterId, p_amount: amount });
/** Commissioner/admin moves EVERY team's balance by the same signed amount (0131). */
export const commishBulkCoin = (leagueId: string, amount: number) =>
  rpc<{ ok: boolean; error?: string; teams?: number }>('commish_bulk_coin', { p_league_id: leagueId, p_amount: amount });
/** Commissioner/admin zeroes every wallet in the league, via the ledger (0131). */
export const commishClearCoin = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; cleared?: number }>('commish_clear_coin', { p_league_id: leagueId });
export interface RosterWallet { roster_id: number; coins: number }
/** Admin/commish: every team's current coin balance. */
export const adminLeagueWallets = (leagueId: string) => rpc<RosterWallet[]>('admin_league_wallets', { p_league_id: leagueId });
/** The league's configured weekly coin budget (any member can read it — the board
 *  shows it in place of the generic stipend when the league sets its own). Null
 *  when unreadable/unset. */
export const leagueWeeklyBudget = async (leagueId: string): Promise<number | null> => {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('league').select('weekly_budget').eq('id', leagueId).maybeSingle();
  const b = (data as { weekly_budget?: number } | null)?.weekly_budget;
  return b == null ? null : Number(b);
};
/** Super-admin: toggle a league's live-test mode (compressed real-time schedule). */
export const adminSetTestLive = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; test_live_at?: string | null }>('admin_set_test_live', { p_league_id: leagueId, p_on: on });
/** Super-admin: toggle a league's preseason mode — clones its Week-1 pairings into
 *  the preseason offset weeks (101-103) so it can play real 2026 preseason games. */
export const adminSetPreseason = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; preseason_at?: string | null; matchups?: number }>('admin_set_preseason', { p_league_id: leagueId, p_on: on });
/** Commissioner (or admin): flip a league's preseason PRACTICE mode. Same clone
 *  as adminSetPreseason — the 0110 twin that accepts the league's commissioner,
 *  so opening practice isn't a super-admin errand. */
export const setPreseasonPractice = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; preseason_at?: string | null; matchups?: number; weeks?: number[]; skipped?: number[] }>(
    'set_preseason_practice', { p_league_id: leagueId, p_on: on });

export interface PreseasonWindow {
  /** The preseason slate is loaded for this season (weeks 101-103 have games). */
  loaded: boolean;
  /** Practice can still be fed: the last preseason game hasn't finished yet. */
  open: boolean;
  firstKickoff: number | null;
  lastKickoff: number | null;
}
/** Can preseason practice still produce real games for this season?
 *
 *  Worth being blunt about why this check exists: the WORKER decides what it
 *  polls from process-wide config (`PILOT_SEASON_TYPE=1` → seasonType 1 +
 *  weekOffset 100), not per league. A league can therefore be flipped into
 *  practice at a moment when nothing will ever feed those weeks — three weeks of
 *  matchups that sit at 0-0 forever. The commissioner has no way to know that
 *  and no way to fix it.
 *
 *  The honest proxy is the calendar: while the preseason slate's last kickoff is
 *  still ahead of us, opening practice is a live proposition (the worker either
 *  is or will be pointed at preseason for this window); once it's passed, it
 *  isn't, and the button should say so instead of handing over a dead league.
 *  Admins bypass this in the UI so off-window testing stays possible. */
export async function preseasonWindow(season: string): Promise<PreseasonWindow> {
  const sb = await getSupabase();
  if (!sb) return { loaded: false, open: false, firstKickoff: null, lastKickoff: null };
  const { data } = await sb.from('nfl_slate').select('week, kickoff')
    .eq('season', season).in('week', PRESEASON_BOARD_WEEKS);
  const kicks = ((data ?? []) as { kickoff: string | null }[])
    .map((r) => (r.kickoff ? Date.parse(r.kickoff) : NaN)).filter(Number.isFinite);
  if (!kicks.length) return { loaded: false, open: false, firstKickoff: null, lastKickoff: null };
  const first = Math.min(...kicks), last = Math.max(...kicks);
  // ~4h pads the last kickoff to that game's end, same allowance defaultOpenWeek
  // and join_weekly use for "this week isn't over yet".
  return { loaded: true, open: Date.now() <= last + 4 * 3_600_000, firstKickoff: first, lastKickoff: last };
}

/** The ONE-CLICK a commissioner actually wants: turn preseason practice on AND
 *  give every preseason week its deep (backups-included) pool, in one action.
 *  These were two separate super-admin buttons in the required order, and the
 *  pool had to be re-seeded after every re-toggle (the toggle wipes lineups with
 *  its clones) — forget it and seats field Week-1 starters who don't take
 *  preseason snaps. Partial failure is reported, not swallowed: the mode is on
 *  and the weeks that seeded are listed, so a retry is safe (both halves are
 *  idempotent). */
export async function enablePreseasonPractice(leagueId: string): Promise<{ ok: boolean; error?: string; matchups?: number; weeks?: number[]; skipped?: number[]; pool?: number }> {
  const on = await setPreseasonPractice(leagueId, true);
  if (!on.ok) return { ok: false, error: on.error ?? 'could not turn practice on' };
  const weeks: number[] = [];
  let pool = 0, firstErr: string | null = null;
  // Seed pools for exactly the weeks the clone seeded — 0113 skips preseason
  // weeks that have already been played, and reporting a "failure" for a week it
  // deliberately left alone would be noise.
  for (const wk of on.weeks?.length ? on.weeks : PRESEASON_BOARD_WEEKS) {
    // A week whose slate hasn't loaded yet isn't fatal — the others still seed,
    // and the worker writes that slate on its first preseason tick (re-seed then).
    const r = await seedPreseasonPool(leagueId, wk).catch((e: unknown) => ({ ok: false, error: friendlyError(e), pool: 0 }));
    if (r.ok) { weeks.push(wk); pool += r.pool ?? 0; }
    else firstErr ??= r.error ?? `week ${wk} failed`;
  }
  if (!weeks.length) {
    return { ok: false, matchups: on.matchups, error: `practice is on, but no week got a deep pool — ${firstErr}` };
  }
  return { ok: true, matchups: on.matchups, weeks, skipped: on.skipped, pool };
}

/** Commissioner/admin: replace every seat's pick pool at a preseason board week
 *  with the DEEP slate-team pool — every active skill player on that week's teams
 *  from the Sleeper directory, depth-chart ordered, plus team K/DST (preseason is
 *  played by the backups the Week-1 clones don't carry). Builds the pool
 *  client-side (shared builder, src/data/preseasonPool.ts) and writes via the
 *  0110 RPC (the commish-capable twin of 0101's admin-only one). */
export async function seedPreseasonPool(leagueId: string, week: number): Promise<{ ok: boolean; error?: string; seats?: number; pool?: number; teams?: number }> {
  const sb = await client();
  const { data: slateRows } = await sb.from('nfl_slate').select('season, home, away').eq('week', week);
  const season = (slateRows ?? []).reduce((m, r) => (r.season > m ? r.season : m), '');
  const teams = new Set((slateRows ?? []).filter((r) => r.season === season).flatMap((r) => [r.home, r.away]).filter(Boolean));
  if (!teams.size) return { ok: false, error: `no slate loaded for week ${week}` };
  const { loadPlayerDirectory } = await import('./sleeperPlayers');
  const { poolFromRows } = await import('./preseasonPool');
  const { normName } = await import('./players');
  const dir = await loadPlayerDirectory();
  const rows = [...dir.values()]
    .filter((m) => m.active !== false && m.team)
    .map((m) => ({ sid: m.id, slug: normName(m.full).replace(/\s+/g, '-'), full: m.full, pos: m.pos, team: m.team!, depth: m.depth ?? 99 }));
  const pool = poolFromRows(rows, teams as Set<string>);
  if (!pool.length) return { ok: false, error: 'empty pool — player directory had no one on the slate teams' };
  const r = await rpc<{ ok: boolean; error?: string; seats?: number; pool?: number }>('seed_preseason_pool', { p_league_id: leagueId, p_week: week, p_pool: pool });
  return { ...r, teams: teams.size };
}
/** The league's live-test anchor (epoch ms) if test mode is on, else null. Any
 *  member can read it — the board compresses its window timeline from this. */
export const leagueTestLiveAt = async (leagueId: string): Promise<number | null> => {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('league').select('test_live_at').eq('id', leagueId).maybeSingle();
  const t = (data as { test_live_at?: string | null } | null)?.test_live_at;
  return t ? Date.parse(t) : null;
};
/** Commissioner/admin sets the league's flat weekly coin budget (0 disables). */
export const commishSetWeeklyBudget = (leagueId: string, amount: number) =>
  rpc<{ ok: boolean; error?: string; weekly_budget?: number }>('commish_set_weekly_budget', { p_league_id: leagueId, p_amount: amount });
/** Commissioner/admin grants the league's weekly budget to every team for one
 *  week (idempotent — re-running a week never double-credits). */
export const commishGrantWeeklyBudget = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; credited?: number; weekly_budget?: number }>('commish_grant_weekly_budget', { p_league_id: leagueId, p_week: week });
/** Admin/commish-map a roster to a person — by a joined-user id (picked from the
 *  pool) or by email (immediate enroll if signed in, else a pending claim that
 *  links on their next sign-in). Empty email + no id clears the roster. */
export const adminAssignRoster = (leagueId: string, rosterId: number, email: string, appUserId?: string) =>
  rpc<{ ok: boolean; error?: string; status?: 'enrolled' | 'pending' | 'cleared' }>('admin_assign_roster',
    { p_league_id: leagueId, p_roster_id: rosterId, p_email: email, ...(appUserId ? { p_app_user_id: appUserId } : {}) });
/** Claim any rosters pre-assigned to my email (called after sign-in). */
export const claimMyRosters = () => rpc<{ ok: boolean; claimed?: number }>('claim_my_rosters');
/** Player joins a league's pool by invite code (any platform); the commissioner
 *  then assigns them a roster from the pool. */
export const joinLeague = (code: string) =>
  rpc<{ ok: boolean; error?: string; league?: string; status?: 'joined' | 'enrolled' }>('join_league', { p_code: code.trim() });
export interface LeagueJoiner { app_user_id: string; email: string | null; }
/** Admin/commish: users who've joined a league's pool but aren't rostered yet. */
export const adminLeagueJoiners = (leagueId: string) => rpc<LeagueJoiner[]>('admin_league_joiners', { p_league_id: leagueId });
export const commishOverview = () => rpc<AdminLeague[]>('commish_overview');
export interface MatchupPicks { home_roster_id: number; away_roster_id: number; home_app_user: string | null; away_app_user: string | null; picks: { app_user_id: string; game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null }[]; home_lineup: { player_slug: string | null; pos: string | null }[]; away_lineup: { player_slug: string | null; pos: string | null }[]; home_buffs: string[]; away_buffs: string[]; home_unlocks?: string[]; away_unlocks?: string[]; home_extra?: number; away_extra?: number; }
export const adminMatchupPicks = (matchupId: string) => rpc<MatchupPicks>('admin_matchup_picks', { p_matchup_id: matchupId });

// ── Read-only "view as" (0107): what a given user sees, for support + QA ────────
export interface ViewAsPick { game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; locked: boolean }
export interface ViewAsMatchup { id: string; status: string; lock_at: string | null; opponent: string | null; picks: ViewAsPick[] }
export interface ViewAsLeague {
  league_id: string; name: string; season: string; provider: string; avatar_url: string | null;
  roster_id: number; team_name: string; team_avatar: string | null; controller?: Controller;
  is_commish: boolean; pool_size: number | null; matchup: ViewAsMatchup | null;
}
export interface ViewAsState {
  error?: string;
  user: { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; created_at: string };
  week: number | null;
  leagues: ViewAsLeague[];
}
/** Super-admin only. Reads; never writes and never mints a session — the caller
 *  stays themselves. Admin-gated rather than commish-gated because it can surface
 *  an opponent's still-unlocked picks. */
export const adminUserState = (appUserId: string, week: number) =>
  rpc<ViewAsState>('admin_user_state', { p_app_user_id: appUserId, p_week: week });

/** Browse-as twins of the per-caller reads (0109). commish_overview() and
 *  my_features() key on auth.uid(), so without these a browse-as session shows
 *  the ADMIN's commissioner leagues and is gated by the ADMIN's feature flags. */
export const adminUserCommishLeagues = (appUserId: string) =>
  rpc<AdminLeague[]>('admin_user_commish_leagues', { p_app_user_id: appUserId });
export const adminUserFeatures = (appUserId: string) =>
  rpc<Record<string, boolean>>('admin_user_features', { p_app_user_id: appUserId });

// ── Live power-up loadout (M1): arm/disarm in-slot team buffs, pre-lock ──────────
/** Commissioner switch on the real-time (armed) power-ups (0155). */
export const setLeagueLiveBuffs = (leagueId: string, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; on?: boolean }>('set_league_live_buffs', { p_league_id: leagueId, p_on: on }),
    Ev.commishAction, { tool: 'live_buffs', on });
export const leagueLiveBuffs = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; on?: boolean }>('league_live_buffs', { p_league_id: leagueId });

// ── Game mode (0157): NORMIE MODE — classic fantasy as a league setting ──────
/** 'drip' (default) or 'classic' — classic = standard scoring, one weekly
 *  QB/RB/RB/WR/WR/TE/FLEX/K/DEF lineup, no bonuses, no power-ups. Frozen once
 *  the draft starts. `ppr` (0 | 0.5 | 1, default 1) applies in classic only. */
export interface GameModeInfo { ok: boolean; error?: string; mode?: 'drip' | 'classic'; ppr?: number; classic_ok?: boolean; bestball?: string[]; scoring?: Record<string, number>; roster?: Record<string, number>; slots?: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null }[] | null; shape?: { bench?: number; taxi?: number; ir?: number } | null; rounds?: number | null; positions?: string[] | null; pool_filter?: { teams?: string[] | null; min_exp?: number | null; max_exp?: number | null } | null; can_edit?: boolean }
export const setLeagueGameMode = (leagueId: string, mode: 'drip' | 'classic', ppr?: number) =>
  tracked(rpc<{ ok: boolean; error?: string; mode?: string }>('set_league_game_mode',
    { p_league_id: leagueId, p_mode: mode, p_ppr: ppr ?? null }),
    Ev.commishAction, { tool: 'game_mode', mode });
export const leagueGameMode = (leagueId: string) =>
  rpc<GameModeInfo>('league_game_mode', { p_league_id: leagueId });
/** The feature flag on classic availability (0158) — ADMIN only. The
 *  commissioner's CLASSIC choice unlocks per league, by the founder's hand. */
export const setLeagueClassicAccess = (leagueId: string, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; on?: boolean }>('set_league_classic_access',
    { p_league_id: leagueId, p_on: on }),
    Ev.commishAction, { tool: 'classic_access', on });
/** Best ball (0159): which classic slots fill themselves. All nine = full
 *  best ball; a subset = hybrid; [] = off. Classic leagues only, commish. */
export const setLeagueBestball = (leagueId: string, slots: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; bestball?: string[] }>('set_league_bestball',
    { p_league_id: leagueId, p_slots: slots }),
    Ev.commishAction, { tool: 'bestball', count: slots.length });
/** The classic starting lineup (0161): counts per slot type (QB/RB/WR/TE/
 *  FLEX/SFLX/WRT/K/DEF/DL/LB/DB/IDP). Frozen once the draft starts. */
export const setLeagueClassicRoster = (leagueId: string, roster: Record<string, number>) =>
  tracked(rpc<{ ok: boolean; error?: string; roster?: Record<string, number>; starters?: number }>('set_league_classic_roster',
    { p_league_id: leagueId, p_roster: roster }),
    Ev.commishAction, { tool: 'classic_roster' });
/** The roster POSITION BUILDER (0163): an ordered list of starting spots,
 *  each with its own eligible-position set + best-ball flag. Wins over the
 *  0161 counts when present; null/[] clears back to them. Draft-frozen. */
export const setLeagueClassicSlots = (leagueId: string, slots: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null }[] | null) =>
  tracked(rpc<{ ok: boolean; error?: string; slots?: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null }[] | null; starters?: number }>('set_league_classic_slots',
    { p_league_id: leagueId, p_slots: slots }),
    Ev.commishAction, { tool: 'roster_builder', count: slots?.length ?? 0 });
/** BENCH/TAXI/IR counts (0164) — classic, pre-draft; draft rounds re-derive as
 *  starters + bench + taxi + ir. */
export const setLeagueRosterShape = (leagueId: string, bench: number, taxi: number, ir: number) =>
  tracked(rpc<{ ok: boolean; error?: string; shape?: { bench: number; taxi: number; ir: number }; rounds?: number }>('set_league_roster_shape',
    { p_league_id: leagueId, p_bench: bench, p_taxi: taxi, p_ir: ir }),
    Ev.commishAction, { tool: 'roster_shape' });
/** Move a rostered player between ACTIVE / TAXI / IR (0164). Owner or commish;
 *  IR needs a real injury designation; caps enforced server-side. */
export const setRosterSpot = (leagueId: string, slug: string, spot: 'active' | 'taxi' | 'ir') =>
  rpc<{ ok: boolean; error?: string; slug?: string; spot?: string }>('set_roster_spot',
    { p_league_id: leagueId, p_slug: slug, p_spot: spot });
/** Full classic scoring overrides (0160) — camelCase ClassicScoring keys,
 *  sanitized + clamped server-side; {} resets to the engine defaults. */
export const setLeagueClassicScoring = (leagueId: string, scoring: Record<string, number>) =>
  tracked(rpc<{ ok: boolean; error?: string; scoring?: Record<string, number> }>('set_league_classic_scoring',
    { p_league_id: leagueId, p_scoring: scoring }),
    Ev.commishAction, { tool: 'classic_scoring', count: Object.keys(scoring).length });

export const LIVE_BUFFS = ['overtime', 'ot-shield', 'momentum', 'garbage-time', 'amp-2', 'amp-3', 'floodgates', 'counter-nuke', 'insurance', 'fg-stack'] as const;
export const armBuff = (matchupId: string, buff: string) => rpc<{ ok: boolean; error?: string; detail?: string; buffs?: string[] }>('arm_buff', { p_matchup_id: matchupId, p_buff: buff });
export const disarmBuff = (matchupId: string, buff: string) => rpc<{ ok: boolean; error?: string; detail?: string; buffs?: string[] }>('disarm_buff', { p_matchup_id: matchupId, p_buff: buff });
export const myBuffs = (matchupId: string) => rpc<string[]>('my_buffs', { p_matchup_id: matchupId });
/** Hero board: persist the armed buff set (no wallet charge — paid at buy). */
export const heroSetBuffs = (matchupId: string, buffs: string[]) =>
  rpc<{ ok: boolean; error?: string }>('hero_set_buffs', { p_matchup_id: matchupId, p_buffs: buffs });
/** Hero board: persist/read the full working applied blob (extra slots, swaps,
 *  backups, targeted powerups) for cross-device restoration. */
export const heroSetApplied = (matchupId: string, payload: unknown) =>
  rpc<{ ok: boolean; error?: string }>('hero_set_applied', { p_matchup_id: matchupId, p_payload: payload });
export const myHeroApplied = (matchupId: string) => rpc<Record<string, unknown>>('my_hero_applied', { p_matchup_id: matchupId });

// Targeted power-ups (migration 0060): the SCORING record for Double or Nothing /
// Bye Steal / EMP / swaps — validated + timing-gated server-side, read by the
// worker's resolver. Uncharged (the shop flow already charged + consumed
// inventory), except use_spy which consumes a purchased Spy itself.
export const applyTargeted = (matchupId: string, powerupId: string, payload: Record<string, unknown>) =>
  rpc<{ ok: boolean; error?: string }>('apply_targeted', { p_matchup_id: matchupId, p_powerup_id: powerupId, p_payload: payload });
export const clearTargeted = (matchupId: string, powerupId: string, payload?: Record<string, unknown>) =>
  // 2-arg form drops a single-entry key (don/byeSteal, 0060); the 3-arg overload
  // (0085) removes ONE entry from a battle-play list (rivalry/ghost/slot bets).
  rpc<{ ok: boolean; error?: string }>('clear_targeted', payload
    ? { p_matchup_id: matchupId, p_powerup_id: powerupId, p_payload: payload }
    : { p_matchup_id: matchupId, p_powerup_id: powerupId });
export const useSpy = (matchupId: string, win: string, slot: string, reveal: 'player' | 'metric') =>
  rpc<{ ok: boolean; error?: string; reveal?: string | null; present?: boolean }>('use_spy', { p_matchup_id: matchupId, p_win: win, p_slot: slot, p_reveal: reveal });
export interface TargetedState {
  don?: { win: string; slot: string };
  byeSteal?: { win: string; slot: string; slug: string; pts: number };
  emp?: Record<string, number>;
  swaps?: Record<string, { kind: string; toMetric?: string; toPlayer?: string; atClock: number; atRt?: number }>;
  spy?: { win: string; slot: string; reveal: 'player' | 'metric' }[];
  /** Manual backup assignments (0137): "win#slot" backup → "win#slot" starter. */
  backups?: Record<string, string>;
}

/** Record (or clear, with a null target) a manual backup assignment (0137).
 *  Post-lock is the POINT — backups are auto-assigned at lock and reassigned
 *  after — so unlike hero_applied this store accepts writes until the matchup
 *  is final, and the worker's next resolve pass scores the choice. */
export const setBackupAssign = (matchupId: string, backupKey: string, targetKey: string | null) =>
  rpc<{ ok: boolean; error?: string; backups?: Record<string, string> }>(
    'set_backup_assign', { p_matchup_id: matchupId, p_backup_key: backupKey, p_target_key: targetKey });
/** The caller's recorded targeted power-ups (own applied_state row, readable under RLS). */
export async function myTargeted(matchupId: string, userId: string): Promise<TargetedState> {
  const { data } = await (await client()).from('applied_state').select('payload_json')
    .eq('matchup_id', matchupId).eq('app_user_id', userId).maybeSingle();
  return ((data?.payload_json as { targeted?: TargetedState } | null)?.targeted) ?? {};
}

// Metric unlocks (M2): arm before a locked metric (Combo Drip / Return / Air Raid)
// can be picked. Same applied_state store, free this season.
export const armUnlock = (matchupId: string, unlock: string) => rpc<{ ok: boolean; error?: string; unlocks?: string[]; comboQty?: number }>('arm_unlock', { p_matchup_id: matchupId, p_unlock: unlock });
export const disarmUnlock = (matchupId: string, unlock: string) => rpc<{ ok: boolean; error?: string; unlocks?: string[]; comboQty?: number }>('disarm_unlock', { p_matchup_id: matchupId, p_unlock: unlock });
export const myUnlocks = (matchupId: string) => rpc<string[]>('my_unlocks', { p_matchup_id: matchupId });
/** Combo-Drip unlocks purchased this week (one combodrip slot per purchase).
 *  A legacy set flag without a qty reads as 1. Own applied_state row, RLS-readable. */
export async function myComboQty(matchupId: string, userId: string): Promise<number> {
  const { data } = await (await client()).from('applied_state').select('payload_json')
    .eq('matchup_id', matchupId).eq('app_user_id', userId).maybeSingle();
  const pj = data?.payload_json as { unlocks?: string[]; unlockQty?: Record<string, number> } | null;
  return Number(pj?.unlockQty?.['unlock-combo-drip'] ?? (pj?.unlocks?.includes('unlock-combo-drip') ? 1 : 0));
}

// Persistent coin wallet (M3): both sides' banked balances for a matchup.
export const matchupWallets = (matchupId: string) => rpc<{ home: number | null; away: number | null } | null>('matchup_wallets', { p_matchup_id: matchupId });

// Extra slots (M4c): a buyable power-up (cap 2) that adds lineup slots beyond the
// base 8. A count in applied_state; bought/sold against the team wallet.
export const myExtra = (matchupId: string) => rpc<number>('my_extra', { p_matchup_id: matchupId });
export const buyExtraSlot = (matchupId: string) => rpc<{ ok: boolean; error?: string; extra?: number; charged?: number }>('buy_extra_slot', { p_matchup_id: matchupId });
export const sellExtraSlot = (matchupId: string) => rpc<{ ok: boolean; error?: string; extra?: number }>('sell_extra_slot', { p_matchup_id: matchupId });

// Spend (M4): the caller's team balance + a lazy season seed so there's coin to
// spend before week 1. ensure_wallet seeds once (idempotent) and returns balance.
export const myWallet = (matchupId: string) => rpc<number>('my_wallet', { p_matchup_id: matchupId });
export const ensureWallet = (matchupId: string) => rpc<number>('ensure_wallet', { p_matchup_id: matchupId });
/** Buy a power-up into inventory, charged against the real team wallet + recorded
 *  server-side. Returns the new balance. */
export const walletBuyPowerup = (matchupId: string, powerupId: string) =>
  rpc<{ ok: boolean; error?: string; balance?: number; charged?: number }>('wallet_buy_powerup', { p_matchup_id: matchupId, p_powerup_id: powerupId });
/** The caller's server-backed owned inventory for a matchup's league → {id: qty}. */
export const myInventory = (matchupId: string) => rpc<Record<string, number>>('my_inventory', { p_matchup_id: matchupId });
/** Consume/refund one owned power-up server-side (arming vs disarming). */
export const consumeInventory = (matchupId: string, powerupId: string) => rpc<{ ok: boolean; qty?: number }>('consume_inventory', { p_matchup_id: matchupId, p_powerup_id: powerupId });
export const refundInventory = (matchupId: string, powerupId: string) => rpc<{ ok: boolean; qty?: number }>('refund_inventory', { p_matchup_id: matchupId, p_powerup_id: powerupId });
export const adminSetState = (matchupId: string, states: { window: string; home: number; away: number }[], coin?: { home: number; away: number }, slotScores?: { win: string; side: string; slot: string; slug: string; metric: string | null; score: number }[]) =>
  rpc<{ ok: boolean }>('admin_set_state', { p_matchup_id: matchupId, p_states: states, p_home_coin: coin?.home ?? null, p_away_coin: coin?.away ?? null, p_slot_scores: slotScores ?? null });
export const adminSetCoin = (matchupId: string, home: number, away: number) =>
  rpc<{ ok: boolean; error?: string }>('admin_set_coin', { p_matchup_id: matchupId, p_home_coin: home, p_away_coin: away });
export const adminRegenCode = (leagueId: string, which: 'invite' | 'commish') =>
  rpc<{ ok: boolean; code?: string; error?: string }>('admin_regen_code', { p_league_id: leagueId, p_which: which });

// ── Native leagues (migration 0064): created in-app, rosters built by draft ─────
/** The league-continuity axis (0185): what carries into next season. */
export type LeagueContinuity = 'redraft' | 'keeper' | 'dynasty';
export interface NativeCreateResult { ok: boolean; error?: string; league_id?: string; roster_id?: number; invite_code?: string; game_mode?: 'drip' | 'classic'; dynasty?: boolean; continuity?: LeagueContinuity; }
/** Per-position roster limits (0071). null = uncapped. Absent blob = legacy
 *  defaults (QB 3, TE 3, K 1, D/ST 1, RB/WR uncapped). Enforced server-side
 *  for humans AND honored by the AI. */
export type PosCaps = { QB: number | null; RB: number | null; WR: number | null; TE: number | null; K: number | null; DEF: number | null };
export const POS_CAP_KEYS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export const createNativeLeague = (
  name: string, season: string, teams: number, rounds: number, pickSeconds: number,
  mode: 'snake' | 'auction' = 'snake', budget = 200, lotSeconds = 15, maxLots = 1,
  nightStartMin: number | null = null, nightEndMin: number | null = null,
  posCaps: PosCaps | null = null,
  /** Which game the league plays (0175). 'classic' also self-flags the league
   *  as classic-capable, so its commissioner can switch modes pre-draft. */
  gameMode: 'drip' | 'classic' = 'drip',
  /** Continuity at creation (0185): 'keeper' keeps continuityN players per
   *  team; 'dynasty' runs a continuityN-round rookie draft (keepers implied:
   *  roster − rounds) and deals THREE seasons of tradeable pick assets.
   *  Editable later in 🎮 MODE & SEASON (set_league_continuity). */
  continuity: LeagueContinuity = 'redraft',
  continuityN: number | null = null,
) =>
  rpc<NativeCreateResult>('create_native_league', {
    p_name: name, p_season: season, p_teams: teams, p_rounds: rounds, p_pick_seconds: pickSeconds,
    p_mode: mode, p_budget: budget, p_lot_seconds: lotSeconds, p_max_lots: maxLots,
    p_night_start_min: nightStartMin, p_night_end_min: nightEndMin, p_pos_caps: posCaps,
    p_game_mode: gameMode, p_continuity: continuity, p_continuity_n: continuityN,
  });
/** Read the league's roster + transaction rules (any member; the commish editors' loader). */
export const rosterRules = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string; rounds?: number; draft_status?: string; pos_caps?: PosCaps;
        waiver_mode?: WaiverMode; faab_budget?: number; trade_review?: 'none' | 'commish';
        waiver_clear_min?: number | null; waiver_clear_dow?: number[] | null;
        fa_after_waivers_dow?: number[] | null; waiver_hold_days?: number;
        fa_start_min?: number | null; fa_end_min?: number | null }>(
    'roster_rules', { p_league_id: leagueId });
/** Commissioner: edit position limits any time; roster size only pre-draft. */
export const setRosterRules = (leagueId: string, rounds: number | null, posCaps: PosCaps | null) =>
  rpc<{ ok: boolean; error?: string; rounds?: number; pos_caps?: PosCaps }>(
    'set_roster_rules', { p_league_id: leagueId, p_rounds: rounds, p_pos_caps: posCaps });

// ── Transactions (0072): commish roster tools, FAAB waivers, trades ──────────
/** rolling = queue that rotates on wins; standings = reverse of the live
 *  standings at every clear (Sleeper's default — winning a claim costs
 *  nothing); faab = blind bids from a season budget. */
export type WaiverMode = 'rolling' | 'standings' | 'faab';
export type TradeReview = 'none' | 'commish';
/** Per-seat FAAB (0173). `faab` is the EFFECTIVE balance — an untouched seat
 *  reads the league default rather than 0 — and `touched` says whether the
 *  seat has its own stored value yet. */
export interface FaabWallets { ok: boolean; error?: string; budget?: number; teams?: { roster_id: number; team: string | null; faab: number; touched: boolean }[] }
export const leagueFaabWallets = (leagueId: string) =>
  rpc<FaabWallets>('league_faab_wallets', { p_league_id: leagueId });

/** Commissioner grants FAAB (0173). ADDITIVE — negative claws back, the result
 *  floors at 0. `rosterId` null grants EVERY team (the overall grant). Refused
 *  unless the league is on FAAB, since a mode flip resets every balance. */
export const commishGrantFaab = (leagueId: string, rosterId: number | null, amount: number) =>
  tracked(rpc<{ ok: boolean; error?: string; granted?: number; teams?: { roster_id: number; team: string | null; faab: number }[] }>(
    'commish_grant_faab', { p_league_id: leagueId, p_roster_id: rosterId, p_amount: amount }),
    Ev.commishAction, { tool: 'faab_grant', all: rosterId == null });

/** Commissioner: waiver mode / FAAB budget / trade review / waiver clear
 *  schedule / FA window. Nulls = unchanged; the schedule knobs accept -1 to
 *  CLEAR (clear time → rolling 24h; FA window → always open).
 *  NOTE: sending mode or budget resets every seat's FAAB balance. */
export const setTransactionRules = (
  leagueId: string, waiverMode: WaiverMode | null, faabBudget: number | null, tradeReview: TradeReview | null,
  waiverClearMin: number | null = null, waiverHoldDays: number | null = null,
  faStartMin: number | null = null, faEndMin: number | null = null,
  /** Days waivers clear, 0=Sun…6=Sat ET (0126). [] clears back to every day;
   *  null = leave unchanged. */
  waiverClearDow: number[] | null = null,
  /** Days instant adds wait for the waiver run (0127). [] clears; null = leave
   *  unchanged. */
  faAfterWaiversDow: number[] | null = null,
) =>
  rpc<{ ok: boolean; error?: string; waiver_mode?: WaiverMode; faab_budget?: number; trade_review?: TradeReview }>(
    'set_transaction_rules', {
      p_league_id: leagueId, p_waiver_mode: waiverMode, p_faab_budget: faabBudget, p_trade_review: tradeReview,
      p_waiver_clear_min: waiverClearMin, p_waiver_hold_days: waiverHoldDays,
      p_fa_start_min: faStartMin, p_fa_end_min: faEndMin,
      p_waiver_clear_dow: waiverClearDow, p_fa_after_waivers_dow: faAfterWaiversDow,
    });
/** THE LEAGUE REGISTER (0186): every in-season roster movement, newest first.
 *  Adds, drops, waiver wins (with the bid), trades (with the seat each player
 *  came from) and commissioner moves — written by a trigger on native_roster,
 *  so it covers every path. Draft night is deliberately absent: the draft room
 *  is already its own record. Any member may read it. */
export interface RegisterRow {
  id: number; at: string;
  kind: 'add' | 'drop' | 'waiver' | 'trade' | 'commish';
  slug: string;
  roster_id: number; team: string | null;
  /** Trades only: the seat the player came from. */
  from_roster: number | null; from_team: string | null;
  /** Waiver wins in a FAAB league. */
  bid: number | null;
}
export const leagueRegister = (leagueId: string, limit = 100) =>
  rpc<{ ok: boolean; error?: string; rows?: RegisterRow[] }>('league_register',
    { p_league_id: leagueId, p_limit: limit });

/** Commissioner override: put any pool player on any roster (clears waiver holds;
 *  position limits bypassed, roster size still enforced). */
export const commishMovePlayer = (leagueId: string, slug: string, toRoster: number) =>
  rpc<{ ok: boolean; error?: string }>('commish_move_player', { p_league_id: leagueId, p_slug: slug, p_to_roster: toRoster });
/** Commissioner override: pull a player off his roster — to waivers or straight to FA. */
export const commishRemovePlayer = (leagueId: string, slug: string, waive = true) =>
  rpc<{ ok: boolean; error?: string }>('commish_remove_player', { p_league_id: leagueId, p_slug: slug, p_waive: waive });

/** A tradeable draft pick (0183): season + round + the seat whose slot it is. */
export interface TradePick { season: string; round: number; orig: number; }
export interface TradeRow {
  id: string; from_roster: number; to_roster: number; give: string[]; get: string[];
  give_picks?: TradePick[]; get_picks?: TradePick[];
  status: 'pending' | 'accepted' | 'executed' | 'rejected' | 'cancelled' | 'vetoed';
  note: string | null; created_at: string; resolved_at: string | null;
}
export const leagueTrades = (leagueId: string, limit = 30) =>
  rpc<TradeRow[] | { error: string }>('league_trades', { p_league_id: leagueId, p_limit: limit });
export const proposeTrade = (
  leagueId: string, fromRoster: number, toRoster: number, give: string[], get: string[], note?: string,
  /** season omitted = next season; multi-year futures name theirs (0185). */
  givePicks?: { season?: string; round: number; orig: number }[], getPicks?: { season?: string; round: number; orig: number }[],
) =>
  tracked(rpc<{ ok: boolean; error?: string; trade_id?: string }>('propose_trade', {
    p_league_id: leagueId, p_from_roster: fromRoster, p_to_roster: toRoster,
    p_give: give, p_get: get, p_note: note ?? null,
    p_give_picks: givePicks ?? null, p_get_picks: getPicks ?? null,
  }), Ev.tradeProposed, { players: give.length + get.length, picks: (givePicks?.length ?? 0) + (getPicks?.length ?? 0) });
export const respondTrade = (tradeId: string, accept: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string }>('respond_trade', { p_trade_id: tradeId, p_accept: accept }),
    Ev.tradeResponded, { action: accept ? 'accept' : 'reject' });
export const cancelTrade = (tradeId: string) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string }>('cancel_trade', { p_trade_id: tradeId }),
    Ev.tradeResponded, { action: 'cancel' });
export const commishRuleTrade = (tradeId: string, approve: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string }>('commish_rule_trade', { p_trade_id: tradeId, p_approve: approve }),
    Ev.commishAction, { tool: approve ? 'trade_approve' : 'trade_veto' });

/** A standing trade signal (0140): 'block' = roster_id flags its OWN player as
 *  available; 'want' = roster_id flags ANOTHER team's player as one it would
 *  trade for. League-visible. holder_roster is the player's CURRENT seat —
 *  the server filters out signals whose premise broke (player moved), so every
 *  row returned is live. */
export interface TradeSignalRow {
  kind: 'block' | 'want'; roster_id: number; slug: string;
  holder_roster: number; created_at: string;
}
export const tradeSignals = (leagueId: string) =>
  rpc<TradeSignalRow[] | { error: string }>('trade_signals', { p_league_id: leagueId });
export const setTradeSignal = (leagueId: string, rosterId: number, slug: string, kind: 'block' | 'want', on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; on?: boolean }>('set_trade_signal', {
    p_league_id: leagueId, p_roster_id: rosterId, p_slug: slug, p_kind: kind, p_on: on,
  }), Ev.playerStarred, { on, kind });

// ── Commish kit (0141): the league note + player flags, any league kind ──────
export const leagueNote = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string; text?: string | null; at?: string | null; can_edit?: boolean }>(
    'league_note', { p_league_id: leagueId });
export const setLeagueNote = (leagueId: string, text: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; text?: string | null }>('set_league_note', { p_league_id: leagueId, p_text: text }),
    Ev.commishAction, { tool: 'note', cleared: !text });
/** Raw rule keys as stored (0144) — see docs/flag-rules.md. */
export interface FlagRulesRaw {
  no_trade?: boolean; no_add?: boolean; no_start?: boolean; no_powerups?: boolean; immune?: boolean;
  bonus_mult?: number; bonus_pts?: number;
}
export interface PlayerFlagRow { slug: string; label: string; rules?: FlagRulesRaw; created_at: string; }
export const playerFlags = (leagueId: string) =>
  rpc<PlayerFlagRow[] | { error: string }>('player_flags', { p_league_id: leagueId });
export const setPlayerFlag = (leagueId: string, slug: string, label: string | null, rules: FlagRulesRaw = {}) =>
  tracked(rpc<{ ok: boolean; error?: string; on?: boolean; label?: string }>('set_player_flag', {
    p_league_id: leagueId, p_slug: slug, p_label: label, p_rules: rules,
  }), Ev.commishAction, { tool: label === null ? 'unflag' : 'flag' });
export const setPlayerFlagsBulk = (leagueId: string, slugs: string[], label: string | null, rules: FlagRulesRaw = {}) =>
  tracked(rpc<{ ok: boolean; error?: string; count?: number }>('set_player_flags_bulk', {
    p_league_id: leagueId, p_slugs: slugs, p_label: label, p_rules: rules,
  }), Ev.commishAction, { tool: label === null ? 'unflag_bulk' : 'flags_bulk', n: slugs.length });

// ── Chat (0147, v2 0148): league chat + member DMs, both league-scoped ───────
export interface ChatPoll { options: { text: string; votes: number }[]; total: number; mine: number | null; }
export interface ChatMessage {
  id: number; body: string; at: string; author: string; author_id: string; mine: boolean;
  kind: 'text' | 'poll'; pinned: boolean; mentions_me: boolean; poll?: ChatPoll;
}
export interface DmThreadRow { thread_id: string; peer_id: string; peer: string; last_at: string; preview: string | null; unread: number; }
export interface DmMessage { id: number; body: string; at: string; mine: boolean; }
export const chatPost = (leagueId: string, body: string, mentions: string[] = []) =>
  tracked(rpc<{ ok: boolean; error?: string; id?: number }>('chat_post', { p_league_id: leagueId, p_body: body, p_mentions: mentions }),
    Ev.chatPosted, { kind: looksImage(body) ? 'gif' : 'text', dm: false, mentions: mentions.length });
export const chatPostPoll = (leagueId: string, question: string, options: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; id?: number }>('chat_post_poll', { p_league_id: leagueId, p_question: question, p_options: options }),
    Ev.chatPosted, { kind: 'poll', dm: false, options: options.length });
export const pollCast = (leagueId: string, messageId: number, choice: number) =>
  tracked(rpc<{ ok: boolean; error?: string }>('poll_cast', { p_league_id: leagueId, p_message_id: messageId, p_choice: choice }),
    Ev.pollVoted);
export const chatPin = (leagueId: string, id: number, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string }>('chat_pin', { p_league_id: leagueId, p_id: id, p_on: on }),
    Ev.chatPinned, { on });
/** Latest page (no `before`) marks the channel read and carries the pin strip. */
export const chatMessages = (leagueId: string, before?: number) =>
  rpc<{ ok: boolean; error?: string; messages?: ChatMessage[]; pins?: ChatMessage[] }>('chat_messages', {
    p_league_id: leagueId, p_before: before ?? null, p_limit: 50,
  });
export const chatDelete = (leagueId: string, id: number) =>
  rpc<{ ok: boolean; error?: string }>('chat_delete', { p_league_id: leagueId, p_id: id });
export const dmSend = (leagueId: string, to: string, body: string) =>
  tracked(rpc<{ ok: boolean; error?: string; thread_id?: string; id?: number }>('dm_send', {
    p_league_id: leagueId, p_to: to, p_body: body,
  }), Ev.chatPosted, { kind: looksImage(body) ? 'gif' : 'text', dm: true, mentions: 0 });
// ── League presence (0151): touch on open, commish reads last-seen ──────────
export const leagueTouch = (leagueId: string) =>
  rpc<{ ok: boolean; seen?: boolean }>('league_touch', { p_league_id: leagueId });
export interface LeagueSeenRow { id: string; name: string; last_at: string | null; }
/** "just now" / "35m ago" / "6h ago" / "3d ago" / "never" — the commissioner's
 *  last-seen list speaks in coarse, honest units; the exact timestamp is noise. */
export function seenAgoLabel(lastAt: string | null): string {
  if (!lastAt) return 'never';
  const ms = Date.now() - Date.parse(lastAt);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
export const leagueLastSeen = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; members?: LeagueSeenRow[] }>('league_last_seen', { p_league_id: leagueId });

/** The league's badge counts in one ask (0154): unvoted polls, my waiver
 *  results since I last opened the league, and (commish only) the inbox. */
export const leagueSignals = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; polls_unvoted?: number; waiver_results?: number;
        commish?: { waiting: number; review: number } | null }>('league_signals', { p_league_id: leagueId });

export const dmThreads = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; threads?: DmThreadRow[] }>('dm_threads', { p_league_id: leagueId });
/** Latest page (no `before`) marks the thread read. */
export const dmMessages = (threadId: string, before?: number) =>
  rpc<{ ok: boolean; error?: string; messages?: DmMessage[]; peer?: string }>('dm_messages', {
    p_thread_id: threadId, p_before: before ?? null, p_limit: 50,
  });
/** Badge counts only — never marks anything read. `mention` counts unread messages naming YOU. */
export const chatUnread = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; league?: number; dm?: number; mention?: number }>('chat_unread', { p_league_id: leagueId });
export const chatMembers = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; members?: { id: string; name: string; me: boolean }[] }>('chat_members', { p_league_id: leagueId });

// ── App push notifications (0150): device token registry + per-device mutes ──
export interface PushTokenRow { token: string; platform: string; prefs: Record<string, boolean>; last_seen_at: string; }
export const registerPushToken = (token: string, platform = 'android', prefs?: Record<string, boolean>) =>
  rpc<{ ok: boolean; error?: string }>('register_push_token', { p_token: token, p_platform: platform, p_prefs: prefs ?? null });
export const removePushToken = (token: string) =>
  rpc<{ ok: boolean; removed?: boolean }>('remove_push_token', { p_token: token });
export const setPushPrefs = (token: string, prefs: Record<string, boolean>) =>
  rpc<{ ok: boolean; error?: string; prefs?: Record<string, boolean> }>('set_push_prefs', { p_token: token, p_prefs: prefs });
export const myPushTokens = () => rpc<PushTokenRow[]>('my_push_tokens');

// ── League scoring adjustments (0143): the commissioner's layering knobs ─────
export interface LeagueScoringRow {
  td_bonus: number; yd_mult: number; to_penalty: number; can_edit: boolean;
  /** The 0145 scoped rules, as stored. Raw — feed the whole response to
   *  engine/leagueScoring's parseScoring rather than reading these by hand. */
  scoped?: unknown[];
}
export const leagueScoringGet = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string } & Partial<LeagueScoringRow>>('league_scoring', { p_league_id: leagueId });
export const leagueScoringSet = (leagueId: string, tdBonus: number, ydMult: number, toPenalty: number, scoped: unknown[] = []) =>
  tracked(rpc<{ ok: boolean; error?: string }>('set_league_scoring', {
    p_league_id: leagueId, p_td_bonus: tdBonus, p_yd_mult: ydMult, p_to_penalty: toPenalty, p_scoped: scoped,
  }), Ev.commishAction, { tool: 'scoring', scoped: scoped.length });

// ── Playoffs (0073): the endgame for native leagues ───────────────────────────
export interface StandingsRow { roster_id: number; team: string | null; wins: number; losses: number; ties: number; pf: number; pa: number; }
export interface PlayoffMatchup {
  id: string; week: number; round: number; pos: number; label: string | null; status: string;
  /** Consolation-ladder game (never blocks bracket advancement). */
  consolation: boolean;
  home: number; away: number; home_final: number | null; away_final: number | null; winner: number | null;
}
export interface PlayoffState {
  error?: string; ok?: boolean;
  playoff_teams: number; playoff_start_week: number;
  generated: boolean; underway: boolean;
  rounds: number | null; seeds: number[] | null;
  /** The live consolation ladder, top rung first (final below-the-cut order once the title game ends). */
  consolation: number[];
  champion: number | null; champion_team: string | null;
  matchups: PlayoffMatchup[]; standings: StandingsRow[];
}
/** Everything the playoff view needs (any member). */
export const playoffState = (leagueId: string) => rpc<PlayoffState>('playoff_state', { p_league_id: leagueId });
export const leagueStandings = (leagueId: string) => rpc<StandingsRow[] | { error: string }>('league_standings', { p_league_id: leagueId });
/** Commissioner: bracket size (2/4/6/8) + start week — locked once underway. */
export const setPlayoffRules = (leagueId: string, teams: number | null, startWeek: number | null) =>
  rpc<{ ok: boolean; error?: string }>('set_playoff_rules', { p_league_id: leagueId, p_teams: teams, p_start_week: startWeek });
/** Commissioner: (re)build round 1 — standings seeding, or an explicit seed
 *  order (override). Locked once underway. */
export const generatePlayoffs = (leagueId: string, seeds: number[] | null = null) =>
  rpc<{ ok: boolean; error?: string }>('generate_playoffs', { p_league_id: leagueId, p_seeds: seeds, p_auto: false });
/** The season closes itself (0162): any member's league-load poke — builds
 *  round 1 once the LAST regular-season game is final. Seedless only, never
 *  regenerates an existing bracket; safe to call blindly like advancePlayoffs. */
export const autoGeneratePlayoffs = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; generated?: boolean }>('generate_playoffs', { p_league_id: leagueId, p_seeds: null, p_auto: true });
/** Idempotent: creates the next round when the current one is final; crowns the champ. */
export const advancePlayoffs = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; advanced?: boolean; champion?: number }>('advance_playoffs', { p_league_id: leagueId });
/** Mock draft (0070): a practice room where every other seat is a named AI.
 *  Same settings surface as a real league (snake/auction, live/slow clocks,
 *  parallel lots); no schedule, no season, deletable any time. */
export const createMockDraft = (
  teams: number, rounds: number, pickSeconds: number,
  mode: 'snake' | 'auction' = 'snake', budget = 200, lotSeconds = 15, maxLots = 1,
  posCaps: PosCaps | null = null,
) =>
  rpc<NativeCreateResult>('create_mock_draft', {
    p_teams: teams, p_rounds: rounds, p_pick_seconds: pickSeconds,
    p_mode: mode, p_budget: budget, p_lot_seconds: lotSeconds, p_max_lots: maxLots,
    p_pos_caps: posCaps,
  });
/** Wipe a mock draft (its commissioner or an admin); refuses real leagues. */
export const deleteMockDraft = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string }>('delete_mock_draft', { p_league_id: leagueId });
/** Claim the lowest open seat in a native league by invite code. */
export const nativeJoin = (code: string, teamName?: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string; roster_id?: number; status?: string; league?: string }>(
    'native_join', { p_code: code.trim(), p_team_name: teamName?.trim() || null });
export const setTeamName = (leagueId: string, rosterId: number, name: string) =>
  rpc<{ ok: boolean; error?: string; team_name?: string }>('set_team_name', { p_league_id: leagueId, p_roster_id: rosterId, p_name: name });
/** Seed the draftable player universe (commissioner, pre-draft only). */
/** Admin-only (0171): which extra position groups this league may use
 *  (subset of HC / P / IDP / FB / RET). */
export const setLeaguePositionAccess = (leagueId: string, positions: string[]) =>
  rpc<{ ok: boolean; error?: string; positions?: string[] }>('set_league_position_access', {
    p_league_id: leagueId, p_positions: positions,
  });

/** Commissioner (0171, pre-draft): allowable-player filter for the pool —
 *  team whitelist and/or tenure window. Null/empty clears. */
export const setLeaguePoolFilter = (leagueId: string, filter: { teams?: string[] | null; min_exp?: number | null; max_exp?: number | null } | null) =>
  rpc<{ ok: boolean; error?: string; filter?: unknown }>('set_league_pool_filter', {
    p_league_id: leagueId, p_filter: filter,
  });

export const seedLeaguePool = (leagueId: string, players: { slug: string; full: string; pos: string; team: string; espnId?: string; exp?: number }[]) =>
  rpc<{ ok: boolean; error?: string; players?: number }>('seed_league_pool', {
    p_league_id: leagueId,
    p_players: players.map(({ espnId, exp, ...p }) => ({ ...p, espn_id: espnId ?? null, exp: exp ?? null })),
  });
export const nativeGenerateSchedule = (leagueId: string, weeks = 14) =>
  rpc<{ ok: boolean; error?: string; weeks?: number; matchups?: number }>('native_generate_schedule', { p_league_id: leagueId, p_weeks: weeks });

// ── Dynasty (0182): keepers + season rollover ────────────────────────────────

/** Commissioner: how many players every team keeps into next season (0 clears). */
export const setKeeperCount = (leagueId: string, count: number) =>
  tracked(rpc<{ ok: boolean; error?: string; keeper_count?: number }>('set_keeper_count',
    { p_league_id: leagueId, p_count: count }), 'set_keeper_count');

/** A manager (or commish) declares a roster's keepers. Replace-all semantics. */
export const setKeepers = (leagueId: string, rosterId: number, slugs: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; declared?: number }>('set_keepers',
    { p_league_id: leagueId, p_roster_id: rosterId, p_slugs: slugs }), 'set_keepers');

export interface KeeperTeam {
  roster_id: number; team: string | null; claimed: boolean;
  declared: string[];
  /** What rollover would keep TODAY: declared first, topped up by pool rank. */
  keep: { slug: string; declared: boolean }[];
}
export interface KeeperState {
  ok?: boolean; error?: string;
  /** The league's dynasty identity (0184): stamped at creation or implied by
   *  a live keeper_count / rookie_rounds setting. */
  dynasty?: boolean;
  /** The continuity axis (0185): redraft / keeper / dynasty. */
  continuity?: LeagueContinuity;
  rookie_rounds?: number;
  /** The Super Bowl gate (0185): the rollover is an option that appears when
   *  the season is over (Feb 15 after the season year). */
  season_over?: boolean;
  /** The caller is a super admin — may roll before the gate, for testing. */
  admin?: boolean;
  keeper_count: number; roster_size: number; draft_status: string;
  season: string; next_season: string | null;
  game_mode: 'drip' | 'classic';
  /** Non-null ⇒ this season already rolled over, into that league. */
  rolled_league_id: string | null;
  my_roster_id: number | null;
  teams: KeeperTeam[];
}
export const keeperState = (leagueId: string) =>
  rpc<KeeperState>('keeper_state', { p_league_id: leagueId });

/** Commissioner (0185): the continuity selector — redraft clears everything,
 *  keeper takes the keeper count, dynasty takes the rookie-round count and
 *  deals three seasons of tradeable pick assets. Lives in 🎮 MODE & SEASON. */
export const setLeagueContinuity = (leagueId: string, mode: LeagueContinuity, n?: number | null) =>
  tracked(rpc<{ ok: boolean; error?: string; continuity?: LeagueContinuity; keeper_count?: number; rookie_rounds?: number; seasons?: string[] }>(
    'set_league_continuity', { p_league_id: leagueId, p_mode: mode, p_n: n ?? null }), 'set_league_continuity');

/** Commissioner (0183): how many rounds next season's rookie draft runs.
 *  Provisions one tradeable pick asset per seat per round; 0 clears. Growing
 *  adds rounds, shrinking refuses to delete rounds holding a traded pick. */
export const setRookieRounds = (leagueId: string, rounds: number) =>
  tracked(rpc<{ ok: boolean; error?: string; rookie_rounds?: number; season?: string; created?: number; removed?: number }>(
    'set_rookie_rounds', { p_league_id: leagueId, p_rounds: rounds }), 'set_rookie_rounds');

export interface PickAssetRow { season: string; round: number; orig: number; owner: number; }
export interface PickAssets {
  ok?: boolean; error?: string;
  rookie_rounds: number;
  /** The season whose picks are tradeable right now (league season + 1). */
  future_season: string | null;
  picks: PickAssetRow[];
}
export const pickAssets = (leagueId: string) =>
  rpc<PickAssets>('pick_assets', { p_league_id: leagueId });

/** Commissioner, post-season: clone the league into season+1 — same settings
 *  and seats, keepers carried onto the new rosters, a fresh pending draft
 *  (rounds − keepers picks) and a generated schedule. Wallets start fresh.
 *  rookieOnly (dynasty phase 2) carries only the keepers into the new pool and
 *  pins pool_filter to rookies-only, so the pre-draft reseed builds a rookie
 *  draft. The response NAMES the game mode it carried (v0.251.0 rule). */
export const rolloverLeague = (leagueId: string, weeks = 14, rookieOnly = false) =>
  tracked(rpc<{
    ok: boolean; error?: string; league_id?: string; season?: string;
    game_mode?: 'drip' | 'classic'; keeper_slots?: number; kept?: number;
    draft_rounds?: number; roster_size?: number; rookie_only?: boolean;
    picks_carried?: number; invite_code?: string;
  }>('rollover_league', { p_league_id: leagueId, p_weeks: weeks, p_rookie_only: rookieOnly }), 'rollover_league');

export const startDraft = (leagueId: string, order?: number[]) =>
  rpc<{ ok: boolean; error?: string; order?: number[] }>('start_draft', { p_league_id: leagueId, p_order: order ?? null });
export interface DraftPickRow { overall: number; round: number; roster_id: number; slug: string; auto: boolean; price?: number | null; }
export interface DraftState {
  error?: string; status: 'pending' | 'live' | 'complete'; mode: 'snake' | 'auction'; rounds: number; pick_seconds: number;
  paused: boolean;
  order: number[] | null; current_overall: number;
  /** Snake: the seat on the clock. Auction: the seat whose turn it is to nominate. */
  on_clock: number | null;
  /** True ⇒ the on-clock seat is vacant/AI/autodraft — a draft_tick will act now. */
  on_clock_auto: boolean | null;
  deadline_at: string | null; server_now: string; picks: DraftPickRow[];
  budget: number | null;
  lot_seconds: number;
  /** Auction: up to max_lots lots run in parallel. my_proxy/my_max are the
   *  caller's own hidden max + highest legal bid on THAT lot. */
  max_lots: number;
  lots: { id: string; slug: string; bid: number; roster_id: number; deadline_at: string; my_proxy: number | null; my_max: number | null }[];
  /** Armed scheduled start (0177), ISO — the worker opens the draft then.
   *  Null means a manual start. Kept after the draft goes live, so the room
   *  can still say what it was scheduled for. */
  start_at?: string | null;
  /** Overnight quiet hours (minutes since midnight ET); clocks skip them. */
  night: { start_min: number; end_min: number; is_night: boolean } | null;
  budgets: { roster_id: number; budget: number; committed: number; spots_left: number; max_bid: number }[] | null;
  my_autodraft: boolean;
  /** Practice room vs the AI — no schedule/season behind it, deletable. */
  is_mock?: boolean;
  /** Per-position roster limits (null value = uncapped). */
  pos_caps?: PosCaps;
  /** Dynasty (0182): `rounds` is the rounds actually DRAFTED. keeper_slots
   *  roster spots arrived pre-filled; roster_size = rounds + keeper_slots. */
  keeper_slots?: number;
  roster_size?: number;
}
export const draftState = (leagueId: string) => rpc<DraftState>('draft_state', { p_league_id: leagueId });
/** Replace a seat's private draft queue with an ordered slug list. */
export const setDraftQueue = (leagueId: string, rosterId: number, slugs: string[]) =>
  rpc<{ ok: boolean; error?: string; queued?: number }>('set_draft_queue', { p_league_id: leagueId, p_roster_id: rosterId, p_slugs: slugs });
/** The caller's own queue (RLS hides everyone else's). */
export async function myDraftQueue(leagueId: string, rosterId: number): Promise<string[]> {
  const { data, error } = await (await client()).from('draft_queue')
    .select('slug, pos').eq('league_id', leagueId).eq('roster_id', rosterId).order('pos');
  if (error) throw error;
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
}
export const setAutodraft = (leagueId: string, rosterId: number, on: boolean) =>
  rpc<{ ok: boolean; error?: string; autodraft?: boolean }>('set_autodraft', { p_league_id: leagueId, p_roster_id: rosterId, p_on: on });
/** Commissioner sets/clears the draft's overnight quiet hours (0153). Both
 *  null clears; minutes since midnight ET. A live draft's running clocks are
 *  re-based server-side so a fresh pause can't be beaten by an old deadline. */
/** Commissioner: change the draft's shape while it's still PENDING (0176).
 *  Nulls mean "unchanged", so one control can move without restating the rest.
 *  Everything here freezes the moment the draft starts — the same rule the
 *  game mode, lineup spec and roster rules already follow. */
export const setDraftSetup = (
  leagueId: string,
  pickSeconds: number | null = null,
  mode: 'snake' | 'auction' | null = null,
  budget: number | null = null,
  lotSeconds: number | null = null,
  maxLots: number | null = null,
) =>
  tracked(rpc<{ ok: boolean; error?: string; pick_seconds?: number; mode?: 'snake' | 'auction';
                budget?: number; lot_seconds?: number; max_lots?: number }>(
    'set_draft_setup', {
      p_league_id: leagueId, p_pick_seconds: pickSeconds, p_mode: mode,
      p_budget: budget, p_lot_seconds: lotSeconds, p_max_lots: maxLots,
    }), Ev.commishAction, { tool: 'draft_setup' });

/** Commissioner: arm a scheduled start (0177). `at` is an ISO timestamp; null
 *  disarms and goes back to a manual start. The worker's native sweep opens the
 *  draft when the time comes — deliberately NOT a client poll, which would
 *  start the draft whenever somebody next happened to look rather than at the
 *  time the league was told. Refused in the past and beyond a year out. */
export const setDraftStart = (leagueId: string, at: string | null = null) =>
  tracked(rpc<{ ok: boolean; error?: string; start_at?: string | null }>(
    'set_draft_start', { p_league_id: leagueId, p_at: at }),
    Ev.commishAction, { tool: 'draft_start', armed: at != null });

/** Commissioner: set the draft order BEFORE the draft starts (0176). `order`
 *  null shuffles now — visibly, which is the point of drawing it early. The
 *  order is rechecked against the current seats at start, so a team added
 *  afterwards can't be dropped by a stale list. */
export const setDraftOrder = (leagueId: string, order: number[] | null = null) =>
  tracked(rpc<{ ok: boolean; error?: string; order?: number[] }>(
    'set_draft_order', { p_league_id: leagueId, p_order: order }),
    Ev.commishAction, { tool: 'draft_order', random: order == null });

export const setDraftNight = (leagueId: string, startMin: number | null = null, endMin: number | null = null) =>
  tracked(rpc<{ ok: boolean; error?: string; start_min?: number | null; end_min?: number | null }>('set_draft_night', {
    p_league_id: leagueId, p_start_min: startMin, p_end_min: endMin,
  }), Ev.commishAction, { tool: 'draft_night', on: startMin != null });

export const commishPauseDraft = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string }>('commish_pause_draft', { p_league_id: leagueId });
export const commishResumeDraft = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string }>('commish_resume_draft', { p_league_id: leagueId });
/** Force the on-clock pick through: a chosen slug, or queue/best-available. */
export const commishForcePick = (leagueId: string, slug?: string) =>
  rpc<{ ok: boolean; error?: string }>('commish_force_pick', { p_league_id: leagueId, p_slug: slug ?? null });
export const commishUndoPick = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; undone_overall?: number; slug?: string }>('commish_undo_pick', { p_league_id: leagueId });
/** Auction: open a lot (the nominating seat, or the commissioner on its behalf). */
export const nominate = (leagueId: string, slug: string, bid = 1) =>
  rpc<{ ok: boolean; error?: string; lot?: string; bid?: number }>('nominate', { p_league_id: leagueId, p_slug: slug, p_bid: bid });
export const placeBid = (leagueId: string, rosterId: number, amount: number, lotId?: string) =>
  rpc<{ ok: boolean; error?: string; bid?: number; roster_id?: number; outbid?: boolean }>('place_bid', { p_league_id: leagueId, p_roster_id: rosterId, p_amount: amount, p_lot_id: lotId ?? null });
/** Hidden max bid on a lot (proxy — the fair way to win a slow auction while
 *  asleep). Null clears it. Resolves second-price immediately. */
export const setLotProxy = (leagueId: string, rosterId: number, max: number | null, lotId?: string) =>
  rpc<{ ok: boolean; error?: string; max?: number | null }>('set_lot_proxy', { p_league_id: leagueId, p_roster_id: rosterId, p_max: max, p_lot_id: lotId ?? null });
export const makeDraftPick = (leagueId: string, slug: string) =>
  tracked(rpc<{ ok: boolean; error?: string; overall?: number; roster_id?: number; slug?: string; complete?: boolean }>(
    'make_draft_pick', { p_league_id: leagueId, p_slug: slug }), Ev.draftPicked);
/** Advance the draft: snake autopicks (queue → best available) and auction lot
 *  awards + auto-nominations. Idempotent — any member's poll may call it. */
export const draftTick = (leagueId: string) => rpc<{ ok: boolean; error?: string; autopicks?: number; lots_awarded?: number }>('draft_tick', { p_league_id: leagueId });

export interface LeaguePoolPlayer { slug: string; full_name: string; pos: string; team: string; rank: number; waived_until: string | null; espn_id?: string | null; }
export async function leaguePool(leagueId: string): Promise<LeaguePoolPlayer[]> {
  const { data, error } = await (await client()).from('league_pool')
    .select('slug, full_name, pos, team, rank, waived_until, espn_id')
    .eq('league_id', leagueId).order('rank').range(0, 1999);
  if (error) throw error;
  return (data ?? []) as LeaguePoolPlayer[];
}
/** Tenure by slug from the league's pool (0172) — per-slot filter checks at
 *  lineup time read this. Null exp = unknown (pre-0172 seed, or Sleeper doesn't
 *  know); tenure-filtered spots refuse unknowns, so a re-seed fills them in. */
export async function leaguePoolExp(leagueId: string): Promise<Record<string, number>> {
  const { data, error } = await (await client()).from('league_pool')
    .select('slug, exp').eq('league_id', leagueId).not('exp', 'is', null).range(0, 1999);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { slug: string; exp: number }[]) out[r.slug] = r.exp;
  return out;
}

export interface NativeRosterRow { roster_id: number; slug: string; acquired: string; spot?: 'active' | 'taxi' | 'ir'; }
export async function nativeRosters(leagueId: string): Promise<NativeRosterRow[]> {
  const { data, error } = await (await client()).from('native_roster')
    .select('roster_id, slug, acquired, spot').eq('league_id', leagueId).range(0, 1999);
  if (error) throw error;
  return (data ?? []) as NativeRosterRow[];
}

export const dropPlayer = (leagueId: string, rosterId: number, slug: string) =>
  rpc<{ ok: boolean; error?: string }>('drop_player', { p_league_id: leagueId, p_roster_id: rosterId, p_slug: slug });
export const addFreeAgent = (leagueId: string, rosterId: number, addSlug: string, dropSlug?: string) =>
  tracked(rpc<{ ok: boolean; error?: string }>('add_free_agent', { p_league_id: leagueId, p_roster_id: rosterId, p_add_slug: addSlug, p_drop_slug: dropSlug ?? null }),
    Ev.waiverClaimed, { type: 'fa', drop: !!dropSlug });
export const submitWaiverClaim = (leagueId: string, rosterId: number, addSlug: string, dropSlug?: string, bid = 0) =>
  tracked(rpc<{ ok: boolean; error?: string; claim_id?: string; clears_at?: string; bid?: number }>('submit_waiver_claim', { p_league_id: leagueId, p_roster_id: rosterId, p_add_slug: addSlug, p_drop_slug: dropSlug ?? null, p_bid: bid }),
    Ev.waiverClaimed, { type: 'waiver', drop: !!dropSlug, bid });
export const cancelWaiverClaim = (claimId: string) =>
  rpc<{ ok: boolean; error?: string }>('cancel_waiver_claim', { p_claim_id: claimId });
/** Resolve every due claim in waiver-priority order. Idempotent — safe to call on load. */
export const processWaivers = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; won?: number; lost?: number }>('process_waivers', { p_league_id: leagueId });
export interface WaiverClaimRow { id: string; add_slug: string; drop_slug: string | null; status: string; note: string | null; created_at: string; bid?: number; }
export interface NativeTeamState {
  error?: string; my_roster_id: number | null; draft_status: string; roster_cap: number | null; server_now: string;
  /** Per-position roster limits (null value = uncapped). */
  pos_caps?: PosCaps;
  /** Waiver system: rolling priority (default) or FAAB blind bids. */
  waiver_mode?: WaiverMode;
  trade_review?: TradeReview;
  /** My remaining FAAB budget (FAAB leagues only). */
  my_faab?: number | null;
  /** Why my roster is illegal (over size / position limits) — locked out of
   *  FA, waivers, and weekly picks until null. */
  roster_issue?: string | null;
  /** Is free agency open right now (commish-set daily window)? */
  fa_open?: boolean;
  fa_start_min?: number | null; fa_end_min?: number | null;
  /** Daily ET waiver clear time (minutes since midnight; null = rolling 24h). */
  waiver_clear_min?: number | null; waiver_hold_days?: number;
  my_team?: string | null; my_avatar?: string | null; league_avatar?: string | null; is_commish?: boolean;
  waiver_order: { roster_id: number; team: string | null; priority: number | null; avatar?: string | null; faab?: number | null }[];
  my_claims: WaiverClaimRow[];
}
export const nativeTeamState = (leagueId: string) => rpc<NativeTeamState>('native_team_state', { p_league_id: leagueId });
/** Pick your own team's avatar (manager, commish or admin); null clears it. */
export const setTeamAvatar = (leagueId: string, rosterId: number, url: string | null) =>
  rpc<{ ok: boolean; error?: string; avatar?: string | null }>('set_team_avatar', { p_league_id: leagueId, p_roster_id: rosterId, p_url: url });
/** Rename the league (commissioner/admin, 0187). Trimmed and inner-whitespace
 *  collapsed server-side; 2–60 characters. Answers with the STORED name, so a
 *  caller renders what the server kept rather than what it sent. */
export const setLeagueName = (leagueId: string, name: string) =>
  tracked(rpc<{ ok: boolean; error?: string; name?: string }>('set_league_name',
    { p_league_id: leagueId, p_name: name }),
    Ev.commishAction, { tool: 'league_name' });
/** Pick the league's crest (commissioner/admin); null clears it. */
export const setLeagueAvatar = (leagueId: string, url: string | null) =>
  rpc<{ ok: boolean; error?: string; avatar?: string | null }>('set_league_avatar', { p_league_id: leagueId, p_url: url });

// ── The league board (0123): post a league that needs managers, browse, join ──
export interface BoardListing {
  league_id: string; name: string; season: string; avatar_url: string | null;
  blurb: string; posted_at: string;
  seats_total: number; seats_open: number;
  draft_status: string; draft_mode: string;
  /** The caller is already enrolled here / commissions it. */
  mine: boolean; commish: boolean;
}
/** Open listings with at least one claimable seat, newest first. Never carries
 *  invite codes — joining goes through joinFromBoard, which resolves the code
 *  server-side. */
export async function leagueBoard(): Promise<BoardListing[]> {
  const r = await rpc<BoardListing[] | { error?: string }>('league_board');
  if (!Array.isArray(r)) throw new Error(r?.error ?? 'could not load the board');
  return r;
}
/** Post (or re-open / edit) the caller's league. Null blurb keeps the old one. */
export const postLeagueListing = (leagueId: string, blurb?: string | null) =>
  rpc<{ ok: boolean; error?: string }>('post_league_listing', { p_league_id: leagueId, p_blurb: blurb ?? null });
export const closeLeagueListing = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string }>('close_league_listing', { p_league_id: leagueId });
/** Claim a seat in a posted league — native_join's seat rules, authorized by
 *  the open listing instead of a typed code. */
/** Look before you join (0156): the full shape of a LISTED league — seats,
 *  draft, rules, scoring, the seat map (team names + taken, no identities). */
export interface BoardPreview {
  ok: boolean; error?: string;
  name?: string; season?: string; avatar_url?: string | null; blurb?: string | null;
  game_mode?: 'drip' | 'classic'; ppr?: number; bestball?: string[]; roster?: Record<string, number>;
  seats_total?: number; seats_open?: number;
  draft?: { status: string; mode: string; rounds: number; pick_seconds: number;
            budget?: number | null; night?: { start_min: number; end_min: number } | null } | null;
  rules?: { waiver_mode: string; faab_budget?: number | null; trade_review: string;
            pos_caps?: Record<string, number> | null; live_buffs: boolean };
  scoring?: { td_bonus: number; yd_mult: number; to_penalty: number } | null;
  teams?: { roster_id: number; team_name: string; taken: boolean }[];
}
export const leaguePreview = (leagueId: string) =>
  rpc<BoardPreview>('league_preview', { p_league_id: leagueId });

export const joinFromBoard = (leagueId: string, teamName?: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string; roster_id?: number; league?: string }>(
    'join_from_board', { p_league_id: leagueId, p_team_name: teamName ?? null });
/** The invite code, for any enrolled member — so recruiting a friend doesn't
 *  need the commissioner's screen. */
export const leagueInvite = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; invite_code?: string; name?: string; seats_open?: number }>(
    'league_invite', { p_league_id: leagueId });
/** The listing's true state, commish/admin only (0124). league_board() hides
 *  full leagues, so it cannot answer "is my league public?" — this can. */
export const leagueListingState = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; listed?: boolean; blurb?: string; seats_open?: number }>(
    'league_listing_state', { p_league_id: leagueId });

// ── Co-managers + the waiting room (0125) ─────────────────────────────────────
/** Attach/detach a co-manager on a seat: by email (must be an account) or
 *  app_user_id (straight from the waitlist, which the attach clears). */
export const commishSetManager = (leagueId: string, rosterId: number, opts: { email?: string; appUserId?: string; remove?: boolean }) =>
  rpc<{ ok: boolean; error?: string; removed?: boolean }>('commish_set_manager', {
    p_league_id: leagueId, p_roster_id: rosterId,
    p_email: opts.email ?? null, p_app_user_id: opts.appUserId ?? null, p_remove: opts.remove ?? false,
  });
export interface TeamManagerRow { roster_id: number; app_user_id: string; email: string | null; }
export async function teamManagers(leagueId: string): Promise<TeamManagerRow[]> {
  const r = await rpc<TeamManagerRow[] | { error?: string }>('team_managers', { p_league_id: leagueId });
  if (!Array.isArray(r)) throw new Error((r as { error?: string })?.error ?? 'could not load managers');
  return r;
}
export interface WaitlistRow { league_id: string; name: string; season: string; avatar_url: string | null; joined_at: string; }
/** Leagues the caller has joined but holds no seat in yet — full-league joins
 *  land here (native_join v3) until the commissioner deals them in. */
export async function myWaitlist(): Promise<WaitlistRow[]> {
  const r = await rpc<WaitlistRow[] | { error?: string }>('my_waitlist');
  return Array.isArray(r) ? r : [];
}
/** my_waitlist() for an arbitrary user — the browse-as twin (0149). */
export async function adminUserWaitlist(appUserId: string): Promise<WaitlistRow[]> {
  const r = await rpc<WaitlistRow[] | { error?: string }>('admin_user_waitlist', { p_app_user_id: appUserId });
  return Array.isArray(r) ? r : [];
}

/** Subscribe to live score changes for a matchup. Returns an unsubscribe fn. */
export function subscribeMatchup(matchupId: string, onChange: () => void): () => void {
  // Lazy SDK: open the channel once the client lands; tear down cleanly if the
  // caller unsubscribed before it did.
  let cleanup: (() => void) | null = null;
  let dead = false;
  getSupabase().then((c) => {
    if (!c || dead) return;
    const ch = c.channel(`mw-${matchupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchup_state', filter: `matchup_id=eq.${matchupId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matchup', filter: `id=eq.${matchupId}` }, onChange)
      .subscribe();
    cleanup = () => { c.removeChannel(ch); };
    if (dead) cleanup();
  }).catch(() => {});
  return () => { dead = true; cleanup?.(); };
}

// ── The Window Pot (migration 0117 · docs/window-pot.md) ─────────────────────
// An OPT-IN wager ladder on a game window: one manager puts ◎10 up, the other
// matches it, and they trade check / wager / call / raise until that window's
// PICKS lock. Everything here is a no-op for a league with `pot_ante = 0` (the
// shipping default): pot_state comes back `{ off: true }` and the UI renders
// nothing at all.

export type PotWindowState =
  | 'offered'      // one ◎10 down, waiting on the other side
  | 'live'         // both in; the ladder is open
  | 'locked'       // picks locked; frozen, riding to the window's final
  | 'void'         // nobody matched the offer; the ante went home
  | 'folded_you' | 'folded_them'
  | 'settled' | 'split';
export type PotActionKind =
  'ante' | 'match' | 'check' | 'wager' | 'call' | 'fold' | 'settle' | 'refund' | 'void';

/** One window's pot, already oriented to the CALLER by the RPC — `you_in` is
 *  always your own committed coin, never the home team's. */
export interface PotWindow {
  win: string;
  state: PotWindowState;
  /** Who put the first ◎10 up. They also get first action once it's matched. */
  leader: 'you' | 'them';
  /** Whose move it is. Null unless the pot is live. */
  turn: 'you' | 'them' | null;
  /** The outstanding wager the turn-holder must answer. 0 ⇒ they may check or open. */
  owed: number;
  /** Everything both sides have committed. */
  pot: number;
  you_in: number;
  them_in: number;
  /** The entry fee alone — the ONLY thing backing out forfeits. */
  you_ante: number;
  them_ante: number;
  /** What the wager slider maxes at — table stakes. 0 ⇒ nothing offerable. */
  effective_stack: number;
  /** When betting closes: the instant this window's picks lock (kickoff − 1h). */
  lock_at: string | null;
  winner: 'you' | 'them' | 'split' | null;
  settled_at: string | null;
  log: { seq: number; kind: PotActionKind; amount: number; at: string; side: 'you' | 'them' | null }[];
}
export interface PotState {
  ok: boolean;
  error?: string;
  /** True ⇒ this league has pots disabled (`pot_ante = 0`). Render nothing. */
  off: boolean;
  ante: number;
  cap: number;
  side_cap: number;
  min_wager: number;
  my_side: 'home' | 'away';
  my_roster_id: number;
  my_bank: number;
  /** False ⇒ the other seat is AI/unenrolled, so nobody could answer an offer. */
  both_live: boolean;
  server_now: string;
  /** Only windows somebody actually anted on. The client offers the ◎10 on the
   *  rest from the slate it already has. */
  windows: PotWindow[];
}
export const potState = (matchupId: string) => rpc<PotState>('pot_state', { p_matchup_id: matchupId });
/** Advance this matchup's pots (void unmatched offers and freeze live ladders at
 *  picks lock, settle finished windows). Idempotent and advisory-locked — any
 *  participant's poll may call it, exactly like draft_tick; the worker sweeps
 *  every league on its own tick too. */
export const potSweep = (matchupId: string) =>
  rpc<{ ok: boolean; error?: string; voided?: number; frozen?: number; settled?: number }>(
    'pot_sweep', { p_matchup_id: matchupId });
export interface PotActionResult {
  ok: boolean; error?: string;
  /** pot_ante: which half of the handshake this was. */
  led?: boolean; matched?: boolean; ante?: number; state?: string;
  checked?: boolean; wagered?: number; called?: number; pot?: number;
  /** pot_close: how it ended. */
  cause?: string; winner?: string; home_paid?: number; away_paid?: number;
  effective_stack?: number;
}
/** Put the ◎10 up: leads the offer on an untouched window, or matches the offer
 *  already sitting there (which is what makes the pot real). */
export const potAnte = (matchupId: string, win: string) =>
  rpc<PotActionResult>('pot_ante', { p_matchup_id: matchupId, p_win: win });
/** Take your turn. 'raise' is call + open, and is all-or-nothing: an illegal
 *  open rolls the call back with it. 'fold' backs out for exactly your ante. */
export const potAct = (matchupId: string, win: string, action: 'check' | 'wager' | 'call' | 'raise' | 'fold', amount?: number) =>
  rpc<PotActionResult>('pot_act', { p_matchup_id: matchupId, p_win: win, p_action: action, p_amount: amount ?? null });

/** Super admin: turn the Window Pot on or off for ONE league, and tune its two
 *  numbers. Turning it off stops new play but deliberately leaves pots already
 *  under way to close and settle themselves — `open_pots` reports how many that
 *  is. Omit the numbers to keep/restore the defaults. */
export const adminSetPot = (leagueId: string, on: boolean, ante?: number, cap?: number) =>
  rpc<{ ok: boolean; error?: string; on?: boolean; pot_ante?: number; pot_cap?: number; open_pots?: number }>(
    'admin_set_pot', { p_league_id: leagueId, p_on: on, p_ante: ante ?? null, p_cap: cap ?? null });
/** Super admin: unwind a league's pots on the spot — every offer, ladder and
 *  frozen pot is voided and every chip goes back to whoever put it in. */
export const adminClosePots = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; closed?: number }>('admin_close_pots', { p_league_id: leagueId });
