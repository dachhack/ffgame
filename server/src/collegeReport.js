// THE COLLEGE READ-BACK (v0.550.1) — what the worker stored for every league
// with college players rostered. Read-only.
//
// For each such league: its kind (college calendar / mixed / devy), its first
// matchups, and each rostered college player's plays per requested week, by
// game. A college player in a college-calendar league scores at his board week
// (205 = college Week 5); in a mixed league his plays are ALSO copied into the
// NFL week the game falls in (0372), so ask for both.
import { db } from './supabase.js';

const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

/** PURE: what kind of college league this is, from its settings. */
export function collegeLeagueKind(settings) {
  const s = settings ?? {};
  if (s.calendar === 'college') return 'college calendar';
  if (Number(s.roster_shape?.devy ?? 0) > 0) return 'devy';
  return 'mixed';
}

/** PURE: one player's line — plays per week, and which games they came from. */
export function playerLine(slug, label, weeks, plays) {
  const by = weeks.map((w) => {
    const p = plays.filter((x) => x.player_slug === slug && x.week === w);
    return `wk ${w}: ${p.length} plays${p.length ? ` (${[...new Set(p.map((x) => x.game_id))].join('/')})` : ''}`;
  });
  return `${slug.padEnd(11)} ${label.padEnd(32)} ${by.join(' · ')}`;
}

export async function collegeReport({ weeks, leagues = null, log = console.log }) {
  if (!weeks?.length) throw new Error('which weeks? e.g. 205,4');
  let ids = leagues;
  if (!ids?.length) {
    const rows = ok(await db().from('native_roster').select('league_id').like('slug', 'c-%').limit(5000), 'college rosters');
    ids = [...new Set(rows.map((r) => r.league_id))];
  }
  if (!ids.length) { log('no league has a college player rostered'); return 0; }
  const lgs = ok(await db().from('league').select('id, name, season, settings_json').in('id', ids.slice(0, 25)), 'leagues');
  log(`${lgs.length} league(s) with college players; weeks ${weeks.join(', ')}`);
  for (const l of lgs) {
    const roster = ok(await db().from('native_roster').select('roster_id, slug, spot').eq('league_id', l.id).like('slug', 'c-%'), 'roster');
    const slugs = roster.map((r) => r.slug);
    const pool = ok(await db().from('league_pool').select('slug, full_name, pos').eq('league_id', l.id).in('slug', slugs), 'pool');
    const name = new Map(pool.map((p) => [p.slug, `${p.full_name} (${p.pos})`]));
    const plays = ok(await db().from('live_play').select('week, game_id, player_slug').in('player_slug', slugs).in('week', weeks).limit(20000), 'plays');
    const ms = ok(await db().from('matchup').select('week, status, lock_at').eq('league_id', l.id).order('week').limit(4), 'matchups');
    log(`\n── ${l.name} · ${collegeLeagueKind(l.settings_json)} · ${l.id}`);
    log(`   first matchups: ${ms.length ? ms.map((m) => `wk ${m.week} ${m.status}`).join(' · ') : 'none'}`);
    log(`   ${slugs.length} college players, ${new Set(plays.map((p) => p.player_slug)).size} with plays`);
    for (const r of roster) log(`   R${r.roster_id} ${playerLine(r.slug, name.get(r.slug) ?? '?', weeks, plays)}${r.spot === 'devy' ? '  [devy]' : ''}`);
  }
  return lgs.length;
}
