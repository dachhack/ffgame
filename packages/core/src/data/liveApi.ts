// Live-pilot client API: magic-link auth + invite-code redemption, on top of the
// Supabase client. All table access is RLS-guarded; enrollment goes through the
// redeem_invite RPC (migration 0002), never a direct membership write.
import { getSupabase } from './supabaseClient';
import { platform, storeGet } from '../platform';
import { track, Ev, type Props } from '../analytics';
import { readPool, type PoolGroup } from './poolEntry';
import { setLiveInjuries, type InjuryRow } from './injuries';
import { setTeamOverrides } from './playerTeam';
import { setDepthChart } from './playerDepth';
import { resolveUser } from './sleeper';
import { supabaseUrl } from './liveConfig';
import { isChatImageUrl } from './chatImage';
import { PRESEASON_BOARD_WEEKS, PRESEASON_BASE } from './nflSlate';
import { assignSealedRows } from '../engine/seatPicks';
import type { Session } from '@supabase/supabase-js';
import { openWeekFrom, DEFAULT_TURNOVER, type WeekTurnover } from './openWeek';
import type { WaiverRunReport } from './txnChat';

// ── Analytics at the chokepoint (0186) ───────────────────────────────────────
// The write RPCs both hosts share fire their product event HERE, on the
// server's yes — one seam instead of two UIs, and a failed write never
// counts. UI-context events (screens, tiles, sheets) stay host-side.
const tracked = <T,>(p: Promise<T>, event: string, props?: Props): Promise<T> =>
  p.then((r) => { if ((r as { ok?: boolean } | null)?.ok) track(event, props); return r; });
