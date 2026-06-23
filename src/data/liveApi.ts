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

export async function getSession(): Promise<Session | null> {
  const { data } = await client().auth.getSession();
  return data.session;
}

export function onAuth(cb: (s: Session | null) => void): () => void {
  const { data } = client().auth.onAuthStateChange((_e, session) => cb(session));
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
export interface LiveMatchup { id: string; league_id: string; week: number; status: string; lock_at: string | null; home_roster_id: number; away_roster_id: number; }
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
