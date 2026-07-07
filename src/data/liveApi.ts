// Live-pilot client API: magic-link auth + invite-code redemption, on top of the
// Supabase client. All table access is RLS-guarded; enrollment goes through the
// redeem_invite RPC (migration 0002), never a direct membership write.
import { supabase } from './supabaseClient';
import { resolveUser } from './sleeper';
import type { Session } from '@supabase/supabase-js';

function client() {
  if (!supabase) throw new Error('Live mode is not configured');
  return supabase;
}

/** Turn a raw Supabase / auth / network error into calm, player-facing copy.
 *  Unknown messages fall through lightly cleaned (capitalized, trailing period). */
export function friendlyError(x: unknown): string {
  const raw = (x instanceof Error ? x.message : typeof x === 'string' ? x : '').trim();
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
    const p = new URLSearchParams(window.location.search);
    const commish = p.get('commish') || localStorage.getItem('dripCommishCode');
    const code = p.get('code') || localStorage.getItem('dripInviteCode');
    if (commish) extra = `&commish=${encodeURIComponent(commish)}`;
    else if (code) extra = `&code=${encodeURIComponent(code)}`;
  } catch { /* ignore */ }
  return `${window.location.origin}${window.location.pathname}?live=1${extra}`;
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

/** Sign in with the 6-digit code from the email (magic-link fallback for mobile). */
export async function verifyEmailOtp(email: string, token: string): Promise<void> {
  const { error } = await client().auth.verifyOtp({ email: email.trim(), token: token.trim(), type: 'email' });
  if (error) throw error;
}

/** Third-party OAuth (Google / Apple). Redirects the page to the provider and
 *  back to ?live=1. Each provider must be enabled in Supabase → Auth → Providers. */
export async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
  if (error) throw error;
}

// ── Password auth ───────────────────────────────────────────────────────────────
export async function signInPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}
/** Create an account. needsConfirm=true when the project requires email confirmation. */
export async function signUpPassword(email: string, password: string): Promise<{ needsConfirm: boolean }> {
  const { data, error } = await client().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
  return { needsConfirm: !data.session };
}
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
  if (error) throw error;
}
export async function updatePassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await client().auth.getSession();
  return data.session;
}

export function onAuth(cb: (s: Session | null, event?: string) => void): () => void {
  const { data } = client().auth.onAuthStateChange((event, session) => cb(session, event));
  return () => data.subscription.unsubscribe();
}

export async function signOut(): Promise<void> {
  await client().auth.signOut();
}

/** Ensure the caller's app_user row exists (FK target for enrollment). */
export async function ensureAppUser(session: Session): Promise<void> {
  await client().from('app_user').upsert(
    { id: session.user.id, email: session.user.email ?? null },
    { onConflict: 'id', ignoreDuplicates: false },
  );
}

/** The signed-in user's previously-linked Sleeper account, if any (set on a prior
 *  join or commish-verify). Lets a returning player skip re-typing their username.
 *  RLS (`app_user_self`) restricts this to the caller's own row. */
export async function myLinkedSleeper(userId: string): Promise<{ userId: string; username: string } | null> {
  const { data } = await client().from('app_user')
    .select('sleeper_user_id, sleeper_username').eq('id', userId).maybeSingle();
  return data?.sleeper_user_id
    ? { userId: data.sleeper_user_id as string, username: (data.sleeper_username as string | null) ?? '' }
    : null;
}

export interface LeaguePreview { league_id: string; name: string; season: string; }

/** Preview a league by invite code (so we can show "You're joining <name>"). */
export async function previewLeague(code: string): Promise<LeaguePreview | null> {
  const { data, error } = await client().rpc('league_by_invite', { code: code.trim() });
  if (error) throw error;
  return (data && data[0]) || null;
}

export interface RedeemResult { ok: boolean; error?: string; league_id?: string; roster_id?: number; team?: string; }

export interface PreviewRedeem { ok: boolean; error?: string; league?: string; team?: string; avatar?: string | null; }