/** GIF-vs-text for chat_posted: a whole-URL body that renders inline. */
const looksImage = (s: string): boolean =>
  /^https?:\/\/\S+$/.test(s.trim()) && (/(tenor|giphy|imgur)\.com\//i.test(s) || /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(s));
/** What a message body IS, for analytics. An upload (0349) counts apart from a
 *  GIF: they are one message shape to the database and two different features
 *  to the question "is anybody posting pictures?". */
const postKind = (body: string): 'image' | 'gif' | 'text' =>
  isChatImageUrl(body) ? 'image' : looksImage(body) ? 'gif' : 'text';

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
  // A trade offer expiring is not a magic link expiring (v0.456.0): the
  // auth rule below matched every server line with "expired" in it and told
  // a manager accepting a lapsed offer to request a fresh sign-in link.
  if (m.includes('offer expired') || m.includes('trade already expired')) return raw;
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
  // 0208's closed waiting room. Matched on the WHOLE phrase, not on 'full':
  // 'roster full — drop someone' and 'lineup is full — 8 slots max' are
  // different messages about different things and must keep their own words.
  if (m.includes('league is full'))
    return 'That league is full and isn’t taking a waiting list. Ask whoever sent you the link whether another seat is opening.';
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

export interface LeaguePreview {
  league_id: string; name: string; season: string; provider?: string;
  avatar_url?: string | null; game_mode?: string | null;
  /** Unclaimed seats (0208). 0 = the league is full. */
  seats_open?: number | null;
  /** Whether a full league still takes waiters (0208). False = "League Full". */
  waitlist_open?: boolean | null;
}

/** Preview a league by invite code (so we can show "You're joining <name>").
 *
 *  CALLABLE SIGNED OUT since 0206 — that grant is the feature. The moment this
 *  answer is wanted is the moment before there is an authenticated anybody, and
 *  for four years it was granted to `authenticated` only, so the join screen
 *  could only say "Join your league." in the abstract to someone who had just
 *  been handed a link and had no way to tell which league it was for. */
export async function previewLeague(code: string): Promise<LeaguePreview | null> {
  const { data, error } = await (await client()).rpc('league_by_invite', { code: code.trim() });
  if (error) throw error;
  return (data && data[0]) || null;
}

/** THE INVITE LANDING (0274) — the whole league, to someone holding the code.
 *
 *  `previewLeague` above identifies the league; this one DESCRIBES it: the
 *  rules, the lineup, the draft, the seats and the team names. Callable signed
 *  out, and — unlike `league_preview` — it does not require the league to have
 *  listed itself publicly, because a private league is exactly the kind whose
 *  invite gets sent. The code is the credential. */
export interface InviteLeaguePreview {
  ok: boolean; error?: string;
  league_id?: string; name?: string; season?: string; provider?: string | null;
  avatar_url?: string | null; game_mode?: string | null;
  /** standard | guillotine | vampire. */
  format?: string | null;
  /** redraft | keeper | dynasty | contract | contract_dynasty. */
  continuity?: string | null;
  ppr?: number | null;
  bestball?: string[] | null;
  /** The classic lineup as a spot→count map ({ QB: 1, RB: 2, … }). */
  roster?: Record<string, number> | null;
  dues?: string | null;
  blurb?: string | null;
  seats_total?: number | null;
  seats_open?: number | null;
  draft?: { status?: string; mode?: string; rounds?: number; pick_seconds?: number; budget?: number | null } | null;
  rules?: {
    waiver_mode?: string; faab_budget?: number | null; trade_review?: string;
    pos_caps?: Record<string, number> | null; live_buffs?: boolean;
  } | null;
  contract_rules?: { salary_cap?: number | null; years_max?: number | null } | null;
  scoring?: Record<string, unknown> | null;
  /** Seat, team name, and whether somebody is sitting in it. No owners. */
  teams?: { roster_id: number; team_name: string | null; taken: boolean }[] | null;
}
export const invitePreview = (code: string) =>
  rpc<InviteLeaguePreview>('invite_preview', { p_code: code.trim() });

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

/** Load the worker-published depth chart (0293) into the playerDepth cache.
 *  A few hundred rows. Never throws — without it the projected sheet falls
 *  back to projection order, which is what it did before the chart existed. */
export async function loadDepthChart(): Promise<number> {
  try {
    const { data, error } = await (await client()).from('player_depth').select('slug, team, pos, depth');
    if (error) return 0;
    const rows = (data ?? []) as { slug: string; team: string; pos: string; depth: number }[];
    setDepthChart(rows);
    return rows.length;
  } catch { return 0; }
}

export async function loadLiveInjuries(week: number): Promise<number> {
  try {
    // PAGED (v0.489.4), for the same reason the pool loaders are: PostgREST
    // answers any select with at most 1000 rows, silently. This table had no
    // prune until 0489, so it accumulated every designation the worker had ever
    // seen — comfortably past a thousand — and a truncated read does not look
    // truncated. It looks like the players past the cap are healthy, on every
    // card that asks. The prune keeps it small now; paging means a poll that
    // cannot prune does not quietly take the report back down to 1000 rows.
    const c = await client();
    const data = await allRows<InjuryStatusRow>((from, to) => c.from('injury_status')
      .select('player_slug, status, return_date, comment, team, updated_at')
      .order('player_slug').range(from, to));
    const rows: Record<string, InjuryRow> = {};
    for (const r of data) {
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

/** The live injury report as a plain slug → designation map (0198), for the
 *  ROSTER screens' IR gate. Deliberately not the module cache above: that cache
 *  is keyed to one WEEK because a board only ever asks about the week it is
 *  showing, and a roster screen isn't showing a week at all — it is asking
 *  "what is this player's designation right now", which is the only thing the
 *  ESPN feed can answer anyway. Reading it separately also means opening a
 *  roster can never clobber the week a live board has installed. */
export async function injuryTags(): Promise<Record<string, 'O' | 'D' | 'Q' | 'IR'>> {
  try {
    const c = await client();
    const data = await allRows<{ player_slug: string; status: string }>((from, to) =>
      c.from('injury_status').select('player_slug, status').order('player_slug').range(from, to));
    const out: Record<string, 'O' | 'D' | 'Q' | 'IR'> = {};
    for (const r of data) {
      if (r.status === 'O' || r.status === 'D' || r.status === 'Q' || r.status === 'IR') out[r.player_slug] = r.status;
    }
    return out;
  } catch { return {}; }
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
  /** 0239: on YOUR shelf — the leagues list folds it into ARCHIVED. */
  archived?: boolean;
  league: {
    name: string; season: string; preseason_at?: string | null; provider?: string; avatar_url?: string | null;
    is_mock?: boolean; kind?: string; contest_week?: number | null; dynasty?: boolean; continuity?: LeagueContinuity;
    /** 0240: where this league's draft stands. NULL/absent means there is no
     *  draft of ours at all — an imported league drafted on its own platform —
     *  which is NOT the same as 'pending'. */
    draft_status?: DraftStatus | null;
    /** 0240: seats in the league, for the card's built type line. */
    rosters?: number;
    /** 0242: WHICH GAME this league plays, for the same line. Native leagues
     *  only — an imported one plays its platform's game, not ours. */
    game_mode?: 'drip' | 'classic';
    format?: LeagueFormat;
    golf?: boolean;
  } | null;
}

/** Every seat the caller can act for — owned AND co-managed (0125's my_teams).
 *  Was a direct league_membership select, which by construction could never
 *  show a co-managed seat: RLS scopes that table to your own rows, and a
 *  co-manager's whole point is acting on somebody else's. The userId param
 *  survives for signature compatibility; the server answers for auth.uid(). */
/** Shelve (or unshelve) a league for the CALLER alone (0239) — the seat,
 *  the history and everyone else's view of the league are untouched. */
export const setLeagueArchived = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; archived?: boolean }>('set_league_archived', { p_league_id: leagueId, p_on: on });

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

/** The caller's soonest matchup AT OR AFTER a week — the honest answer for a
 *  seat that is on BYE at the week the league is currently playing (v0.364.0).
 *
 *  An odd-sized league sits one team out each week, and every caller here used
 *  to fall back to the week-LESS myMatchup, which is `.order('week').limit(1)`
 *  — Week 1. So the leagues list printed a Week 1 opponent as though it were
 *  this week's game. Asking for "my next one from here" is one query and
 *  cannot be stale. */
export async function myMatchupFrom(leagueId: string, rosterId: number, week: number): Promise<LiveMatchup | null> {
  const { data } = await (await client()).from('matchup').select('*')
    .eq('league_id', leagueId).or(`home_roster_id.eq.${rosterId},away_roster_id.eq.${rosterId}`)
    .gte('week', week).order('week').limit(1).maybeSingle();
  return (data as LiveMatchup) ?? null;
}

/** Is this seat PLAYING, on BYE, or is the schedule not built (0247)? A bye and
 *  an unbuilt schedule look identical from one seat — both are "no matchup
 *  row" — and only the league-wide view can tell them apart. Saying the wrong
 *  one blames the commissioner for a schedule that is working correctly. */
export const leagueWeekRole = (leagueId: string, rosterId: number, week: number) =>
  rpc<'playing' | 'bye' | 'unbuilt'>('league_week_role',
    { p_league_id: leagueId, p_roster_id: rosterId, p_week: week });

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

export async function defaultOpenWeek(leagueId: string, season?: string, preseasonEnabled?: boolean): Promise<number> {
  // v0.407.0: season and the preseason flag are now OPTIONAL and read from the
  // league when not supplied. ClassicBoard — the screen the founder was
  // actually looking at — has a league id and a roster id and nothing else,
  // and needing a season string is the reason it never called this at all.
  let seas = season, pre = preseasonEnabled;
  if (seas == null || pre == null) {
    const { data } = await (await client()).from('league')
      .select('season, preseason_at').eq('id', leagueId).maybeSingle();
    const row = data as { season?: string | null; preseason_at?: string | null } | null;
    seas = seas ?? row?.season ?? '2026';
    pre = pre ?? !!row?.preseason_at;
  }
  const [msRes, slRes] = await Promise.all([
    // status too (v0.407.0): a week whose matchups are all final is over even
    // when no slate row exists to measure the Wednesday rule against.
    (await client()).from('matchup').select('week, status').eq('league_id', leagueId),
    (await client()).from('nfl_slate').select('week, kickoff').eq('season', seas),
  ]);
  const rows = (msRes.data ?? []) as { week: number; status: string | null }[];
  const weeks = [...new Set(rows.map((r) => r.week))];
  if (!weeks.length) return pre ? 101 : 1;
  const finals: Record<number, boolean> = {};
  for (const w of weeks) {
    const mine = rows.filter((r) => r.week === w);
    finals[w] = mine.length > 0 && mine.every((r) => r.status === 'final');
  }
  const kicks: Record<number, { first: number; last: number }> = {};
  for (const r of (slRes.data ?? []) as { week: number; kickoff: string | null }[]) {
    if (!r.kickoff) continue;
    const t = Date.parse(r.kickoff);
    const e = kicks[r.week] ?? (kicks[r.week] = { first: t, last: t });
    e.first = Math.min(e.first, t); e.last = Math.max(e.last, t);
  }
  // v0.401.0: the ordering and the cutoff moved into openWeekFrom, a pure
  // function parity can test against fixed instants. The cutoff also MOVED —
  // it used to be last kickoff + 4h, so the screen jumped to next week the
  // moment Monday night football ended.
  //
  // v0.466.0: and it moved again, from Wednesday midnight to THIS LEAGUE'S
  // WAIVER RUN. Founder: "We want it synced with the waiver run so that when
  // you see the week matchup, you see the impacts of new rosters from the
  // waiver run." A board that turns over before the run shows next week's
  // matchup against last week's rosters. A league that has no run — rolling
  // waivers, or a schedule that clears no day — gets the default pair, which
  // is what `league_week_turnover` returns and says `source` about.
  const turn = await leagueWeekTurnover(leagueId).catch(() => null);
  return openWeekFrom(weeks, kicks, Date.now(), finals,
    turn && turn.dow != null ? { dow: turn.dow, minute: turn.minute } : DEFAULT_TURNOVER)
    ?? (pre ? 101 : 1);
}

/** WHEN THIS LEAGUE'S BOARD TURNS OVER (0343) — the day and time of the waiver
 *  run that reshapes its rosters for the week ahead, which is the moment the
 *  matchup screens stop showing the week just played.
 *
 *  `source` is which answer you are looking at: `run` is the league's own
 *  after-games clearing run; `rolling`, `no_hold_day` and `no_run` are the
 *  three ways a league can have no such moment, all of which fall back to
 *  Wednesday 3:00am ET because the board still has to turn over somewhere. */
export const leagueWeekTurnover = (leagueId: string) =>
  rpc<WeekTurnover & { source?: 'run' | 'rolling' | 'no_hold_day' | 'no_run' | 'default' }>(
    'league_week_turnover', { p_league_id: leagueId });

/** ── THE WEEK'S SCOREBOARD, FOR ANYBODY IN THE LEAGUE (0341) ────────────────
 *  Founder: "Matchups summary, rankings, then activity." `leagueResults`
 *  reads `matchup.home_final/away_final`, and those are null until the week is
 *  stamped — so a league-wide board showed dashes all Sunday. This serves the
 *  stamped final where there is one and the sum of the worker's published
 *  window rows where there is not, which are the same number at the whistle.
 *
 *  TOTALS ONLY. Never `slot_scores`: it says what the score is, never who is
 *  in the lineup, and a window nobody has played has no row to sum. */
export interface ScoreboardSide { roster_id: number; team: string | null; points: number | null; live: boolean }
export interface ScoreboardGame {
  matchup_id: string; status: string;
  playoff?: boolean | null; consolation?: boolean | null; label?: string | null;
  home: ScoreboardSide; away: ScoreboardSide;
}
/** `week` null asks for the one the league is PLAYING — the lowest unfinished,
 *  else the last there is. A board that opens on week 1 in November is a board
 *  nobody reads. */
export const leagueWeekScoreboard = (leagueId: string, week?: number | null) =>
  rpc<{ ok?: boolean; error?: string; week?: number | null; weeks?: number[]; games?: ScoreboardGame[] }>(
    'league_week_scoreboard', { p_league_id: leagueId, p_week: week ?? null });

/** THE WAIVER RUN BEHIND A CHAT LINE (0344). `at` is the message's own
 *  `created_at`: the run stamps every claim `processed_at = now()` and posts
 *  its chat line in the SAME transaction, so the two are the same instant.
 *  Matched on the nearest run within five seconds rather than on equality —
 *  the timestamps agree in the database but travel out as text and back as a
 *  parameter, and a rule that needs that round trip to be byte-exact is one
 *  that fails silently into an empty sheet. */
export const leagueWaiverRun = (leagueId: string, at: string) =>
  rpc<WaiverRunReport>('league_waiver_run', { p_league_id: leagueId, p_at: at });

export interface MatchupResult { id: string; week: number; home_roster_id: number; away_roster_id: number; home_final: number | null; away_final: number | null; status: string; }
/** Every matchup in a league (all weeks) with its final totals — the scoreboard/
 *  results feed. Readable by any league member (finals live on the matchup row). */
export async function leagueResults(leagueId: string): Promise<MatchupResult[]> {
  const { data } = await (await client()).from('matchup')
    .select('id, week, home_roster_id, away_roster_id, home_final, away_final, status')
    .eq('league_id', leagueId).order('week');
  return (data ?? []) as MatchupResult[];
}
/** Every matchup in a league for ONE week (v0.424.0) — the ring the classic
 *  board's ▸ chip walks. Same row, same RLS (any league member). */
export async function weekMatchups(leagueId: string, week: number): Promise<MatchupResult[]> {
  const { data } = await (await client()).from('matchup')
    .select('id, week, home_roster_id, away_roster_id, home_final, away_final, status')
    .eq('league_id', leagueId).eq('week', week).order('home_roster_id');
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

/** The latest SYNCED week's pool for one seat (0239's external MY TEAM): the
 *  newest real-week sleeper_lineup row, read through the shared reader.
 *
 *  REAL WEEKS ONLY (v0.356.18, founder: "Let's use the actual roster from
 *  sleeper though, not the preseason fill in"). Preseason board weeks are
 *  numbered ABOVE the real season — 101/102/103 against 1–18 — so a plain
 *  `order by week desc` always picked one of them when a league had ever run
 *  preseason practice. And those rows are not anybody's roster:
 *  admin_seed_preseason_pool (0101) writes EVERY seat the same deep slate-team
 *  pool, every active skill player on that week's teams, so backups who
 *  actually take preseason snaps can be fielded. As a "my team" answer it was
 *  both wrong and identical for all twelve managers.
 *
 *  The board still wants those pools and still gets them: it reads by explicit
 *  week (poolForWeek / buildLiveLeague), never through here. */
export async function myLatestPool(leagueId: string, rosterId: number): Promise<{ week: number; players: PoolPlayer[] } | null> {
  const { data, error } = await (await client()).from('sleeper_lineup').select('week, starters_json')
    .eq('league_id', leagueId).eq('roster_id', rosterId)
    .lte('week', PRESEASON_BASE)
    .order('week', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`roster read failed: ${error.message}`);
  if (!data) return null;
  return { week: (data as { week: number }).week, players: readPool((data as { starters_json: unknown }).starters_json) };
}

/** The caller's saved picks for a matchup (locked = that window has sealed). */
export async function myPicks(matchupId: string, userId: string): Promise<PickRow[]> {
  const { data } = await (await client()).from('sealed_pick')
    .select('game_window, roster_slot, player_slug, metric_id, locked')
    .eq('matchup_id', matchupId).eq('app_user_id', userId);
  return (data ?? []) as PickRow[];
}

const PICK_CONFLICT = 'matchup_id,app_user_id,game_window,roster_slot';

/** Upsert the caller's sealed picks, ALL OR NOTHING. RLS + the window-lock
 *  trigger (migration 0058) only accept rows in windows that haven't kicked
 *  off — callers must pre-filter locked windows out or the whole upsert fails.
 *  `locked` is stripped: only the server sets it (the RLS WITH CHECK rejects it
 *  from clients anyway).
 *
 *  ATOMIC ON PURPOSE, and the classic boards depend on it: a move is the two
 *  rows "player into the target spot" and "player out of the spot he left",
 *  and landing only one of them stands the same man in two places. Those
 *  callers revert their optimistic board when this throws. The LIVE boards
 *  autosave a whole lineup instead, where all-or-nothing is the wrong trade —
 *  they use savePicksBestEffort below. */
export async function savePicks(matchupId: string, userId: string, rows: PickRow[]): Promise<void> {
  const payload = rows.map(({ locked: _locked, ...r }) => ({ matchup_id: matchupId, app_user_id: userId, ...r }));
  const { error } = await (await client()).from('sealed_pick').upsert(payload, { onConflict: PICK_CONFLICT });
  if (error) throw error;
}

export interface SavePicksResult { saved: number; failed: import('./pickSave').FailedPick[] }

/** Reconcile the server's picks with the lineup the client is sending: delete
 *  the rows a cleared spot left stranded (v0.394.3, completed v0.394.4).
 *
 *  `clearSlot` only ever changed local state — it deletes the key and compacts
 *  the rest upward — and the autosave only ever SENDS filled slots. So a
 *  cleared pick's row stayed in `sealed_pick` forever, at a slot index the
 *  board had stopped rendering: invisible, un-removable, and still counted by
 *  every cap trigger. Founder, week 2: one Combo Drip on screen, two in the
 *  table, the lineup refused.
 *
 *  Bounded deliberately, because a delete that guesses wrong loses a lineup:
 *   • `locked = false` — a sealed pick is the record of what was fielded and is
 *     never the client's to remove.
 *   • Only windows the caller says are OPEN, which is the same set it filtered
 *     `rows` down to. A window that has locked is left entirely alone.
 *   • Callers must only call this once their saved lineup has HYDRATED; empty
 *     local state must never be able to empty the server.
 *  Best effort per window: the 0178 lock trigger fires on DELETE too and may
 *  refuse a row whose player has kicked off, and that must not stop the rest
 *  being tidied. */
async function pruneStaleSlots(matchupId: string, userId: string,
                               payload: { game_window: string; roster_slot: string }[],
                               openWindows?: string[]): Promise<void> {
  const byWin = new Map<string, Set<string>>();
  for (const r of payload) {
    let keep = byWin.get(r.game_window);
    if (!keep) { keep = new Set(); byWin.set(r.game_window, keep); }
    keep.add(r.roster_slot);
  }
  // An open window the batch names NOTHING in is a window the manager emptied —
  // every row in it is stale. Without this, clearing a window's last pick left
  // the whole window standing on the server.
  for (const w of openWindows ?? []) if (!byWin.has(w)) byWin.set(w, new Set());
  const c = await client();
  for (const [win, keep] of byWin) {
    const slots = [...keep];
    // The PostgREST `in` list is built by string interpolation, so anything that
    // could break out of it means we skip this window rather than send a filter
    // we cannot reason about. Real slot ids are "1", "S2", "FLEX" and the like.
    if (!slots.every((x) => /^[A-Za-z0-9_-]+$/.test(x))) continue;
    let q = c.from('sealed_pick').delete()
      .eq('matchup_id', matchupId).eq('app_user_id', userId)
      .eq('game_window', win).eq('locked', false);
    if (slots.length) q = q.not('roster_slot', 'in', `(${slots.map((x) => `"${x}"`).join(',')})`);
    await q.then(undefined, () => undefined);
  }
}

/** The (window → slots) shape last reconciled, per board. Pruning only matters
 *  when the LAYOUT moves — a slot cleared, an extra slot removed, picks
 *  compacted — so a save that only swaps a player or a metric skips it and
 *  stays a single round trip. Keyed per matchup+user; the first save after a
 *  mount always prunes, which is what heals a board that is already stranded. */
const lastPruned = new Map<string, string>();
const slotShape = (payload: { game_window: string; roster_slot: string }[], openWindows?: string[]): string =>
  JSON.stringify([
    payload.map((r) => `${r.game_window}#${r.roster_slot}`).sort(),
    [...(openWindows ?? [])].sort(),
  ]);

export async function savePicksBestEffort(matchupId: string, userId: string, rows: PickRow[],
                                          opts?: { openWindows?: string[] }): Promise<SavePicksResult> {
  const payload = rows.map(({ locked: _locked, ...r }) => ({ matchup_id: matchupId, app_user_id: userId, ...r }));
  if (!payload.length) return { saved: 0, failed: [] };
  // RECONCILE BEFORE WRITING (v0.394.4). A cleared spot's row has to go, and it
  // has to go FIRST: while it is still there it counts against every cap, which
  // is exactly how one invisible Combo Drip refused a lineup that had one.
  const key = `${matchupId}:${userId}`;
  const shape = slotShape(payload, opts?.openWindows);
  if (lastPruned.get(key) !== shape) {
    await pruneStaleSlots(matchupId, userId, payload, opts?.openWindows).catch(() => {});
    lastPruned.set(key, shape);
  }
  const c = await client();
  const { error } = await c.from('sealed_pick').upsert(payload, { onConflict: PICK_CONFLICT });
  if (!error) return { saved: payload.length, failed: [] };
  const failed: import('./pickSave').FailedPick[] = [];
  let saved = 0;
  // In ORDER, deliberately: where a cap is the reason (Combo Drip, extra slots)
  // the earlier rows are the ones that fit, so the manager keeps the picks he
  // made first and is told about the overflow — rather than the outcome
  // depending on which row the database happened to reject.
  for (const row of payload) {
    const { error: e } = await c.from('sealed_pick').upsert([row], { onConflict: PICK_CONFLICT });
    if (!e) { saved += 1; continue; }
    failed.push({ win: row.game_window, slot: row.roster_slot, slug: row.player_slug ?? null, error: e.message });
  }
  // ONE MORE PASS OVER WHAT WAS REFUSED (v0.418.0). A cap is counted against
  // the rows already on the server, and a LATER row in this batch may be the
  // one that frees it: moving the Combo Drip from slot 2 to slot 1 sends
  // "1: combodrip" before "2: something else", and row 1 is refused while row
  // 2 still reads combodrip. Once every row has had its turn, the refusals
  // that were only about ORDER go through; the ones that were about the rule
  // come back with the same message, once.
  if (failed.length && saved) {
    const again = failed.splice(0);
    for (const f of again) {
      const row = payload.find((r) => r.game_window === f.win && r.roster_slot === f.slot);
      if (!row) continue;
      const { error: e } = await c.from('sealed_pick').upsert([row], { onConflict: PICK_CONFLICT });
      if (!e) { saved += 1; continue; }
      failed.push({ ...f, error: e.message });
    }
  }
  return { saved, failed };
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

/** Every (week, kickoff) the slate holds for a season — what the leagues page
 *  feeds fieldsWeekFrom to pick the week the ▦ FIELDS sheet shows (v0.390.0). */
export async function slateWeeks(season: string): Promise<{ week: number; kickoff: string | null }[]> {
  const { data } = await (await client()).from('nfl_slate').select('week, kickoff').eq('season', season);
  return (data ?? []) as { week: number; kickoff: string | null }[];
}

/** Both teams' display identity (name + avatar) for a matchup — league members can
 *  read all memberships (RLS), so this drives the live board's team headers. */
export interface TeamInfo {
  roster_id: number; team_name: string | null; avatar: string | null;
  /** The account in the seat (v0.424.0) — what a browsed board splits the
   *  week's revealed classic picks by. Null for an unclaimed seat. */
  user_id?: string | null;
}
export async function matchupTeams(leagueId: string, rosterIds: number[]): Promise<Record<number, TeamInfo>> {
  const { data } = await (await client()).from('league_membership')
    .select('sleeper_roster_id, team_name, avatar_url, app_user_id').eq('league_id', leagueId).in('sleeper_roster_id', rosterIds);
  const out: Record<number, TeamInfo> = {};
  for (const m of (data ?? []) as { sleeper_roster_id: number; team_name: string | null; avatar_url: string | null; app_user_id: string | null }[]) {
    out[m.sleeper_roster_id] = { roster_id: m.sleeper_roster_id, team_name: m.team_name, avatar: m.avatar_url, user_id: m.app_user_id ?? null };
  }
  return out;
}

/** Sealed picks visible under RLS: always yours; the opponent's only once
 *  locked AND the window has kicked off (0262 — locked alone is the edit
 *  seal at kickoff − 1h, not the reveal).
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
export interface LivePlayRow { player_slug: string; c: number; t: number | null; pid: number | null; game_id?: string | null; k: string; y: number; td: number; ca: number; tg: number; to: number | null; fd?: number | null; cp?: number | null; ic?: number | null; sk?: number | null; rk?: string | null; tt?: string | null; hf?: number | null; p6?: number | null; }
export async function weekLivePlays(week: number): Promise<LivePlayRow[]> {
  // Page through the full result set. PostgREST caps an un-ranged select at its
  // max-rows default (1000), so a busy NFL Sunday (several thousand plays) would
  // silently truncate — and the board would score off an incomplete play set.
  const PAGE = 1000;
  const rows: LivePlayRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (await client()).from('live_play')
      .select('player_slug, c, t, pid, game_id, k, y, td, ca, tg, to, fd, cp, ic, sk, rk, tt, hf, p6')
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
export interface GameFeedRow { key: string; away: string; home: string; plays: import('./gameFeed').GamePlay[]; state?: string | null; game_id?: string | null;
  /** The header's status and the stoppages (0313, v0.434.3). */
  status?: import('./gameFeed').GameStatus | null; events?: import('./gameFeed').GameEvent[] | null; }
export async function weekGameFeeds(week: number): Promise<GameFeedRow[]> {
  const { data } = await (await client()).from('game_feed')
    .select('key, away, home, plays, state, game_id, status, events').eq('week', week);
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
export interface AdminLeague { league_id: string; sleeper_league_id: string; name: string; season: string; provider?: string; avatar_url?: string | null; commish_code: string; invite_code: string; commissioner: boolean; /** 0320: false for a co-commissioner (who cannot add, remove or hand over commissioners, or delete the league). */ primary?: boolean; rosters: number; enrolled: number; lineup_policy?: LineupPolicy; ai_teams?: number; weekly_budget?: number; test_live_at?: string | null; preseason_at?: string | null; /** Window Pot: the per-league flag (0 = off) + its ceiling, and how many pots are in flight right now. */ pot_ante?: number; pot_cap?: number; pot_open?: number; }
export interface AdminUser { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; enrolled: number; created_at: string; }
/** `drifted` (0117): this seat's occupant is no longer the roster's Sleeper owner
 *  — they left the league, it changed hands, or they unlinked. Sleeper leagues
 *  only, and never set for hand-assigned seats (those carry claim_email and are
 *  deliberately independent of Sleeper). Advisory: a refresh flags it, it never
 *  clears the seat on its own. */
export interface AdminMember { roster_id: number; team: string; owner: string | null; enrolled: boolean; email: string | null; sleeper: string | null; controller?: Controller; avatar?: string | null; claim_email?: string | null; drifted?: boolean; /** Drip-coin balance (0130); 0 for a wallet never minted. */ coin?: number; /** Division label (0215). */ division?: string | null; /** This seat is a vampire (0269). */ vampire?: boolean; }
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
/** THE METRICLESS-PICK AUDIT (0211). Read-only, admin-gated.
 *
 *  A `sealed_pick` with a player and no metric scores EXACTLY ZERO — scorePlay
 *  is a chain of `if (metricId === '…')` ending in `return 0`, so a null falls
 *  through. The seat is occupied and dead and the board does not say so. This
 *  finds them across every league. It reports; it never repairs. */
export interface MetriclessPick {
  league: string; week: number; win: string; slot: string; player_slug: string;
  team: string; controller: string; locked: boolean;
  /** How many of that seat's OTHER slots DO carry a metric. >0 means the seat
   *  was set up properly and then lost one, which points at the paths that null
   *  a metric deliberately (0024/0026/0062) rather than at someone who never
   *  finished. */
  sibling_slots_with_metric: number;
}
export interface MetriclessAudit {
  ok: boolean; error?: string; total?: number; truncated?: boolean;
  picks?: MetriclessPick[];
  by_team?: { league: string; team: string; controller: string; n: number; locked: number }[];
  /** Should always be 0: autoLineup always assigns a metric, so an agent row
   *  here means something nulled it AFTER the worker wrote it. */
  agent_rows?: number;
}
export const adminMetriclessPicks = (limit = 200) =>
  rpc<MetriclessAudit>('admin_metricless_picks', { p_limit: limit });

/** THE WEEKLY MATCHUP AUDIT (0302, v0.430.0): who actually played the week —
 *  per league and per seat, which slots a person set vs the computer vs an
 *  AI seat, what was left empty, who started an OUT or bye player, and whose
 *  moves and claims the week's transactions were. Week null → the latest
 *  week with a stamped final; season null → the newest season with matchups;
 *  the activity window can be overridden. Admin-only. The shape and its
 *  reading live in core data/weekAudit.ts. */
export const adminWeekAudit = (week?: number | null, season?: string | null, from?: string | null, to?: string | null) =>
  rpc<import('./weekAudit').WeekAudit>('admin_week_audit', {
    p_week: week ?? null, p_season: season ?? null, p_from: from ?? null, p_to: to ?? null,
  });

/** One market_board refresh run (0237): what the pull applied and what moved. */
export interface MarketRefreshRun {
  id: number; as_of: string; applied_at: string; players: number;
  entered: { slug: string; rank: number }[];
  dropped: { slug: string; rank: number }[];
  movers: { slug: string; from: number; to: number }[];
  note?: string | null;
}
export interface MarketReport { ok: boolean; error?: string; board_size?: number; runs?: MarketRefreshRun[]; }
/** Super admin: the market-refresh history — success of each run + its
 *  significant changes (entered / dropped / 15-spot movers in the top 200). */
export const adminMarketReport = (limit = 12) =>
  rpc<MarketReport>('admin_market_report', { p_limit: limit });

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
/** LEAVING (0188) — give up your seat, or drop a co-manager role. One RPC for
 *  both, because a member should not have to know which kind they are; the
 *  answer comes back as `as: 'manager' | 'comanager'`. The seat keeps its team
 *  name and roster for whoever takes it next. A commissioner cannot leave. */
export const leaveLeague = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; league?: string; as?: 'manager' | 'comanager'; roster_id?: number }>(
    'leave_league', { p_league_id: leagueId });
/** DELETING (0188) — the commissioner's own way out, and irreversible: every
 *  child table cascades off league(id). `confirm` must be the league's name
 *  (case and inner whitespace forgiving); anything else refuses. */
export const commishDeleteLeague = (leagueId: string, confirm: string) =>
  rpc<{ ok: boolean; error?: string; name?: string; removed_members?: number }>(
    'commish_delete_league', { p_league_id: leagueId, p_confirm: confirm });

export const adminDeleteLeague = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; name?: string }>('admin_delete_league', { p_league_id: leagueId });
/** Commissioner/admin enrolls THEMSELVES on a roster — claim a team to play.
 *  Call once per roster to claim multiple teams. */
export const commishClaimRoster = (leagueId: string, rosterId: number) =>
  rpc<{ ok: boolean; error?: string; status?: string }>('commish_claim_roster', { p_league_id: leagueId, p_roster_id: rosterId });
/** Commissioner/admin grants drip coin to a team (additive). During an active
 *  practice week the grant lands on THAT week's throwaway practice wallet
 *  (practice: true, week) and wipes with it; otherwise the season wallet (0253). */
export const commishSeedCoin = (leagueId: string, rosterId: number, amount: number) =>
  rpc<{ ok: boolean; error?: string; balance?: number; practice?: boolean; week?: number }>('commish_seed_coin', { p_league_id: leagueId, p_roster_id: rosterId, p_amount: amount });
/** The league's practice week currently in play (earliest non-final week > 100),
 *  null once the preseason is over or was never opened. Drives the commish coin
 *  sheet's preseason note + routing awareness (0253). */
export const leaguePracticeWeek = async (leagueId: string): Promise<number | null> => {
  const w = await rpc<number | null>('league_practice_week', { p_league_id: leagueId }).catch(() => null);
  return typeof w === 'number' ? w : null;
};
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
/** ▶ Board-driven dress rehearsal (0251): arm/reset a sim_run the WORKER
 *  drives — baked plays dripped through live_play → resolver → this board.
 *  Same double gate as the stamp lever: admin + 🧪 LIVE TEST. One sim per
 *  week across all leagues (the SIM feed rows are week-scoped). */
export const adminSimStart = (leagueId: string, week?: number | null, src?: number | null, speed?: number | null) =>
  rpc<{ ok: boolean; error?: string; week?: number; src?: number; matchups?: number }>(
    // p_speed null on purpose: the SERVER owns the default (100× since 0266).
    // This used to send 20, which silently overrode the server every time the
    // strip armed a run — the founder's "says 20×" screenshot was this line.
    'admin_sim_start', { p_league_id: leagueId, p_week: week ?? null, p_src: src ?? null, p_speed: speed ?? null });
export const adminSimReset = (leagueId: string, week?: number | null) =>
  rpc<{ ok: boolean; error?: string; week?: number }>('admin_sim_reset', { p_league_id: leagueId, p_week: week ?? null });
export interface SimRun {
  week: number; src: number; speed: number; status: 'running' | 'done'; started_at: string; cursor_at: number; clock: number;
  /** The feed's final release time — stamped by the worker's first sweep tick
   *  of a run (0266); null before that, so pct is a fallback-aware read. */
  feed_len?: number | null;
  /** 0–100, server-computed from clock ÷ feed_len; null until feed_len lands. */
  pct?: number | null;
}
export const simRunState = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; run?: SimRun | null }>('sim_run_state', { p_league_id: leagueId });

/** ⚡ Complete a SANDBOX league's week on demand (0250) — writes plausible
 *  finals so the week-completion mechanics (guillotine blade, vampire steal
 *  window) arm without waiting for the real NFL calendar. Admin-only AND the
 *  league must be in 🧪 LIVE TEST; p_favor makes that seat win its matchup,
 *  p_doom hands it the week's floor. week null = earliest unstamped. */
// ── The weekly report's gate, and a forced build (0277) ─────────────────────
export interface WeekReportState {
  ok: boolean; error?: string; week: number | null; season?: string; matchups: number; final?: number; stamped?: number;
  statuses?: Record<string, number>; report?: boolean; message?: boolean;
  request?: { requested_at: string; done_at: string | null; error: string | null } | null;
}
export const adminWeekReportState = (leagueId: string, week?: number | null) =>
  rpc<WeekReportState>('admin_week_report_state', { p_league_id: leagueId, p_week: week ?? null });
export const adminRequestWeekReport = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; queued?: boolean; note?: string; id?: number }>('admin_request_week_report', { p_league_id: leagueId, p_week: week });
/** ── THE COMMISSIONER'S OWN REPORT CONTROL (0339) ────────────────────────────
 *  Founder: "Maybe have an option for commish to regen any weekly report and
 *  post in chat." The queue, the worker and the chat-line REPLACEMENT are
 *  0277's and unchanged — this is the commissioner's door onto them, with the
 *  one guard the admin door does not have: a week still being played is
 *  refused, because a report built mid-game is the v0.457.0 bug and a button
 *  is a faster way to reach it than the bug was. */
export interface ReportWeek {
  week: number; matchups: number; final: number; stamped: number;
  /** Stored finals that no longer match their own window rows — a stamp taken
   *  early, OR a score the commissioner edited by hand, which the database
   *  cannot tell apart and so does not try to. */
  drifted: number;
  /** Stamped finals computed BEFORE the week's last play landed (0345).
   *  `drifted` cannot see this — a final and its window rows are written by
   *  one pass, so a week frozen three hours early agrees with itself
   *  perfectly. This is the two timestamps in the wrong order. */
  stale: number;
  /** When the week was last scored, and when its last play arrived — the pair
   *  `stale` is counted from, so a console can show its working. */
  scored_at: string | null; last_play_at: string | null;
  report: boolean; posted_at: string | null;
  week_state: { season: string | null; slate: number; feed: number; live: number; complete: boolean };
  request: { requested_at: string; done_at: string | null; error: string | null } | null;
}
/** THE COMMISSIONER'S RE-SCORE (0353). A PREVIEW re-resolves a finished
 *  classic week and changes nothing; an APPLY rewrites the finals, rebuilds
 *  the week's report and tells the league — and is refused unless a preview
 *  of that week finished in the last 30 minutes and found a change. */
export interface RescoreState {
  ok: boolean; error?: string; week?: number;
  /** A fresh preview that found a change is waiting to be confirmed. */
  can_apply?: boolean;
  request?: {
    id: number; apply: boolean; requested_at: string; started_at: string | null;
    done_at: string | null; error: string | null;
    result: import('./rescore').RescoreResult | null;
  } | null;
}
export const commishRequestRescore = (leagueId: string, week: number, apply = false) =>
  tracked(rpc<{ ok: boolean; error?: string; id?: number; note?: string }>('commish_request_rescore',
    { p_league_id: leagueId, p_week: week, p_apply: apply }), Ev.commishAction, { tool: apply ? 'rescore_apply' : 'rescore_preview' });
export const leagueRescoreState = (leagueId: string, week: number) =>
  rpc<RescoreState>('league_rescore_state', { p_league_id: leagueId, p_week: week });

export const leagueReportWeeks = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; season?: string; report_chat?: boolean; weeks?: ReportWeek[] }>(
    'league_report_weeks', { p_league_id: leagueId });
