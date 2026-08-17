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
  classicSlotsFromSpec, classicSlots, planSpotMove, bestballFillBy,
} from '../packages/core/src/engine/classic';
import { tenureMatches, TENURE_BANDS } from '../packages/core/src/data/tenure';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
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
// A tiny LCG keeps it reproducible — a probe that fails only sometimes is
// worse than no probe.
{
  let seed = 20260816;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
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

console.log(fails ? `\n${fails} FAILED` : '\nALL DRAFT-SPOT ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
