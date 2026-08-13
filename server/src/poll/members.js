// Member sync: Sleeper users+rosters → league_membership, self-driving (0133).
//
// Kills "it says im not in the league when I try to claim team": joins happen
// on Sleeper, and until now Drip's member list refreshed only when the commish
// pressed ⟳ refresh members. Two paths in, one write out:
//   • poked — a claimant bounced off redeem_invite; the client called
//     request_member_sync, which stamped member_sync_requested_at. Picked up on
//     the NEXT tick, so the claim flow's retry loop seats them in under a minute.
//   • stale — the safety net: every current-season sleeper league re-pulled on a
//     slow cadence, so membership converges even when nobody's claiming.
// member_sync_due() serves both; every write goes through the guarded
// _upsert_membership_rows chokepoint (links kept, enrolled only false→true —
// the same rule as the commissioner's button, because it IS the same SQL).
import { db } from '../supabase.js';
import { getLeagueUsers, getLeagueRosters } from '../sleeper.js';

const STALE_MINUTES = Number(process.env.MEMBER_SYNC_STALE_MIN || 10);

/** One league's pull: fetch, shape rows exactly like the client's syncMembers
 *  (sleeperAdmin.fetchMembers) so the two paths can't map owners differently. */
export async function syncLeagueMembers(leagueId, sleeperLeagueId) {
  const [users, rosters] = await Promise.all([
    getLeagueUsers(sleeperLeagueId), getLeagueRosters(sleeperLeagueId),
  ]);
  const byId = new Map((users ?? []).map((u) => [String(u.user_id), u]));
  const members = (rosters ?? []).map((ro) => {
    const owner = ro.owner_id != null ? String(ro.owner_id) : null;
    const u = owner ? byId.get(owner) : undefined;
    return { roster_id: ro.roster_id, owner_id: owner, team_name: u?.metadata?.team_name || u?.display_name || `Roster ${ro.roster_id}` };
  });
  const { data, error } = await db().rpc('_upsert_membership_rows', { p_league_id: leagueId, p_members: members });
  if (error) throw new Error(error.message);
  if (data && data.ok === false) throw new Error(data.error || 'membership upsert refused');
  return members.length;
}

/** The tick's pass: pull every due league. Throttled like syncAllLeagues to
 *  stay under Sleeper's rate limit; per-league errors are logged and the
 *  league's clock stamped anyway (member_sync_touch) so a dead upstream league
 *  backs off to the slow cadence instead of retrying every tick. */
export async function sweepMembers(log, season) {
  const { data: due, error } = await db().rpc('member_sync_due', { p_stale_minutes: STALE_MINUTES, p_season: season });
  if (error) { log('member sync: due query failed', error.message); return { synced: 0, failed: 0 }; }
  let synced = 0, failed = 0;
  for (const row of due ?? []) {
    try {
      const seats = await syncLeagueMembers(row.league_id, row.sleeper_league_id);
      synced++;
      log('member sync:', row.sleeper_league_id, '→', seats, 'seats');
    } catch (e) {
      failed++;
      log('member sync error:', row.sleeper_league_id, e.message);
      await db().rpc('member_sync_touch', { p_league_id: row.league_id });
    }
    if ((due?.length ?? 0) > 1) await new Promise((r) => setTimeout(r, 400)); // ~2.5 leagues/sec
  }
  return { synced, failed };
}
