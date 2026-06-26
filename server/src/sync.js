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
import { weekKickoffMs, buildSlate } from './poll/scoreboard.js';
import { buildPlayerIndex } from './playerIndex.js';
import { assignKdst } from '../../src/data/kdst.ts';
import { setRuntimeSlate } from '../../src/data/nflSlate.ts';

/** Sync a week's schedule + lineups for many leagues, throttled to stay under
 *  Sleeper's rate limit. Returns { ok, total }. Shared by the CLI (`sync-week-all`)
 *  and the worker's weekly auto-scheduler. */
export async function syncAllLeagues(week, season, idx, ids) {
  let ok = 0;
  for (const id of ids) {
    try { await syncWeek(id, week, season, idx); ok++; }
    catch (e) { console.error(`[sync-all] ${id}: ${e?.message ?? e}`); }
    await new Promise((r) => setTimeout(r, 400)); // ~2.5 leagues/sec
  }
  return { ok, total: ids.length };
}

/** Import one Sleeper league: league row, memberships, enrollment. */
export async function importLeague(leagueId, season = config.season) {
  const [league, users, rosters] = await Promise.all([
    sleeper.getLeague(leagueId), sleeper.getLeagueUsers(leagueId), sleeper.getLeagueRosters(leagueId),
  ]);

  const { data: leagueRow } = await db().from('league').upsert({
    sleeper_league_id: leagueId, season, name: league?.name ?? 'League',
    settings_json: { settings: league?.settings, scoring: league?.scoring_settings, roster_positions: league?.roster_positions },
    synced_at: new Date().toISOString(),
  }, { onConflict: 'sleeper_league_id,season' }).select('id, invite_code').single(); // invite_code is DB-generated on insert (migration 0002)
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
  return {
    leagueId: lid, inviteCode: leagueRow.invite_code,
    rosters: rosters.length, enrolled: memberships.filter((m) => m.enrolled).length,
  };
}

/** Mirror a week's Sleeper schedule into matchup rows + store starting lineups. */
export async function syncWeek(leagueId, week, season = config.season, playerIndex = null) {
  const idx = playerIndex || (await buildPlayerIndex());
  const { data: leagueRow } = await db().from('league').select('id, kdst_mode, settings_json')
    .eq('sleeper_league_id', leagueId).eq('season', season).single();
  const lid = leagueRow.id;
  const kdstMode = leagueRow.kdst_mode ?? 'off';
  const rows = await sleeper.getMatchups(leagueId, week); // one row per roster
  const lockMs = await weekKickoffMs(season, week);
  const lockAt = lockMs ? new Date(lockMs).toISOString() : null;

  // Live NFL slate from ESPN → overrides the baked 2025 slate for this real
  // season, so slate-gating + the K/DST bye check below use the correct windows
  // and byes. Stored in nfl_slate so the client can load it too.
  try {
    const slate = await buildSlate(season, week);
    if (slate.length) {
      setRuntimeSlate(week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win })));
      await db().from('nfl_slate').upsert(
        slate.map((g) => ({ season, week, home: g.home, away: g.away, win: g.win, kickoff: g.kickoff })),
        { onConflict: 'season,week,home' },
      );
    }
  } catch (e) { console.error('[sync-week] slate', e?.message ?? e); }

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

  // K/DST fill (migration 0028): if the commissioner enabled a fill mode and this
  // league doesn't roster K and/or DEF, inject a team-keyed K/DST slug into each
  // roster's pool so the Banker / Suppress metrics are playable. Detect missing
  // positions from Sleeper roster_positions when present, else from the lineups.
  if (kdstMode !== 'off') {
    const rp = leagueRow.settings_json?.roster_positions;
    const hasRp = Array.isArray(rp) && rp.length > 0;
    const hasPos = (pos) => hasRp ? rp.includes(pos) : lineups.some((l) => l.starters_json.some((s) => s.pos === pos));
    const needK = !hasPos('K'), needDef = !hasPos('DEF');
    if (needK || needDef) {
      const { data: manualRows } = await db().from('team_kdst').select('roster_id,k_slug,dst_slug').eq('league_id', lid);
      const manualBy = new Map((manualRows ?? []).map((m) => [m.roster_id, m]));
      // League-wide set of NFL teams handed out this week so random fills are drawn
      // without replacement. Iterate by roster_id for a stable, deterministic draw.
      const taken = new Set();
      for (const l of [...lineups].sort((a, b) => a.roster_id - b.roster_id)) {
        const fill = assignKdst({ leagueId: lid, rosterId: l.roster_id, week, mode: kdstMode, needK, needDef, manual: manualBy.get(l.roster_id), taken });
        let slot = l.starters_json.length;
        if (fill.kSlug) l.starters_json.push({ slot: slot++, sleeper_id: null, player_slug: fill.kSlug, pos: 'K' });
        if (fill.dstSlug) l.starters_json.push({ slot: slot++, sleeper_id: null, player_slug: fill.dstSlug, pos: 'DEF' });
      }
    }
  }

  if (lineups.length) await db().from('sleeper_lineup').upsert(lineups, { onConflict: 'league_id,week,roster_id' });
  return { matchups: matchups.length, lineups: lineups.length, lockAt };
}
