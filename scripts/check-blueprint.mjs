// COPYING A LEAGUE'S SETTINGS (founder: "When creating a new league, you
// should be able to copy the settings from an existing"), checked in Node.
//
// Two classes of assertion here, and the second is the one that earns its
// keep. The pure functions are testable directly. The APPLY sequence is not —
// it is a chain of RPCs against a live database — so its two invariants are
// pinned by reading the source instead, which is the same tool that guards a
// duplicated list or a removed default elsewhere in this suite. Comment lines
// are stripped before matching, or an assertion catches the comment that
// explains it.
import fs from 'node:fs';
import { blueprintCreateArgs, blueprintSummary } from '../packages/core/src/data/leagueBlueprint';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const SRC = fs.readFileSync(new URL('../packages/core/src/data/leagueBlueprint.ts', import.meta.url), 'utf8');
/** Source with `//` comment lines removed — the prose in this module names
 *  every function it calls, so matching against it raw proves nothing. */
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');

const BP = {
  sourceLeagueId: 'src-league',
  teams: 12, rounds: 17, pickSeconds: 90,
  mode: 'snake', budget: 300, lotSeconds: 20, maxLots: 4,
  nightStartMin: 120, nightEndMin: 480,
  posCaps: { QB: 3, RB: null, WR: null, TE: 3, K: 1, DEF: 1 },
  gameMode: 'classic', continuity: 'contract_dynasty', continuityN: 3,
  format: 'guillotine',
  scoring: { tdBonus: 2, ydMult: 1.5, toPenalty: -2, scoped: [{ a: 1 }] },
  rules: {
    waiverMode: 'faab', faabBudget: 100, tradeReview: 'commish',
    waiverClearMin: 180, waiverClearDow: [3], faAfterWaiversDow: [2],
    waiverHoldDays: 2, faStartMin: null, faEndMin: null,
    taxiMaxExp: 1, taxiLock: true, irTags: ['IR', 'O'],
  },
  classic: null,
  unread: [],
};

// ── the create tuple ────────────────────────────────────────────────────────
// Every argument create_native_league takes is positional, and two different
// create forms hand it this tuple. A shifted argument would not fail to
// compile — it would create a league with the roster size in the clock — so
// the arity and the slots are pinned here.
{
  const args = blueprintCreateArgs(BP, 'New League', '2026');
  ok('the tuple is exactly as long as createNativeLeague takes', args.length === 15, args.length);
  ok('name and season come from the CALLER, not the source league',
    args[0] === 'New League' && args[1] === '2026', [args[0], args[1]]);
  ok('teams / roster size / clock land in their own slots',
    args[2] === 12 && args[3] === 17 && args[4] === 90, args.slice(2, 5));
  ok('draft mode, budget and lot clock follow', args[5] === 'snake' && args[6] === 300 && args[7] === 20, args.slice(5, 8));
  ok('the overnight window carries', args[9] === 120 && args[10] === 480, args.slice(9, 11));
  ok('position caps carry as the object, not a copy that drops a null',
    args[11] && args[11].QB === 3 && args[11].RB === null, args[11]);
  ok('game, continuity and its N carry', args[12] === 'classic' && args[13] === 'contract_dynasty' && args[14] === 3, args.slice(12));

  // maxLots is meaningless off an auction and the server would store it
  // anyway, so a snake league copied from an auction one must not inherit 4
  // parallel lots waiting to confuse whoever switches the mode later.
  ok('a non-auction league collapses maxLots to 1', args[8] === 1, args[8]);
  const auc = blueprintCreateArgs({ ...BP, mode: 'auction' }, 'A', '2026');
  ok('…and an auction keeps the source league\'s lots', auc[8] === 4, auc[8]);

  // createNativeLeague's own signature, read from liveApi: if a parameter is
  // ever added there, this tuple is silently one short and every copied league
  // loses the new setting. Counting the RPC's p_ arguments is the check that
  // notices, because that list is what the tuple ultimately fills.
  const api = fs.readFileSync(new URL('../packages/core/src/data/liveApi.ts', import.meta.url), 'utf8');
  const body = api.slice(api.indexOf('export const createNativeLeague'));
  const call = body.slice(body.indexOf('create_native_league'), body.indexOf('});'));
  const params = (call.match(/p_[a-z_]+:/g) ?? []).length;
  ok('create_native_league still takes exactly the 15 the tuple fills', params === 15, params);
}