/** Which team a code + Sleeper username would join — without enrolling. */
export async function redeemPreview(code: string, sleeperUsername: string): Promise<PreviewRedeem> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await client().rpc('redeem_preview', { p_code: code.trim(), p_sleeper_user_id: user.userId });
  if (error) return { ok: false, error: error.message };
  return data as PreviewRedeem;
}

/** Redeem: resolve the Sleeper username, then link + enroll via the RPC. */
export async function redeemInvite(code: string, sleeperUsername: string): Promise<RedeemResult> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await client().rpc('redeem_invite', {
    code: code.trim(), p_sleeper_user_id: user.userId, p_sleeper_username: user.username,
  });
  if (error) return { ok: false, error: error.message };
  return data as RedeemResult;
}

// ── "Request a code" lead capture (migration 0016) ───────────────────────────────
/** Pre-auth request to have a pilot code set up for the visitor's league. Routes
 *  through a SECURITY DEFINER RPC granted to anon, so it works before sign-in. */
export async function requestCode(input: { email?: string; sleeper?: string; league?: string; leagueRef?: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Live mode is not configured.' };
  const { data, error } = await client().rpc('request_code', {
    p_email: input.email ?? null, p_sleeper: input.sleeper ?? null, p_league: input.league ?? null,
    p_league_ref: input.leagueRef ?? null, p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}

export interface Enrollment { league_id: string; team_name: string; sleeper_roster_id: number; avatar_url: string | null; league: { name: string; season: string; preseason_at?: string | null } | null; }

/** The caller's enrolled memberships (RLS scopes to their own rows). */
export async function myEnrollments(userId: string): Promise<Enrollment[]> {
  const { data, error } = await client()
    .from('league_membership')
    .select('league_id, team_name, sleeper_roster_id, avatar_url, league:league_id(name, season, preseason_at)')
    .eq('app_user_id', userId)
    .eq('enrolled', true);
  if (error) throw error;
  return (data as unknown as Enrollment[]) ?? [];
}

// ── Commissioner verification (migration 0003) ──────────────────────────────────
export interface StartCommish { ok: boolean; error?: string; tag?: string; league?: string; }
export interface ConfirmCommish { ok: boolean; error?: string; invite_code?: string; league?: string; }

/** Step 1: validate the commissioner code, confirm Sleeper ownership, get a team-name tag. */
export async function startCommishVerify(commishCode: string, sleeperUsername: string): Promise<StartCommish> {
  const user = await resolveUser(sleeperUsername);
  if (!user) return { ok: false, error: `No Sleeper user “${sleeperUsername}”. Check the spelling.` };
  const { data, error } = await client().rpc('start_commish_verify', {
    p_code: commishCode.trim(), p_sleeper_user_id: user.userId, p_sleeper_username: user.username,
  });
  if (error) return { ok: false, error: error.message };
  return data as StartCommish;
}

/** Step 2: confirm the tag is now in the Sleeper team name → become commissioner + get the invite code. */
export async function confirmCommishVerify(commishCode: string): Promise<ConfirmCommish> {
  const { data, error } = await client().rpc('confirm_commish_verify', { p_code: commishCode.trim() });
  if (error) return { ok: false, error: error.message };
  return data as ConfirmCommish;
}

/** Admin-assigned commissioner: redeem the commish code the admin sent you → become
 *  this league's commissioner (platform-agnostic, no Sleeper team-tagging). */
export async function redeemCommish(commishCode: string): Promise<ConfirmCommish & { league_id?: string }> {
  const { data, error } = await client().rpc('redeem_commish', { p_code: commishCode.trim() });
  if (error) return { ok: false, error: error.message };
  return data as ConfirmCommish & { league_id?: string };
}

// ── Sealed picks (live-H2H lineup) ──────────────────────────────────────────────
export interface LiveMatchup { id: string; league_id: string; week: number; status: string; lock_at: string | null; home_roster_id: number; away_roster_id: number; home_coin: number | null; away_coin: number | null; }
export interface PoolPlayer { slug: string; full: string; pos: string; }
export interface PickRow { game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; locked?: boolean; }

/** The caller's enrolled roster in a league (first enrolled membership). */
export async function myRoster(userId: string): Promise<{ leagueId: string; rosterId: number } | null> {
  const { data } = await client().from('league_membership')
    .select('league_id, sleeper_roster_id').eq('app_user_id', userId).eq('enrolled', true).limit(1).maybeSingle();
  return data ? { leagueId: data.league_id, rosterId: data.sleeper_roster_id } : null;
}

/** The caller's next/earliest matchup in a league. */
export async function myMatchup(leagueId: string, rosterId: number, week?: number): Promise<LiveMatchup | null> {
  let q = client().from('matchup').select('*')
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
export async function defaultOpenWeek(leagueId: string, season: string, preseasonEnabled: boolean): Promise<number> {
  const [msRes, slRes] = await Promise.all([
    client().from('matchup').select('week').eq('league_id', leagueId),
    client().from('nfl_slate').select('week, kickoff').eq('season', season),
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
  const { data } = await client().from('matchup')
    .select('id, week, home_roster_id, away_roster_id, home_final, away_final, status')
    .eq('league_id', leagueId).order('week');
  return (data ?? []) as MatchupResult[];
}

/** The caller's player pool for a week (their Sleeper roster, from sleeper_lineup). */
export async function myPool(leagueId: string, week: number, rosterId: number): Promise<PoolPlayer[]> {
  const { data } = await client().from('sleeper_lineup').select('starters_json')
    .eq('league_id', leagueId).eq('week', week).eq('roster_id', rosterId).maybeSingle();
  return ((data?.starters_json) ?? []) as PoolPlayer[];
}

/** The caller's saved picks for a matchup (locked = that window has sealed). */
export async function myPicks(matchupId: string, userId: string): Promise<PickRow[]> {
  const { data } = await client().from('sealed_pick')
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
  const { error } = await client().from('sealed_pick').upsert(payload, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' });
  if (error) throw error;
}

// ── Live board (Realtime) ───────────────────────────────────────────────────────
export interface WindowScore { game_window: string; home_score: number; away_score: number; }
export interface RevealedPick { app_user_id: string; game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; locked: boolean; }

/** Re-read a matchup's row (status / lock_at / finals may have changed). */
export async function getMatchup(matchupId: string): Promise<LiveMatchup | null> {
  const { data } = await client().from('matchup').select('*').eq('id', matchupId).maybeSingle();
  return (data as LiveMatchup) ?? null;
}

/** Per-window engine scores for a matchup (written by the worker's resolver). */
export async function getMatchupState(matchupId: string): Promise<WindowScore[]> {
  const { data } = await client().from('matchup_state').select('game_window, home_score, away_score').eq('matchup_id', matchupId);
  return (data ?? []) as WindowScore[];
}

/** The live NFL slate for a week (worker-written from ESPN, migration 0029) —
 *  drives slate-gating + the K/DST bye check for the real current season. Empty
 *  until the worker has synced that week (then the client falls back to baked). */
export interface SlateGame { away: string; home: string; win: string; kickoff?: string | null }
export async function liveSlate(week: number, season?: string): Promise<SlateGame[]> {
  let q = client().from('nfl_slate').select('season, away, home, win, kickoff').eq('week', week);
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
  const { data } = await client().from('league_membership')
    .select('sleeper_roster_id, team_name, avatar_url').eq('league_id', leagueId).in('sleeper_roster_id', rosterIds);
  const out: Record<number, TeamInfo> = {};
  for (const m of (data ?? []) as { sleeper_roster_id: number; team_name: string | null; avatar_url: string | null }[]) {
    out[m.sleeper_roster_id] = { roster_id: m.sleeper_roster_id, team_name: m.team_name, avatar: m.avatar_url };
  }
  return out;
}

/** Sealed picks visible under RLS: always yours; the opponent's only once locked. */
export async function getRevealedPicks(matchupId: string): Promise<RevealedPick[]> {
  const { data } = await client().from('sealed_pick')
    .select('app_user_id, game_window, roster_slot, player_slug, metric_id, locked').eq('matchup_id', matchupId);
  return (data ?? []) as RevealedPick[];
}

/** All worker-ingested plays for a week (live_play is readable by any authed user).
 *  Drives the live full-board resolution off real plays. */
export interface LivePlayRow { player_slug: string; c: number; t: number | null; pid: number | null; k: string; y: number; td: number; ca: number; tg: number; to: number | null; }
export async function weekLivePlays(week: number): Promise<LivePlayRow[]> {
  // Page through the full result set. PostgREST caps an un-ranged select at its
  // max-rows default (1000), so a busy NFL Sunday (several thousand plays) would
  // silently truncate — and the board would score off an incomplete play set.
  const PAGE = 1000;
  const rows: LivePlayRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client().from('live_play')
      .select('player_slug, c, t, pid, k, y, td, ca, tg, to')
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
export interface GameFeedRow { key: string; away: string; home: string; plays: import('./gameFeed').GamePlay[]; }
export async function weekGameFeeds(week: number): Promise<GameFeedRow[]> {
  const { data } = await client().from('game_feed')
    .select('key, away, home, plays').eq('week', week);
  return (data ?? []) as GameFeedRow[];
}

/** The opponent's revealed armed buffs — readable only AFTER the matchup locks
 *  (applied_read_after_lock RLS). Returns null when the opponent's row isn't
 *  visible yet (pre-lock) so callers can keep the AI default; an array (possibly
 *  empty) once revealed. */
export async function revealedOppBuffs(matchupId: string, userId: string): Promise<string[] | null> {
  const { data } = await client().from('applied_state').select('app_user_id, payload_json').eq('matchup_id', matchupId);
  const opp = (data ?? []).find((r) => r.app_user_id && r.app_user_id !== userId) as { payload_json: { buffs?: string[] } | null } | undefined;
  if (!opp) return null;
  return opp.payload_json?.buffs ?? [];
}

// ── Super admin ─────────────────────────────────────────────────────────────────
export type Controller = 'human' | 'ai';
export type LineupPolicy = 'best_lineup' | 'ai' | 'empty';
export interface AdminLeague { league_id: string; sleeper_league_id: string; name: string; season: string; provider?: string; commish_code: string; invite_code: string; commissioner: boolean; rosters: number; enrolled: number; lineup_policy?: LineupPolicy; ai_teams?: number; weekly_budget?: number; test_live_at?: string | null; preseason_at?: string | null; }
export interface AdminUser { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; enrolled: number; created_at: string; }
export interface AdminMember { roster_id: number; team: string; owner: string | null; enrolled: boolean; email: string | null; sleeper: string | null; controller?: Controller; avatar?: string | null; claim_email?: string | null; }
export interface AdminAdmin { email: string; note: string | null; }
export interface MemberRow { roster_id: number; owner_id: string | null; team_name: string; }
export interface MatchupRow { sleeper_matchup_id: number | null; home_roster_id: number; away_roster_id: number; }
export interface LineupRow { roster_id: number; starters: { slug: string; full: string; pos: string; team?: string }[]; }
export interface AdminMatchup { id: string; week: number; home_roster_id: number; away_roster_id: number; status: string; lock_at: string | null; home_final: number | null; away_final: number | null; home_coin?: number | null; away_coin?: number | null; }
export interface AdminOverride { sleeper_user_id: string; note: string | null; }
export interface AdminAudit { table: string; op: string; row_id: string | null; at: string; detail?: string | null; actor?: string | null; }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
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
  const { data, error } = await client().functions.invoke('stripe-checkout', { body: { kind, leagueId, amountCents } });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (url) window.location.href = url;
}
export const adminSetPremiumTier = (freePositions: string[], freePowerups: string[]) =>
  rpc<{ ok: boolean; error?: string }>('admin_set_premium_tier', { p_free_positions: freePositions, p_free_powerups: freePowerups });

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
export const adminUpsertLeague = (sleeperId: string, season: string, name: string, settings: unknown, provider?: string) =>
  rpc<{ ok: boolean; error?: string; league_id?: string }>('admin_upsert_league', { p_sleeper_id: sleeperId, p_season: season, p_name: name, p_settings: settings, ...(provider ? { p_provider: provider } : {}) });
export const adminUpsertMemberships = (leagueId: string, members: MemberRow[]) =>
  rpc<{ ok: boolean; count?: number }>('admin_upsert_memberships', { p_league_id: leagueId, p_members: members });
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
export interface AdminHealth { now: string; leagues: number; enrolled: number; matchups_by_status: Record<string, number>; live_matchups: number; live_play_count: number; sim_play_count: number; last_play_ingest: string | null; last_state_update: string | null; }
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
  const { data, error } = await client().functions.invoke('dispatch-sim', { body: input });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}
/** Email an invite (share link + code) to a code-request, via the send-invite edge
 *  function (admin-only; the function re-checks is_admin and sends through Gmail). */
export async function sendInvite(input: { to: string; code: string; link: string; leagueName?: string; kind?: 'player' | 'commish' }): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await client().functions.invoke('send-invite', { body: input });
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
export interface RosterWallet { roster_id: number; coins: number }
/** Admin/commish: every team's current coin balance. */
export const adminLeagueWallets = (leagueId: string) => rpc<RosterWallet[]>('admin_league_wallets', { p_league_id: leagueId });
/** The league's configured weekly coin budget (any member can read it — the board
 *  shows it in place of the generic stipend when the league sets its own). Null
 *  when unreadable/unset. */
export const leagueWeeklyBudget = async (leagueId: string): Promise<number | null> => {
  if (!supabase) return null;
  const { data } = await supabase.from('league').select('weekly_budget').eq('id', leagueId).maybeSingle();
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
/** The league's live-test anchor (epoch ms) if test mode is on, else null. Any
 *  member can read it — the board compresses its window timeline from this. */
export const leagueTestLiveAt = async (leagueId: string): Promise<number | null> => {
  if (!supabase) return null;
  const { data } = await supabase.from('league').select('test_live_at').eq('id', leagueId).maybeSingle();
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

// ── Live power-up loadout (M1): arm/disarm in-slot team buffs, pre-lock ──────────
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
export const clearTargeted = (matchupId: string, powerupId: string) =>
  rpc<{ ok: boolean; error?: string }>('clear_targeted', { p_matchup_id: matchupId, p_powerup_id: powerupId });
export const useSpy = (matchupId: string, win: string, slot: string, reveal: 'player' | 'metric') =>
  rpc<{ ok: boolean; error?: string; reveal?: string | null; present?: boolean }>('use_spy', { p_matchup_id: matchupId, p_win: win, p_slot: slot, p_reveal: reveal });
export interface TargetedState {
  don?: { win: string; slot: string };
  byeSteal?: { win: string; slot: string; slug: string; pts: number };
  emp?: Record<string, number>;
  swaps?: Record<string, { kind: string; toMetric?: string; toPlayer?: string; atClock: number; atRt?: number }>;
  spy?: { win: string; slot: string; reveal: 'player' | 'metric' }[];
}
/** The caller's recorded targeted power-ups (own applied_state row, readable under RLS). */
export async function myTargeted(matchupId: string, userId: string): Promise<TargetedState> {
  const { data } = await client().from('applied_state').select('payload_json')
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
  const { data } = await client().from('applied_state').select('payload_json')
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

/** Subscribe to live score changes for a matchup. Returns an unsubscribe fn. */
export function subscribeMatchup(matchupId: string, onChange: () => void): () => void {
  const c = client();
  const ch = c.channel(`mw-${matchupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matchup_state', filter: `matchup_id=eq.${matchupId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matchup', filter: `id=eq.${matchupId}` }, onChange)
    .subscribe();
  return () => { c.removeChannel(ch); };
}
