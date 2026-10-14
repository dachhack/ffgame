// THE BYE WEEK, guarded at the source (v0.364.0).
//
// An odd-sized league sits one seat out every week. That has always been true —
// 0064's schedule pads the field with a ghost and skips the pair — and every
// screen read the missing matchup row as "no schedule yet". The drip board did
// worse: it fell back to 'rock-tunnel', a BAKED DEMO TEAM that does not exist
// in a live league, asserted it non-null, and threw on its name.
//
// The fix is a branch, and a branch is exactly the kind of thing that gets
// "tidied" back into a fallback by someone who reads `?? 'rock-tunnel'` as a
// sensible default. So the shape is pinned here: wherever the demo team is
// named as a fallback, its lookup must be CHECKED rather than asserted, and
// the file must have a bye screen to show instead.
import fs from 'node:fs';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── the crash, and the guard that replaced it ───────────────────────────────
for (const f of ['src/screens/Matchup.tsx', 'src/screens/MatchupFinal.tsx']) {
  const src = read(f);
  const name = f.split('/').pop();
  // The fallback may stay — it is right on the demo board, where the team
  // exists — but the RESULT of looking it up may never be asserted non-null.
  ok(`${name}: getTeam is never non-null-asserted`, !/getTeam\([^)]*\)!/.test(src),
    (src.match(/getTeam\([^)]*\)!/g) ?? [])[0]);
  ok(`${name}: renders a bye screen instead`, /<NoGameScreen/.test(src));
}

// The screen the guard falls through to must say which case it is. A bye and
// an unbuilt schedule are both "no matchup row", and only one of them is the
// commissioner's fault — calling a working schedule unsynced is the copy bug
// this file also exists to stop.
{
  const ui = read('src/app/ui.tsx');
  const body = ui.slice(ui.indexOf('export function NoGameScreen'));
  const end = body.indexOf('\nexport ', 1);
  const fn = end > 0 ? body.slice(0, end) : body;
  ok('NoGameScreen branches on bye', /bye \?/.test(fn));
  ok('…and only the NOT-bye copy mentions the commissioner',
    (fn.match(/commissioner/g) ?? []).length === 1 && fn.indexOf('BYE') < fn.indexOf('commissioner'), fn.match(/commissioner/g)?.length);
}

// ── nobody may fall back to Week 1 for "my current matchup" ─────────────────
// Week-less myMatchup is `.order('week').limit(1)` — the FIRST week of the
// season. Used as a fallback for a week-scoped miss it prints a months-old
// opponent as though it were the game coming up.
{
  const api = read('packages/core/src/data/liveApi.ts');
  ok('liveApi offers "my next game from here"', /export async function myMatchupFrom/.test(api));
  ok('…and it is bounded below by the week asked for', /\.gte\('week', week\)/.test(api));

  const onboard = read('src/screens/LiveOnboard.tsx');
  const loop = onboard.slice(onboard.indexOf('defaultOpenWeek(e.league_id'));
  const block = loop.slice(0, loop.indexOf('setCards('));
  ok('the leagues list never falls back to the week-less read on a resolved week',
    /wk == null/.test(block) && /myMatchupFrom/.test(block));
}

// ── the guillotine floor ────────────────────────────────────────────────────
// The migration is probed against a live database; what is checked here is
// that the CLIENT never renders a byed seat as a score, which is how a team
// that could not be eliminated still looked like the one about to be.
// v0.383.1: the chopping block has a WEB twin now, and the bye rules bind
// both renderers — a rule pinned in one file and drifted in the other is the
// exact bug this checker exists to stop.
for (const f of ['apps/mobile/src/ui/LeagueExtras.tsx', 'src/screens/GuillotinePanel.tsx']) {
  const ex = read(f);
  const name = f.split('/').pop();
  // 0267: bye is a REAL no-matchup flag from the server now, so the client
  // tests it alone — and a live (un-final) total prints as provisional (~),
  // never as a number that reads like a final.
  ok(`${name}: a byed seat prints BYE, not a number`, /a\.bye \? 'BYE'/.test(ex));
  ok(`${name}: …a live total is marked provisional, not passed off as final`, /`~\$\{fmt1\(a\.live!\)\}`/.test(ex));
  ok(`${name}: …and is never marked as the one under the blade`, /i === 0 && !a\.bye/.test(ex));
}
{
  const mig = read('supabase/migrations/0247_bye_week.sql');
  ok('the floor skips a seat with no score rather than imputing 0',
    /where t\.pts is not null/.test(mig) && !/limit 1\), 0\) as pts/.test(mig));
}

