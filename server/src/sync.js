// Sleeper sync: import a league and MIRROR its schedule into our tables.
//
//   league → league + league_membership (enrollment marked where a Sleeper owner
//            links to an app_user with that sleeper_user_id)
//   weekly  → matchup rows mirroring the Sleeper pairings + sleeper_lineup starters
//
// Pairings come from Sleeper's matchups endpoint: rows sharing a matchup_id are
// opponents. lock_at = the week's first kickoff (ESPN scoreboard).
import { db } from './supabase.js';
import { config } from './config.js';
import * as sleeper from './sleeper.js';
import { weekKickoffMs } from './poll/scoreboard.js';
import { buildPlayerIndex } from './playerIndex.js';

/** Import one Sleeper league: league row, memberships, enrollment. */
export async function importLeague(leagueId, season = config.season) {
  const [league, users, rosters] = await Promise.all([
    sleeper.getLeague(leagueId), sleeper.getLeagueUsers(leagueId), sleeper.getLeagueRosters(leagueId),
  ]);

  const { data: leagueRow } = await db().from('league').upsert({
    sleeper_league_id: leagueId, season, name: league?.name ?? 'League',
    settings_json: { settings: league?.settings, scoring: league?.scoring_settings, roster_positions: league?.roster_positions },
    synced_at: new Date().toISOString(),
  }, { onConflict: 'sleeper_league_id,season' }).select('id').single();
  const lid = leagueRow.id;

  // Which Sleeper users are enrolled pilot testers? (app_user linked by sleeper id)
  const ownerIds = users.map((u) => String(u.user_id));
  const { data: appUsers } = await db().from('app_user').select('id, sleeper_user_id').in('sleeper_user_id', ownerIds);
  const appBySleeper = new Map((appUsers ?? []).map((a) => [a.sleeper_user_id, a.id]));
  const userById = new Map(users.map((u) => [String(u.user_id), u]));

  const memberships = rosters.map((r) => {
    const owner = r.owner_id != null ? String(r.owner_id) : null;
    const u = owner ? userById.get(owner) : null;
    const appId = owner ? appBySleeper.get(owner) ?? null : null;
    return {
      league_id: lid, sleeper_roster_id: r.roster_id, sleeper_owner_id: owner,
      app_user_id: appId, enrolled: !!appId,
      team_name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}`,
    };
  });
  await db().from('league_membership').upsert(memberships, { onConflict: 'league_id,sleeper_roster_id' });
  return { leagueId: lid, rosters: rosters.length, enrolled: memberships.filter((m) => m.enrolled).length };
}

/** Mirror a week's Sleeper schedule into matchup rows + store starting lineups. */
export async function syncWeek(leagueId, week, season = config.season, playerIndex = null) {
  const idx = playerIndex || (await buildPlayerIndex());
  const { data: leagueRow } = await db().from('league').select('id').eq('sleeper_league_id', leagueId).eq('season', season).single();
  const lid = leagueRow.id;
  const rows = await sleeper.getMatchups(leagueId, week); // one row per roster
  const lockMs = await weekKickoffMs(season, week);
  const lockAt = lockMs ? new Date(lockMs).toISOString() : null;

  // Group by Sleeper matchup_id → opponent pairs.
  const byMatchup = new Map();
  for (const r of rows) {
    if (r.matchup_id == null) continue;
    if (!byMatchup.has(r.matchup_id)) byMatchup.set(r.matchup_id, []);
    byMatchup.get(r.matchup_id).push(r);
  }
  const matchups = [];
  for (const [mid, pair] of byMatchup) {
    if (pair.length < 2) continue; // bye
    const [home, away] = pair;
    matchups.push({
      league_id: lid, week, sleeper_matchup_id: mid,
      home_roster_id: home.roster_id, away_roster_id: away.roster_id,
      status: 'scheduled', lock_at: lockAt,
    });
  }
  if (matchups.length) await db().from('matchup').upsert(matchups, { onConflict: 'league_id,week,home_roster_id,away_roster_id' });

  // Store each roster's starters (player pool + unenrolled-opponent fallback),
  // resolved to our shared slug via the Sleeper player index.
  const lineups = rows.map((r) => ({
    league_id: lid, week, roster_id: r.roster_id,
    starters_json: (r.starters ?? []).map((sid, i) => {
      const p = idx.sleeper(sid);
      return { slot: i, sleeper_id: sid, player_slug: p?.slug ?? null, pos: p?.pos ?? null };
    }),
  }));
  if (lineups.length) await db().from('sleeper_lineup').upsert(lineups, { onConflict: 'league_id,week,roster_id' });
  return { matchups: matchups.length, lineups: lineups.length, lockAt };
}