/** 0348: announce the weekly report in chat, or keep it to the report screen.
 *  OFF stops the CHAT LINE, never the write-up — the week is still built and
 *  stored, so the history survives a commissioner quieting a notification. A
 *  commissioner's own ↻ REPOST posts regardless: that is an explicit press,
 *  not the standing schedule this setting is about. */
export const commishSetReportChat = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; report_chat?: boolean }>(
    'commish_set_report_chat', { p_league_id: leagueId, p_on: on });
export const commishRequestWeekReport = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; queued?: boolean; note?: string; id?: number; week_state?: ReportWeek['week_state'] }>(
    'commish_request_week_report', { p_league_id: leagueId, p_week: week });

export const adminStampWeek = (leagueId: string, week?: number | null, favor?: number | null, doom?: number | null) =>
  rpc<{ ok: boolean; error?: string; week?: number; stamped?: number; eliminated?: number; vampire_won?: boolean }>(
    'admin_stamp_week', { p_league_id: leagueId, p_week: week ?? null, p_favor: favor ?? null, p_doom: doom ?? null });
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

/** THE COMMISSIONER'S DOOR ON THE WAITING ROOM (0208).
 *
 *  Founder: "Can we have a commish option to close the waiting room. Just
 *  'League Full'." Closed, a FULL league refuses new joiners instead of queuing
 *  them; it changes nothing while a seat is free, and it never evicts the
 *  people already waiting — `waiting` comes back so the UI can say so. */
export const setLeagueWaitlist = (leagueId: string, open: boolean) =>
  rpc<{ ok: boolean; error?: string; waitlist_open?: boolean; waiting?: number }>(
    'set_league_waitlist', { p_league_id: leagueId, p_open: open });
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
export interface GameModeInfo { ok: boolean; error?: string; mode?: 'drip' | 'classic'; ppr?: number; classic_ok?: boolean; bestball?: string[]; scoring?: Record<string, number>; roster?: Record<string, number>; slots?: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null; flags?: string[] | null; zero_pts?: number | null }[] | null; shape?: { bench?: number; taxi?: number; ir?: number; out?: number } | null; golf?: boolean; rounds?: number | null; positions?: string[] | null; pool_filter?: { teams?: string[] | null; min_exp?: number | null; max_exp?: number | null } | null; can_edit?: boolean }
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
/** GOLF MODE (0200): lowest weekly total wins. Classic only, and it locks
 *  once the draft starts — you draft a golf league inside out. */
export const setLeagueGolf = (leagueId: string, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; golf?: boolean }>('set_league_golf',
    { p_league_id: leagueId, p_on: on }),
    Ev.commishAction, { tool: 'golf', on });
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
export const setLeagueClassicSlots = (leagueId: string, slots: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null; flags?: string[] | null; zero_pts?: number | null }[] | null) =>
  tracked(rpc<{ ok: boolean; error?: string; slots?: { pos: string[]; bb?: boolean; label?: string; teams?: string[] | null; min_exp?: number | null; max_exp?: number | null; flags?: string[] | null; zero_pts?: number | null }[] | null; starters?: number; rounds?: number }>('set_league_classic_slots',
    { p_league_id: leagueId, p_slots: slots }),
    Ev.commishAction, { tool: 'roster_builder', count: slots?.length ?? 0 });
/** BENCH/TAXI/IR counts (0164) — classic, pre-draft; draft rounds re-derive as
 *  starters + bench + taxi + ir. */
export const setLeagueRosterShape = (leagueId: string, bench: number, taxi: number, ir: number, out = 0) =>
  // `rounds` is the ROSTER (what a team may hold, IR/OUT included);
  // `draft_rounds` is what the draft actually runs — they stopped being one
  // number in 0193, because an injured shelf is a spot you stash into, not one
  // you draft. OUT (0307) is IR's week-to-week sibling.
  tracked(rpc<{ ok: boolean; error?: string; shape?: { bench: number; taxi: number; ir: number; out?: number }; rounds?: number; draft_rounds?: number }>('set_league_roster_shape',
    { p_league_id: leagueId, p_bench: bench, p_taxi: taxi, p_ir: ir, p_out: out }),
    Ev.commishAction, { tool: 'roster_shape' });
/** Move a rostered player between ACTIVE / TAXI / IR (0164). Owner or commish;
 *  IR needs a real injury designation; caps enforced server-side. */
export type RosterSpot = 'active' | 'taxi' | 'ir' | 'out';
export const setRosterSpot = (leagueId: string, slug: string, spot: RosterSpot) =>
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
/** Underdog modifier (0257): attach the owned card to one of YOUR slots before
 *  its window kicks off — the slot keeps its metric; trailing scores bank ×1.5.
 *  Consumes one card server-side (0256 model). No clear path — no refunds. */
export const applyUnderdog = (matchupId: string, win: string, slot: string) =>
  rpc<{ ok: boolean; error?: string; underdog?: string[] }>('apply_underdog', { p_matchup_id: matchupId, p_win: win, p_slot: slot });
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
  /** Battle plays, all keyed 'win|slot' (the payload the apply RPCs write —
   *  surfaced so the app can SHOW what's attached even before it can apply). */
  rivalry?: string[];
  ghost?: string[];
  leadChange?: string[];
  grudge?: string[];
  jinx?: string[];
  redHerring?: string[];
  underdog?: string[];
  clutchDon?: string[];
  surge?: Record<string, number>;
  coldSnap?: Record<string, number>;
  napalm?: Record<string, number>;
  bunker?: Record<string, number>;
  clutchEncore?: Record<string, number>;
  clutchCounter?: Record<string, number>;
  /** Extra Slot cards played this week, by window (0305 apply_extra_slot):
   *  {win: n}. Read from the same applied_state row as the targeted plays. */
  extraSlots?: Record<string, number>;
}

/** The windows in which the caller's opponent has NO filled pick, from an
 *  hour before each window locks (0312, v0.434.0). The one thing about a
 *  sealed lineup that may be shown early, because it is nothing: the board
 *  draws those windows' opposing halves empty and offers the sub in time.
 *  [] for non-participants, classic matchups, and any read that fails. */
export async function opponentEmptyWindows(matchupId: string): Promise<string[]> {
  const r = await rpc<unknown>('opponent_empty_windows', { p_matchup_id: matchupId }).catch(() => null);
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
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
  const pj = data?.payload_json as { targeted?: TargetedState; extraSlots?: Record<string, number> } | null;
  const t: TargetedState = { ...(pj?.targeted ?? {}) };
  if (pj?.extraSlots && typeof pj.extraSlots === 'object') t.extraSlots = pj.extraSlots;
  return t;
}
/** Play one owned Extra Slot card on a window (0305): before the week's first
 *  lock, consumes the card, bumps the slot cap and records the window for
 *  both boards. No refunds. */
export const applyExtraSlotCard = (matchupId: string, win: string) =>
  rpc<{ ok: boolean; error?: string; extra?: number; extraSlots?: Record<string, number>; win?: string }>('apply_extra_slot', { p_matchup_id: matchupId, p_win: win });

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
/** The league-type axis (0185, 0218). The contract types preset the rest:
 *  an auction startup room and the salary cap on at the budget. */
export type LeagueContinuity = 'redraft' | 'keeper' | 'dynasty' | 'contract' | 'contract_dynasty';
/** contract_dynasty runs the full dynasty machinery (rookie rounds, pick
 *  horizon, rollover) — ask this, not `=== 'dynasty'`, when branching. */
export const isDynastyContinuity = (c: LeagueContinuity | string | null | undefined) =>
  c === 'dynasty' || c === 'contract_dynasty';
export const isContractContinuity = (c: LeagueContinuity | string | null | undefined) =>
  c === 'contract' || c === 'contract_dynasty';

// ── THE LEAGUE CARD'S ONE LINE, AND WHERE A TAP LANDS (0240) ─────────────────
// Founder, holding up Sleeper's own list: "Avatar, league name, built text of
// league type, drafting if drafting. That's all we need too." Both rules live
// here rather than in either client, so the app and the web say the same thing
// about the same league — the same reason `crestFor` and `isDynastyContinuity`
// are in core.

/** Where a league's own draft stands. Absent/null = no draft of ours at all
 *  (an imported league drafted on its platform), which is NOT 'pending'. */
export type DraftStatus = 'pending' | 'live' | 'complete';

/** The card's single grey line: season, size, and what KIND of league this is.
 *  Built from what my_teams already carries, dropping any part it doesn't
 *  know rather than printing a gap. A mock says so — it is the most important
 *  thing about a league that isn't real. */
export function leagueTypeLine(e: Enrollment): string {
  const lg = e.league;
  if (!lg) return '';
  const parts: string[] = [];
  if (lg.season) parts.push(lg.season);
  if (lg.rosters) parts.push(`${lg.rosters}-Team`);
  parts.push(leagueTypeName(e));
  parts.push(...leagueGameWords(e));
  if (lg.is_mock) parts.push('Mock');
  return parts.join(' ');
}

/** WHICH GAME this league plays (0242, founder: "let's have drip or classic
 *  vampire, golf etc on the chips in my leagues") — the continuity word above
 *  says what CARRIES OVER, which is a different question from what you play on
 *  a Sunday.
 *
 *  NATIVE LEAGUES ONLY. An imported league plays its own platform's game and
 *  these settings are ours, so printing "Drip" on a Sleeper league would be a
 *  claim about somebody else's rules. Nothing is printed for a pod, showdown
 *  or DFS league either: those name themselves in the type word already.
 *
 *  The mode is always said — drip and classic are opposite games and the
 *  founder asked for both — while a format and golf are said only when set,
 *  because "Standard" on every chip is the word that isn't news. */
export function leagueGameWords(e: Enrollment): string[] {
  const lg = e.league;
  if (!lg) return [];
  if (lg.provider && lg.provider !== 'native') return [];
  if (lg.kind && lg.kind !== 'league') return [];
  const out = [lg.game_mode === 'classic' ? 'Classic' : 'Drip'];
  if (lg.format === 'guillotine') out.push('Guillotine');
  if (lg.format === 'vampire') out.push('Vampire');
  if (lg.golf) out.push('Golf');
  return out;
}

/** What kind of league this is, in a word or two: an imported league answers
 *  with its platform (its rules live there), a native one with its
 *  continuity. */
export function leagueTypeName(e: Enrollment): string {
  const lg = e.league;
  if (!lg) return '';
  if (lg.kind && lg.kind !== 'league') return titleWord(lg.kind);
  if (lg.provider && lg.provider !== 'native') return titleWord(lg.provider);
  switch (lg.continuity) {
    case 'contract': return 'Contract';
    case 'contract_dynasty': return 'Contract Dynasty';
    case 'dynasty': return 'Dynasty';
    case 'keeper': return 'Keeper';
    default: return 'Redraft';
  }
}