// ── A PLAYER'S BYE WEEK, beside his team (v0.712.4) ─────────────────────────
// Founder, beside Sleeper's "RB • CLE (11)". byeWeeksFrom reads it off the
// season slate: the one full regular-season week a team is missing from.
{
  const { byeWeeksFrom } = await import('../packages/core/src/data/liveApi.ts');
  const TEAMS = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LA','LAC','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
  // Week w: teams 2(w-1) and 2(w-1)+1 are off; everyone else plays, paired in order.
  const rows = [];
  for (let w = 1; w <= 4; w++) {
    const on = TEAMS.filter((_, i) => i !== 2 * (w - 1) && i !== 2 * (w - 1) + 1);
    for (let i = 0; i < on.length; i += 2) rows.push({ week: w, home: on[i], away: on[i + 1] });
  }
  rows.push({ week: 5, home: 'ARI', away: 'ATL' });          // a week still loading: 2 teams
  rows.push({ week: 201, home: 'c-1', away: 'c-2' });         // a college week: ignored
  const byes = byeWeeksFrom(rows);
  ok('bye: a team gets the full week it is missing from', byes.get('ARI') === 1 && byes.get('BAL') === 2, [byes.get('ARI'), byes.get('BAL')]);
  ok('bye: a partial week (2 games of 16) invents no bye', byes.get('CAR') === 3 && byes.get('CIN') === 4, [byes.get('CAR'), byes.get('CIN')]);
  ok('bye: a team with no missing full week has none yet', byes.get('SEA') === undefined, byes.get('SEA'));
  ok('bye: the Rams answer to LA and LAR alike', byes.get('LAR') === byes.get('LA'));
  ok('bye: college weeks are not NFL weeks', byes.get('c-1') === undefined);
  // Two missing full weeks means the schedule is wrong or partial: say nothing.
  // ARI is off in week 1; drop its week-2 game too and it is missing two.
  const twice = byeWeeksFrom(rows.filter((r) => !(r.week === 2 && (r.home === 'ARI' || r.away === 'ARI'))));
  ok('bye: two missing weeks give no number', twice.get('ARI') === undefined, twice.get('ARI'));
  const app = read('apps/mobile/src/ui/ClassicBoard.tsx');
  ok('board: the pre-kick line leads with the opponent', /\[e\.opponent, e\.kickoff\]\.filter\(Boolean\)\.join\(' · '\)/.test(app));
  ok('board: the team line carries the bye', /byeTag\(e\.team\)/.test(app));
  // The web board (mobile web, and the web's My Team variant): opponent first,
  // one line, no kickoff-then-opponent left anywhere.
  const web = read('src/screens/ClassicBoard.tsx');
  ok('web board: the pre-kick line leads with the opponent', /function preGameLine[\s\S]{0,200}\[e\.opponent, e\.kickoff\]\.filter\(Boolean\)\.join\(' · '\)/.test(web));
  ok('web board: no line still reads kickoff then opponent', !/kickoff \?\? ''\} \$\{[a-z]+\.opponent/.test(web));
  ok('web board: the team line carries the bye', /byeTag\(e\.team\)/.test(web));
  const team = read('apps/mobile/src/screens/Team.tsx');
  ok('my team: roster rows carry the bye and the week\'s opponent', /byeTag\(p\.team\)/.test(team) && /slateOppLabel\(slate, p\.team\)/.test(team));
}

if (fails) { console.log(`\n${fails} BYE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL BYE ASSERTIONS PASSED');
