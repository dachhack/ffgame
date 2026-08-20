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
import { REGULAR_SEASON } from './seasonType.js';
import { buildPlayerIndex, slugOf } from './playerIndex.js';
import { assignKdst } from '../../packages/core/src/data/kdst.ts';
import { setRuntimeSlate } from '../../packages/core/src/data/nflSlate.ts';
import { poolFromRows } from '../../packages/core/src/data/preseasonPool.ts';

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
  }, { onConflict: 'sleeper_league_id,season' }).select('id, invite_code, avatar_url').single(); // invite_code is DB-generated on insert (migration 0002)
  const lid = leagueRow.id;

  // League crest (0071): the Sleeper avatar when the league has one, else a
  // random first-party tile — filled only while the crest is NULL, so a
  // commissioner's pick (or an earlier import's) survives every re-sync.
  if (!leagueRow.avatar_url) {
    let crest = league?.avatar ? `https://sleepercdn.com/avatars/thumbs/${league.avatar}` : null;
    if (!crest) crest = (await db().rpc('random_drip_avatar')).data ?? null;
    if (crest) await db().from('league').update({ avatar_url: crest }).eq('id', lid).is('avatar_url', null);
  }

  // Memberships go through the guarded chokepoint (0133), not a raw upsert. The
  // raw version this replaces recomputed app_user_id/enrolled and clobbered both
  // on conflict — so a RE-import could unlink an enrolled manager whose Sleeper
  // account wasn't matched that day. _upsert_membership_rows keeps existing
  // links and only ever moves enrolled false→true, same as the commissioner's
  // refresh, because it IS the same SQL.
  const userById = new Map(users.map((u) => [String(u.user_id), u]));
  const members = rosters.map((r) => {
    const owner = r.owner_id != null ? String(r.owner_id) : null;
    const u = owner ? userById.get(owner) : null;
    return { roster_id: r.roster_id, owner_id: owner, team_name: u?.metadata?.team_name || u?.display_name || `Roster ${r.roster_id}` };
  });
  const { error: memErr } = await db().rpc('_upsert_membership_rows', { p_league_id: lid, p_members: members });
  if (memErr) throw new Error(`membership upsert failed: ${memErr.message}`);
  const { data: enrolledRows } = await db().from('league_membership')
    .select('sleeper_roster_id').eq('league_id', lid).eq('enrolled', true);
  return {
    leagueId: lid, inviteCode: leagueRow.invite_code,
    rosters: rosters.length, enrolled: enrolledRows?.length ?? 0,
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
  // The matchups endpoint carries `starters` and `players`, but NOT `reserve`
  // (IR) or `taxi` — those live on /rosters. Fetched separately so the pool can
  // be a manager's WHOLE roster rather than only who Sleeper has starting.
  // Tolerated as empty on failure: a pool of starters is worse than a full one
  // but far better than no sync at all.
  const rosterRows = await sleeper.getLeagueRosters(leagueId).catch((e) => {
    console.error(`[sync-week] rosters ${leagueId}: ${e?.message ?? e}`);
    return [];
  });
  const rosterById = new Map((rosterRows ?? []).map((r) => [r.roster_id, r]));
  // REGULAR season explicitly: this mirrors Sleeper's schedule, which only ever
  // describes regular-season weeks. It used to read config.seasonType, which was
  // harmless only because the sync was skipped entirely in preseason mode — now
  // that both contexts run together (index.js), that would fetch preseason
  // kickoffs for a regular-season week.
  // FIXTURES, NOT SCORES (v0.314.0): both of these read kickoff times and who
  // plays whom, which move a couple of times a day — so they accept a 5-minute
  // cached scoreboard rather than pulling 194KB twice per league. At 100
  // leagues this is the difference between 200 identical ESPN requests per sync
  // pass and one. The live play tick does NOT opt in and is unchanged.
  const SLATE_TTL_MS = 300_000;
  const lockMs = await weekKickoffMs(season, week, REGULAR_SEASON, SLATE_TTL_MS);
  // Lineups lock 1h before the week's first kickoff (client shows the same lead).
  const lockAt = lockMs ? new Date(lockMs - config.lockLeadMs).toISOString() : null;

  // Live NFL slate from ESPN → overrides the baked 2025 slate for this real
  // season, so slate-gating + the K/DST bye check below use the correct windows
  // and byes. Stored in nfl_slate so the client can load it too.
  try {
    const slate = await buildSlate(season, week, REGULAR_SEASON, SLATE_TTL_MS);
    if (slate.length) {
      setRuntimeSlate(week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win, kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined })));
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

  // Store each roster's WHOLE roster as the player pool (and the
  // unenrolled-opponent fallback), resolved to our shared slug via the Sleeper
  // player index.
  //
  // Starters, bench, IR and taxi — not just starters. A manager fields one
  // player per window here, against a slate that is nothing like Sleeper's
  // weekly lineup, so "who Sleeper has starting" was never the right constraint
  // on who you may play; it was just the only list this sync fetched. The
  // column keeps its name because renaming it would touch every reader for no
  // behavioural gain.
  //
  // Each entry carries `grp` so the distinction survives: the UI can group and
  // label, and a future rule could restrict by it. Order is starters first
  // (their `slot` is Sleeper's own ordering), then bench, IR, taxi.
  const GROUPS = ['start', 'bench', 'ir', 'taxi'];
  const lineups = rows.map((r) => {
    const rr = rosterById.get(r.roster_id) ?? {};
    const starters = (r.starters ?? []).filter((sid) => sid && sid !== '0');
    const reserve = rr.reserve ?? [];
    const taxi = rr.taxi ?? [];
    // `players` is everything on the roster; bench is what's left once the
    // named groups are removed. Falls back to the matchup row's own player list
    // when /rosters didn't come back.
    const all = rr.players ?? r.players ?? [];
    const named = new Set([...starters, ...reserve, ...taxi].map(String));
    const bench = all.filter((sid) => sid && !named.has(String(sid)));
    const buckets = { start: starters, bench, ir: reserve, taxi };

    const seen = new Set();
    const entries = [];
    for (const grp of GROUPS) {
      for (const sid of buckets[grp] ?? []) {
        const key = String(sid);
        if (!sid || key === '0' || seen.has(key)) continue;
        seen.add(key);
        const p = idx.sleeper(sid);
        // CARRY `team` and `full`. The index has both and this used to drop them,
        // which left the client resolving a player's NFL team from the 2025 baked
        // slug table or by name-matching the stats DB. That works for a veteran
        // and fails for anyone who wasn't in the 2025 set — a rookie, most of a
        // dynasty taxi squad — and the failure is invisible in the worst way:
        // windowPools() can't place a player with no team, so they vanish from
        // EVERY window rather than showing up wrong. Sleeper knows the team;
        // there is no reason to re-derive it downstream.
        entries.push({ slot: entries.length, sleeper_id: sid, player_slug: p?.slug ?? null, full: p?.full ?? null, pos: p?.pos ?? null, team: p?.team ?? null, grp });
      }
    }
    return { league_id: lid, week, roster_id: r.roster_id, starters_json: entries };
  });

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
        // grp 'start': a filled K/DST is not on anyone's bench — it exists only
        // because the league doesn't roster the position, so it is always
        // playable and should group with the starters rather than sit under a
        // "Bench" heading it was never on.
        if (fill.kSlug) l.starters_json.push({ slot: slot++, sleeper_id: null, player_slug: fill.kSlug, pos: 'K', grp: 'start' });
        if (fill.dstSlug) l.starters_json.push({ slot: slot++, sleeper_id: null, player_slug: fill.dstSlug, pos: 'DEF', grp: 'start' });
      }
    }
  }

  if (lineups.length) await db().from('sleeper_lineup').upsert(lineups, { onConflict: 'league_id,week,roster_id' });
  return { matchups: matchups.length, lineups: lineups.length, lockAt };
}

