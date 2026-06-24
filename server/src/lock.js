// Lock / reveal. At a matchup's lock_at (first kickoff of the week), the server
// flips the matchup to 'locked' and seals every pick (locked = true). ONLY the
// service role can do this — the RLS WITH CHECK forbids clients from ever setting
// locked — which is the moment the opponent's picks first become readable.
import { db } from './supabase.js';
import { autoLineup } from './engine.js';

/** Lock any scheduled matchups whose lock_at has passed. Returns count locked. */
export async function lockDueMatchups(now = new Date()) {
  const iso = now.toISOString();
  const { data: due } = await db().from('matchup').select('id')
    .eq('status', 'scheduled').not('lock_at', 'is', null).lte('lock_at', iso);
  if (!due || !due.length) return 0;
  const ids = due.map((m) => m.id);
  await db().from('sealed_pick').update({ locked: true, revealed_at: iso }).in('matchup_id', ids).eq('locked', false);
  await db().from('matchup').update({ status: 'live' }).in('id', ids);
  try { await materializeAutoLineups(ids, iso); } catch (e) { console.error('[lock] materialize auto-lineups', e?.message ?? e); }
  return ids.length;
}

/** At lock, write an auto-lineup (Sleeper starters + default metric) into
 *  sealed_pick — locked + revealed — for any side that is AI-controlled, or an
 *  enrolled manager who submitted no picks (unless the league policy is 'empty').
 *  Makes those lineups visible on the board and locks them; empty seats with no
 *  app_user are left to the resolver's auto-backup. */
export async function materializeAutoLineups(matchupIds, iso = new Date().toISOString()) {
  const { data: ms } = await db().from('matchup')
    .select('id,league_id,week,home_roster_id,away_roster_id').in('id', matchupIds);
  let n = 0;
  for (const m of ms ?? []) {
    const policy = (await db().from('league').select('lineup_policy').eq('id', m.league_id).maybeSingle()).data?.lineup_policy ?? 'best_lineup';
    const { data: mems } = await db().from('league_membership')
      .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', m.league_id)
      .in('sleeper_roster_id', [m.home_roster_id, m.away_roster_id]);
    const { data: lineups } = await db().from('sleeper_lineup').select('roster_id,starters_json')
      .eq('league_id', m.league_id).eq('week', m.week).in('roster_id', [m.home_roster_id, m.away_roster_id]);
    const startersByRoster = new Map((lineups ?? []).map((r) => [r.roster_id, r.starters_json]));
    for (const rosterId of [m.home_roster_id, m.away_roster_id]) {
      const mem = (mems ?? []).find((x) => x.sleeper_roster_id === rosterId);
      if (!mem?.app_user_id) continue; // empty seat → resolver auto-backup (can't store picks)
      const { data: existing } = await db().from('sealed_pick').select('id')
        .eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id).not('player_slug', 'is', null).limit(1);
      const hasPicks = !!(existing && existing.length);
      const isAi = mem.controller === 'ai';
      const missed = mem.enrolled && !hasPicks;
      if (!(isAi || (missed && policy !== 'empty'))) continue;
      if (isAi && hasPicks) await db().from('sealed_pick').delete().eq('matchup_id', m.id).eq('app_user_id', mem.app_user_id);
      const slugs = ((startersByRoster.get(rosterId)) ?? []).map((s) => s.player_slug).filter(Boolean);
      const rows = autoLineup(slugs, m.week).map((p) => ({
        matchup_id: m.id, app_user_id: mem.app_user_id, game_window: p.win, roster_slot: p.slot,
        player_slug: p.slug, metric_id: p.metric, locked: true, revealed_at: iso,
      }));
      if (rows.length) { await db().from('sealed_pick').upsert(rows, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' }); n++; }
    }
  }
  return n;
}

/** Mark matchups final once all their week's games are complete. */
export async function finalizeMatchups(week, completed) {
  if (!completed) return 0;
  const { data } = await db().from('matchup').update({ status: 'final' }).eq('week', week).eq('status', 'live').select('id');
  return (data ?? []).length;
}