const titleWord = (s: string) =>
  s.split(/[\s_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

/** Which room a tap on the card opens (0240, founder): the matchup once the
 *  draft is done, the draft room while it is running, the league home when
 *  there is neither — including every imported league, whose draft is not
 *  ours to open. */
export type LandingRoom = 'matchup' | 'draft' | 'home';
export function leagueLandingRoom(e: Enrollment): LandingRoom {
  const st = e.league?.draft_status;
  if (st === 'live') return 'draft';
  // No seat, no lineup: the matchup room cannot render for a commissioner who
  // does not play, so the hub is the only honest landing.
  if (st === 'complete') return e.sleeper_roster_id != null ? 'matchup' : 'home';
  return 'home';
}
/** Contract leagues preset a DEEP roster (v0.352.0, founder: "auto set the
 *  benches deep. We want anyone who should have a salary over $1 to get
 *  drafted in the auction."). The auction AI prices rank r at
 *  budget × 0.34 × e^(−r/45), so the players worth $2+ number
 *  45·ln(0.34·budget/1.5) — split across the seats, that is the depth at
 *  which the drafted pool and the above-minimum market are the same set.
 *  Never shallower than the 15-spot standard, capped at 25 so a tiny league
 *  doesn't draft half the NFL. A default for the creation forms — an
 *  explicitly chosen size always wins. */
/** The auction market price for a pool rank (v0.354.7): the same value
 *  curve the auction AI bids and player_market_value serves —
 *  budget × 0.34 × e^(−rank/45), $1 floor. Client-side so the queue can
 *  offer one-tap market maxes without a round trip. */
export const auctionMarketValue = (rank: number | null | undefined, budget: number | null | undefined): number | null =>
  rank == null || !budget ? null : Math.max(1, Math.round(budget * 0.34 * Math.exp(-rank / 45)));
export const contractRosterDepth = (teams: number, budget = 200): number => {
  const priced = Math.max(0, Math.floor(45 * Math.log((0.34 * budget) / 1.5)));
  return Math.min(25, Math.max(15, Math.ceil(priced / Math.max(2, teams))));
};
export interface NativeCreateResult { ok: boolean; error?: string; league_id?: string; roster_id?: number; invite_code?: string; game_mode?: 'drip' | 'classic'; dynasty?: boolean; continuity?: LeagueContinuity; }
/** Per-position roster limits (0071). null = uncapped. Absent blob = legacy
 *  defaults (QB 3, TE 3, K 1, D/ST 1, RB/WR uncapped). Enforced server-side
 *  for humans AND honored by the AI. */
export type PosCaps = { QB: number | null; RB: number | null; WR: number | null; TE: number | null; K: number | null; DEF: number | null };
export const POS_CAP_KEYS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export const createNativeLeague = (
  name: string, season: string, teams: number, rounds: number, pickSeconds: number,
  mode: 'snake' | 'linear' | 'auction' = 'snake', budget = 200, lotSeconds = 15, maxLots = 1,
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
/** OWNERSHIP % (0199): slug → the whole-percent share of this platform's
 *  drafted leagues rostering him. Platform-wide on purpose — a number that
 *  counted only your own league would be 0% for everyone on the waiver wire,
 *  which is exactly the list you wanted to sort. */
export const playerOwnership = (leagueId: string) =>
  rpc<Record<string, number> | { error: string }>('player_ownership', { p_league_id: leagueId });
/** THE LIVE MARKET (0203, ADP re-sourced 0334): average draft position and
 *  ownership share in one call. Empty maps mean the feeds are stale — the
 *  caller keeps the baked consensus ADP rather than blanking the column.
 *
 *  The ADP half now answers from the published Sleeper draft-room board where
 *  it can and from ESPN's where it cannot, per player. `adp_source` says
 *  which, and `adp_format` says WHICH MARKET this league reads — a superflex
 *  lineup gets the 2QB board, a half-PPR league gets the half-PPR one, which
 *  a single baked column could never do. */
export const leagueMarket = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string; fresh?: boolean; as_of?: string | null; source?: string | null;
        adp_source?: 'sleeper' | 'espn' | null; adp_format?: 'ppr' | 'half' | 'std' | '2qb' | null;
        adp_as_of?: string | null;
        adp?: Record<string, number>; own?: Record<string, number>;
        /** 0335: the dynasty market and the rookie-pick board, both resolved
         *  to this league's format, and the source's season rate. `proj` is a
         *  PPR LEVEL, never a score — the engine applies the league's own
         *  catalog to it, so it must not be shown as a projection directly. */
        dyn_format?: '1qb' | 'sf' | null; dyn_as_of?: string | null;
        dyn?: Record<string, number>; picks?: Record<string, number>;
        proj_as_of?: string | null; proj?: Record<string, number>;
        /** 0340: WHAT THE WIRE IS DOING — Sleeper's own trending adds and
         *  drops over `trend_hours`, per slug. `a` is how many leagues added
         *  him, `d` how many dropped him; a player high in BOTH is churn
         *  rather than a signal, which is why the drops ride along rather
         *  than being thrown away. Empty when the board is over a day old:
         *  a stale "trending now" is worse than no column, so the caller
         *  hides it rather than painting yesterday as today. */
        trend_as_of?: string | null; trend_hours?: number | null;
        trend?: Record<string, { a: number; d: number }> }>(
    'league_market', { p_league_id: leagueId });
/** Read the league's roster + transaction rules (any member; the commish editors' loader). */
export const rosterRules = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string; rounds?: number; draft_status?: string; pos_caps?: PosCaps;
        waiver_mode?: WaiverMode; faab_budget?: number; trade_review?: TradeReview;
        waiver_clear_min?: number | null; waiver_clear_dow?: number[] | null;
        fa_after_waivers_dow?: number[] | null; waiver_hold_days?: number;
        fa_start_min?: number | null; fa_end_min?: number | null;
  fa_mode?: FaMode;
        /** 0319, Sleeper parity: the FAAB floor ($0 = none), the days free
         *  agency may open (absent = every day; a day outside the set is
         *  waivers-only), the trade deadline week (null = none) and whether
         *  it has already passed. */
        faab_min_bid?: number; fa_dow?: number[] | null;
        trade_deadline_week?: number | null; trade_deadline_passed?: boolean;
        /** 0337: THE SCHEDULE. Always seven entries — explicit, derived from
         *  the old keys, or Sleeper's default — so a console never has to
         *  guess what an unset league is doing. `waiver_days_set` says which
         *  of the three it is looking at; `waiver_clear_min_effective` is the
         *  run's time with the 3am default already applied (null = no daily
         *  run at all), and `waiver_game_hold_dow` is Sleeper's after-games
         *  morning (null = none). */
        waiver_days?: import('./waiverDays').WaiverDayMode[] | null;
        waiver_days_set?: boolean;
        waiver_clear_min_effective?: number | null;
        waiver_game_hold_dow?: number | null;
        /** 0321: the trade floor. trade_veto_votes is the EFFECTIVE bar;
         *  trade_veto_votes_set is null while it is the majority fallback. */
        /** 0326: is this league served by the anonymous public read API? */
        public_api?: boolean;
        trade_review_hours?: number; trade_veto_votes?: number;
        trade_veto_votes_set?: number | null;
        trade_offer_days?: number; faab_trading?: boolean;
        /** 0320, the commissioner's desk: the league-wide wire lock, the
         *  teams locked one by one, the median game, and the dues. */
        wire_lock?: boolean; locked_rosters?: number[]; median_game?: boolean;
        dues_amount?: number | null; dues_note?: string | null;
        /** The taxi squad's rules (0196): the tenure ceiling (null = anyone),
         *  whether the squad shuts at the season's first kickoff, whether it is
         *  shut RIGHT NOW, and when that kickoff is. */
        taxi_max_exp?: number | null; taxi_lock?: boolean;
        taxi_locked_now?: boolean; taxi_lock_at?: string | null;
        /** Which injury designations qualify a player for an IR spot (0198).
         *  Defaults to ['IR','O'] — the pair 0164 hardcoded. */
        ir_tags?: string[];
        /** …and for an OUT spot (0307), IR's week-to-week sibling. Defaults
         *  to ['O','D']. */
        out_tags?: string[];
        /** May unclaimed seats file waiver claims and free-agent adds (0213)?
         *  The server resolves the default, so absent here means the read
         *  failed — not that the feature is off. */
        agent_waivers?: boolean }>(
    'roster_rules', { p_league_id: leagueId });
/** Commissioner: who may ride the taxi squad, and whether it locks at the
 *  season's first kickoff (0196). Nulls leave a setting alone; `maxExp: -1`
 *  clears the tenure ceiling. Editable AT ANY TIME, unlike the roster shape —
 *  a commissioner reopening the taxi in November is answering a November
 *  question. */
export const setTaxiRules = (leagueId: string, maxExp: number | null = null, lock: boolean | null = null) =>
  tracked(rpc<{ ok: boolean; error?: string; max_exp?: number | null; lock?: boolean;
                locked_now?: boolean; lock_at?: string | null }>(
    'set_taxi_rules', { p_league_id: leagueId, p_max_exp: maxExp, p_lock: lock }),
    Ev.commishAction, { tool: 'taxi_rules' });
/** Commissioner: which injury designations may be stashed on IR (0198). The
 *  vocabulary is the report's own — O / D / Q / IR — and the list may not be
 *  empty: an IR spot nobody can qualify for is a spot to remove, not a rule.
 *  Editable at any time, like the taxi rules. */
export const setIrRules = (leagueId: string, tags: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; tags?: string[] }>(
    'set_ir_rules', { p_league_id: leagueId, p_tags: tags }),
    Ev.commishAction, { tool: 'ir_rules' });
/** Commissioner: edit position limits any time; roster size only pre-draft. */
export const setRosterRules = (leagueId: string, rounds: number | null, posCaps: PosCaps | null) =>
  rpc<{ ok: boolean; error?: string; rounds?: number; pos_caps?: PosCaps }>(
    'set_roster_rules', { p_league_id: leagueId, p_rounds: rounds, p_pos_caps: posCaps });
/** Commissioner: which designations qualify for an OUT spot (0307) — IR's
 *  week-to-week sibling; same vocabulary, same non-empty rule. */
export const setOutRules = (leagueId: string, tags: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; tags?: string[] }>(
    'set_out_rules', { p_league_id: leagueId, p_tags: tags }),
    Ev.commishAction, { tool: 'out_rules' });

// ── Transactions (0072): commish roster tools, FAAB waivers, trades ──────────
/** rolling = queue that rotates on wins; standings = reverse of the live
 *  standings at every clear (Sleeper's default — winning a claim costs
 *  nothing); faab = blind bids from a season budget. */
export type WaiverMode = 'rolling' | 'standings' | 'faab';
/** Free agency: always open, only inside the hours, or not at all (0287). */
export type FaMode = 'open' | 'window' | 'off';
/** 0321: 'league' joins them — an accepted trade goes out for a veto vote. */
export type TradeReview = 'none' | 'commish' | 'league';
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
  /** May UNCLAIMED seats work the wire (0213)? Separate from the auto-slot
   *  opt-out on purpose: filling a lineup from players the seat already owns
   *  is housekeeping, while adding and dropping changes the league's pool and
   *  spends its FAAB. Absent = on. */
  agentWaivers: boolean | null = null,
  /** FREE AGENCY (0287): 'open' always, 'window' only inside the hours, 'off'
   *  not at all — in which case every unowned player is a waiver claim. Unset
   *  reads from the hours, so a league that has never touched this keeps
   *  exactly the behaviour it has. */
  faMode: FaMode | null = null,
  /** 0319: the FAAB floor (-1 clears to $0), the days free agency may open
   *  ([] clears to every day) and the trade deadline week (-1 clears). */
  faabMinBid: number | null = null,
  faDow: number[] | null = null,
  tradeDeadlineWeek: number | null = null,
  /** 0337: THE SCHEDULE — seven modes, Sunday first, one of 'fa' | 'waivers' |
   *  'waivers_to_fa' | 'locked'. [] clears back to the default schedule; null
   *  leaves it. It replaces `waiverClearDow` / `faDow` / `faAfterWaiversDow`
   *  as the thing a console edits: the run days ARE the schedule now. */
  waiverDays: import('./waiverDays').WaiverDayMode[] | null = null,
  /** 0337: Sleeper's AFTER GAMES WAIVERS CLEAR — the morning a player dropped
   *  once the week's games have started comes off waivers. -1 clears to none. */
  waiverGameHoldDow: number | null = null,
) =>
  rpc<{ ok: boolean; error?: string; waiver_mode?: WaiverMode; faab_budget?: number; trade_review?: TradeReview; agent_waivers?: boolean; fa_mode?: FaMode }>(
    'set_transaction_rules', {
      p_league_id: leagueId, p_waiver_mode: waiverMode, p_faab_budget: faabBudget, p_trade_review: tradeReview,
      p_waiver_clear_min: waiverClearMin, p_waiver_hold_days: waiverHoldDays,
      p_fa_start_min: faStartMin, p_fa_end_min: faEndMin,
      p_waiver_clear_dow: waiverClearDow, p_fa_after_waivers_dow: faAfterWaiversDow,
      p_agent_waivers: agentWaivers, p_fa_mode: faMode,
      p_faab_min_bid: faabMinBid, p_fa_dow: faDow, p_trade_deadline_week: tradeDeadlineWeek,
      p_waiver_days: waiverDays, p_waiver_game_hold_dow: waiverGameHoldDow,
    });
/** THE TRADE FLOOR (0321), the commissioner's own call rather than another
 *  argument on set_transaction_rules: the review mode, how long a league vote
 *  stays open, how many vetoes kill a trade (-1 clears back to a majority of
 *  the teams outside it), how many days an offer stands by default (0 = until
 *  it is answered) and whether FAAB may ride a trade. Nulls leave a knob. */
export const commishSetTradeRules = (
  leagueId: string, review: TradeReview | null = null, reviewHours: number | null = null,
  vetoVotes: number | null = null, offerDays: number | null = null, faabTrading: boolean | null = null,
) =>
  tracked(rpc<{ ok: boolean; error?: string; trade_review?: TradeReview; trade_review_hours?: number;
                trade_veto_votes?: number; trade_offer_days?: number; faab_trading?: boolean }>(
    'commish_set_trade_rules', {
      p_league_id: leagueId, p_review: review, p_review_hours: reviewHours,
      p_veto_votes: vetoVotes, p_offer_days: offerDays, p_faab_trading: faabTrading,
    }), Ev.commishAction, { tool: 'trade_rules' });

// ── This week's number, and the news (0329) ──────────────────────────────────
/** The WEEK's projections for this league's players, keyed by slug. Refreshed
 *  hourly by the worker from the source that knows about the starter who is
 *  out, the back-up who has the job and the bye — which the baked season set
 *  (proj2026.ts) cannot, having been computed in August. A player with no
 *  crosswalk id, or a week not yet polled, is simply absent: the baked
 *  projection still answers for him, and a screen shows the season number
 *  rather than a zero. */
/** One player's week, as the source served it (0330). `mult` is the half that
 *  matters in a custom-scoring league: the source splits a player's WHOLE
 *  projected line by this one number, so THIS league's season rate × mult is
 *  THIS league's week — see data/weekProj. `pts` is the source's own PPR
 *  total, right for a stock league and the fallback everywhere else. */
export interface WeekProjRow {
  pts: number | null;
  mult: number | null;
  /** Opponent team code, and whether he is at home. */
  opp: string | null;
  home: boolean | null;
  /** 'OUT' / 'RES' / 'DEV' / 'backup' — why a number is zero or soft. */
  status: string | null;
  /** 'stathead' | 'espn' — a screen that shows a number owes the reader this. */
  source: string;
  /** Our own injury designation for him — 'O' | 'IR' | 'D' | 'Q' (0333). */
  inj?: string | null;
  /** Did that designation change the number? Only ever true for the week
   *  being played: today's "Out" says nothing about week 9. */
  adjusted?: boolean;
}
export const leagueWeekProjections = (leagueId: string, week: number) =>
  rpc<{ ok?: boolean; error?: string; season?: string; week?: number; as_of?: string | null;
        projections?: Record<string, number>; rows?: Record<string, WeekProjRow> }>(
    'league_week_projections', { p_league_id: leagueId, p_week: week });

/** Every public id we can resolve for one player (0331). Absent keys mean the
 *  crosswalk could not place him — never a guess from his name. */
export interface PlayerIds {
  espn_id?: string; sleeper_id?: string; gsis_id?: string;
  pfr_id?: string; yahoo_id?: string; sportradar_id?: string;
}
/** This league's pool, slug → ids. The same set the public API publishes,
 *  for a signed-in client that should not have to ask the public endpoint
 *  for something it is already entitled to. */
export const leaguePlayerIds = (leagueId: string) =>
  rpc<{ ok?: boolean; error?: string; ids?: Record<string, PlayerIds> }>(
    'league_player_ids', { p_league_id: leagueId });

export interface NewsItem {
  id: string; at: string; headline: string; summary: string | null; url: string | null;
  /** Which of this league's players the story is about. */
  players?: { slug: string; name: string; pos: string }[] | null;
}
/** Headlines about THIS league's players, newest first — the feed a manager
 *  wants, rather than the league-wide wire. */
export const leagueNews = (leagueId: string, limit = 30) =>
  rpc<{ ok?: boolean; error?: string; news?: NewsItem[] }>('league_news',
    { p_league_id: leagueId, p_limit: limit });
/** One player's recent headlines, for the card that opens when you tap him. */
export const playerNews = (espnId: string, limit = 5) =>
  rpc<NewsItem[]>('player_news_for', { p_espn_id: espnId, p_limit: limit });

// ── The public read API (0326) ───────────────────────────────────────────────
/** Is this league readable by the anonymous public API? ON by default for
 *  every league that lives here (0327) — there is no directory, so that means
 *  "readable by whoever holds the league's id", not "listed anywhere" — and
 *  OFF by default for leagues imported from another platform, which are a
 *  mirror of somebody else's system. A league that is off is a 404 to the
 *  API, indistinguishable from one that does not exist. */
/** The base URL this deployment's public API answers on. The edge function
 *  lives under the project host (the same host `auth.dripfantasy.com` already
 *  points at), so this is the URL that actually works today; a prettier
 *  `api.dripfantasy.com` is a DNS step, not a code one (docs/public-api.md). */
export const publicApiUrl = (leagueId?: string) =>
  `${supabaseUrl().replace(/\/$/, '')}/functions/v1/public-api/v1${leagueId ? `/league/${leagueId}` : ''}`;

/** Is this league's read API open? Provider-agnostic — `roster_rules` refuses
 *  an imported league, and the switch was inert there (v0.456.0). Null for a
 *  mock; a caller coalesces. */
export const leaguePublicApi = (leagueId: string) =>
  rpc<boolean | null>('league_public_api', { p_league_id: leagueId });
export const commishSetPublicApi = (leagueId: string, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; public_api?: boolean }>('commish_set_public_api',
    { p_league_id: leagueId, p_on: on }), Ev.commishAction, { tool: 'public_api' });

// ── The write API (0352) ─────────────────────────────────────────────────────
// Keyed control of a league from outside the app — lineups, adds and drops,
// claims, trades, and for the commissioner the league's own tools. The
// commissioner opts the league in; each manager mints their own key. A key is
// shown ONCE (the server keeps only its hash) and acts as whoever minted it,
// with exactly their powers — `team` scope for their own seats only, `league`
// scope (the commissioner's) for every seat and the commissioner's tools.
export interface ApiKeyRow {
  id: string; label: string; scope: 'team' | 'league'; prefix: string;
  created_at: string; last_used_at: string | null; revoked_at: string | null;
  /** Mine, as opposed to one the commissioner can see because they can see all of them. */
  mine: boolean;
  /** The owner's team name — for the commissioner's list. */
  owner: string | null;
}
export interface ApiWriteLogRow {
  id: number; at: string; action: string; roster_id: number | null; ok: boolean;
  error: string | null; prefix: string | null; label: string | null; mine: boolean;
}
export const leagueWriteApi = (leagueId: string) =>
  rpc<boolean>('league_write_api', { p_league_id: leagueId });
export const commishSetWriteApi = (leagueId: string, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; write_api?: boolean }>('commish_set_write_api',
    { p_league_id: leagueId, p_on: on }), Ev.commishAction, { tool: 'write_api' });
export const apiKeys = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; write_api?: boolean; is_commish?: boolean; keys?: ApiKeyRow[] }>(
    'api_keys', { p_league_id: leagueId });
/** The returned `key` is the only time it exists outside the caller's hands. */
export const apiKeyCreate = (leagueId: string, label: string, scope: 'team' | 'league' = 'team') =>
  rpc<{ ok: boolean; error?: string; id?: string; key?: string; prefix?: string; scope?: string }>(
    'api_key_create', { p_league_id: leagueId, p_label: label, p_scope: scope });
export const apiKeyRevoke = (keyId: string) =>
  rpc<{ ok: boolean; error?: string }>('api_key_revoke', { p_key_id: keyId });
export const apiWriteLog = (leagueId: string, limit = 50) =>
  rpc<{ ok: boolean; error?: string; entries?: ApiWriteLogRow[] }>('api_write_log_list',
    { p_league_id: leagueId, p_limit: limit });

// ── Weekly awards and badges (0325) ──────────────────────────────────────────
/** An award DEFINITION: three choices that between them cover everything a
 *  week's scores can say about a team. `is_default` marks the built-in four a
 *  league gets until it changes one. */
export interface AwardDef {
  key: string; name: string; icon: string;
  metric: 'points' | 'points_against' | 'margin' | 'combined';
  direction: 'high' | 'low';
  /** Count every week, only wins, or only losses — "highest score that still
   *  lost" is points/high/loss. */
  only_result: 'any' | 'win' | 'loss';
  /** An optional drip-coin prize paid to the winner (0 = a trophy only). */
  coin: number; sort: number; is_default: boolean;
}
export interface AwardWin { key: string; name: string; icon: string; roster_id: number; team: string | null; value: number | null; }
export interface BadgeDef { key: string; name: string; icon: string; note: string | null; sort: number; }
export interface BadgeGrant { key: string; roster_id: number; season: string; note: string | null; team: string | null; icon: string | null; name: string | null; }
export interface LeagueAwards {
  ok?: boolean; error?: string;
  awards?: AwardDef[];
  badges?: BadgeDef[];
  grants?: BadgeGrant[];
  /** The recent weeks, newest first. */
  weeks?: { week: number; wins: AwardWin[] }[];
  /** How many of each award each seat has won this season. */
  counts?: { roster_id: number; team: string | null; key: string; icon: string; name: string; n: number }[];
}
export const leagueAwards = (leagueId: string, weeks = 6) =>
  rpc<LeagueAwards>('league_awards', { p_league_id: leagueId, p_weeks: weeks });
