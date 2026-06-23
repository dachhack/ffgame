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

export interface PreviewRedeem { ok: boolean; error?: string; league?: string; team?: string; }

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

export interface Enrollment { team_name: string; sleeper_roster_id: number; league: { name: string; season: string } | null; }

/** The caller's enrolled memberships (RLS scopes to their own rows). */
export async function myEnrollments(userId: string): Promise<Enrollment[]> {
  const { data, error } = await client()
    .from('league_membership')
    .select('team_name, sleeper_roster_id, league:league_id(name, season)')
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

/** Sealed picks visible under RLS: always yours; the opponent's only once locked. */
export async function getRevealedPicks(matchupId: string): Promise<RevealedPick[]> {
  const { data } = await client().from('sealed_pick')
    .select('app_user_id, game_window, roster_slot, player_slug, metric_id, locked').eq('matchup_id', matchupId);
  return (data ?? []) as RevealedPick[];
}

// ── Super admin ─────────────────────────────────────────────────────────────────
export interface AdminLeague { league_id: string; sleeper_league_id: string; name: string; season: string; commish_code: string; invite_code: string; commissioner: boolean; rosters: number; enrolled: number; }
export interface AdminUser { id: string; email: string | null; sleeper_username: string | null; sleeper_user_id: string | null; enrolled: number; created_at: string; }
export interface AdminMember { roster_id: number; team: string; owner: string | null; enrolled: boolean; email: string | null; sleeper: string | null; }
export interface AdminAdmin { email: string; note: string | null; }
export interface MemberRow { roster_id: number; owner_id: string | null; team_name: string; }
export interface MatchupRow { sleeper_matchup_id: number | null; home_roster_id: number; away_roster_id: number; }
export interface LineupRow { roster_id: number; starters: { slug: string; full: string; pos: string }[]; }
export interface AdminMatchup { id: string; week: number; home_roster_id: number; away_roster_id: number; status: string; lock_at: string | null; home_final: number | null; away_final: number | null; home_coin?: number | null; away_coin?: number | null; }
export interface AdminOverride { sleeper_user_id: string; note: string | null; }
export interface AdminAudit { table: string; op: string; row_id: string | null; at: string; detail?: string | null; }

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
export const adminLeagueMembers = (leagueId: string) => rpc<AdminMember[]>('admin_league_members', { p_league_id: leagueId });
export const commishOverview = () => rpc<AdminLeague[]>('commish_overview');
export interface MatchupPicks { home_roster_id: number; away_roster_id: number; home_app_user: string | null; away_app_user: string | null; picks: { app_user_id: string; game_window: string; roster_slot: string; player_slug: string | null; metric_id: string | null }[]; home_lineup: { slug: string; pos: string }[]; away_lineup: { slug: string; pos: string }[]; }
export const adminMatchupPicks = (matchupId: string) => rpc<MatchupPicks>('admin_matchup_picks', { p_matchup_id: matchupId });
export const adminSetState = (matchupId: string, states: { window: string; home: number; away: number }[], coin?: { home: number; away: number }) =>
  rpc<{ ok: boolean }>('admin_set_state', { p_matchup_id: matchupId, p_states: states, p_home_coin: coin?.home ?? null, p_away_coin: coin?.away ?? null });
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
