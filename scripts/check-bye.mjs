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
{
  const ex = read('apps/mobile/src/ui/LeagueExtras.tsx');
  // 0267: bye is a REAL no-matchup flag from the server now, so the client
  // tests it alone — and a live (un-final) total prints as provisional (~),
  // never as a number that reads like a final.
  ok('a byed seat prints BYE, not a number', /a\.bye \? 'BYE'/.test(ex));
  ok('…a live total is marked provisional, not passed off as final', /`~\$\{fmt1\(a\.live!\)\}`/.test(ex));
  ok('…and is never marked as the one under the blade', /i === 0 && !a\.bye/.test(ex));

  const mig = read('supabase/migrations/0247_bye_week.sql');
  ok('the floor skips a seat with no score rather than imputing 0',
    /where t\.pts is not null/.test(mig) && !/limit 1\), 0\) as pts/.test(mig));
}

if (fails) { console.log(`\n${fails} BYE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL BYE ASSERTIONS PASSED');
