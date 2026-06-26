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
 *  added to Supabase Auth → URL Configuration → Redirect URLs. */
function redirectTo(): string {
  return `${window.location.origin}${window.location.pathname}?live=1`;
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
export async function requestCode(input: { email?: string; sleeper?: string; league?: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Live mode is not configured.' };
  const { data, error } = await client().rpc('request_code', {
    p_email: input.email ?? null, p_sleeper: input.sleeper ?? null, p_league: input.league ?? null, p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  return data as { ok: boolean; error?: string };
}

export interface Enrollment { league_id: string; team_name: string; sleeper_roster_id: number; avatar_url: string | null; league: { name: string; season: string } | null; }

/** The caller's enrolled memberships (RLS scopes to their own rows). */
export async function myEnrollments(userId: string): Promise<Enrollment[]> {
  const { data, error } = await client()
    .from('league_membership')
    .select('league_id, team_name, sleeper_roster_id, avatar_url, league:league_id(name, season)')
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

// ── Sealed picks (live-H2H lineup) ──────────────────────────────────────────────
export interface LiveMatchup { id: string; league_id: string; week: number; status: string; lock_at: string | null; home_roster_id: number; away_roster_id: number; home_coin: number | null; away_coin: number | null; }
export interface PoolPlayer { slug: string; full: string; pos: string; }
export interface PickRow { game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null; }

/** The caller's enrolled roster in a league (first enrolled membership). */
export async function myRoster(userId: string): Promise<{ leagueId: string; rosterId: number } | null> {
  const { data } = await client().from('league_membership')
    .select('league_id, sleeper_roster_id').eq('app_user_id', userId).eq('enrolled', true).limit(1).maybeSingle();
  return data ? { leagueId: data.league_id, rosterId: data.sleeper_roster_id } : null;
}

/** The caller's next/earliest matchup in a league. */
export async function myMatchup(leagueId: string, rosterId: number): Promise<LiveMatchup | null> {
  const { data } = await client().from('matchup').select('*')
    .eq('league_id', leagueId).or(`home_roster_id.eq.${rosterId},away_roster_id.eq.${rosterId}`)
    .order('week').limit(1).maybeSingle();
  return (data as LiveMatchup) ?? null;
}

/** The caller's player pool for a week (their Sleeper roster, from sleeper_lineup). */
export async function myPool(leagueId: string, week: number, rosterId: number): Promise<PoolPlayer[]> {
  const { data } = await client().from('sleeper_lineup').select('starters_json')
    .eq('league_id', leagueId).eq('week', week).eq('roster_id', rosterId).maybeSingle();
  return ((data?.starters_json) ?? []) as PoolPlayer[];
}

/** The caller's saved picks for a matchup. */
export async function myPicks(matchupId: string, userId: string): Promise<PickRow[]> {
  const { data } = await client().from('sealed_pick')
    .select('game_window, roster_slot, player_slug, metric_id')
    .eq('matchup_id', matchupId).eq('app_user_id', userId);
  return (data ?? []) as PickRow[];
}

/** Upsert the caller's sealed picks (only allowed by RLS while unlocked). */
export async function savePicks(matchupId: string, userId: string, rows: PickRow[]): Promise<void> {
  const payload = rows.map((r) => ({ matchup_id: matchupId, app_user_id: userId, ...r }));
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
export interface SlateGame { away: string; home: string; win: string }
export async function liveSlate(week: number): Promise<SlateGame[]> {
  const { data } = await client().from('nfl_slate').select('away, home, win').eq('week', week);
  return (data ?? []) as SlateGame[];
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
  const { data } = await client().from('live_play')
    .select('player_slug, c, t, pid, k, y, td, ca, tg, to').eq('week', week);
  return (data ?? []) as LivePlayRow[];
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
export interface AdminLeague { league_id: string; sleeper_league_id: string; name: string; season: string; commish_code: string; invite_code: string; commissioner: boolean; rosters: number; enrolled: number; lineup_policy?: LineupPolicy; ai_teams?: number; }
export interface AdminUser { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; enrolled: number; created_at: string; }
export interface AdminMember { roster_id: number; team: string; owner: string | null; enrolled: boolean; email: string | null; sleeper: string | null; controller?: Controller; avatar?: string | null; }
export interface AdminAdmin { email: string; note: string | null; }
export interface MemberRow { roster_id: number; owner_id: string | null; team_name: string; }
export interface MatchupRow { sleeper_matchup_id: number | null; home_roster_id: number; away_roster_id: number; }
export interface LineupRow { roster_id: number; starters: { slug: string; full: string; pos: string }[]; }
export interface AdminMatchup { id: string; week: number; home_roster_id: number; away_roster_id: number; status: string; lock_at: string | null; home_final: number | null; away_final: number | null; home_coin?: number | null; away_coin?: number | null; }
export interface AdminOverride { sleeper_user_id: string; note: string | null; }
export interface AdminAudit { table: string; op: string; row_id: string | null; at: string; detail?: string | null; actor?: string | null; }

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const isAdmin = () => rpc<boolean>('is_admin');
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
export const adminUpsertLeague = (sleeperId: string, season: string, name: string, settings: unknown) =>
  rpc<{ ok: boolean; error?: string; league_id?: string }>('admin_upsert_league', { p_sleeper_id: sleeperId, p_season: season, p_name: name, p_settings: settings });
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
export interface CodeRequest { id: string; created_at: string; email: string | null; sleeper_username: string | null; league_name: string | null; note: string | null; handled: boolean; }
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
export const adminLeagueMembers = (leagueId: string) => rpc<AdminMember[]>('admin_league_members', { p_league_id: leagueId });
export const commishOverview = () => rpc<AdminLeague[]>('commish_overview');
export interface MatchupPicks { home_roster_id: number; away_roster_id: number; home_app_user: string | null; away_app_user: string | null; picks: { app_user_id: string; game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null }[]; home_lineup: { player_slug: string | null; pos: string | null }[]; away_lineup: { player_slug: string | null; pos: string | null }[]; home_buffs: string[]; away_buffs: string[]; home_unlocks?: string[]; away_unlocks?: string[]; home_extra?: number; away_extra?: number; }
export const adminMatchupPicks = (matchupId: string) => rpc<MatchupPicks>('admin_matchup_picks', { p_matchup_id: matchupId });

// ── Live power-up loadout (M1): arm/disarm in-slot team buffs, pre-lock ──────────
export const LIVE_BUFFS = ['overtime', 'ot-shield', 'momentum', 'garbage-time', 'floodgates', 'counter-nuke', 'insurance', 'fg-stack'] as const;
export const armBuff = (matchupId: string, buff: string) => rpc<{ ok: boolean; error?: string; buffs?: string[] }>('arm_buff', { p_matchup_id: matchupId, p_buff: buff });
export const disarmBuff = (matchupId: string, buff: string) => rpc<{ ok: boolean; error?: string; buffs?: string[] }>('disarm_buff', { p_matchup_id: matchupId, p_buff: buff });
export const myBuffs = (matchupId: string) => rpc<string[]>('my_buffs', { p_matchup_id: matchupId });

// Metric unlocks (M2): arm before a locked metric (Combo Drip / Return / Air Raid)
// can be picked. Same applied_state store, free this season.
export const armUnlock = (matchupId: string, unlock: string) => rpc<{ ok: boolean; error?: string; unlocks?: string[] }>('arm_unlock', { p_matchup_id: matchupId, p_unlock: unlock });
export const disarmUnlock = (matchupId: string, unlock: string) => rpc<{ ok: boolean; error?: string; unlocks?: string[] }>('disarm_unlock', { p_matchup_id: matchupId, p_unlock: unlock });
export const myUnlocks = (matchupId: string) => rpc<string[]>('my_unlocks', { p_matchup_id: matchupId });

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