/** Commissioner: add or change one award. The key is the identity — an
 *  existing key edits, a new one adds — and nulls leave a field alone, so a
 *  console can save one field at a time. The first edit writes the built-in
 *  four down as real rows, so renaming one does not delete the others. */
export const commishSetAward = (
  leagueId: string, key: string,
  a: { name?: string; icon?: string; metric?: AwardDef['metric']; direction?: AwardDef['direction'];
       onlyResult?: AwardDef['only_result']; coin?: number; active?: boolean; sort?: number; note?: string } = {},
) =>
  tracked(rpc<{ ok: boolean; error?: string; key?: string }>('commish_set_award', {
    p_league_id: leagueId, p_key: key,
    p_name: a.name ?? null, p_icon: a.icon ?? null, p_metric: a.metric ?? null,
    p_direction: a.direction ?? null, p_only_result: a.onlyResult ?? null,
    p_coin: a.coin ?? null, p_active: a.active ?? null, p_sort: a.sort ?? null, p_note: a.note ?? null,
  }), Ev.commishAction, { tool: 'award_set' });
/** Retire an award. What it has already handed out stays — the trophy case is
 *  a record of what happened, not of what the rules currently say. */
export const commishDeleteAward = (leagueId: string, key: string) =>
  tracked(rpc<{ ok: boolean; error?: string; kept_wins?: number }>('commish_delete_award',
    { p_league_id: leagueId, p_key: key }), Ev.commishAction, { tool: 'award_delete' });
/** Commissioner: define a badge (🐐, 🤡, PAID HIS DUES — whatever the league
 *  is like). Granting it is a separate call. */
export const commishSetBadge = (leagueId: string, key: string, b: { name?: string; icon?: string; note?: string; sort?: number } = {}) =>
  tracked(rpc<{ ok: boolean; error?: string; key?: string }>('commish_set_badge', {
    p_league_id: leagueId, p_key: key, p_name: b.name ?? null, p_icon: b.icon ?? null,
    p_note: b.note ?? null, p_sort: b.sort ?? null,
  }), Ev.commishAction, { tool: 'badge_set' });
export const commishDeleteBadge = (leagueId: string, key: string) =>
  tracked(rpc<{ ok: boolean; error?: string }>('commish_delete_badge', { p_league_id: leagueId, p_key: key }),
    Ev.commishAction, { tool: 'badge_delete' });
/** Pin a badge on a seat, stamped with the season (defaults to the league's),
 *  so the same badge can be won again next year without erasing this year's. */
export const commishGrantBadge = (leagueId: string, rosterId: number, key: string, season?: string, note?: string) =>
  tracked(rpc<{ ok: boolean; error?: string; season?: string }>('commish_grant_badge', {
    p_league_id: leagueId, p_roster_id: rosterId, p_key: key, p_season: season ?? null, p_note: note ?? null,
  }), Ev.commishAction, { tool: 'badge_grant' });
export const commishRevokeBadge = (leagueId: string, rosterId: number, key: string, season?: string) =>
  tracked(rpc<{ ok: boolean; error?: string }>('commish_revoke_badge', {
    p_league_id: leagueId, p_roster_id: rosterId, p_key: key, p_season: season ?? null,
  }), Ev.commishAction, { tool: 'badge_revoke' });
/** Hand out one league-week's awards. Idempotent, and re-runnable: an award
 *  added in week 9 fills in the weeks behind it without disturbing them. The
 *  worker sweeps this; a screen may poke it for the week it is showing. */
export const awardWeek = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; awarded?: number; skipped?: string }>('award_week',
    { p_league_id: leagueId, p_week: week });

// ── The league's history (0324) ──────────────────────────────────────────────
/** One season in a league's lineage, as the history screen shows it. */
export interface HistorySeason {
  league_id: string; season: string; name: string | null; current: boolean;
  champion: { roster_id: number; team: string | null; avatar?: string | null } | null;
  runner_up: { roster_id: number; team: string | null } | null;
  /** The regular-season table, best first. */
  table: { roster_id: number; team: string | null; w: number; l: number; t: number; pf: number; pa: number }[];
  high_week: { week: number; roster_id: number; team: string | null; points: number } | null;
}
export interface HistoryWeekRow {
  season: string; week: number; playoff?: boolean; points: number;
  roster_id: number; team: string | null; opp?: string | null; opp_points?: number;
}
export interface HistoryGameRow {
  season: string; week: number; margin: number; winner: string | null; loser: string | null; score: string;
}
export interface HistoryManager {
  manager: string; team: string | null; app_user_id: string | null;
  seasons: number; w: number; l: number; t: number; pf: number;
  /** Titles won, and how many title games they reached. */
  titles: number; finals: number;
  /** 0325: weekly awards won, and the badges pinned on them. */
  awards?: number;
  badges?: { icon: string; name: string; season: string }[];
}
export interface LeagueHistory {
  ok?: boolean; error?: string; league_id?: string; seasons_count?: number;
  seasons?: HistorySeason[];
  records?: {
    top_weeks: HistoryWeekRow[]; low_weeks: HistoryWeekRow[];
    blowouts: HistoryGameRow[]; nailbiters: HistoryGameRow[];
    top_seasons: { season: string; pf: number; record: string; roster_id: number; team: string | null }[];
    best_records: { season: string; record: string; pct: number; pf: number; roster_id: number; team: string | null }[];
  };
  managers?: HistoryManager[];
}
/** Past champions, the record book and every manager's all-time line, across
 *  every season this league has rolled through (0324). Any member of ANY of
 *  those seasons may read all of them — a manager who joined last August
 *  should see the seasons he missed. */
export const leagueHistory = (leagueId: string) =>
  rpc<LeagueHistory>('league_history', { p_league_id: leagueId });

/** THE LEAGUE REGISTER (0186): every in-season roster movement, newest first.
 *  Adds, drops, waiver wins (with the bid), trades (with the seat each player
 *  came from) and commissioner moves — written by a trigger on native_roster,
 *  so it covers every path. Draft night is deliberately absent: the draft room
 *  is already its own record. Any member may read it. */
export interface RegisterRow {
  id: number; at: string;
  /** 0221/0222 grew the vocabulary: eliminations + releases (guillotine),
   *  steals (vampire), and the front office (tag/extension/rfa/retained/cap). */
  kind: 'add' | 'drop' | 'waiver' | 'trade' | 'commish'
      | 'elimination' | 'release' | 'steal' | 'tag' | 'extension' | 'rfa' | 'retained' | 'cap'
      /** 0321: FAAB dollars moved as a trade asset. */
      | 'faab';
  slug: string;
  roster_id: number; team: string | null;
  /** Trades only: the seat the player came from. */
  from_roster: number | null; from_team: string | null;
  /** 0354: this line was taken back by the commissioner; the lines the undo
   *  itself wrote carry `undo_of`; and — for the commissioner only — whether
   *  ↩ UNDO would accept this line right now. */
  undone?: boolean; undo_of?: number | null; can_undo?: boolean | null;
  /** Waiver wins in a FAAB league. */
  bid: number | null;
  /** Event detail (0221): "guillotine week 3", "franchise tagged — $18 for 1yr". */
  note?: string | null;
}
export const leagueRegister = (leagueId: string, limit = 100) =>
  rpc<{ ok: boolean; error?: string; rows?: RegisterRow[]; is_commish?: boolean }>('league_register',
    { p_league_id: leagueId, p_limit: limit });

/** ↩ UNDO (0354) — the commissioner takes back an add, a drop or a waiver
 *  claim from its register line: the pickup goes back on waivers, the drop
 *  comes home, a FAAB bid is refunded and the waiver order restored where
 *  nothing has moved it since. Refused, with the reason, when the move is no
 *  longer true (the pickup moved on, the drop was picked up, a game kicked off). */
export const commishUndoTxn = (txnId: number) =>
  tracked(rpc<{ ok: boolean; error?: string; note?: string }>('commish_undo_txn', { p_txn_id: txnId }),
    Ev.commishAction, { tool: 'undo_txn' });

/** A PLAYER'S WAIVER HOLD, BY HAND (0354). */
export interface HeldPlayer { slug: string; name: string; pos: string; team: string; until: string | null; claims?: number }
export const leagueWaiverHolds = (leagueId: string, search?: string) =>
  rpc<{ ok: boolean; error?: string; next_run?: string | null; held?: HeldPlayer[]; found?: HeldPlayer[] }>(
    'league_waiver_holds', { p_league_id: leagueId, p_search: search ?? null });
/** 'free' = a free agent now; 'next_run' = on waivers until the run a drop
 *  would wait for; 'until' = held until `until` (within two weeks). */
export const commishSetWaiverHold = (leagueId: string, slug: string, mode: 'free' | 'next_run' | 'until', until?: string) =>
  tracked(rpc<{ ok: boolean; error?: string; until?: string | null; note?: string }>('commish_set_waiver_hold',
    { p_league_id: leagueId, p_slug: slug, p_mode: mode, p_until: until ?? null }), Ev.commishAction, { tool: 'waiver_hold' });

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
  /** Contract leagues (0219): retained-salary terms and traded cap dollars. */
  retain?: { slug: string; amount: number; roster: number }[] | null;
  cap_dollars?: number | null;
  /** 0321: FAAB dollars as an asset (positive = the PROPOSER sends them). */
  faab_dollars?: number | null;
  status: 'pending' | 'accepted' | 'review' | 'executed' | 'rejected' | 'cancelled'
        | 'vetoed' | 'expired' | 'countered' | 'reversed';
  note: string | null; created_at: string; resolved_at: string | null;
  /** 0321: when this offer lapses (null = it stands until answered), when the
   *  league vote closes, and the offer this one answers. */
  expires_at?: string | null;
  review_until?: string | null;
  counters?: string | null;
  /** 0321: the vote so far, and the number of vetoes that would kill it. */
  votes?: { roster_id: number; veto: boolean }[];
  veto_need?: number;
  /** 0322: a MULTI-TEAM deal's legs — one per seat, each asset naming where
   *  it goes, and each seat's own acceptance. Null on an ordinary two-seat
   *  offer, which is how a screen tells the two shapes apart; `give`/`get`
   *  are empty on a multi-team row. */
  legs?: TradeLeg[] | null;
}
/** One seat's side of a multi-team trade (0322). */
export interface TradeLeg {
  roster_id: number;
  send: { slug: string; to: number }[];
  send_picks: { season: string; round: number; orig: number; to: number }[];
  send_faab: { to: number; amount: number }[];
  send_cap: { to: number; amount: number }[];
  accepted: boolean;
}
export const leagueTrades = (leagueId: string, limit = 30) =>
  rpc<TradeRow[] | { error: string }>('league_trades', { p_league_id: leagueId, p_limit: limit });
export const proposeTrade = (
  leagueId: string, fromRoster: number, toRoster: number, give: string[], get: string[], note?: string,
  /** season omitted = next season; multi-year futures name theirs (0185). */
  givePicks?: { season?: string; round: number; orig: number }[], getPicks?: { season?: string; round: number; orig: number }[],
  /** Contract leagues (0219): salary the current owner keeps eating on a
   *  traded player ($1..salary−1), and raw cap dollars moved as an asset
   *  (positive = the proposer sends cap room). */
  retain?: { slug: string; amount: number }[], capDollars?: number,
  /** 0321: FAAB dollars moved with the deal (positive = the proposer sends
   *  them), and how long the offer stands — hours, -1 for "until it is
   *  answered", or undefined to take the league's default. */
  faabDollars?: number, expiresHours?: number,
) =>
  tracked(rpc<{ ok: boolean; error?: string; trade_id?: string; expires_at?: string | null }>('propose_trade', {
    p_league_id: leagueId, p_from_roster: fromRoster, p_to_roster: toRoster,
    p_give: give, p_get: get, p_note: note ?? null,
    p_give_picks: givePicks ?? null, p_get_picks: getPicks ?? null,
    p_retain: retain && retain.length > 0 ? retain : null,
    p_cap_dollars: capDollars ?? null,
    p_faab_dollars: faabDollars ?? 0, p_expires_hours: expiresHours ?? null,
  }), Ev.tradeProposed, { players: give.length + get.length, picks: (givePicks?.length ?? 0) + (getPicks?.length ?? 0) });

/** 0321: answer an offer with an offer. The original closes as 'countered' and
 *  the mirrored proposal is filed from the answering seat in one transaction —
 *  `give` is what THEY send. Everything a proposal may carry carries here. */
export const counterTrade = (
  tradeId: string, give: string[], get: string[], note?: string,
  givePicks?: { season?: string; round: number; orig: number }[], getPicks?: { season?: string; round: number; orig: number }[],
  retain?: { slug: string; amount: number }[], capDollars?: number,
  faabDollars?: number, expiresHours?: number,
) =>
  tracked(rpc<{ ok: boolean; error?: string; trade_id?: string; counters?: string }>('counter_trade', {
    p_trade_id: tradeId, p_give: give, p_get: get, p_note: note ?? null,
    p_give_picks: givePicks ?? null, p_get_picks: getPicks ?? null,
    p_retain: retain && retain.length > 0 ? retain : null,
    p_cap_dollars: capDollars ?? null,
    p_faab_dollars: faabDollars ?? 0, p_expires_hours: expiresHours ?? null,
  }), Ev.tradeProposed, { players: give.length + get.length, counter: true });

/** 0322: a THREE-TEAM (or more) trade. Each leg is one seat and what it
 *  sends, every asset addressed to another seat in the deal — which is what
 *  makes a carousel work: A's receiver goes to B, B's back to C, C's pick to
 *  A, and no two seats have a trade between them. The proposer must be in it,
 *  their leg is accepted on filing, and nothing moves until the last seat
 *  answers (respond_trade, the same call a two-seat offer takes). Salary
 *  retention is refused here — it is a two-seat term. */
export const proposeMultiTrade = (
  leagueId: string,
  legs: {
    roster: number;
    send?: { slug: string; to: number }[];
    send_picks?: { season?: string; round: number; orig: number; to: number }[];
    send_faab?: { to: number; amount: number }[];
    send_cap?: { to: number; amount: number }[];
  }[],
  note?: string, expiresHours?: number,
) =>
  tracked(rpc<{ ok: boolean; error?: string; trade_id?: string; teams?: number; expires_at?: string | null }>(
    'propose_multi_trade', {
      p_league_id: leagueId, p_legs: legs, p_note: note ?? null, p_expires_hours: expiresHours ?? null,
    }), Ev.tradeProposed, { teams: legs.length, multi: true });

/** 0321: one uninvolved seat's vote on a trade out for league review. Veto =
 *  against; an allow counts too, because a vote whose outcome is already
 *  arithmetic settles at once instead of sitting out its window. */
export const castTradeVote = (tradeId: string, veto: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string; vetoes?: number; need?: number }>(
    'cast_trade_vote', { p_trade_id: tradeId, p_veto: veto }),
    Ev.tradeResponded, { action: veto ? 'veto' : 'allow' });
export const respondTrade = (tradeId: string, accept: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string }>('respond_trade', { p_trade_id: tradeId, p_accept: accept }),
    Ev.tradeResponded, { action: accept ? 'accept' : 'reject' });
export const cancelTrade = (tradeId: string) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string }>('cancel_trade', { p_trade_id: tradeId }),
    Ev.tradeResponded, { action: 'cancel' });
/** 0328: the commissioner's last resort — reverse a COMPLETED trade. Every
 *  leg run backwards in one transaction: players home, picks home, FAAB and
 *  cap home, retained salary un-retained. Refuses (rather than half-undoing)
 *  when a piece has moved on, when the undo would leave a roster illegal, or
 *  when the FAAB has already been spent. The trade is stamped 'reversed'
 *  rather than deleted — it happened. */
export const commishReverseTrade = (tradeId: string, note?: string) =>
  tracked(rpc<{ ok: boolean; error?: string; status?: string; teams?: number }>('commish_reverse_trade',
    { p_trade_id: tradeId, p_note: note ?? null }), Ev.commishAction, { tool: 'trade_reverse' });

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
  id: number; body: string; at: string; author: string; author_id: string | null; mine: boolean;
  kind: 'text' | 'poll' | 'report' | 'txn'; pinned: boolean; mentions_me: boolean; poll?: ChatPoll;
  /** What the poster wrote under a picture (0350). Null on everything else,
   *  and on every message posted before captions existed. */
  caption?: string | null;
  /** When this message was last reworded (0351), and by whom as a display name
   *  — null when the author edited their own, which the clients render as a
   *  plain "edited". Both null on anything nobody has edited. */
  edited_at?: string | null;
  edited_by?: string | null;
  /** A weekly report line (0275): the house posted it; the link opens the week. */
  report?: { week: number };
  /** A transaction line (0290): an add, a drop, a waiver run or a trade. */
  txn?: import('./txnChat').TxnPayload;
  /** Quick reactions (0210), counted per emoji. Only ones somebody used. */
  reactions?: import('./chatReactions').ChatReactionCount[];
}
export interface DmThreadRow { thread_id: string; peer_id: string; peer: string; last_at: string; preview: string | null; unread: number; }
export interface DmMessage {
  id: number; body: string; at: string; mine: boolean; caption?: string | null;
  /** 0351. No editor name: a DM has no commissioner, so every edit is the
   *  author's own and every note reads "edited". */
  edited_at?: string | null;
}
/** `caption` (0350) rides beside the body rather than inside it: the body of an
 *  image message stays the bare URL every client already renders inline. */
export const chatPost = (leagueId: string, body: string, mentions: string[] = [], caption?: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; id?: number }>('chat_post', {
    p_league_id: leagueId, p_body: body, p_mentions: mentions, p_caption: caption ?? null,
  }), Ev.chatPosted, { kind: postKind(body), dm: false, mentions: mentions.length, captioned: !!caption });
export const chatPostPoll = (leagueId: string, question: string, options: string[]) =>
  tracked(rpc<{ ok: boolean; error?: string; id?: number }>('chat_post_poll', { p_league_id: leagueId, p_question: question, p_options: options }),
    Ev.chatPosted, { kind: 'poll', dm: false, options: options.length });
export const pollCast = (leagueId: string, messageId: number, choice: number) =>
  tracked(rpc<{ ok: boolean; error?: string }>('poll_cast', { p_league_id: leagueId, p_message_id: messageId, p_choice: choice }),
    Ev.pollVoted);
