// Devy graduation's worker half (0367): who gets graduated, with what slug,
// and who waits. No network, no database.
import { runGraduation, nflTeamOf } from '../src/poll/graduate.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

ok(nflTeamOf({ athlete: { team: { abbreviation: 'TEN' } } }) === 'TEN', 'a team on the athlete payload');
ok(nflTeamOf({ athlete: {} }) === null && nflTeamOf(null) === null, 'no team, no graduation');

const index = { sleeper: (sid) => ({
  s1: { slug: 'cam-ward', full: 'Cam Ward', pos: 'QB', team: 'TEN' },
  s2: { slug: 'still-college', full: 'Still College', pos: 'RB', team: null },
}[sid] ?? null) };
const cands = [
  { espn_id: '4688380', sleeper_id: 's1', leagues: 2 },   // drafted: graduates
  { espn_id: '5000001', sleeper_id: null, leagues: 1 },   // no crosswalk id: skipped, ESPN never asked
  { espn_id: '5000002', sleeper_id: 's9', leagues: 1 },   // id the index lacks: waits
  { espn_id: '5000003', sleeper_id: 's2', leagues: 1 },   // ESPN 404: not on a team
];
const asked = [];
const fetchAthlete = async (id) => { asked.push(id); return id === '4688380' ? { athlete: { team: { abbreviation: 'TEN' } } } : null; };
const calls = [];
const rpc = async (fn, args) => {
  calls.push({ fn, args });
  if (fn === 'graduation_candidates') return { data: cands };
  if (fn === 'graduate_college_player') return { data: { ok: true, leagues: 2, conflicts: 0 } };
  return { error: { message: fn } };
};
const r = await runGraduation(index, () => {}, fetchAthlete, rpc);
ok(r.graduated === 2 && r.waiting === 1 && r.checked === 2, `one player, two leagues; one waits (got ${JSON.stringify(r)})`);
ok(!asked.includes('5000001') && !asked.includes('5000002'), 'ESPN is only asked about players the crosswalk and index can place');
const g = calls.filter((c) => c.fn === 'graduate_college_player');
ok(g.length === 1 && g[0].args.p_new_slug === 'cam-ward' && g[0].args.p_sleeper_id === 's1'
  && g[0].args.p_espn_id === '4688380' && g[0].args.p_pos === 'QB', 'graduated by ids, onto the index\'s slug');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL GRADUATION POLL CHECKS PASS');
