// The classic SPOT ASSIGNMENT and the SPOT LABELS, checked in Node.
//
// `assignSpots` decides what the draft room's TEAMS panel shows: each pick
// against the starting spot it will fill. It lives in check:parity rather
// than beside the screens because two hosts render it and a panel that
// disagrees with the lineup the league can actually field is worse than the
// R1..R12 list it replaced.
//
// The cases that earn their keep are the ones a first-fit gets WRONG: a flex
// grabbed early that strands a flex-only player, a filtered spot (0172) that
// must claim its player before a plain spot takes them, and the general
// property — no arrangement of these players fills more spots than the one
// shown. That last one is checked by brute force, not by argument.
// The label half is here for the same reason: both hosts print these strings
// on the lineup setter and the draft panel, and a spot that READS differently
// than it BEHAVES is the bug the 0174 label was one edit away from causing.
import {
  assignSpots, slotAllows, slotDisplayName, slotDisplayNames, slotAcceptsLabel, slotFilterLabel,
  classicSlotsFromSpec, classicSlots, planSpotMove, bestballFillBy, isRetSlot,
  optimalLineup, autoSlotPlan, classicLineup, slateAwareProj, leagueEligiblePos,
} from '../packages/core/src/engine/classic';
import { sortPool, poolSortValue, adpFor, projFor, setLiveAdp, clearLiveAdp, adpIsLive } from '../packages/core/src/data/poolSort';
import { disambiguateSlugs } from '../packages/core/src/data/nativeLeague';
import { ADP_2026 } from '../packages/core/src/data/adp2026';
import { setLeagueFlags, clearLeagueFlags } from '../packages/core/src/data/commish';
import { PROJ_2026 } from '../packages/core/src/data/proj2026';
import { tenureMatches, TENURE_BANDS } from '../packages/core/src/data/tenure';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

/** A tiny reproducible PRNG for the brute-force blocks below — a probe that
 *  fails only sometimes is worse than no probe.
 *
 *  Deliberately NOT the obvious LCG. `seed = (seed * 1103515245 + 12345) % 2^31`
 *  then `seed % n` looks fine and is useless: an LCG's LOW-ORDER bits cycle with
 *  period n, so `rnd(4)` walks the same four values forever and every draw from
 *  it is correlated with every other. Written that way, the generators below
 *  produced ONE shape four hundred times and their brute-force checks proved
 *  nothing at all. xorshift32 mixes the low bits, and each block now asserts
 *  that its cases actually vary. */
const prng = (seed) => (n) => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
  return (seed >>> 0) % n;
};

/** Spots from a builder spec, exactly as a league stores them (S1..Sn). */
const spots = (...spec) => classicSlotsFromSpec(spec);
/** A drafted player. Draft order is array order. */
const P = (id, pos, extra = {}) => ({ id, pos, team: 'KC', exp: 3, ...extra });
/** slot → player id, the shape the panel renders. */
const seated = (a) => Object.fromEntries(a.spots.map((s) => [s.def.slot, s.player?.id ?? null]));
const benched = (a) => a.bench.map((p) => p.id);
const filled = (a) => a.spots.filter((s) => s.player).length;