export const chatPin = (leagueId: string, id: number, on: boolean) =>
  tracked(rpc<{ ok: boolean; error?: string }>('chat_pin', { p_league_id: leagueId, p_id: id, p_on: on }),
    Ev.chatPinned, { on });
/** The weekly report behind a chat line of kind 'report' (0275). */
export const leagueReport = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; report?: import('./weekReport').WeekReport; at?: string }>('league_report_get', { p_league_id: leagueId, p_week: week });
/** Latest page (no `before`) marks the channel read and carries the pin strip. */
export const chatMessages = (leagueId: string, before?: number) =>
  rpc<{ ok: boolean; error?: string; messages?: ChatMessage[]; pins?: ChatMessage[] }>('chat_messages', {
    p_league_id: leagueId, p_before: before ?? null, p_limit: 50,
  });
/** TOGGLE a quick reaction (0210). Returns the message's whole reaction set so
 *  the caller can repaint one message without refetching the page — a chat that
 *  reloads on every tap is a chat that scrolls away from you. */
export const chatReact = (leagueId: string, messageId: number, emoji: string) =>
  tracked(rpc<{ ok: boolean; error?: string; on?: boolean; reactions?: import('./chatReactions').ChatReactionCount[] }>(
    'chat_react', { p_league_id: leagueId, p_message_id: messageId, p_emoji: emoji }),
    Ev.chatReacted, { emoji });
export const chatDelete = (leagueId: string, id: number) =>
  rpc<{ ok: boolean; error?: string }>('chat_delete', { p_league_id: leagueId, p_id: id });
/** REWORD a message (0351) — the author's or the commissioner's, and signed
 *  either way. An image message keeps its URL and edits its caption; the server
 *  holds that line too, so `body` there is the one it already had. */
export const chatEdit = (leagueId: string, id: number, body: string, mentions: string[] = [], caption?: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; unchanged?: boolean; edited_at?: string; edited_by?: string }>('chat_edit', {
    p_league_id: leagueId, p_id: id, p_body: body, p_mentions: mentions, p_caption: caption ?? null,
  }), Ev.chatEdited);
/** REWORD a DM (0351) — yours only; there is nobody else in a thread who could.
 *  Like the league channel, an image message keeps its URL and edits its
 *  caption. */
export const dmEdit = (threadId: string, id: number, body: string, caption?: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; unchanged?: boolean; edited_at?: string }>('dm_edit', {
    p_thread_id: threadId, p_id: id, p_body: body, p_caption: caption ?? null,
  }), Ev.chatEdited, { dm: true });
export const dmSend = (leagueId: string, to: string, body: string, caption?: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; thread_id?: string; id?: number }>('dm_send', {
    p_league_id: leagueId, p_to: to, p_body: body, p_caption: caption ?? null,
  }), Ev.chatPosted, { kind: postKind(body), dm: true, mentions: 0, captioned: !!caption });
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

/** ── THE SHELF, IN ONE ASK (0347) ────────────────────────────────────────────
 *  Founder: "Matchup summary per league and a notification for unread chats."
 *  Every enrolled league's current matchup — my side and my opponent's, with
 *  records — plus that league's unread counts, in a single round trip. It
 *  replaces a `chat_unread` fan-out of one RPC per league per minute, and its
 *  scores come from the same `league_week_scoreboard` the league page reads,
 *  so a list and the page it opens can never disagree about a score. */
export interface SlateSide {
  roster_id: number; team: string | null; points: number | null; live: boolean;
  record: { wins: number; losses: number; ties: number } | null;
}
export interface LeagueSlateRow {
  league_id: string; name: string; roster_id: number; week: number | null;
  /** Null for a bye, an odd league, or a week with no fixture for this seat —
   *  a card that prints a score is claiming a game was played. */
  game: { status: string; playoff: boolean; consolation: boolean; label: string | null;
          me: SlateSide; opp: SlateSide } | null;
  unread: { league: number; dm: number; mention: number };
}
export const myLeagueSlate = () =>
  rpc<{ ok: boolean; error?: string; leagues?: LeagueSlateRow[] }>('my_league_slate', {});

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
  rpc<{ ok: boolean; error?: string; members?: { id: string; name: string; me: boolean }[];
        /** 0238: which member OWNS each roster — Teams & rosters prints the
         *  owner and hands the id to 💬 MESSAGE / ⇄ TRADE. */
        seats?: { roster: number; user: string }[] }>('chat_members', { p_league_id: leagueId });

// ── App push notifications (0150): device token registry + per-device mutes ──
export interface PushTokenRow { token: string; platform: string; prefs: Record<string, boolean>; last_seen_at: string; }
export const registerPushToken = (token: string, platform = 'android', prefs?: Record<string, boolean>) =>
  rpc<{ ok: boolean; error?: string }>('register_push_token', { p_token: token, p_platform: platform, p_prefs: prefs ?? null });
export const removePushToken = (token: string) =>
  rpc<{ ok: boolean; removed?: boolean }>('remove_push_token', { p_token: token });
export const setPushPrefs = (token: string, prefs: Record<string, boolean>) =>
  rpc<{ ok: boolean; error?: string; prefs?: Record<string, boolean> }>('set_push_prefs', { p_token: token, p_prefs: prefs });
export const myPushTokens = () => rpc<PushTokenRow[]>('my_push_tokens');
// ── Push diagnostics (0276): a test push, and what became of your pushes ────
export interface PushLogRow { id: number; kind: string; title: string; at: string; sent_at: string | null; error: string | null; }
export const pushTest = () =>
  rpc<{ ok: boolean; error?: string; id?: number; devices?: number }>('push_test');
export const myPushLog = () =>
  rpc<{ ok: boolean; error?: string; rows?: PushLogRow[]; devices?: { platform: string; seen: string }[] }>('my_push_log');
/** One line a manager can read off an outbox row. The 'waiting-*' marks are
 *  the worker's: that channel has no credentials on the server yet. */
export function pushLogStatus(r: PushLogRow): { glyph: string; text: string; tone: 'ok' | 'bad' | 'wait' } {
  if (r.sent_at && !r.error) return { glyph: '✓', text: 'delivered', tone: 'ok' };
  // v0.392.2: the worker names each device that refused ("phone refused: …",
  // "browser refused: …") and how many delivered; a partial delivery is a
  // half-mark, not a failure.
  if (r.sent_at && r.error?.startsWith('delivered to ')) return { glyph: '◐', text: r.error, tone: 'wait' };
  if (r.sent_at && /^(phone|browser) refused: /.test(r.error ?? '')) return { glyph: '✗', text: r.error ?? '', tone: 'bad' };
  if (r.sent_at) return { glyph: '✗', text: r.error === 'no devices' ? 'no device was registered' : `refused: ${r.error}`, tone: 'bad' };
  if (r.error === 'waiting-vapid') return { glyph: '⏳', text: 'waiting — the server has no browser push key yet', tone: 'wait' };
  if (r.error === 'waiting-fcm') return { glyph: '⏳', text: 'waiting — the server has no phone push key yet', tone: 'wait' };
  return { glyph: '⏳', text: 'queued — the worker sends within a minute', tone: 'wait' };
}

// ── Every message, per league (0241) ────────────────────────────────────────
// Founder: "anytime someone ... posts a comment". The per-device mutes above
// are global — turning chat off turns it off everywhere — so "every word of
// THIS league" is a different question and gets its own answer. Off unless
// somebody said yes.
export const myLeagueChatPush = (leagueId: string) =>
  rpc<{ ok: boolean; all_messages: boolean }>('my_league_chat_push', { p_league_id: leagueId });
export const setLeagueChatPush = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; all_messages?: boolean }>('set_league_chat_push', { p_league_id: leagueId, p_on: on });

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
export interface StandingsRow { roster_id: number; team: string | null; wins: number; losses: number; ties: number; pf: number; pa: number; /** The median game's share of the record (0320); 0 when it is off. */ median_w?: number; median_l?: number; /** The seat's division label (0215); null until the commissioner draws the map. */ division?: string | null; /** This seat is a vampire (0269) — badge it wherever the row renders. */ vampire?: boolean; /** The week the guillotine took this seat (0272); null while it lives. */ eliminated?: number | null; }
export interface PlayoffMatchup {
  id: string; week: number; round: number; pos: number; label: string | null; status: string;
  /** Consolation-ladder game (never blocks bracket advancement). */
  consolation: boolean;
  home: number; away: number; home_final: number | null; away_final: number | null; winner: number | null;
}
export interface PlayoffState {
  error?: string; ok?: boolean;
  /** 0 = this league plays no playoffs (0246). */
  playoff_teams: number;
  playoff_start_week: number;
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
/** Commissioner: bracket size + start week — locked once underway.
 *  `teams` is 0 (no playoffs at all — 0246), 2, 4, 6 or 8. Zero deletes a
 *  bracket that was only ever scheduled and makes both the commissioner's
 *  generate and the auto poke refuse; the season then ends with the last
 *  regular-season week. A guillotine league sets itself to 0. */
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
  mode: 'snake' | 'linear' | 'auction' = 'snake', budget = 200, lotSeconds = 15, maxLots = 1,
  posCaps: PosCaps | null = null,
) =>
  rpc<NativeCreateResult>('create_mock_draft', {
    p_teams: teams, p_rounds: rounds, p_pick_seconds: pickSeconds,
    p_mode: mode, p_budget: budget, p_lot_seconds: lotSeconds, p_max_lots: maxLots,
    p_pos_caps: posCaps,
  });
/** A PRACTICE ROOM (0281): mock THIS league's draft, from a slot you choose.
 *  Open to any enrolled member — not just the commissioner, and not only
 *  people carrying the `native` feature flag. Clones the league's game mode,
 *  roster size, draft mode, clocks, caps and player pool; seats the AI under
 *  your leaguemates' names; leaves the real league untouched. `slot` is your
 *  pick number in round one, 1..teams. */
export const createPracticeRoom = (leagueId: string, slot?: number) =>
  rpc<{
    ok: boolean; error?: string; league_id?: string; roster_id?: number;
    slot?: number; teams?: number; game_mode?: string; source?: string; name?: string;
    rounds?: number; mode?: string; pool?: number;
  }>('create_mock_from_league', { p_league_id: leagueId, p_slot: slot ?? null });

/** WHO IS IN THE ROOM (0286): mark me present and get everyone's last beat
 *  back in the same round trip. `secs` is how long ago that seat was last
 *  seen — the client decides what stale means, so a client that dies fades
 *  instead of lying "here" forever. */
export interface DraftPresence { roster_id: number; seen_at: string; secs: number }
export const draftHere = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; server_now?: string; here?: DraftPresence[] }>(
    'draft_here', { p_league_id: leagueId });

/** A seat counts as IN THE ROOM for this long after its last beat. The client
 *  beats every 10s, so this is four missed beats — long enough to ride out a
 *  phone waking up or a tab throttling, short enough that a manager who walked
 *  away shows as gone before their clock does. Shared so the web and the app
 *  never disagree about who is here. */
export const PRESENCE_STALE_SECS = 40;
export const seatIsHere = (here: DraftPresence[] | null | undefined, rosterId: number | null | undefined): boolean =>
  rosterId != null && (here ?? []).some((h) => h.roster_id === rosterId && h.secs <= PRESENCE_STALE_SECS);

/** THE DRAFT LOG (0284): what happened, in order — every pick, autopick,
 *  auction award and nomination, every undo/edit/reset, start/pause/resume/
 *  complete, every autodraft toggle, and (0285) every clock that ran out.
 *  Oldest first from `after` (exclusive), so poll with the last id you hold. */
export type DraftEventKind =
  | 'start' | 'pick' | 'autopick' | 'forced' | 'won' | 'nominate' | 'removed' | 'edit'
  | 'reset' | 'pause' | 'resume' | 'complete' | 'autodraft_on' | 'autodraft_off' | 'timeout';
export interface DraftEvent {
  id: number; at: string; kind: DraftEventKind | string;
  roster_id: number | null; team: string | null;
  slug: string | null; player: string | null; pos: string | null; nfl: string | null;
  overall: number | null; round: number | null; price: number | null;
  actor_role: 'server' | 'commish' | 'member'; actor_roster: number | null; actor_team?: string | null;
  detail: Record<string, unknown>;
}
export const draftLog = (leagueId: string, after = 0, limit = 300) =>
  rpc<{ ok: boolean; error?: string; events?: DraftEvent[] }>('draft_log',
    { p_league_id: leagueId, p_after: after, p_limit: limit });

/** Wipe a mock draft (its commissioner or an admin); refuses real leagues. */
export const deleteMockDraft = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string }>('delete_mock_draft', { p_league_id: leagueId });
/** Claim the lowest open seat in a native league by invite code. */
export const nativeJoin = (code: string, teamName?: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string; roster_id?: number; status?: string; league?: string }>(
    'native_join', { p_code: code.trim(), p_team_name: teamName?.trim() || null });
export const setTeamName = (leagueId: string, rosterId: number, name: string) =>
  rpc<{ ok: boolean; error?: string; team_name?: string }>('set_team_name', { p_league_id: leagueId, p_roster_id: rosterId, p_name: name });
/** Name (or clear, with null/'') a seat's division — commissioner only (0215).
 *  Divisions activate once every seat is labeled and ≥2 labels exist. */
export const setTeamDivision = (leagueId: string, rosterId: number, division: string | null) =>
  rpc<{ ok: boolean; error?: string; division?: string | null }>('set_team_division', { p_league_id: leagueId, p_roster_id: rosterId, p_division: division });

// ── Contracts + salary cap (0217–0220) ────────────────────────────────────────
/** One player's deal: the auction bid (or FAAB bid, rookie-scale figure, $1
 *  street minimum) as salary, the manager-assigned length, and how it began.
 *  `retained` is what former teams still eat; `mkt` the league's own market
 *  price (top-5 positional average). */
export interface ContractDeal { slug: string; roster_id: number; salary: number; years: number; acquired: 'auction' | 'rookie' | 'draft' | 'waiver' | 'fa' | 'commish'; tagged?: boolean; mkt?: number; retained?: number; }
/** The 📜 SALARY rulebook (0219) — every knob the commissioner can turn. */
export interface SalaryRules { dead_pct: number; retention: boolean; cap_trading: boolean; ir_relief: boolean; tag_raise_pct: number; ext_discount_pct: number; rfa: boolean; rookie_years?: number; }
export interface RfaTenderRow { slug: string; roster_id: number; status: 'open' | 'matched' | 'walked'; offer_roster: number | null; offer_salary: number | null; offer_years: number | null; }
export interface LeagueContracts {
  error?: string;
  /** False = the league doesn't play with contracts; everything else absent. */
  contracts: boolean;
  salary_cap?: number; years_max?: number;
  /** True once the draft room closes — lengths become commissioner-only. */
  locked?: boolean;
  /** The offseason window is open (Super Bowl gate, or admin) — tags,
   *  extensions and RFA are live. */
  offseason?: boolean;
  rules?: SalaryRules;
  deals?: ContractDeal[];
  /** Ghost lines: salary a team retained on players it traded away. */
  retentions?: { roster_id: number; slug: string; amount: number }[];
  /** Dead cap from cuts, charged this season and years_left−1 more. */
  dead?: { roster_id: number; slug: string; amount: number; years_left: number; note: string | null }[];
  tenders?: RfaTenderRow[];
  payrolls?: { roster_id: number; team: string | null; payroll: number; cap?: number; cap_adjust?: number }[];
  /** 0229 lock-to-play: my seat's lock, the auto-lock deadline, every seat's
   *  state. `locked` above is the CALLER's assignability, not the league's. */
  my_locked?: boolean;
  lock_deadline?: string | null;
  locks?: { roster_id: number; locked: boolean }[];
}
/** 0229: confirm your lengths as written — the wire opens for your team when
 *  you lock (or at the league deadline, when unset deals stand at 1 year). */
export const lockContracts = (leagueId: string, rosterId: number) =>
  rpc<{ ok: boolean; error?: string; locked?: boolean; deals?: number }>('lock_contracts',
    { p_league_id: leagueId, p_roster_id: rosterId });
/** The cap sheet — rules, every deal, per-team payrolls (any member). */
export const leagueContracts = (leagueId: string) => rpc<LeagueContracts>('league_contracts', { p_league_id: leagueId });
/** Commissioner: switch the cap on at $cap (with an optional max length,
 *  default 4), or off with cap=null. While an auction room is open the cap
 *  must cover the startup budget. */
export const setContractRules = (leagueId: string, cap: number | null, yearsMax: number | null = null) =>
  rpc<{ ok: boolean; error?: string; contracts?: boolean; salary_cap?: number; contract_years_max?: number }>(
    'set_contract_rules', { p_league_id: leagueId, p_cap: cap, p_years_max: yearsMax });
/** The owner assigns a length (1..max) while the draft room is open; after it
 *  closes this is commissioner-only, and rookie-scale lengths always are. */
export const setContractYears = (leagueId: string, slug: string, years: number) =>
  rpc<{ ok: boolean; error?: string; years?: number }>('set_contract_years', { p_league_id: leagueId, p_slug: slug, p_years: years });
/** Commissioner (0231): how many years a rookie-scale deal signs for —
 *  default 4 (the NFL's own rookie term), clamped to the league max. */
export const setRookieYears = (leagueId: string, years: number) =>
  rpc<{ ok: boolean; error?: string; rookie_years?: number }>('set_rookie_years',
    { p_league_id: leagueId, p_years: years });
/** Commissioner (0219): the 📜 SALARY rulebook — nulls leave a knob alone. */
export const setSalaryRules = (leagueId: string, r: {
  deadPct?: number | null; retention?: boolean | null; capTrading?: boolean | null;
  irRelief?: boolean | null; tagRaisePct?: number | null; extDiscountPct?: number | null; rfa?: boolean | null;
}) =>
  rpc<{ ok: boolean; error?: string } & Partial<SalaryRules>>('set_salary_rules', {
    p_league_id: leagueId,
    p_dead_pct: r.deadPct ?? null, p_retention: r.retention ?? null,
    p_cap_trading: r.capTrading ?? null, p_ir_relief: r.irRelief ?? null,
    p_tag_raise_pct: r.tagRaisePct ?? null, p_ext_discount_pct: r.extDiscountPct ?? null,
    p_rfa: r.rfa ?? null,
  });
/** Offseason (0220): one per team — an expiring deal re-signs for a year at
 *  max(top-5 positional market, salary + raise%). */
