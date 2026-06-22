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