// Copy a league's matchups + starting lineups from one week to another — so a
// test league (whose Sleeper source has no preseason matchups) can be scheduled
// against a real preseason week the worker will poll. Idempotent: clears any
// prior clone at `toWeek` first. New matchups are 'scheduled' (unlocked).
export async function cloneWeek(sleeperLeagueId, fromWeek, toWeek, season = config.season) {
  const { data: lg } = await db().from('league').select('id')
    .eq('sleeper_league_id', sleeperLeagueId).eq('season', season).maybeSingle();
  if (!lg) throw new Error(`no league for sleeper_league_id=${sleeperLeagueId} season=${season}`);
  const lid = lg.id;

  // Wipe any existing clone at toWeek (children first).
  const { data: existing } = await db().from('matchup').select('id').eq('league_id', lid).eq('week', toWeek);
  const ids = (existing ?? []).map((m) => m.id);
  if (ids.length) {
    await db().from('sealed_pick').delete().in('matchup_id', ids);
    await db().from('matchup_state').delete().in('matchup_id', ids);
    await db().from('applied_state').delete().in('matchup_id', ids);
    await db().from('matchup').delete().in('id', ids);
  }
  await db().from('sleeper_lineup').delete().eq('league_id', lid).eq('week', toWeek);

  const { data: ms } = await db().from('matchup')
    .select('sleeper_matchup_id, home_roster_id, away_roster_id').eq('league_id', lid).eq('week', fromWeek);
  const newM = (ms ?? []).map((m) => ({
    league_id: lid, week: toWeek, sleeper_matchup_id: m.sleeper_matchup_id,
    home_roster_id: m.home_roster_id, away_roster_id: m.away_roster_id, status: 'scheduled', lock_at: null,
  }));
  if (newM.length) await db().from('matchup').insert(newM);

  const { data: ls } = await db().from('sleeper_lineup')
    .select('roster_id, starters_json').eq('league_id', lid).eq('week', fromWeek);
  const newL = (ls ?? []).map((l) => ({ league_id: lid, week: toWeek, roster_id: l.roster_id, starters_json: l.starters_json }));
  if (newL.length) await db().from('sleeper_lineup').insert(newL);

  return { matchups: newM.length, lineups: newL.length };
}