// ── The plain case: nothing exotic, everyone lands where you'd expect ────────
{
  const s = spots({ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB'] }, { pos: ['WR'] }, { pos: ['RB', 'WR', 'TE'] });
  const a = assignSpots(s, [P('rb1', 'RB'), P('wr1', 'WR'), P('qb1', 'QB'), P('rb2', 'RB'), P('te1', 'TE'), P('rb3', 'RB')]);
  ok('dedicated spots take their own position', seated(a).S1 === 'qb1' && seated(a).S2 === 'rb1' && seated(a).S3 === 'rb2' && seated(a).S4 === 'wr1', seated(a));
  ok('the flex takes the earliest pick left over', seated(a).S5 === 'te1', seated(a));
  ok('leftovers bench in draft order', JSON.stringify(benched(a)) === JSON.stringify(['rb3']), benched(a));
}

// ── The first-fit trap: a flex claimed early ────────────────────────────────
// Spot order puts FLEX first. First-fit seats RB1 there, and WR1 — who is
// legal for NOTHING else — benches beside an empty RB spot.
{
  const s = spots({ pos: ['RB', 'WR', 'TE'] }, { pos: ['RB'] });
  const a = assignSpots(s, [P('rb1', 'RB'), P('wr1', 'WR')]);
  ok('a flex taken early does not bench a flex-only player', filled(a) === 2, seated(a));
  ok('the displaced pick moves to the spot only it can fill', seated(a).S2 === 'rb1' && seated(a).S1 === 'wr1', seated(a));
  ok('nothing benches while a spot it fits is empty', benched(a).length === 0, benched(a));
}

// ── The 0172 filter trap: overlapping, non-nested eligibility ───────────────
// A rookies-only RB spot and a plain RB spot. The rookie is legal for both;
// the veteran only for the plain one. Whoever the rookie is offered first,
// both must start.
{
  const s = spots({ pos: ['RB'] }, { pos: ['RB'], max_exp: 0, label: 'ROOKIE RB' });
  const a = assignSpots(s, [P('rook', 'RB', { exp: 0 }), P('vet', 'RB', { exp: 6 })]);
  ok('a filtered spot does not lose its only candidate', filled(a) === 2, seated(a));
  ok('the rookie takes the rookies-only spot', seated(a).S2 === 'rook' && seated(a).S1 === 'vet', seated(a));

  // Reversed draft order — the same two must start, whichever came first.
  const b = assignSpots(s, [P('vet', 'RB', { exp: 6 }), P('rook', 'RB', { exp: 0 })]);
  ok('draft order cannot cost a spot', filled(b) === 2 && seated(b).S2 === 'rook', seated(b));
}

// Two filtered spots whose candidate sets overlap but nest neither way:
// KC-only and KC/BUF. The KC/BUF spot must not eat the only KC back.
{
  const s = spots({ pos: ['RB'], teams: ['KC', 'BUF'] }, { pos: ['RB'], teams: ['KC'] });
  const a = assignSpots(s, [P('kcRb', 'RB', { team: 'KC' }), P('bufRb', 'RB', { team: 'BUF' })]);
  ok('crossing team whitelists still seat both', filled(a) === 2, seated(a));
  ok('the KC-only spot gets the KC back', seated(a).S2 === 'kcRb' && seated(a).S1 === 'bufRb', seated(a));
}

// ── Eligibility is exactly slotAllows — labels never change it (0174) ───────
{
  const s = spots({ pos: ['RB'], label: 'QB' });
  const a = assignSpots(s, [P('qb1', 'QB'), P('rb1', 'RB')]);
  ok('a label cannot make a spot take a position it does not accept', seated(a).S1 === 'rb1', seated(a));
  ok('the label is what the panel calls the spot', slotDisplayName(a.spots[0].def) === 'QB');
  ok('an unlabelled spot reads its eligibility', slotDisplayName(spots({ pos: ['RB', 'WR', 'TE'] })[0]) === 'FLEX (RB/WR/TE)');
}
{
  // Unknown tenure can't prove eligibility — the engine's no-guess rule.
  const s = spots({ pos: ['RB'], max_exp: 0 });
  const a = assignSpots(s, [P('unknown', 'RB', { exp: null })]);
  ok('unknown tenure cannot fill a tenure-windowed spot', seated(a).S1 === null && benched(a).length === 1, seated(a));
}

// ── Degenerate shapes hold their shape ──────────────────────────────────────
{
  const s = spots({ pos: ['QB'] }, { pos: ['K'] });
  const empty = assignSpots(s, []);
  ok('no picks yet: every spot renders empty', filled(empty) === 0 && empty.spots.length === 2, seated(empty));
  const only = assignSpots(s, [P('te1', 'TE')]);
  ok('a pick that fits nothing benches, spots stay empty', filled(only) === 0 && benched(only)[0] === 'te1');
  ok('no spots at all: everyone benches', assignSpots([], [P('rb1', 'RB')]).bench.length === 1);
}
{
  // Nobody is seated twice, and everybody is accounted for exactly once.
  const s = spots({ pos: ['RB'] }, { pos: ['RB', 'WR', 'TE'] }, { pos: ['WR'] });
  const picks = [P('a', 'RB'), P('b', 'WR'), P('c', 'RB'), P('d', 'WR'), P('e', 'TE')];
  const a = assignSpots(s, picks);
  const ids = [...a.spots.flatMap((x) => (x.player ? [x.player.id] : [])), ...benched(a)];
  ok('every pick appears exactly once', ids.length === picks.length && new Set(ids).size === picks.length, ids);
  ok('a seated player is legal for their spot', a.spots.every((x) => !x.player || slotAllows(x.def, x.player)));
}
{
  // Determinism: same input, same answer. The panel repolls every 3 seconds.
  const s = spots({ pos: ['RB', 'WR', 'TE'] }, { pos: ['RB'] }, { pos: ['WR'] });
  const picks = [P('a', 'RB'), P('b', 'WR'), P('c', 'TE')];
  ok('the same draft answers the same way twice',
    JSON.stringify(seated(assignSpots(s, picks))) === JSON.stringify(seated(assignSpots(s, picks))));
}

// ── An earlier pick is never benched to seat a later one ────────────────────
{
  // One spot, two legal players: the first one drafted holds it.
  const s = spots({ pos: ['RB'] });
  const a = assignSpots(s, [P('first', 'RB'), P('second', 'RB')]);
  ok('draft priority: the earlier pick keeps the contested spot', seated(a).S1 === 'first' && benched(a)[0] === 'second', seated(a));
}

// ── The property, brute-forced: nothing fills more spots ────────────────────
// Every case above is an argument; this is a proof over a few hundred shapes.
{
  const rnd = prng(20260816);
  const POS = ['QB', 'RB', 'WR', 'TE', 'K'];
  const SETS = [['QB'], ['RB'], ['WR'], ['TE'], ['K'], ['RB', 'WR', 'TE'], ['QB', 'RB', 'WR', 'TE'], ['WR', 'TE']];
  /** Maximum spots fillable, by exhaustive search over spot→player choices. */
  const brute = (slots, players) => {
    let best = 0;
    const walk = (si, used, got) => {
      if (got + (slots.length - si) <= best) return;    // can't beat it from here
      if (si === slots.length) { best = Math.max(best, got); return; }
      walk(si + 1, used, got);                          // leave this spot empty
      for (let pi = 0; pi < players.length; pi++) {
        if (used.has(pi) || !slotAllows(slots[si], players[pi])) continue;
        used.add(pi); walk(si + 1, used, got + 1); used.delete(pi);
      }
    };
    walk(0, new Set(), 0);
    return best;
  };
  let worst = null, cases = 0;
  const shapes = new Set();
  for (let c = 0; c < 400; c++) {
    const spec = Array.from({ length: 1 + rnd(6) }, () => {
      const s = { pos: SETS[rnd(SETS.length)] };
      const f = rnd(4);
      if (f === 1) s.teams = ['KC'];
      else if (f === 2) s.max_exp = 0;
      else if (f === 3) s.min_exp = 4;
      return s;
    });
    const slots = classicSlotsFromSpec(spec);
    const players = Array.from({ length: rnd(8) }, (_, i) =>
      ({ id: `p${i}`, pos: POS[rnd(POS.length)], team: rnd(2) ? 'KC' : 'BUF', exp: rnd(3) === 0 ? 0 : 1 + rnd(8) }));
    const a = assignSpots(slots, players);
    cases++;
    shapes.add(JSON.stringify([spec, players]));
    // Legality + accounting hold on every shape, not just the handwritten ones.
    const idsSeen = [...a.spots.flatMap((x) => (x.player ? [x.player.id] : [])), ...benched(a)];
    if (!a.spots.every((x) => !x.player || slotAllows(x.def, x.player))
        || new Set(idsSeen).size !== players.length || idsSeen.length !== players.length) {
      worst = { why: 'illegal or lost a player', spec, players };
      break;
    }
    const max = brute(slots, players);
    if (filled(a) !== max) { worst = { why: `filled ${filled(a)}, best possible ${max}`, spec, players }; break; }
  }
  ok(`no arrangement fills more spots (${cases} random shapes, brute-forced)`, worst === null, worst);
  ok('…and the shapes are actually different from each other', shapes.size > 350, shapes.size);
}

// ── The labels a manager reads on the lineup setter ─────────────────────────
{
  const s = spots({ pos: ['RB'] }, { pos: ['RB'] }, { pos: ['QB'] }, { pos: ['RB', 'WR', 'TE'] });
  ok('repeated spots are numbered so you know which row you are setting',
    JSON.stringify(slotDisplayNames(s)) === JSON.stringify(['RB 1', 'RB 2', 'QB', 'FLEX (RB/WR/TE)']), slotDisplayNames(s));
  ok('a spot that appears once is NOT numbered', slotDisplayNames(spots({ pos: ['QB'] }))[0] === 'QB');
  // The counts model already generated RB1/RB2 — those must not become "RB1 1".
  const counted = classicSlots({ QB: 1, RB: 2 }).map((d) => d.slot);
  ok('the counts model keeps its own generated names', JSON.stringify(counted) === JSON.stringify(['QB', 'RB1', 'RB2']), counted);
  // Custom labels are disambiguated the same way — two "FLAG SPOT"s are two rows.
  const dup = spots({ pos: ['WR'], label: 'FLAG SPOT' }, { pos: ['TE'], label: 'FLAG SPOT' });
  ok('two spots sharing a custom label are still told apart',
    JSON.stringify(slotDisplayNames(dup)) === JSON.stringify(['FLAG SPOT 1', 'FLAG SPOT 2']), slotDisplayNames(dup));
}
{
  // The accepts line says the half the NAME doesn't.
  ok('a derived name already says the positions, so the line stays empty',
    slotAcceptsLabel({ pos: ['RB', 'WR', 'TE'] }) === '', slotAcceptsLabel({ pos: ['RB', 'WR', 'TE'] }));
  ok('a CUSTOM label hides eligibility, so the positions are spelled out',
    slotAcceptsLabel({ pos: ['WR', 'TE'], label: 'Only NFC Players' }) === 'WR/TE',
    slotAcceptsLabel({ pos: ['WR', 'TE'], label: 'Only NFC Players' }));
  ok('a filter shows whether or not the spot is labelled',
    slotAcceptsLabel({ pos: ['RB'], max_exp: 0, flt: { max_exp: 0 } }) === 'ROOKIES ONLY'
    && slotAcceptsLabel({ pos: ['RB'], label: 'The Kid', flt: { teams: ['KC'] } }) === 'RB · KC');
  ok('no filter reads as nothing, never as "undefined"', slotFilterLabel(null) === '' && slotFilterLabel(undefined) === '');
  ok('a tenure window reads as a range', slotFilterLabel({ min_exp: 2, max_exp: 5 }) === '2–5 YRS', slotFilterLabel({ min_exp: 2, max_exp: 5 }));
  ok('an open-ended window still reads', slotFilterLabel({ min_exp: 4 }) === '4–30 YRS', slotFilterLabel({ min_exp: 4 }));
}
{
  // The load-bearing one: what a spot READS must match what it ACCEPTS.
  const s = spots({ pos: ['WR', 'TE'], label: 'Only NFC Players', teams: ['PHI'] })[0];
  const legal = { pos: 'WR', team: 'PHI', exp: 3 };
  const wrongTeam = { pos: 'WR', team: 'KC', exp: 3 };
  const wrongPos = { pos: 'RB', team: 'PHI', exp: 3 };
  ok('the accepts line names exactly the rule slotAllows enforces',
    slotAcceptsLabel(s) === 'WR/TE · PHI' && slotAllows(s, legal) && !slotAllows(s, wrongTeam) && !slotAllows(s, wrongPos),
    slotAcceptsLabel(s));
}
{
  // A FLAG CONDITION (v0.300.0): only a player wearing one of the spot's flags
  // may stand in it. Same no-guess rule as tenure — a player with no id has no
  // flag to read and therefore cannot prove he qualifies.
  clearLeagueFlags();
  const s = spots({ pos: ['RB', 'WR', 'TE'], flags: ['Franchise Tag'] })[0];
  const tagged = { id: 'saquon-barkley', pos: 'RB', team: 'PHI', exp: 7 };
  const plain = { id: 'james-cook', pos: 'RB', team: 'BUF', exp: 3 };
  ok('an unflagged league lets nobody into a flag-only spot', !slotAllows(s, tagged) && !slotAllows(s, plain));
  setLeagueFlags('L', [{ slug: 'saquon-barkley', label: 'FRANCHISE TAG' }]);
  ok('the flagged player may fill it (label matched case-insensitively)', slotAllows(s, tagged));
  ok('…and an unflagged one may not', !slotAllows(s, plain));
  ok('a player with no id can never prove a flag', !slotAllows(s, { pos: 'RB', team: 'PHI', exp: 7 }));
  ok('the wrong label is still a miss', !slotAllows(spots({ pos: ['RB'], flags: ['Keeper'] })[0], tagged));
  ok('the filter line names the flag', slotFilterLabel({ flags: ['Franchise Tag'] }) === '⚑ Franchise Tag',
    slotFilterLabel({ flags: ['Franchise Tag'] }));
  clearLeagueFlags();
}

// ── WHICH POSITIONS THE LEAGUE CAN ROSTER (v0.302.0) ───────────────────────
// The waiver wire filters on this, so it has to agree with what a spot will
// actually accept — offering a kicker a league can never start is the bug,
// and hiding a flex-eligible back would be the worse one.
{
  const spec = [{ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB', 'WR', 'TE'] }];
  const e = leagueEligiblePos({ slots: spec });
  ok('a league with no K or DEF spot cannot roster one', !e.has('K') && !e.has('DEF'));
  ok('…and can roster everything its spots accept', ['QB', 'RB', 'WR', 'TE'].every((p) => e.has(p)));
  ok('a RET spot opens the ball-carriers it stands for',
    ['RB', 'WR', 'TE', 'FB'].every((p) => leagueEligiblePos({ slots: [{ pos: ['RET'] }] }).has(p)));
  ok('a league with a kicker spot keeps kickers', leagueEligiblePos({ slots: [{ pos: ['K'] }] }).has('K'));
  ok('no lineup at all means no restriction', leagueEligiblePos(null) === null
    && leagueEligiblePos({ slots: [] }) === null, leagueEligiblePos({ slots: [] }));
}

// ── THE ORDER OF AN AVAILABLE-PLAYER LIST (v0.302.0) ───────────────────────
// Four orders over one list. The load-bearing property is the LAST one: a
// player the source doesn't know sorts last in every order, because an unknown
// ADP is not an ADP of zero and a missing projection is not zero points.
{
  const known = [...PROJ_2026.keys()].filter((k) => ADP_2026.has(k)).slice(0, 3);
  ok('the bake has players with both an ADP and a projection (else this is vacuous)', known.length === 3, known);
  const rows = known.map((slug, i) => ({ slug, rank: i + 1 }))
    .concat([{ slug: 'nobody-at-all', rank: 99 }]);
  const own = { [known[2]]: 90, [known[0]]: 10 };
  const by = (o, extra) => sortPool(rows, o, extra).map((r) => r.slug);
  ok('rank order is the pool\u2019s own', by('rank')[0] === known[0] && by('rank').at(-1) === 'nobody-at-all');
  const adpOrder = by('adp');
  ok('ADP runs earliest first',
    adpFor(adpOrder[0]) <= adpFor(adpOrder[1]) && adpFor(adpOrder[1]) <= adpFor(adpOrder[2]),
    adpOrder.map((x) => adpFor(x)));
  const projOrder = by('proj');
  ok('PROJ runs highest first',
    projFor(projOrder[0]) >= projFor(projOrder[1]) && projFor(projOrder[1]) >= projFor(projOrder[2]),
    projOrder.map((x) => projFor(x)));
  ok('an unknown player sorts LAST in every order, never first',
    ['adp', 'proj', 'own'].every((o) => by(o, own).at(-1) === 'nobody-at-all'));
  const ownOrder = by('own', own);
  ok('ownership runs highest first, and an unowned player is behind an owned one',
    ownOrder[0] === known[2] && ownOrder[1] === known[0]);
  ok('with no ownership map loaded the list holds its rank order rather than claiming everyone is 0%',
    by('own').join() === by('rank').join());
  // v0.310.0: the value is derived from the ROW, not from a positional slug —
  // it needs the position now, because a projection is the league's.
  ok('the row label says what it sorted on', poolSortValue('rank', { slug: known[0], rank: 1 }) === '#1'
    && poolSortValue('own', { slug: known[2], rank: 3 }, own) === '90%'
    && poolSortValue('adp', { slug: 'nobody-at-all', rank: 9 }) === '\u2014');
  ok('sorting never mutates the caller\u2019s array', rows.at(-1).slug === 'nobody-at-all' && rows.length === 4);

  // THE LIVE MARKET OVERLAY (v0.306.1). The load-bearing property is that it
  // OVERLAYS rather than replaces: a feed that doesn't price a player, or a
  // feed that never arrived, must leave the baked consensus showing. A board
  // that blanked 200 rows on a failed poll would be worse than a stale one.
  const bakedFirst = adpFor(known[0]);
  ok('with no feed installed, ADP is the baked consensus', bakedFirst === ADP_2026.get(known[0]));
  ok('…and the board says it is not live', adpIsLive() === false);
  setLiveAdp({ [known[0]]: 1.5 });
  ok('an installed feed wins for the players it prices', adpFor(known[0]) === 1.5);
  ok('…and the bake still answers for the ones it does not',
    adpFor(known[1]) === ADP_2026.get(known[1]), adpFor(known[1]));
  ok('…and the board can say it is live', adpIsLive() === true);
  ok('a live ADP actually reorders the list',
    sortPool(rows, 'adp')[0].slug === known[0], sortPool(rows, 'adp').map((r) => r.slug));
  setLiveAdp({});
  ok('an EMPTY feed is not a feed — the bake comes straight back',
    adpFor(known[0]) === bakedFirst && adpIsLive() === false);
  clearLiveAdp();
  ok('and clearing restores the bake', adpFor(known[0]) === bakedFirst);
}

// ── Moving a player who is already starting somewhere ──────────────────────
{
  const s = spots({ pos: ['RB'] }, { pos: ['TE'] }, { pos: ['RB', 'WR', 'TE'] });   // S1 RB, S2 TE, S3 FLEX
  const legal = (slot, slug) => {
    const d = s.find((x) => x.slot === slot);
    const pos = { rb1: 'RB', te1: 'TE', rb2: 'RB', wr1: 'WR' }[slug];
    return !!d && slotAllows(d, { pos, team: 'KC', exp: 3 });
  };
  // From the BENCH: one write, nothing vacated.
  ok('a bench player is a single write',
    JSON.stringify(planSpotMove(s, { S1: 'rb1', S2: 'te1', S3: null }, 'S3', 'wr1', legal))
      === JSON.stringify([{ slot: 'S3', player: 'wr1' }]));
  // SWAP: the TE in S2 moves to the flex, and the flex's RB is legal in… no he
  // isn't — S2 only takes TE — so S2 is emptied rather than filled illegally.
  ok('a displaced player who cannot stand in the vacated spot leaves it EMPTY',
    JSON.stringify(planSpotMove(s, { S1: 'rb1', S2: 'te1', S3: 'rb2' }, 'S3', 'te1', legal))
      === JSON.stringify([{ slot: 'S3', player: 'te1' }, { slot: 'S2', player: null }]),
    planSpotMove(s, { S1: 'rb1', S2: 'te1', S3: 'rb2' }, 'S3', 'te1', legal));
  // A true SWAP, where the displaced man IS legal in the vacated spot.
  ok('two RB-eligible spots swap their occupants',
    JSON.stringify(planSpotMove(s, { S1: 'rb1', S2: null, S3: 'rb2' }, 'S3', 'rb1', legal))
      === JSON.stringify([{ slot: 'S3', player: 'rb1' }, { slot: 'S1', player: 'rb2' }]),
    planSpotMove(s, { S1: 'rb1', S2: null, S3: 'rb2' }, 'S3', 'rb1', legal));
  // Moving into an EMPTY spot vacates the old one with nobody to backfill.
  ok('moving into an empty spot leaves the old one empty',
    JSON.stringify(planSpotMove(s, { S1: 'rb1', S2: null, S3: null }, 'S3', 'rb1', legal))
      === JSON.stringify([{ slot: 'S3', player: 'rb1' }, { slot: 'S1', player: null }]));
  // The vacated spot is ALWAYS written: "he left S1" is a change to S1, and a
  // picker that only wrote the target would leave the same player in two spots.
  ok('the vacated spot is always part of the plan',
    planSpotMove(s, { S1: 'rb1', S2: null, S3: null }, 'S3', 'rb1', legal).length === 2);
}

// ── Tenure bands (the waiver wire's filter, and 0172's neighbour) ──────────
{
  ok('every band has a label and a short form', TENURE_BANDS.every((b) => b.id && b.label && b.short));
  ok('ANY takes everyone, unknowns included', TENURE_BANDS.every(() => true)
    && tenureMatches('any', 0) && tenureMatches('any', 12) && tenureMatches('any', null));
  ok('a rookie is exp 0 — seasons ACCRUED', tenureMatches('rookie', 0) && !tenureMatches('rookie', 1));
  ok('the bands tile without gaps or overlap', [0, 1, 2, 3, 4, 5, 6, 7, 8, 15]
    .every((e) => ['rookie', 'y1_3', 'y4_7', 'y8'].filter((b) => tenureMatches(b, e)).length === 1));
  // The rule that matters: same no-guess answer slotAllows gives.
  ok('an UNKNOWN tenure matches no band but ANY',
    ['rookie', 'y1_3', 'y4_7', 'y8'].every((b) => !tenureMatches(b, null) && !tenureMatches(b, undefined)));
  ok('a nonsense value is unknown, not a rookie', !tenureMatches('rookie', NaN));
  // TEAM UNITS pass every band (v0.258.0) — the same exemption slotAllows
  // gives a spot's tenure window, so the wire can show you the units a
  // rookies-only league's own spots would accept. Case-insensitive, and only
  // for genuine team units: a skill player's pos changes nothing.
  ok('a D/ST matches every band, tenure unknowable',
    ['rookie', 'y1_3', 'y4_7', 'y8'].every((b) => tenureMatches(b, null, 'DEF') && tenureMatches(b, null, 'def')));
  ok('so do K, HC and P', tenureMatches('rookie', null, 'K') && tenureMatches('y8', null, 'HC') && tenureMatches('y1_3', null, 'P'));
  ok('a skill player with unknown tenure still proves nothing', !tenureMatches('rookie', null, 'RB'));
  ok('…and a known one still lands in his own band only',
    tenureMatches('rookie', 0, 'RB') && !tenureMatches('y1_3', 0, 'RB'));
}

// ── The BEST-BALL fill, testable for the first time ────────────────────────
// bestballFill ranks by classicPoints, which needs baked play data, so this
// algorithm has never had probes. bestballFillBy takes the ranking as an
// argument — so the SHAPE of the fill (who is eligible, who is excluded, what
// order spots claim players in) can finally be asserted with plain numbers.
{
  const R = (id, pos, extra = {}) => ({ id, name: id, full: id, pos, team: 'KC', stats: {}, ...extra });
  const proj = { star: 20, mid: 12, low: 4, rook: 9, vet: 15 };
  const by = (p) => proj[p.id] ?? 0;
  const s = spots({ pos: ['RB'], bb: true }, { pos: ['RB', 'WR', 'TE'], bb: true });
  const bb = ['S1', 'S2'];

  ok('the highest-ranked eligible player takes the spot',
    bestballFillBy([], bb, [R('low', 'RB'), R('star', 'RB')], s, by)[0].player.id === 'star');
  // The founder's rule, verbatim since 0159: a manual start reserves a player.
  ok('a player started MANUALLY elsewhere is not auto-filled',
    bestballFillBy([{ slot: 'S9', player: R('star', 'RB') }], bb, [R('low', 'RB'), R('star', 'RB')], s, by)[0].player.id === 'low');
  // One player, one spot.
  {
    const f = bestballFillBy([], bb, [R('star', 'RB'), R('mid', 'WR')], s, by);
    ok('one player cannot fill two spots', new Set(f.map((x) => x.player.id)).size === f.length, f.map((x) => x.player.id));
    ok('the dedicated spot claims first, the flex takes what is left',
      f.find((x) => x.slot === 'S1')?.player.id === 'star' && f.find((x) => x.slot === 'S2')?.player.id === 'mid');
  }
  // A FILTERED spot claims before a plain spot of the same width, or the plain
  // one takes the only player the filtered one could have used.
  {
    const t = spots({ pos: ['RB'], bb: true }, { pos: ['RB'], max_exp: 0, bb: true });
    const f = bestballFillBy([], ['S1', 'S2'], [R('vet', 'RB', { exp: 8 }), R('rook', 'RB', { exp: 0 })], t, by);
    ok('a rookies-only best-ball spot still gets its rookie',
      f.find((x) => x.slot === 'S2')?.player.id === 'rook' && f.find((x) => x.slot === 'S1')?.player.id === 'vet',
      f.map((x) => `${x.slot}=${x.player.id}`));
  }
  ok('no best-ball spots means no fills', bestballFillBy([], [], [R('star', 'RB')], s, by).length === 0);
  ok('an ineligible roster fills nothing', bestballFillBy([], bb, [R('star', 'QB')], s, by).length === 0);
}

// ── The best-ball fill is EXACT (v0.250.0) ─────────────────────────────────
// bestballFillBy cannot ride optimalLineup's matroid greedy, because a RET
// spot (0171) values a player by his RETURN production while a flex values him
// in full — the value depends on WHERE HE STANDS. So it runs a general
// assignment (assignByValue), and the objective it must honor is best ball's
// own promise, lexicographically: every spot that CAN fill does, and among
// full fills the total is maximal. Brute-forced here under exactly that order,
// with per-slot values and negative values in the mix — and with the retired
// greedy re-implemented inline so its losses prove the cases have teeth.
{
  const R = (id, pos, extra = {}) => ({ id, name: id, full: id, pos, team: 'KC', exp: 3, stats: {}, ...extra });

  // THE RET INTERACTION, the case that forced per-slot values. A is a star
  // from scrimmage (20) and the better returner (8); B returns nearly as well
  // (6) but barely plays otherwise (6). Spot-at-a-time greedy hands the RET
  // spot its best returner — A — and banks 8 + 6 = 14. The exact fill sees the
  // OTHER arrangement: B returns for 6 so A's 20 can count in the flex, 26.
  {
    const full = { a: 20, b: 6 };
    const ret = { a: 8, b: 6 };
    const val = (p, d) => (isRetSlot(d.pos) ? ret[p.id] : full[p.id]);
    const s = spots({ pos: ['RET'], bb: true }, { pos: ['RB', 'WR', 'TE'], bb: true });
    const f = bestballFillBy([], ['S1', 'S2'], [R('a', 'RB'), R('b', 'WR')], s, val);
    const got = Object.fromEntries(f.map((x) => [x.slot, x.player.id]));
    ok('the star plays from scrimmage while the lesser man returns',
      got.S1 === 'b' && got.S2 === 'a', got);
    ok('…which is 26, not the greedy’s 14',
      f.reduce((t, x) => t + val(x.player, s.find((d) => d.slot === x.slot)), 0) === 26);
  }

  // A best-ball spot FILLS even at a loss — its promise is to field somebody,
  // and the old fill seated a negative-scoring player the same way.
  {
    const s = spots({ pos: ['QB'], bb: true });
    const f = bestballFillBy([], ['S1'], [R('turnover-machine', 'QB')], s, () => -3);
    ok('a lone negative-scoring player still fills the spot', f.length === 1 && f[0].player.id === 'turnover-machine');
  }

  // No arrangement does better — enumerated under the lexicographic objective.
  {
    const rnd = prng(20260818);
    const POS = ['QB', 'RB', 'WR', 'TE'];
    const brute = (slots, players, val) => {
      let bestSize = -1, bestTotal = -Infinity;
      const walk = (si, used, size, total) => {
        if (si === slots.length) {
          if (size > bestSize || (size === bestSize && total > bestTotal)) { bestSize = size; bestTotal = total; }
          return;
        }
        walk(si + 1, used, size, total);
        for (let pi = 0; pi < players.length; pi++) {
          if (used.has(pi) || !slotAllows(slots[si], players[pi])) continue;
          used.add(pi); walk(si + 1, used, size + 1, total + val(players[pi], slots[si])); used.delete(pi);
        }
      };
      walk(0, new Set(), 0, 0);
      return { size: bestSize, total: bestTotal };
    };
    // The fill this replaced, verbatim: most-specific-first, each spot takes
    // its best remaining player. Kept ONLY to prove the generator produces
    // cases where it loses — a brute-force check nothing can fail is decoration.
    const oldGreedy = (slots, players, val) => {
      const order = [...slots].sort((a, b) => a.pos.length - b.pos.length || (a.flt ? 0 : 1) - (b.flt ? 0 : 1));
      const used = new Set();
      let size = 0, total = 0;
      for (const d of order) {
        let best = null;
        for (const c of players) {
          if (used.has(c.id) || !slotAllows(d, c)) continue;
          if (!best || val(c, d) > val(best, d)) best = c;
        }
        if (best) { used.add(best.id); size++; total += val(best, d); }
      }
      return { size, total };
    };
    let worst = null, greedyLost = 0;
    const shapes = new Set();
    for (let t = 0; t < 400; t++) {
      const spec = Array.from({ length: 1 + rnd(4) }, () => {
        const roll = rnd(5);
        const d = roll === 0
          ? { pos: ['RET'], bb: true }   // the per-slot value class
          : { pos: [...new Set(Array.from({ length: 1 + rnd(3) }, () => POS[rnd(4)]))], bb: true };
        if (roll === 1) d.max_exp = 0;   // the filter class that retired the greedy
        return d;
      });
      const s = spots(...spec);
      const players = Array.from({ length: s.length + 1 + rnd(4) }, (_, i) =>
        R(`p${i}`, POS[rnd(4)], { exp: rnd(3) === 0 ? 0 : 5 }));
      // Values per player per CLASS — full and return — negatives included.
      const full = Object.fromEntries(players.map((p) => [p.id, rnd(36) - 4]));
      const ret = Object.fromEntries(players.map((p) => [p.id, rnd(12) - 2]));
      const val = (p, d) => (isRetSlot(d.pos) ? ret[p.id] : full[p.id]);
      shapes.add(JSON.stringify([spec, players.map((p) => `${p.id}${p.pos}${p.exp}`), full, ret]));

      const bbNames = s.map((d) => d.slot);
      const f = bestballFillBy([], bbNames, players, s, val);
      const got = {
        size: f.length,
        total: f.reduce((sum, x) => sum + val(x.player, s.find((d) => d.slot === x.slot)), 0),
      };
      const best = brute(s, players, val);
      if ((got.size !== best.size || Math.abs(got.total - best.total) > 1e-6) && !worst) {
        worst = { spec, players: players.map((p) => `${p.id}:${p.pos}:e${p.exp}`), full, ret, got, best };
      }
      const g = oldGreedy(s, players, val);
      if (g.size < best.size || best.total - g.total > 1e-6) greedyLost++;
      // Determinism on the first instance: the fill repolls every few seconds.
      if (t === 0) {
        const again = bestballFillBy([], bbNames, players, s, val);
        ok('the exact fill is stable across calls',
          JSON.stringify(f.map((x) => [x.slot, x.player.id])) === JSON.stringify(again.map((x) => [x.slot, x.player.id])));
      }
    }
    ok('every spot that can fill does, and no arrangement scores more (400 cases, brute-forced)', !worst, worst);
    ok('…across genuinely different cases', shapes.size > 350, shapes.size);
    ok('…and the retired greedy loses dozens of them, so the check has teeth', greedyLost > 25, greedyLost);
  }
}

// ── The OPTIMAL lineup (v0.247.0) ──────────────────────────────────────────
// `assignSpots` asks who is LEGAL where. `optimalLineup` asks which of the
// legal arrangements SCORES MOST, and the two have different answers. The
// assertions that earn their keep here are the ones that separate "a lineup"
// from "the best lineup": the case the most-specific-first fill loses, and a
// brute-force cross-check that no arrangement of these players beats the one
// returned — checked by enumeration, not by argument.
const V = (id, pos, val, extra = {}) => ({ id, name: id, full: id, pos, team: 'KC', exp: 3, stats: {}, val, ...extra });
const byVal = (p) => p.val ?? 0;
const totalOf = (a) => a.spots.reduce((s, r) => s + (r.player ? byVal(r.player) : 0), 0);

{
  const s = spots({ pos: ['RB'] }, { pos: ['RB', 'WR', 'TE'] });
  const a = optimalLineup(s, [V('low', 'RB', 4), V('star', 'RB', 20), V('mid', 'WR', 12)], byVal);
  ok('the best player starts', seated(a).S1 === 'star', seated(a));
  ok('the flex takes the best of the rest', seated(a).S2 === 'mid', seated(a));
  ok('the leftover benches, in roster order', JSON.stringify(benched(a)) === JSON.stringify(['low']), benched(a));
  ok('nobody starts twice', new Set(a.spots.filter((r) => r.player).map((r) => r.player.id)).size === filled(a));
}

// THE CASE THAT MADE THIS FUNCTION EXIST. Spots [RB, FLEX(rookies only)] with
// a rookie RB projected 20 and a veteran RB projected 18. bestballFillBy walks
// spots most-specific-first — RB (one position) before the rookies-only flex
// (three) — so RB takes the rookie and the flex is left holding a veteran it
// cannot legally seat. Its own comment argues that greedy is optimal "because
// every flex's eligibility is a superset of the dedicated slots it follows",
// which stopped being true the day 0172 gave a spot its own player filter.
{
  const s = spots({ pos: ['RB'] }, { pos: ['RB', 'WR', 'TE'], max_exp: 0 });
  const roster = [V('rook', 'RB', 20, { exp: 0 }), V('vet', 'RB', 18, { exp: 8 })];
  const a = optimalLineup(s, roster, byVal);
  ok('the rookies-only flex gets the rookie, the plain spot takes the veteran',
    seated(a).S1 === 'vet' && seated(a).S2 === 'rook', seated(a));
  ok('…which is 38 points, not 20', totalOf(a) === 38, totalOf(a));
  // v0.247.0 asserted the best-ball fill STRICTLY LOSES this case — proof the
  // greedy left points on the table. v0.250.0 made that fill exact too, so the
  // assertion flips: on uniform values the two must now agree.
  const bbFill = bestballFillBy([], ['S1', 'S2'], roster, s, byVal);
  ok('…and the best-ball fill now finds the same 38 (v0.250.0)',
    bbFill.reduce((t, f) => t + byVal(f.player), 0) === totalOf(a),
    bbFill.map((f) => `${f.slot}=${f.player.id}`));
}

// No arrangement beats it — enumerated, on instances small enough to enumerate.
{
  const rnd = prng(20260817);
  const POS = ['QB', 'RB', 'WR', 'TE'];
  const brute = (slots, players) => {
    let best = 0;
    const walk = (si, used, sum) => {
      if (si === slots.length) { best = Math.max(best, sum); return; }
      walk(si + 1, used, sum);                       // a spot may legally sit empty
      for (let pi = 0; pi < players.length; pi++) {
        if (used.has(pi) || !slotAllows(slots[si], players[pi])) continue;
        used.add(pi); walk(si + 1, used, sum + byVal(players[pi])); used.delete(pi);
      }
    };
    walk(0, new Set(), 0);
    return best;
  };
  let worst = null;
  let blindLost = 0;   // cases the value-BLIND assignment gets wrong — see below
  for (let t = 0; t < 400; t++) {
    const spec = Array.from({ length: 1 + rnd(4) }, () => {
      const d = { pos: [...new Set(Array.from({ length: 1 + rnd(3) }, () => POS[rnd(4)]))] };
      if (rnd(3) === 0) d.max_exp = 0;               // a rookies-only spot, the filter that breaks nesting
      if (rnd(4) === 0) d.teams = ['KC'];
      return d;
    });
    const s = spots(...spec);
    // MORE PLAYERS THAN SPOTS, always. A bench is what makes the question
    // interesting: when everyone starts, every arrangement scores the same and
    // the instance tests nothing.
    const players = Array.from({ length: s.length + 1 + rnd(4) }, (_, i) =>
      V(`p${i}`, POS[rnd(4)], rnd(30), { exp: rnd(3) === 0 ? 0 : 5, team: rnd(4) === 0 ? 'BUF' : 'KC' }));
    const got = totalOf(optimalLineup(s, players, byVal));
    const best = brute(s, players);
    if (got !== best && !worst) worst = { spec, players: players.map((p) => `${p.id}:${p.pos}:${p.val}`), got, best };
    if (totalOf(assignSpots(s, players)) !== best) blindLost++;
  }
  ok('no arrangement of these players scores more (400 random cases, brute-forced)', !worst, worst);
  // The check above is only worth running if it can FAIL. `assignSpots` fills
  // the same spots by the same eligibility rules and differs in exactly one
  // way — it doesn't know what anyone is worth — so the cases it loses are the
  // cases this generator is actually testing. If this ever reads 0, the random
  // instances have gone toothless and the assertion above is decoration.
  ok('…and the value-blind assignment loses many of them, so the check has teeth',
    blindLost > 50, blindLost);
}

{
  const s = spots({ pos: ['RB'] }, { pos: ['RB'] });
  // Everything projected the same — the answer still has to be ONE answer.
  const flat = [V('a', 'RB', 0), V('b', 'RB', 0), V('c', 'RB', 0)];
  ok('equal values break toward roster order', seated(optimalLineup(s, flat, byVal)).S1 === 'a');
  ok('…and are stable across calls',
    JSON.stringify(seated(optimalLineup(s, flat, byVal))) === JSON.stringify(seated(optimalLineup(s, flat, byVal))));
  // Zero is a real projection (a K, a rookie the model has never priced). A spot
  // it can legally fill must not sit empty just because the number is 0.
  ok('a spot never sits empty over a zero projection', filled(optimalLineup(s, flat, byVal)) === 2);
  ok('an empty roster fills nothing, and throws nothing', filled(optimalLineup(s, [], byVal)) === 0);
  ok('no spots at all benches everyone', optimalLineup([], flat, byVal).bench.length === 3);
}

// ── AUTO-SLOT: what to WRITE, and what to leave alone ──────────────────────
// The one distinction the whole feature rests on: a spot with no stored row has
// never been decided, a spot holding a NULL is a manager who emptied it on
// purpose. Getting this backwards means the worker silently re-starts a player
// somebody benched, every tick, forever.
{
  const s = spots({ pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB', 'WR', 'TE'] });
  const roster = [V('qb', 'QB', 22), V('rb1', 'RB', 18), V('rb2', 'RB', 9), V('wr', 'WR', 14)];
  const plan = (stored, bb = []) => Object.fromEntries(
    autoSlotPlan(s, bb, stored, roster, byVal).map((r) => [r.slot, r.player]));

  ok('an untouched lineup fills optimally', JSON.stringify(plan({})) === JSON.stringify({ S1: 'qb', S2: 'rb1', S3: 'wr' }), plan({}));
  ok('a spot that already holds a pick is left alone', plan({ S2: 'rb2' }).S2 === undefined, plan({ S2: 'rb2' }));
  ok('…and its player is not started again somewhere else',
    Object.values(plan({ S2: 'rb2' })).every((p) => p !== 'rb2'), plan({ S2: 'rb2' }));
  // THE ONE. A cleared spot is a decision, and re-filling it un-does it.
  ok('a spot the manager EMPTIED is never re-filled', plan({ S3: null }).S3 === undefined, plan({ S3: null }));
  ok('…while its untouched neighbours still fill', Object.keys(plan({ S3: null })).length === 2, plan({ S3: null }));
  ok('best-ball spots are never written — they fill themselves',
    plan({}, ['S3']).S3 === undefined && Object.keys(plan({}, ['S3'])).length === 2, plan({}, ['S3']));
  // A best-ball spot's stored row is ignored by the resolver (0159), so the
  // player in it is NOT reserved against the manual spots.
  ok('a player parked in a best-ball spot is still available to a real one',
    plan({ S3: 'rb1' }, ['S3']).S2 === 'rb1', plan({ S3: 'rb1' }, ['S3']));
  ok('a fully set lineup writes nothing', autoSlotPlan(s, [], { S1: 'qb', S2: 'rb1', S3: 'wr' }, roster, byVal).length === 0);
  ok('an empty roster writes nothing', autoSlotPlan(s, [], {}, [], byVal).length === 0);
  ok('a roster with nobody eligible writes nothing',
    autoSlotPlan(spots({ pos: ['K'] }), [], {}, roster, byVal).length === 0);
  // Partial manual + auto is the common case: one spot set by hand on Tuesday,
  // the rest still open. The fill has to be optimal OVER WHAT IS LEFT.
  ok('the fill is optimal over the spots that are still open',
    JSON.stringify(plan({ S3: 'rb1' })) === JSON.stringify({ S1: 'qb', S2: 'rb2' }), plan({ S3: 'rb1' }));
}

// ── The seat nobody manages (v0.248.0) ─────────────────────────────────────
// sealed_pick.app_user_id is NOT NULL, so an unclaimed seat has nowhere to
// store a lineup and the worker's auto-slot can never reach it — seven of eight
// seats in the founder's own leagues. classicLineup fields its best projected
// lineup from the roster instead, and the rule that keeps that safe is the one
// worth asserting: it fires ONLY when the side stored nothing.
{
  // Real slugs, so the ranking is the real PROJ_2026 the resolver will use.
  const R = (id, pos, extra = {}) => ({ id, name: id, full: id, pos, team: 'KC', stats: {}, ...extra });
  const roster = [
    R('jonathan-taylor', 'RB'),   // 24.7 (2026-08-22 bake)
    R('josh-allen', 'QB'),        // 20.4
    R('puka-nacua', 'WR'),        // 18.4
    R('trevor-lawrence', 'QB'),   // 18.0
  ];
  const s = spots({ pos: ['QB'] }, { pos: ['RB', 'WR', 'TE'] });
  const seatedOf = (picks) => Object.fromEntries(picks.map((p) => [p.slot, p.player.id]));

  ok('the projections these assertions lean on are still the baked ones',
    // Re-pinned at the 2026-08-22 rebake (Lawrence 18.2 → 18.0). What the
    // downstream assertions actually lean on is the ORDER — Allen above
    // Lawrence at QB, Taylor the board's best — which held; the exact pins
    // exist so the NEXT rebake forces this same deliberate check.
    PROJ_2026.get('josh-allen') === 20.4 && PROJ_2026.get('trevor-lawrence') === 18
      && PROJ_2026.get('puka-nacua') === 18.4,
    [PROJ_2026.get('josh-allen'), PROJ_2026.get('trevor-lawrence'), PROJ_2026.get('puka-nacua')]);

  // No rows at all → the seat is unmanaged, and fields its best legal lineup.
  {
    const got = seatedOf(classicLineup({ picks: [], roster, bestball: [] }, 1, 1, s));
    ok('an unmanaged seat fields its best projected lineup',
      got.S1 === 'josh-allen' && got.S2 === 'jonathan-taylor', got);
  }
  // THE ONE THAT KEEPS IT SAFE. Rows exist but hold nobody — a manager who
  // emptied every spot. hasLineup says so, and nothing is filled in.
  {
    const got = seatedOf(classicLineup({ picks: [], roster, bestball: [], hasLineup: true }, 1, 1, s));
    ok('a MANAGED seat that emptied every spot still fields nothing',
      Object.keys(got).length === 0, got);
  }
  // A stored lineup stands exactly as stored, weaker player and empty spot both.
  {
    const got = seatedOf(classicLineup(
      { picks: [{ slot: 'S1', player: R('trevor-lawrence', 'QB') }], roster, bestball: [] }, 1, 1, s));
    ok('a stored pick is never upgraded to the better player', got.S1 === 'trevor-lawrence', got);
    ok('…and the spot they left empty stays empty', got.S2 === undefined, got);
  }
  // Degenerate inputs stay quiet rather than throwing.
  ok('an unmanaged seat with no roster fields nothing',
    classicLineup({ picks: [], roster: [], bestball: [] }, 1, 1, s).length === 0);
  ok('an unmanaged seat with nobody eligible fields nothing',
    classicLineup({ picks: [], roster, bestball: [] }, 1, 1, spots({ pos: ['K'] })).length === 0);
  // A best-ball spot is not the fallback's business — it fills itself at
  // scoring time, and filling it here would reserve a player twice.
  {
    const t = spots({ pos: ['QB'] }, { pos: ['RB', 'WR', 'TE'], bb: true });
    const got = seatedOf(classicLineup({ picks: [], roster, bestball: ['S2'] }, 1, 1, t));
    ok('the fallback leaves best-ball spots to best ball', got.S1 === 'josh-allen', got);
    ok('…and never starts one player in two spots',
      new Set(Object.values(got)).size === Object.values(got).length, got);
  }
}

// ── What a player is WORTH to an auto-fill (v0.252.0) ──────────────────────
// PROJ_2026 is a season constant — it knows neither byes nor Friday's injury
// report, so every fill that ranked by it raw would seat a 20-point projection
// who is guaranteed to score zero. slateAwareProj zeroes him — but only on
// EVIDENCE, under the same no-guess rule as isBye and slotAllows. The cases
// that earn their keep are the claims it must NOT make.
{
  const wk1 = [{ home: 'BUF', away: 'IND' }, { home: 'LA', away: 'SF' }, { home: 'WAS', away: 'DAL' }];
  const v = slateAwareProj(1, wk1);
  ok('a playing player keeps his projection', v({ id: 'josh-allen', team: 'BUF' }) === 20.4);
  ok('a KNOWN team absent from a LOADED slate is a bye — worth zero',
    v({ id: 'jonathan-taylor', team: 'KC' }) === 0);
  // The relocation-code trap: the pool says LAR/WSH where the slate says
  // LA/WAS. Un-normalized, every Rams player would read as a phantom bye.
  ok('LAR finds the slate\u2019s LA — no phantom bye', v({ id: 'puka-nacua', team: 'LAR' }) === 18.4);
  ok('WSH finds the slate\u2019s WAS the same way', v({ id: 'jayden-daniels', team: 'WSH' }) === 14);
  ok('an UNKNOWN team is never a bye — no team, no claim',
    v({ id: 'josh-allen', team: '' }) === 20.4 && v({ id: 'josh-allen', team: null }) === 20.4);
  ok('an EMPTY slate zeroes nobody', slateAwareProj(1, [])({ id: 'josh-allen', team: 'KC' }) === 20.4);

  // RULED OUT is the caller's own predicate — deliberately never injuryFor by
  // default, because that helper's baked-2025 fallback is exactly the server's
  // resting state and would bench 2026 players for last year's injuries.
  const out = slateAwareProj(1, wk1, (slug) => slug === 'josh-allen');
  ok('a ruled-out player is worth zero', out({ id: 'josh-allen', team: 'BUF' }) === 0);
  ok('…and his healthy teammate is untouched', out({ id: 'jayden-daniels', team: 'WAS' }) === 14);
  ok('no predicate means no injury claim', v({ id: 'josh-allen', team: 'BUF' }) === 20.4);

  // No explicit slate → the module slate (runtime override, else baked 2025 —
  // correct for exactly the 2025 replay path that uses it). Week 99 has no
  // slate at all, so nothing can be proven and nobody is zeroed.
  ok('a week with NO slate loaded zeroes nobody',
    slateAwareProj(99)({ id: 'josh-allen', team: 'XX' }) === 20.4);

  // The integration that motivated all of this: the fill benches a bigger
  // projection on bye for a smaller one who actually plays.
  {
    const s = spots({ pos: ['RB'] });
    const plan = autoSlotPlan(s, [], {}, [
      { id: 'jonathan-taylor', pos: 'RB', team: 'KC', exp: 5 },   // 20.0, but on bye
      { id: 'omarion-hampton', pos: 'RB', team: 'BUF', exp: 0 },  // 15.1, playing
    ], v);
    ok('the fill benches a 20-point bye for a 15-point player who plays',
      plan.length === 1 && plan[0].player === 'omarion-hampton', plan);
  }
}


// ── TWO PEOPLE, ONE NAME (0205) ────────────────────────────────────────────
// `league_pool` is keyed (league_id, slug) and the slug is a normalised name,
// so a duplicate name cannot be two rows. It used to be resolved by DROPPING
// one — a commissioner could roster only one of the two Byron Youngs, with
// nothing on screen to say why. The loser is renamed now, and these pin the
// rule, because the failure it replaces was SILENT.
{
  // Sorted best-first, as buildDraftPool hands them over.
  const rows = [
    { slug: 'byron-young', sleeperId: '9001', who: 'LB LA' },     // better
    { slug: 'byron-young', sleeperId: '9002', who: 'DL PHI' },    // worse
    { slug: 'jaylon-jones', sleeperId: '9003', who: 'DB IND' },
    { slug: 'jaylon-jones', sleeperId: '9004', who: 'DB CHI' },
    { slug: 'la-dst', who: 'team unit' },                          // no id
    { slug: 'la-k', who: 'team unit' },
  ];
  disambiguateSlugs(rows);
  ok('every slug in a pool is unique after disambiguation',
    new Set(rows.map((r) => r.slug)).size === rows.length, rows.map((r) => r.slug));
  ok('the BETTER player keeps the clean slug',
    rows[0].slug === 'byron-young' && rows[0].who === 'LB LA', rows[0]);
  ok('…and the other takes his own Sleeper id as the suffix',
    rows[1].slug === 'byron-young-9002', rows[1].slug);
  ok('a second collision is handled independently of the first',
    rows[2].slug === 'jaylon-jones' && rows[3].slug === 'jaylon-jones-9004',
    [rows[2].slug, rows[3].slug]);
  ok('a team pseudo-player is left alone — it is not a person and cannot collide',
    rows[4].slug === 'la-dst' && rows[5].slug === 'la-k');

  // STABLE ACROSS RE-SEEDS. A slug is stored in native_roster, sealed_pick and
  // a dozen other tables, so a rename that moved between seeds would orphan
  // every one of them. Same input, same output — and running it again is a
  // no-op rather than stacking a second suffix.
  const again = disambiguateSlugs(rows.map((r) => ({ ...r })));
  ok('re-running on already-disambiguated rows changes nothing',
    again.map((r) => r.slug).join() === rows.map((r) => r.slug).join(), again.map((r) => r.slug));

  // An entry with no id CANNOT be renamed, so a collision between two id-less
  // rows would still lose one. That cannot happen (team slugs are minted
  // unique) but the behaviour is pinned so a future caller learns it here
  // rather than in production.
  const noIds = [{ slug: 'dup' }, { slug: 'dup' }];
  disambiguateSlugs(noIds);
  ok('without an id there is nothing to disambiguate WITH, and it says so by leaving them equal',
    noIds[0].slug === 'dup' && noIds[1].slug === 'dup');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL DRAFT-SPOT ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
