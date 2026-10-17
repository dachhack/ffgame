// COPIES (0500): who holds a player is a list. These helpers decide what the
// wire, the draft board and the matchup board show on web and app alike; with
// one copy they must answer exactly as the old one-owner maps did.
import { holdersBySlug, copyOpen, copiesLeft, holderFor, boardStashSets, copyWireTag, boardHeldBy, heldNow } from '../packages/core/src/data/copies';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

const rows = [{ roster_id: 3, slug: 'a' }, { roster_id: 1, slug: 'a' }, { roster_id: 2, slug: 'b' }];
const held = holdersBySlug(rows);
ok('holders in seat order', JSON.stringify(held.get('a')) === '[1,3]', held.get('a'));

// one copy: the old answers
ok('1 copy: a held player is gone to everyone', !copyOpen(held, 'b', 1, 1) && !copyOpen(held, 'b', 1));
ok('1 copy: a free player is open', copyOpen(held, 'z', 1, 1));
ok('missing copies reads as one', !copyOpen(held, 'b', undefined, 1) && !copyOpen(held, 'b', null));
ok('1 copy: the holder is the owner', holderFor(held, 'b', 1) === 2);

// two copies
ok('2 copies: another team holds one — still open to me', copyOpen(held, 'b', 2, 1));
ok('2 copies: never a second to the team that holds him', !copyOpen(held, 'b', 2, 2));
ok('2 copies: both held — gone', !copyOpen(held, 'a', 2, 2));
ok('copies left', copiesLeft(held, 'b', 2) === 1 && copiesLeft(held, 'a', 2) === 0 && copiesLeft(held, 'z', 4) === 4);
ok('my copy is the one that matters to me', holderFor(held, 'a', 3) === 3 && holderFor(held, 'a', 2) === 1);
ok('out-of-range copies clamp to 1–4', copyOpen(held, 'a', 9, 2) && !copyOpen(held, 'b', 0, 1));

// the matchup board's taxi/IR sets
const st = [
  { roster_id: 1, slug: 'x', spot: 'active' }, { roster_id: 2, slug: 'x', spot: 'ir' },
  { roster_id: 5, slug: 'y', spot: 'ir' }, { roster_id: 2, slug: 'w', spot: 'taxi' },
];
const s12 = boardStashSets(st, [1, 2], 1);
ok('my active copy is not benched by the rival’s IR copy', !s12.stashed.has('x') && !s12.onIr.has('x'));
ok('a team off the board does not count', !s12.stashed.has('y'));
ok('the rival’s own stash still shows', s12.stashed.has('w') && !s12.onIr.has('w'));
const s21 = boardStashSets(st, [1, 2], 2);
ok('from the rival’s side, their IR copy is IR', s21.stashed.has('x') && s21.onIr.has('x'));

// the wire's copies tag (v0.729.0)
const nm = (r) => `T${r}`;
ok('wire tag: one held, one left, who has it', copyWireTag(held, 'b', 2, 1, nm) === '1 of 2 left · T2', copyWireTag(held, 'b', 2, 1, nm));
ok('wire tag: mine first, as "you"', copyWireTag(held, 'a', 3, 3, nm) === '1 of 3 left · you, T1', copyWireTag(held, 'a', 3, 3, nm));
ok('wire tag: none with one copy or nobody holding him', copyWireTag(held, 'b', 1, 1, nm) === null && copyWireTag(held, 'z', 2, 1, nm) === null);
for (const f of ['apps/mobile/src/screens/Team.tsx', 'src/screens/NativeLeague.tsx']) {
  const src = (await import('node:fs')).readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  ok(`${f}: the tag shows on the default wire with copies`, src.includes('(showOwned || copies > 1) && holders.length > 0') && src.includes('copyWireTag('));
}

// ── THE BENCH IS THE ROSTER NOW (v0.730.11) ───────────────────────────────
// Founder: "team 4 has 10 bench, but in match up they have 13". Kickoff League
// week 7: three waiver drops after the Thursday kickoff stayed in the live
// week's add-only pool (0314); the board listed them on Team 4's bench.
{
  const rows = [{ roster_id: 4, slug: 'hunter-henry' }, { roster_id: 4, slug: 'marshawn-lloyd' }, { roster_id: 7, slug: 'hunter-henry' }, { roster_id: 2, slug: 'x' }];
  const held = boardHeldBy(rows, [4, 7]);
  ok('only the board\'s two teams are read', !held.has(2) && held.get(4).size === 2 && held.get(7).has('hunter-henry'));
  ok('a player dropped since kickoff is not on the roster now', !heldNow(held, 4, 'tyler-higbee') && !heldNow(held, 4, 'romeo-doubs'));
  ok('a current player is', heldNow(held, 4, 'marshawn-lloyd'));
  ok('copies: one team\'s copy says nothing about the other\'s roster', heldNow(held, 7, 'hunter-henry') && !heldNow(held, 7, 'marshawn-lloyd'));
  ok('not loaded yet reads as held (the board draws what it drew before)', heldNow(null, 4, 'anyone') && heldNow(held, null, 'anyone'));
  for (const f of ['src/screens/ClassicBoard.tsx', 'apps/mobile/src/ui/ClassicBoard.tsx']) {
    const src = (await import('node:fs')).readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    ok(`${f}: the bench, the fill preview and the auto-slot read the roster as it stands`,
      src.includes('boardHeldBy(rows, [m.home_roster_id, m.away_roster_id])')
      && /benchOf = \(rid[^)]*\) => \{[\s\S]{0,200}heldNow\(heldBy, rid, p\.slug\)/.test(src)
      && /oppPool\.filter\(\(p\) => heldNow\(heldBy, oppRid, p\.slug\)\)/.test(src)
      && src.includes('// dropped since kickoff (v0.730.11)'));
  }
}

if (fails) { console.log(`\n${fails} copies check(s) failed`); process.exit(1); }
console.log('\nall copies checks passed');
