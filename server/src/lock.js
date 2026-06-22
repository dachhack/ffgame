// Lock / reveal. At a matchup's lock_at (first kickoff of the week), the server
// flips the matchup to 'locked' and seals every pick (locked = true). ONLY the
// service role can do this — the RLS WITH CHECK forbids clients from ever setting
// locked — which is the moment the opponent's picks first become readable.
import { db } from './supabase.js';

/** Lock any scheduled matchups whose lock_at has passed. Returns count locked. */
export async function lockDueMatchups(now = new Date()) {
  const iso = now.toISOString();
  const { data: due } = await db().from('matchup').select('id')
    .eq('status', 'scheduled').not('lock_at', 'is', null).lte('lock_at', iso);
  if (!due || !due.length) return 0;
  const ids = due.map((m) => m.id);
  await db().from('sealed_pick').update({ locked: true, revealed_at: iso }).in('matchup_id', ids).eq('locked', false);
  await db().from('matchup').update({ status: 'live' }).in('id', ids);
  return ids.length;
}

/** Mark matchups final once all their week's games are complete. */
export async function finalizeMatchups(week, completed) {
  if (!completed) return 0;
  const { data } = await db().from('matchup').update({ status: 'final' }).eq('week', week).eq('status', 'live').select('id');
  return (data ?? []).length;
}
