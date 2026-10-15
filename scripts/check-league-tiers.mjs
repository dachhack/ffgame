// TIERS INSIDE ONE LEAGUE (0507, v0.728.0). The database half is proved by
// scripts/db/league-tiers-probes.sql against every migration; this pins the
// shared folds and that both clients and the worker are wired.
// Run: npx tsx scripts/check-league-tiers.mjs
import { readFileSync } from 'node:fs';
import { tierZone, periodLabel, lastTierMovesLine, TIER_PERIODS, TIER_MOVERS } from '../packages/core/src/data/leagueTiers';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let fails = 0;
const ok = (name, cond, got) => { if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); } else console.log(`ok   ${name}`); };

// Three tiers of four, two movers.
const z = (ti, place) => tierZone(ti, 3, place, 4, 2);
ok('zones: the top tier has no up — its top two stay', z(0, 0) === null && z(0, 1) === null);
ok('zones: the top tier\'s bottom two go down', z(0, 2) === 'down' && z(0, 3) === 'down');
ok('zones: a middle tier sends its top two up and bottom two down', z(1, 0) === 'up' && z(1, 1) === 'up' && z(1, 2) === 'down' && z(1, 3) === 'down');
ok('zones: the bottom tier has no down', z(2, 3) === null && z(2, 0) === 'up');
ok('zones: one mover moves one', tierZone(1, 3, 1, 4, 1) === null && tierZone(1, 3, 0, 4, 1) === 'up' && tierZone(1, 3, 3, 4, 1) === 'down');
ok('labels: the period', periodLabel({ ok: true, on: true, period_from: 5, period_to: 8 }) === 'Weeks 5–8' && periodLabel({ ok: true, on: true, period_from: 9, period_to: 9 }) === 'Week 9');
ok('labels: the latest moves only', lastTierMovesLine({ ok: true, on: true, moves: [
  { after_week: 8, roster_id: 3, team: 'Owls', direction: 'down', from_tier: 'Premier', to_tier: 'Championship' },
  { after_week: 8, roster_id: 5, team: 'Hawks', direction: 'up', from_tier: 'Championship', to_tier: 'Premier' },
  { after_week: 4, roster_id: 9, team: 'Old', direction: 'up', from_tier: 'Championship', to_tier: 'Premier' }] }) === 'After week 8: Owls ▼ Championship · Hawks ▲ Premier');
ok('labels: no moves, no line', lastTierMovesLine({ ok: true, on: true, moves: [] }) === null);
ok('choices: periods 2–6, movers 1–3', TIER_PERIODS.join() === '2,3,4,5,6' && TIER_MOVERS.join() === '1,2,3');

const mig = read('supabase/migrations/0507_tiers_in_league.sql');
ok('db: the switch, the boundary and the read', ['function set_league_tiers', 'function tiers_advance', 'function league_tiers', 'create table if not exists league_tier_move'].every((s) => mig.includes(s)));
ok('db: only weeks not yet started are rebuilt', mig.includes("and m.status <> 'scheduled'") && mig.includes('has already started'));
ok('db: probes run with the suite', read('scripts/db/run-scratch-probes.sh').includes('league-tiers-probes.sql'));
const idx = read('server/src/index.js'), tiers = read('server/src/tiers.js');
ok('worker: every league with tiers on is advanced, each on its own', idx.includes('await advanceLeagueTiers(log)') && tiers.includes("rpc('tiers_advance'") && tiers.includes('} catch (e) { log(\'tiers\', lg.id'));
for (const [n, card, home, commish] of [
  ['phone', 'apps/mobile/src/ui/LeagueTiers.tsx', 'apps/mobile/src/screens/LeagueHome.tsx', 'apps/mobile/src/screens/CommishTools.tsx'],
  ['web', 'src/screens/LeagueTiersPanel.tsx', 'src/screens/LeagueHubPage.tsx', 'src/screens/AdminPage.tsx'],
]) {
  const src = read(card);
  ok(`${n}: the commissioner's card turns tiers on, orders them, sets the period and movers`, src.includes('setLeagueTiers(leagueId, true, period, movers, labels)') && src.includes('TIER_PERIODS.map') && src.includes('TIER_MOVERS.map'));
  ok(`${n}: the members' table marks who goes up and down`, src.includes('tierZone(ti, st.tiers!.length, i, tr.teams.length, mv)'));
  ok(`${n}: league home shows the table; the commissioner's ladder section the switch`, read(home).includes('<TiersCard leagueId=') && (read(commish).includes('<TiersCommishCard leagueId={leagueId} />') || read(commish).includes('<TiersPanel leagueId={l.league_id} />')));
}

if (fails) { console.log(`\n${fails} LEAGUE-TIERS ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL LEAGUE-TIERS ASSERTIONS PASSED');