/** A preseason "everyone dressed" pick pool from the raw Sleeper directory —
 *  adapter over the shared pure builder (src/data/preseasonPool.ts, also used
 *  by the admin console's deep-pool button): filters to active players and
 *  normalizes to PoolRow; ordering/synthetics/floor policy live in the shared
 *  module so CLI and button can never drift. */
export function buildPreseasonPool(players, slateTeams) {
  const rows = [];
  for (const [sid, p] of Object.entries(players ?? {})) {
    const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!full || p.active === false) continue;
    rows.push({ sid: String(sid), slug: slugOf(full), full, pos: p.position, team: p.team, depth: Number(p.depth_chart_order) || 99 });
  }
  return poolFromRows(rows, slateTeams);
}

/** Overwrite EVERY seat's lineup at a preseason board week with the deep slate-
 *  team pool above, so any seat can field the backups who actually play. The
 *  week's matchups must already exist (🏈 preseason toggle, or clone-week) —
 *  this replaces only the pick pools the toggle cloned from Week 1. Idempotent;
 *  re-run any time before lock. Toggling preseason OFF deletes these rows along
 *  with the clones, so re-seed after any re-toggle. */
export async function seedPreseasonPool(sleeperLeagueId, week, season = config.season) {
  let lid;
  if (sleeperLeagueId) {
    const { data: leagueRow } = await db().from('league').select('id')
      .eq('sleeper_league_id', sleeperLeagueId).eq('season', season).maybeSingle();
    if (!leagueRow) throw new Error(`no league for sleeper_league_id=${sleeperLeagueId} season=${season} — run cli sync first`);
    lid = leagueRow.id;
  } else {
    // No id → target the league(s) with the 🏈 preseason toggle ON. Exactly one
    // is the common case; otherwise list them so the caller can pick.
    const { data: cands } = await db().from('league').select('id, name, sleeper_league_id')
      .eq('season', season).not('preseason_at', 'is', null);
    if (!cands?.length) throw new Error('no league has the 🏈 preseason toggle on — flip it in the admin console first, or pass a league id');
    if (cands.length > 1) throw new Error(`several leagues are in preseason mode — pass one id: ${cands.map((c) => `${c.sleeper_league_id} (${c.name})`).join(', ')}`);
    lid = cands[0].id;
    console.log(`(no id given — targeting the preseason league: ${cands[0].name})`);
  }
  const { data: slateRows } = await db().from('nfl_slate').select('home, away').eq('season', season).eq('week', week);
  const slateTeams = new Set((slateRows ?? []).flatMap((g) => [g.home, g.away]).filter(Boolean));
  if (!slateTeams.size) throw new Error(`no nfl_slate rows at season ${season} week ${week} — preseason slate not loaded`);
  const pool = buildPreseasonPool(await sleeper.getPlayers(), slateTeams);
  if (!pool.length) throw new Error('empty pool — Sleeper directory returned no active players for the slate teams');
  const { data: mems } = await db().from('league_membership').select('sleeper_roster_id').eq('league_id', lid);
  if (!mems?.length) throw new Error('league has no seats — run cli sync first');
  const rows = mems.map((m) => ({ league_id: lid, week, roster_id: m.sleeper_roster_id, starters_json: pool }));
  await db().from('sleeper_lineup').upsert(rows, { onConflict: 'league_id,week,roster_id' });
  const { data: ms } = await db().from('matchup').select('id').eq('league_id', lid).eq('week', week).limit(1);
  return {
    seats: rows.length, poolSize: pool.length, teams: [...slateTeams].sort(),
    matchups: ms?.length ? 'present' : 'MISSING — hit the 🏈 preseason toggle (or clone-week) so the week has pairings',
  };
}