export const franchiseTag = (leagueId: string, slug: string) =>
  rpc<{ ok: boolean; error?: string; salary?: number }>('franchise_tag', { p_league_id: leagueId, p_slug: slug });
/** Offseason: an expiring deal re-signs 1–3 years at discount% of market. */
export const extendContract = (leagueId: string, slug: string, years: number) =>
  rpc<{ ok: boolean; error?: string; salary?: number; years?: number }>('extend_contract', { p_league_id: leagueId, p_slug: slug, p_years: years });
/** Offseason: tender an expiring player to the RFA market. */
export const rfaTender = (leagueId: string, slug: string) =>
  rpc<{ ok: boolean; error?: string }>('rfa_tender', { p_league_id: leagueId, p_slug: slug });
/** Offseason: outbid the standing offer (your cap is checked at bid time). */
export const rfaBid = (leagueId: string, rosterId: number, slug: string, salary: number, years: number) =>
  rpc<{ ok: boolean; error?: string }>('rfa_bid', { p_league_id: leagueId, p_roster_id: rosterId, p_slug: slug, p_salary: salary, p_years: years });
/** Offseason: the tendering owner answers — match keeps him at the offer,
 *  walk sends him (and the re-priced deal) to the bidder. */
export const rfaResolve = (leagueId: string, slug: string, match: boolean) =>
  rpc<{ ok: boolean; error?: string; status?: string }>('rfa_resolve', { p_league_id: leagueId, p_slug: slug, p_match: match });

// ── League formats (0221/0222): 🔪 guillotine and 🧛 vampire ─────────────────
export type LeagueFormat = 'standard' | 'guillotine' | 'vampire';
/** Commissioner: pick the format. Guillotine must be chosen pre-draft (it
 *  changes how the season scores) and presets a $1000 FAAB market. */
export const setLeagueFormat = (leagueId: string, format: LeagueFormat) =>
  rpc<{ ok: boolean; error?: string; format?: LeagueFormat }>('set_league_format', { p_league_id: leagueId, p_format: format });
/** The blade, poked from any member's league load (idempotent): eliminates
 *  the floor of every completed week and releases the roster to the frenzy. */
export const guillotineTick = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; eliminated?: number }>('guillotine_tick', { p_league_id: leagueId });
export interface GuillotineState {
  error?: string;
  guillotine: boolean;
  week?: number | null;
  champion?: number | null;
  /** `pts` is the FINAL score (null until the week finals); `live` is the
   *  in-flight matchup_state total (0267) — the chopping block's mid-week
   *  number, null on a true bye. `bye` is now a real no-matchup test (0267),
   *  not "no final yet". Sorted by what is known: final, else live; byes last. */
  alive?: { roster_id: number; team: string | null; pts: number | null; live?: number | null; bye?: boolean }[];
  /** `pts` (0267): the score the blade fell on in that team's fatal week. */
  fallen?: { roster_id: number; team: string | null; week: number; pts?: number | null }[];
  /** THE SEASON, WEEK BY WEEK (0271) — one entry per fully-final regular
   *  week, newest first, holding the field as it stood THAT week: every seat
   *  not yet chopped going in, its final (null on a bye), and the one the
   *  blade took. Rows sort by score ascending — the cutline order. */
  history?: {
    week: number; chopped: number | null; chopped_team: string | null;
    teams: { roster_id: number; team: string | null; pts: number | null; bye: boolean; chopped: boolean }[];
  }[];
  /** The frenzy: released players still clearing waivers, best rank first. */
  frenzy?: { slug: string; full_name: string; pos: string; team: string; rank: number; clears_at: string }[];
}
export const guillotineState = (leagueId: string) => rpc<GuillotineState>('guillotine_state', { p_league_id: leagueId });
/** Commissioner: appoint the vampire seat (and flip steal review). Legacy
 *  single-seat setter — kept because shipped APKs call it; new UI uses
 *  setVampires. */
export const setVampire = (leagueId: string, rosterId: number, stealReview: boolean | null = null) =>
  rpc<{ ok: boolean; error?: string; vampire?: number; steal_review?: boolean }>('set_vampire',
    { p_league_id: leagueId, p_roster_id: rosterId, p_steal_review: stealReview });
/** Commissioner (0268): appoint the COVEN — any number of vampire seats (at
 *  least one team must remain to draft), plus steal review and the wire lock
 *  (ON = only vampires may add FAs / claim waivers). */
export const setVampires = (leagueId: string, rosterIds: number[], stealReview: boolean | null = null, wireLock: boolean | null = null) =>
  rpc<{ ok: boolean; error?: string; vampires?: number[]; steal_review?: boolean; wire_lock?: boolean }>('set_vampires',
    { p_league_id: leagueId, p_roster_ids: rosterIds, p_steal_review: stealReview, p_wire_lock: wireLock });
/** The bite: on a fresh win, take from the beaten team's active roster and
 *  give one back. Parks for the commissioner's ruling when steal review is on.
 *  `vampire` names the feeding seat (0268) — required only when the caller
 *  doesn't own exactly one vampire in a many-vampire league. */
export const vampireSteal = (leagueId: string, takeSlug: string, giveSlug: string, vampire: number | null = null) =>
  rpc<{ ok: boolean; error?: string; status?: string; week?: number }>('vampire_steal',
    { p_league_id: leagueId, p_take_slug: takeSlug, p_give_slug: giveSlug, p_vampire: vampire });
export const commishRuleSteal = (leagueId: string, stealId: number, approve: boolean) =>
  rpc<{ ok: boolean; error?: string; status?: string }>('commish_rule_steal',
    { p_league_id: leagueId, p_steal_id: stealId, p_approve: approve });
/** One vampire's chair (0268): its window, record and finaled weeks. */
export interface VampireChair {
  seat: number; seat_team: string | null;
  won: boolean; victim: number | null; fed: boolean;
  record?: { wins: number; losses: number } | null;
  weeks?: { week: number; opp: number; opp_team: string | null; for: number; against: number; won: boolean }[];
}
export interface VampireState {
  error?: string;
  vampire: boolean;
  /** The coven (0268): every vampire seat, and one chair each. */
  seats?: number[];
  vampires?: VampireChair[];
  /** ON = only vampires may add FAs / claim waivers (0268). */
  wire_lock?: boolean;
  steal_review?: boolean;
  week?: number | null;
  /** Legacy single-vampire surface: the caller's own seat, else the first of
   *  the coven — shipped APKs read these. New UI reads `vampires`. */
  seat?: number | null;
  won?: boolean;
  victim?: number | null;
  fed?: boolean;
  seat_team?: string | null;
  record?: { wins: number; losses: number } | null;
  weeks?: { week: number; opp: number; opp_team: string | null; for: number; against: number; won: boolean }[];
  steals?: { id: number; week: number; vampire?: number; victim: number; victim_team?: string | null; take: string; give: string; status: 'pending' | 'executed' | 'vetoed' }[];
}
export const vampireState = (leagueId: string) => rpc<VampireState>('vampire_state', { p_league_id: leagueId });
/** 🩸 THE BITE MARK — non-null when THIS seat was fed on in the CURRENT window
 *  (the latest fully-final week): a player left the roster and another arrived,
 *  and until now nothing on the victim's own screens said why. Pure over a
 *  vampire_state answer, like feedingBell, so the boards and the vampire card
 *  can never disagree. Clears itself when the next week finals — the window
 *  moves on. `pending` means declared but awaiting the commissioner's ruling,
 *  so nobody has moved yet. */
export const bittenNotice = (st: VampireState | null | undefined, rosterId: number | null | undefined):
  { week: number; vampire: string; take: string; give: string; pending: boolean } | null => {
  if (!st?.vampire || rosterId == null || st.week == null) return null;
  const s = (st.steals ?? []).find((x) => x.victim === rosterId && x.week === st.week && x.status !== 'vetoed');
  if (!s) return null;
  const chairs: VampireChair[] = st.vampires ?? [];
  const chair = s.vampire != null ? chairs.find((c) => c.seat === s.vampire) : chairs[0];
  return {
    week: s.week,
    vampire: chair?.seat_team ?? (s.vampire != null ? `Seat ${s.vampire}` : 'The vampire'),
    take: s.take, give: s.give, pending: s.status === 'pending',
  };
};
/** 🧛 THE FEEDING BELL — non-null when THIS seat is a vampire whose win is
 *  fresh: it won the latest fully-final week and hasn't fed on it. The matchup
 *  boards ring it ("YOU WON — TIME TO FEED"); the bite itself lives in the
 *  league tab's vampire card. Pure over a vampire_state answer, shared by both
 *  boards so they can never disagree with the card about whether the window is
 *  open. Falls back to the legacy single-vampire fields for a pre-0268 server. */
export const feedingBell = (st: VampireState | null | undefined, rosterId: number | null | undefined):
  { week: number; victim: string } | null => {
  if (!st?.vampire || rosterId == null || st.week == null) return null;
  const chairs: VampireChair[] = st.vampires ?? (st.seat != null
    ? [{ seat: st.seat, seat_team: st.seat_team ?? null, won: !!st.won, victim: st.victim ?? null, fed: !!st.fed, weeks: st.weeks }]
    : []);
  const c = chairs.find((x) => x.seat === rosterId);
  if (!c?.won || c.fed) return null;
  const wk = (c.weeks ?? []).find((w) => w.week === st.week);
  return { week: st.week, victim: wk?.opp_team ?? (c.victim != null ? `seat ${c.victim}` : 'the beaten team') };
};
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

export const seedLeaguePool = (leagueId: string, players: { slug: string; full: string; pos: string; team: string; espnId?: string; exp?: number; sleeperId?: string }[]) =>
  rpc<{ ok: boolean; error?: string; players?: number }>('seed_league_pool', {
    p_league_id: leagueId,
    // sleeper_id (0205) is the STABLE identity the projection bakes join on —
    // and the reason a duplicate name can now be renamed rather than dropped.
    // Null for the team pseudo-players, which are not people.
    p_players: players.map(({ espnId, exp, sleeperId, ...p }) =>
      ({ ...p, espn_id: espnId ?? null, exp: exp ?? null, sleeper_id: sleeperId ?? null })),
  });

/** Commissioner (0265): rewrite ONE pool row's identity in place — the slug
 *  rosters and picks reference stays; the person behind it changes. The pen
 *  half of the pool doctor; diagnosis is diagnosePoolGhosts (nativeLeague). */
export const commishRepairPoolRow = (leagueId: string, slug: string,
  fix: { full: string; pos: string; team: string; espnId?: string; exp?: number; sleeperId?: string }) =>
  tracked(rpc<{ ok: boolean; error?: string }>('commish_repair_pool_row', {
    p_league_id: leagueId, p_slug: slug, p_full: fix.full, p_pos: fix.pos, p_team: fix.team,
    p_espn_id: fix.espnId ?? null, p_exp: fix.exp ?? null, p_sleeper_id: fix.sleeperId ?? null,
  }), 'commish_repair_pool_row');

// ── The league's slug → Sleeper id map (0205) ──────────────────────────────
// Only the PROJECTION path needs it, so it rides its own small call rather
// than widening every pool read. Install it with `setPoolSleeperIds` and a
// player whose slug had to be disambiguated still finds his projection.
export const leaguePoolIds = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; ids?: Record<string, string> }>('league_pool_ids', { p_league_id: leagueId });
export const nativeGenerateSchedule = (leagueId: string, weeks = 14) =>
  rpc<{ ok: boolean; error?: string; weeks?: number; matchups?: number; first_week?: number; last_week?: number }>(
    'native_generate_schedule', { p_league_id: leagueId, p_weeks: weeks });

// 0280: shift a not-yet-played schedule onto weeks the league can still play.
// A league made mid-season was handed weeks starting at 1 — games already over,
// which nothing ever finalizes, so its live week never moved and every roster
// move stayed locked behind the kickoff rule. Starting a draft heals it now;
// this is the door for a league that already drafted into that state.
export const nativeReschedule = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; shifted?: number; why?: string; first_week?: number; dropped_weeks?: number; cap?: number }>(
    'native_reschedule', { p_league_id: leagueId });

// ── GO NATIVE (0263): convert an imported league in place ───────────────────
export interface ConvertSummary {
  ok: boolean; error?: string; dry_run?: boolean;
  teams?: number; rounds?: number; pool?: number; rostered?: number;
  matched_by_id?: number; matched_by_slug?: number; added_to_pool?: number;
  skipped?: { roster_id: number; full: string; pos: string }[]; skipped_n?: number;
  dups?: number; weeks_materialized?: number; snapshot_week?: number;
  unclaimed_seats?: number;
}
/** Commissioner: convert this imported (sleeper/espn) league to a NATIVE one,
 *  in place — same league_id, seats, schedule and history; rosters read from
 *  the latest synced snapshot; pool from buildDraftPool() (same shape as
 *  seedLeaguePool's). dryRun runs the whole conversion and rolls it back,
 *  returning the summary the real run would — preview and commit are one
 *  code path. Pre-season only (refused once any matchup has locked). */
export const convertLeagueToNative = (
  leagueId: string,
  players: { slug: string; full: string; pos: string; team: string; espnId?: string; exp?: number; sleeperId?: string }[],
  dryRun = false,
) =>
  tracked(rpc<ConvertSummary>('convert_league_to_native', {
    p_league_id: leagueId,
    p_pool: players.map(({ espnId, exp, sleeperId, ...p }) =>
      ({ ...p, espn_id: espnId ?? null, exp: exp ?? null, sleeper_id: sleeperId ?? null })),
    p_dry_run: dryRun,
  }), 'convert_league_to_native');

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

export interface PickAssetRow {
  season: string; round: number; orig: number; owner: number;
  /** 'startup' = a slot in the draft in front of you (snakes, and can be ON THE
   *  CLOCK); 'rookie' = a future rookie-draft pick. 0190; absent on rows read
   *  from a database that predates it, which are all rookie ones. */
  kind?: 'startup' | 'rookie';
}
export interface PickAssets {
  ok?: boolean; error?: string;
  rookie_rounds: number;
  /** The season whose FUTURE picks are tradeable (league season + 1). */
  future_season: string | null;
  /** The league's own season — its startup slots carry this tag (0190). */
  current_season?: string | null;
  /** The commissioner's switch (0190). False ⇒ offers naming picks are refused. */
  pick_trading?: boolean;
  picks: PickAssetRow[];
}
/** The commissioner's pick-trading switch (0190). Turning it ON provisions this
 *  league's startup slots when the draft hasn't started; OFF clears them, but
 *  only while every one still sits with its original owner — a traded pick is
 *  somebody's property and a settings flip must not delete it. */
export const setPickTrading = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; pick_trading?: boolean; startup_picks?: number }>(
    'set_pick_trading', { p_league_id: leagueId, p_on: on });
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
  error?: string; status: 'pending' | 'live' | 'complete'; mode: 'snake' | 'linear' | 'auction'; rounds: number; pick_seconds: number;
  paused: boolean;
  order: number[] | null; current_overall: number;
  /** Snake: the seat on the clock. Auction: the seat whose turn it is to nominate. */
  on_clock: number | null;
  /** True ⇒ the on-clock seat is vacant/AI/autodraft — a draft_tick will act now. */
  on_clock_auto: boolean | null;
  deadline_at: string | null; server_now: string; picks: DraftPickRow[];
  /** Vampire seats (0269): they sit the draft out — no picks, no order slot —
   *  and build from the leftover pool. Named so the room can SAY it. */
  vampires?: { roster_id: number; team: string | null }[];
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
  /** Roster spots the draft does NOT fill because they are IR (0193). `rounds`
   *  above is already net of them; this is here so a screen can SAY why the
   *  roster is bigger than the draft. */
  stash_slots?: number;
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
/** Standing maxes by slug (0228) — the auction queue's hidden ceilings. RLS
 *  already scopes the table to the caller's own seat, same as the queue. */
export async function myQueueMaxes(leagueId: string, rosterId: number): Promise<Record<string, number>> {
  const { data, error } = await (await client()).from('draft_queue')
    .select('slug, max_bid').eq('league_id', leagueId).eq('roster_id', rosterId).not('max_bid', 'is', null);
  if (error) throw error;
  const m: Record<string, number> = {};
  for (const r of (data ?? []) as { slug: string; max_bid: number }[]) m[r.slug] = r.max_bid;
  return m;
}
/** Set (or clear, with null) a queued player's standing max — it becomes his
 *  lot's hidden proxy the moment the lot opens, even if you're asleep. */
export const setQueueMax = (leagueId: string, rosterId: number, slug: string, max: number | null) =>
  rpc<{ ok: boolean; error?: string; max_bid?: number | null }>('set_queue_max',
    { p_league_id: leagueId, p_roster_id: rosterId, p_slug: slug, p_max: max });
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
  mode: 'snake' | 'linear' | 'auction' | null = null,
  budget: number | null = null,
  lotSeconds: number | null = null,
  maxLots: number | null = null,
) =>
  tracked(rpc<{ ok: boolean; error?: string; pick_seconds?: number; mode?: 'snake' | 'linear' | 'auction';
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
/** THE LOTTERY (0189) — weighted shares, and a draw that is recorded.
 *
 *  Shares are WEIGHTS, not percentages: "worst team 250, champion 5" is how a
 *  commissioner thinks, and percentages that must total 100 have to be
 *  rebalanced every time one changes. Odds are their ratio. A share of 0 means
 *  "in the league, not in the lottery" — those seats fill the remaining slots
 *  behind everyone drawn. Pending-only; the order locks at the first pick. */
export const setLotteryShares = (leagueId: string, shares: Record<number, number> | null) =>
  rpc<{ ok: boolean; error?: string; shares?: Record<string, number> | null }>(
    'set_lottery_shares', { p_league_id: leagueId, p_shares: shares });
export interface LotteryPick { roster_id: number; share: number; odds: number }
/** Draw the order. Without replacement, weight-proportional at every step —
 *  the NBA-style lottery people mean when they say the word. */
export const runDraftLottery = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; order?: number[]; result?: LotteryPick[] }>(
    'run_draft_lottery', { p_league_id: leagueId });
/** What was set and what was drawn — readable by ANY member, which is the whole
 *  point: a lottery nobody can inspect afterwards is indistinguishable from a
 *  commissioner typing an order. */
export const draftLottery = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; shares?: Record<string, number> | null; result?: LotteryPick[] | null; order?: number[] | null; locked?: boolean }>(
    'draft_lottery', { p_league_id: leagueId });

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
/** EDIT A PICK THAT WAS ALREADY MADE (0194). `slug` swaps the player in place;
 *  omitting it REMOVES the pick, leaving that cell empty and handing the player
 *  back to the pool. Neither renumbers the board or moves the clock — the picks
 *  around it belong to the teams that made them. Live or complete. */