// ── the summary the picker prints ───────────────────────────────────────────
// It describes the BLUEPRINT rather than the league it came from: what the
// reader is deciding about is the league they are about to make.
{
  const lines = blueprintSummary(BP);
  const all = lines.join('\n');
  ok('the shape line leads with teams, roster and draft', /12 teams · 17-man roster · snake · 90s/.test(all), lines[0]);
  ok('the game, the format and the continuity are named', /CLASSIC/.test(all) && /GUILLOTINE/.test(all) && /CONTRACT DYNASTY/.test(all), lines[1]);
  ok('scoring is spelled out rather than summarised as "custom"', /TD \+2/.test(all) && /×1.5/.test(all), all);
  ok('a scoped rule is counted, since it is the part a total cannot show', /1 scoped/.test(all), all);
  ok('waivers name the mode AND the budget', /faab/.test(all) && /\$100/.test(all), all);
  ok('commish trade review is called out', /commish reviews trades/.test(all), all);

  const auction = blueprintSummary({ ...BP, mode: 'auction' });
  ok('an auction describes its money, not a pick clock', /auction · \$300 · 20s lots/.test(auction[0]), auction[0]);

  // A blueprint whose reads failed must not print a confident line about a
  // setting it never saw.
  const bare = blueprintSummary({ ...BP, scoring: null, rules: null, classic: null });
  ok('no scoring read ⇒ no scoring line', !/TD \+/.test(bare.join('\n')), bare);
  ok('no rules read ⇒ no waiver line', !/waivers/.test(bare.join('\n')), bare);

  const golf = blueprintSummary({ ...BP, classic: { golf: true, ppr: null, bestball: null, roster: null, slots: null, shape: null, scoring: null } });
  ok('golf is stated outright — it inverts who wins', /golf/i.test(golf.join('\n')), golf);
}

// ── the apply sequence, read from the source ────────────────────────────────
{
  const fmt = CODE.indexOf('setLeagueFormat(leagueId');
  const tx = CODE.indexOf('setTransactionRules(');
  ok('the format is applied before the transaction rules', fmt > 0 && tx > 0 && fmt < tx, [fmt, tx]);

  // WHY THAT ORDER MATTERS, pinned so nobody "tidies" the sequence: a
  // guillotine league's format presets a $1000 FAAB market server-side, so a
  // budget written first is overwritten by the preset.
  ok('…and the reason is written down where the order lives', /presets a \$1000 FAAB/.test(SRC));

  // applyBlueprint's whole contract is that it never throws and reports each
  // step. A bare `await setX(` inside it would escape both.
  const apply = CODE.slice(CODE.indexOf('export async function applyBlueprint'));
  const body = apply.slice(0, apply.indexOf('\n  return steps;'));
  const bare = (body.match(/await set[A-Z][A-Za-z]*\(/g) ?? [])
    .concat(body.match(/await league[A-Z][A-Za-z]*\(/g) ?? []);
  ok('every setter in applyBlueprint goes through run(), so none can throw', bare.length === 0, bare);
  ok('run() catches, rather than letting a rejection escape', /catch \(e\)/.test(body));
  ok('a refusal is recorded as a failed STEP, not swallowed', /ok: false/.test(body));

  // readBlueprint degrades rather than refusing: a scoring row that will not
  // load costs the scoring, not the copy.
  const read = CODE.slice(CODE.indexOf('export async function readBlueprint'));
  ok('every read is individually caught', (read.match(/\.catch\(\(\) => null\)/g) ?? []).length === 4,
    (read.match(/\.catch\(\(\) => null\)/g) ?? []).length);
  ok('what could not be read is named for the screen', /unread\.push\(/.test(read));
}

if (fails) { console.log(`\n${fails} BLUEPRINT ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL BLUEPRINT ASSERTIONS PASSED');