export const commishEditPick = (leagueId: string, overall: number, slug?: string | null) =>
  tracked(rpc<{ ok: boolean; error?: string; action?: 'removed' | 'replaced'; overall?: number;
                roster_id?: number; slug?: string; was?: string }>(
    'commish_edit_pick', { p_league_id: leagueId, p_overall: overall, p_slug: slug ?? null }),
    Ev.commishAction, { tool: 'edit_pick', removed: slug == null });
export const commishUndoPick = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; undone_overall?: number; slug?: string }>('commish_undo_pick', { p_league_id: leagueId });
/** THE REST OF THE COMMISSIONER'S DRAFT CONTROLS (0191).
 *
 *  Start the draft over. Typed confirmation — every pick in the room goes, and
 *  a second tap is not proportional to that. KEEPERS SURVIVE (they were never
 *  drafted), and so do traded pick assets and every manager's queue. */
export const commishResetDraft = (leagueId: string, confirm: string) =>
  tracked(rpc<{ ok: boolean; error?: string; picks_cleared?: number; keepers_kept?: number }>(
    'commish_reset_draft', { p_league_id: leagueId, p_confirm: confirm }),
    Ev.commishAction, { tool: 'draft_reset' });

/** Move ONE team to 1-based position `to`, sliding the others along — the
 *  answer to "he joined late, put him at the end". Unlike setDraftOrder this
 *  works MID-DRAFT: picks already made keep their seats and everything from
 *  the clock forward follows the new order. */
export const commishMoveDraftSlot = (leagueId: string, rosterId: number, to: number) =>
  tracked(rpc<{ ok: boolean; error?: string; order?: number[]; from?: number; to?: number }>(
    'commish_move_draft_slot', { p_league_id: leagueId, p_roster: rosterId, p_to: to }),
    Ev.commishAction, { tool: 'draft_move_slot' });

/** Who is on autodraft, by seat. draft_state carries only the caller's own
 *  flag; the commissioner's per-team switch needs everyone's, and membership
 *  is member-readable. */
export async function leagueAutodrafts(leagueId: string): Promise<Record<number, boolean>> {
  const { data } = await (await client()).from('league_membership')
    .select('sleeper_roster_id, autodraft').eq('league_id', leagueId);
  const out: Record<number, boolean> = {};
  for (const m of (data ?? []) as { sleeper_roster_id: number; autodraft: boolean | null }[]) {
    out[m.sleeper_roster_id] = !!m.autodraft;
  }
  return out;
}
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

export interface LeaguePoolPlayer { slug: string; full_name: string; pos: string; team: string; rank: number; waived_until: string | null; espn_id?: string | null; sleeper_id?: string | null; }
/** EVERY ROW, NOT THE FIRST THOUSAND (v0.489.3).
 *
 *  PostgREST answers any select with at most its max-rows (1000 here) — a
 *  `.range(0, 1999)` asks for two thousand and quietly gets one. A league pool
 *  is 1,200 players by default (POOL_CAP) and up to 2,000 with extras, so
 *  every player ranked past 1,000 was missing from the team screen: off the
 *  wire, and — the way the founder found it — off HIS OWN ROSTER COUNT. A
 *  waiver pickup ranked 1,040 vanished from `mine`, the roster read one short
 *  of full, and a FAAB claim went straight to the bid with no drop asked for.
 *  Paged like `weekLivePlays`, on a total order so no row falls between pages. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function leaguePool(leagueId: string): Promise<LeaguePoolPlayer[]> {
  const c = await client();
  return allRows<LeaguePoolPlayer>((from, to) => c.from('league_pool')
    // sleeper_id (0205) rides along so `setSlugMetaOverrides` can install the
    // identity the IDP bake is keyed by — see slugMeta.slugSleeperId.
    .select('slug, full_name, pos, team, rank, waived_until, espn_id, sleeper_id')
    // slug breaks rank ties: paging needs a TOTAL order, or a row can sit on
    // the boundary and be served twice or never.
    .eq('league_id', leagueId).order('rank').order('slug').range(from, to));
}
/** Tenure by slug from the league's pool (0172) — per-slot filter checks at
 *  lineup time read this. Null exp = unknown (pre-0172 seed, or Sleeper doesn't
 *  know); tenure-filtered spots refuse unknowns, so a re-seed fills them in. */
export async function leaguePoolExp(leagueId: string): Promise<Record<string, number>> {
  const c = await client();
  const rows = await allRows<{ slug: string; exp: number }>((from, to) => c.from('league_pool')
    .select('slug, exp').eq('league_id', leagueId).not('exp', 'is', null).order('slug').range(from, to));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.slug] = r.exp;
  return out;
}

export interface NativeRosterRow { roster_id: number; slug: string; acquired: string; spot?: 'active' | 'taxi' | 'ir' | 'out'; }
export async function nativeRosters(leagueId: string): Promise<NativeRosterRow[]> {
  // Paged for the same reason as the pool: a 32-team league with deep benches
  // is past a thousand rostered players, and a missing row is a missing man.
  const c = await client();
  return allRows<NativeRosterRow>((from, to) => c.from('native_roster')
    .select('roster_id, slug, acquired, spot').eq('league_id', leagueId)
    .order('roster_id').order('slug').range(from, to));
}

export const dropPlayer = (leagueId: string, rosterId: number, slug: string) =>
  rpc<{ ok: boolean; error?: string }>('drop_player', { p_league_id: leagueId, p_roster_id: rosterId, p_slug: slug });
export const addFreeAgent = (leagueId: string, rosterId: number, addSlug: string, dropSlug?: string) =>
  tracked(rpc<{ ok: boolean; error?: string }>('add_free_agent', { p_league_id: leagueId, p_roster_id: rosterId, p_add_slug: addSlug, p_drop_slug: dropSlug ?? null }),
    Ev.waiverClaimed, { type: 'fa', drop: !!dropSlug });
/** Is this refusal the server saying the ACTIVE roster is full (0199's
 *  `roster_seat_error`, reached through add_free_agent / submit_waiver_claim)?
 *  Both team screens answer it by asking for a drop rather than printing it —
 *  the server is the authority on full, and the screen's own count can lag. */
export const seatFullError = (error: string | null | undefined): boolean =>
  !!error && /\broster (is )?full\b/i.test(error);
export const submitWaiverClaim = (leagueId: string, rosterId: number, addSlug: string, dropSlug?: string, bid = 0) =>
  tracked(rpc<{ ok: boolean; error?: string; claim_id?: string; clears_at?: string; bid?: number }>('submit_waiver_claim', { p_league_id: leagueId, p_roster_id: rosterId, p_add_slug: addSlug, p_drop_slug: dropSlug ?? null, p_bid: bid }),
    Ev.waiverClaimed, { type: 'waiver', drop: !!dropSlug, bid });
export const cancelWaiverClaim = (claimId: string) =>
  rpc<{ ok: boolean; error?: string }>('cancel_waiver_claim', { p_claim_id: claimId });

/** CONDITIONAL CLAIMS (0323) — "one of these, in this order". Link claims you
 *  have already filed: pass the ids in preference order and how many of them
 *  may land (1 by default). The run still orders claims by the league's own
 *  rules; the group only ever takes the rest off the table once it is full. */
export const groupWaiverClaims = (claimIds: string[], maxWins = 1) =>
  tracked(rpc<{ ok: boolean; error?: string; group_id?: string; claims?: number; max_wins?: number }>(
    'group_waiver_claims', { p_claim_ids: claimIds, p_max_wins: maxWins }),
    Ev.waiverClaimed, { type: 'group', claims: claimIds.length });
/** File a whole contingency list in one call, in preference order. ALL OR
 *  NOTHING: a list whose third claim is refused files none of them. */
export const submitWaiverGroup = (
  leagueId: string, rosterId: number,
  claims: { add: string; drop?: string | null; bid?: number }[], maxWins = 1,
) =>
  tracked(rpc<{ ok: boolean; error?: string; group_id?: string; claims?: number; failed_on?: string }>(
    'submit_waiver_group', { p_league_id: leagueId, p_roster_id: rosterId, p_claims: claims, p_max_wins: maxWins }),
    Ev.waiverClaimed, { type: 'group-file', claims: claims.length });
/** Break a group up; the claims stand on their own, unchanged otherwise. */
export const ungroupWaiverClaims = (groupId: string) =>
  rpc<{ ok: boolean; error?: string; claims?: number }>('ungroup_waiver_claims', { p_group_id: groupId });
/** Withdraw every pending claim in a group at once. */
export const cancelWaiverGroup = (groupId: string) =>
  rpc<{ ok: boolean; error?: string; cancelled?: number }>('cancel_waiver_group', { p_group_id: groupId });
/** Resolve every due claim in waiver-priority order. Idempotent — safe to call on load. */
export const processWaivers = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; won?: number; lost?: number }>('process_waivers', { p_league_id: leagueId });
export interface WaiverClaimRow { id: string; add_slug: string; drop_slug: string | null; status: string; note: string | null; created_at: string; bid?: number;
  /** 0289: when this claim settles — its own clock when free agency could
   *  not reach the player, else the pool hold it is queued behind. */
  clears_at?: string | null;
  /** 0323: the contingency group this claim is part of — "one of these" —
   *  with its place in the manager's order and how many of the group may
   *  land. Null on a claim that stands alone. */
  group_id?: string | null; group_seq?: number | null; group_max?: number | null; }
export interface NativeTeamState {
  /** 0320: why the wire is shut for my seat right now (a commissioner's lock, the format's), or null. */
  wire_block?: string | null;
  error?: string; my_roster_id: number | null; draft_status: string; roster_cap: number | null; server_now: string;
  /** THE BLADE (0272): the week the guillotine took THIS seat, null while it
   *  lives. The team desk says so, and closes the wire with a reason. */
  eliminated?: number | null;
  /** ACTIVE SEATS (0199): starters + bench — what an ADD is bounded by, as
   *  distinct from `roster_cap`, which is the whole roster with its stash
   *  places. `active_held` is how many of them this manager is using. */
  active_seats?: number | null; active_held?: number | null;
  /** Per-position roster limits (null value = uncapped). */
  pos_caps?: PosCaps;
  /** Waiver system: rolling priority (default) or FAAB blind bids. */
  waiver_mode?: WaiverMode;
  trade_review?: TradeReview;
  /** 0321: the trade floor, as the offer screen needs it — how long a league
   *  vote runs, how many vetoes kill a deal, how many days an offer stands by
   *  default (0 = until answered) and whether FAAB may ride one (false in a
   *  league that is not on FAAB at all). */
  trade_review_hours?: number;
  trade_veto_votes?: number;
  trade_offer_days?: number;
  faab_trading?: boolean;
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
  /** 0291: when this league next runs waivers, so the card can say the rule
   *  rather than leaving it to be inferred from one claim's timestamp. */
  next_waiver_run?: string | null; waiver_clear_dow?: number[] | null;
  my_team?: string | null; my_avatar?: string | null; league_avatar?: string | null; is_commish?: boolean;
  waiver_order: { roster_id: number; team: string | null; priority: number | null; avatar?: string | null; faab?: number | null }[];
  my_claims: WaiverClaimRow[];
}
export const nativeTeamState = (leagueId: string) => rpc<NativeTeamState>('native_team_state', { p_league_id: leagueId });
/** native_team_state for the VIEWED user — the browse-as twin (0306). MY TEAM
 *  under "BROWSING AS x" reads x's seat, claims, FAAB and is_commish as x
 *  would; admin-gated server-side. Read-only by construction: the desk's
 *  writes are refused client-side under browse-as. */
export const adminUserNativeTeamState = (appUserId: string, leagueId: string) =>
  rpc<NativeTeamState>('admin_user_native_team_state', { p_app_user_id: appUserId, p_league_id: leagueId });
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
/** What KIND of league a card advertises (0223) — game, continuity, format,
 *  contracts, reception scoring, whether scoring was customized. */
export interface LeagueIdentity {
  game_mode: 'drip' | 'classic';
  continuity: LeagueContinuity;
  format: LeagueFormat;
  contracts: boolean; salary_cap: number | null;
  ppr: number; scoring_custom: boolean;
  vampire_seat?: number | null;
}
export interface BoardListing {
  league_id: string; name: string; season: string; avatar_url: string | null;
  blurb: string; posted_at: string;
  /** The commissioner's word on money ("$50 — Venmo before the draft"); the
   *  platform prints it, it never collects it. */
  dues?: string | null;
  identity?: LeagueIdentity;
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
/** Post (or re-open / edit) the caller's league. Null blurb/dues keeps the
 *  old one; an empty-string dues clears it. */
export const postLeagueListing = (leagueId: string, blurb?: string | null, dues?: string | null) =>
  rpc<{ ok: boolean; error?: string }>('post_league_listing', { p_league_id: leagueId, p_blurb: blurb ?? null, p_dues: dues ?? null });
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
  /** 0223: what kind of league, the dues, and (contract leagues) the rulebook. */
  identity?: LeagueIdentity;
  dues?: string | null;
  contract_rules?: { salary_cap: number; years_max: number; dead_pct: number;
    retention: boolean; cap_trading: boolean; ir_relief: boolean;
    tag_raise_pct: number; ext_discount_pct: number; rfa: boolean } | null;
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
  rpc<{ ok: boolean; error?: string; invite_code?: string; name?: string; seats_open?: number;
        /** 0243: which game a recruit should be SHOWN — the look-first link's
         *  destination. Unset means drip, as everywhere else. */
        game_mode?: string }>(
    'league_invite', { p_league_id: leagueId });
/** The listing's true state, commish/admin only (0124). league_board() hides
 *  full leagues, so it cannot answer "is my league public?" — this can. */
export const leagueListingState = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; listed?: boolean; blurb?: string; dues?: string | null; seats_open?: number }>(
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
// ── The commissioner's desk (0320) ───────────────────────────────────────────
export interface CommissionerRow { app_user_id: string; email: string | null; name: string | null; since?: string }
export const leagueCommissioners = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; primary?: CommissionerRow | null; you_are_primary?: boolean; co?: CommissionerRow[] }>('league_commissioners', { p_league_id: leagueId });
export const addCommissioner = (leagueId: string, email: string) =>
  rpc<{ ok: boolean; error?: string }>('add_commissioner', { p_league_id: leagueId, p_email: email });
export const removeCommissioner = (leagueId: string, appUserId: string) =>
  rpc<{ ok: boolean; error?: string }>('remove_commissioner', { p_league_id: leagueId, p_app_user_id: appUserId });
export const transferCommissioner = (leagueId: string, appUserId: string) =>
  rpc<{ ok: boolean; error?: string }>('transfer_commissioner', { p_league_id: leagueId, p_app_user_id: appUserId });
/** Every free-agent and waiver move in the league, shut or open. */
export const commishSetWireLock = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string; wire_lock?: boolean }>('commish_set_wire_lock', { p_league_id: leagueId, p_on: on });
/** One team's roster transactions (adds, drops, claims, trades), shut or open. */
export const commishLockTeam = (leagueId: string, rosterId: number, locked: boolean) =>
  rpc<{ ok: boolean; error?: string }>('commish_lock_team', { p_league_id: leagueId, p_roster_id: rosterId, p_locked: locked });
/** The whole waiver order at once: every roster id, first pick first. */
export const commishSetWaiverPriority = (leagueId: string, order: number[]) =>
  rpc<{ ok: boolean; error?: string }>('commish_set_waiver_priority', { p_league_id: leagueId, p_order: order });
export const commishSetMedianGame = (leagueId: string, on: boolean) =>
  rpc<{ ok: boolean; error?: string }>('commish_set_median_game', { p_league_id: leagueId, p_on: on });
export interface WeekScoreRow { matchup_id: string; status: string; is_playoff: boolean; home_roster_id: number; home: string | null; home_final: number | null; away_roster_id: number; away: string | null; away_final: number | null }
export const commishWeekScores = (leagueId: string, week: number) =>
  rpc<{ ok: boolean; error?: string; week?: number; matchups?: WeekScoreRow[]; weeks?: number[] }>('commish_week_scores', { p_league_id: leagueId, p_week: week });
/** A final matchup's score, set by hand; standings follow at once. */
export const commishSetMatchupScore = (matchupId: string, home: number, away: number) =>
  rpc<{ ok: boolean; error?: string }>('commish_set_matchup_score', { p_matchup_id: matchupId, p_home: home, p_away: away });
export interface DuesRow { roster_id: number; team: string | null; enrolled: boolean; paid: boolean; paid_at: string | null; note: string | null }
export const leagueDues = (leagueId: string) =>
  rpc<{ ok: boolean; error?: string; amount?: number | null; note?: string | null; teams?: DuesRow[] }>('league_dues', { p_league_id: leagueId });
export const setLeagueDues = (leagueId: string, amount: number | null, note: string | null = null) =>
  rpc<{ ok: boolean; error?: string }>('set_league_dues', { p_league_id: leagueId, p_amount: amount, p_note: note });
export const commishSetDuesPaid = (leagueId: string, rosterId: number, paid: boolean) =>
  rpc<{ ok: boolean; error?: string }>('commish_set_dues_paid', { p_league_id: leagueId, p_roster_id: rosterId, p_paid: paid });

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

// ── MANUAL SLEEPER REFRESH (0204) ──────────────────────────────────────────
// The worker mirrors Sleeper on a 6-hour cadence, and only for leagues in its
// PILOT_LEAGUE_IDS allowlist — so for most Sleeper leagues this button is not a
// convenience, it is the only way their rosters ever move. The RPC queues a
// request; the worker drains it on its next 25s tick with the same `syncWeek`
// the scheduled path uses.

export interface SyncAsk { ok: boolean; queued?: boolean; pending?: boolean; retry_in?: number; error?: string }

/** Ask the worker to re-mirror this league. A `queued:false` answer with a
 *  `retry_in` is the COOLDOWN, not a failure — render it as "just refreshed",
 *  never as an error. */
export async function requestLeagueSync(leagueId: string): Promise<SyncAsk> {
  const { data, error } = await (await client()).rpc('request_league_sync', { p_league_id: leagueId });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false, error: 'no answer' }) as SyncAsk;
}

export interface SyncState { ok: boolean; sleeper?: boolean; pending?: boolean; last_at?: string | null; last_ok?: boolean | null; note?: string | null; retry_in?: number; error?: string }

/** What the button shows between presses — in flight, last outcome, cooldown. */
export async function leagueSyncState(leagueId: string): Promise<SyncState> {
  const { data, error } = await (await client()).rpc('league_sync_state', { p_league_id: leagueId });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: false }) as SyncState;
}
