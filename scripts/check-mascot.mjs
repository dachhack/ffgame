// THE MASCOT BUILDER (v0.420.0), checked in Node.
//
// Founder: "Every selection changes the mascot in some way." So the first
// assertion is that one: no two builds that differ in any answer wear the same
// layers. The rest pin what the builder hands the create screen — the four
// answers are four real arguments — and that the stash, which is a string off
// a phone's localStorage, can never smuggle an unknown id into a league.
import {
  MASCOT_STEPS, DEFAULT_BUILD, LEAGUE_TYPES, MATCHUP_STYLES, DRAFT_TYPES, LEAGUE_MODES,
  mascotLayers, mascotName, describeBuild, buildSeed, parseBuild, serializeBuild, optionFor, MASCOT_FILES,
} from '../packages/core/src/data/mascot';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};

// ── THE FOUR QUESTIONS, IN THE FOUNDER'S ORDER ─────────────────────────────
{
  ok('four steps, in order: league type → matchup style → draft type → league mode',
    MASCOT_STEPS.map((s) => s.key).join(',') === 'type,matchup,draft,mode');
  ok('league types: Redraft | Keeper | Dynasty | Contract Dynasty',
    LEAGUE_TYPES.map((o) => o.name).join(' | ') === 'Redraft | Keeper | Dynasty | Contract Dynasty');
  ok('matchup styles: Drip Battle | Classic Fantasy',
    MATCHUP_STYLES.map((o) => o.name).join(' | ') === 'Drip Battle | Classic Fantasy');
  ok('draft types: Snake | Auction', DRAFT_TYPES.map((o) => o.name).join(' | ') === 'Snake | Auction');
  ok('league modes: Classic | Golf | Vampire | Guillotine',
    LEAGUE_MODES.map((o) => o.name).join(' | ') === 'Classic | Golf | Vampire | Guillotine');
  ok('every option has a glyph, a line and something it puts on the mascot',
    MASCOT_STEPS.every((s) => s.options.every((o) => o.icon && o.line.length > 20 && o.wears.length > 3)));
  const classic = MATCHUP_STYLES.find((o) => o.id === 'classic');
  ok('the classic line is never pitched hidden picks or effects', !/hidden|nuke|erasure|hot streak|secret|effect/i.test(classic.line), classic.line);
}

// ── EVERY SELECTION CHANGES THE MASCOT ─────────────────────────────────────
{
  const all = [];
  for (const type of LEAGUE_TYPES) for (const matchup of MATCHUP_STYLES) for (const draft of DRAFT_TYPES) for (const mode of LEAGUE_MODES) {
    all.push({ type: type.id, matchup: matchup.id, draft: draft.id, mode: mode.id });
  }
  ok('sixty-four builds', all.length === 64, all.length);
  const sig = (b) => mascotLayers(b).map((l) => l.file).join('+');
  const sigs = new Set(all.map(sig));
  ok('no two builds wear the same layers', sigs.size === 64, sigs.size);
  ok('the body is always the league type', all.every((b) => mascotLayers(b).some((l) => l.key === 'body' && l.file === `base-${b.type}`)));
  ok('a drip league wears the chain; a classic one does not',
    all.every((b) => mascotLayers(b).some((l) => l.key === 'chain') === (b.matchup === 'drip')));
  ok('the snake and the gavel never share a mascot',
    all.every((b) => mascotLayers(b).filter((l) => l.key === 'snake' || l.key === 'gavel').length === 1));
  ok('a vampire has a cape BEHIND the body and fangs in front', (() => {
    const l = mascotLayers({ ...DEFAULT_BUILD, mode: 'vampire' });
    return l.findIndex((x) => x.key === 'cape') < l.findIndex((x) => x.key === 'body') && l.findIndex((x) => x.key === 'fangs') > l.findIndex((x) => x.key === 'body');
  })());
  ok('layers come out bottom first', all.every((b) => { const z = mascotLayers(b).map((l) => l.z); return z.every((v, i) => i === 0 || v >= z[i - 1]); }));
  ok('every layer names a planned sticker file', all.every((b) => mascotLayers(b).every((l) => MASCOT_FILES.includes(l.file))));
  ok('every planned sticker file is worn by some build', MASCOT_FILES.every((f) => all.some((b) => mascotLayers(b).some((l) => l.file === f))));
  ok('names are never empty and carry the body', all.every((b) => mascotName(b).length > 4));
  ok('the recipe line names all four answers', describeBuild({ type: 'dynasty', matchup: 'drip', draft: 'auction', mode: 'guillotine' }) === 'Dynasty · Drip Battle · Auction · Guillotine');
}

// ── WHAT IT MEANS TO THE CREATE SCREEN ─────────────────────────────────────
{
  const s = buildSeed({ type: 'dynasty', matchup: 'drip', draft: 'snake', mode: 'guillotine' });
  ok('dynasty + drip + snake + guillotine → the real arguments',
    s.continuity === 'dynasty' && s.gameMode === 'drip' && s.draftMode === 'snake' && s.format === 'guillotine' && !s.golf && s.minTeams === 18, s);
  const c = buildSeed({ type: 'contract_dynasty', matchup: 'classic', draft: 'snake', mode: 'golf' });
  ok('a contract league is an auction whatever the draft card says', c.draftMode === 'auction', c);
  ok('golf is a flag, not a format', c.golf && c.format === 'standard', c);
  ok('vampire is a format', buildSeed({ ...DEFAULT_BUILD, mode: 'vampire' }).format === 'vampire');
  ok('the plain league mode is head-to-head with the standard format', buildSeed(DEFAULT_BUILD).format === 'standard' && buildSeed(DEFAULT_BUILD).minTeams === 2);
}

// ── THE STASH IS A STRING OFF A PHONE ──────────────────────────────────────
{
  const b = { type: 'keeper', matchup: 'classic', draft: 'auction', mode: 'golf' };
  ok('round-trips', JSON.stringify(parseBuild(serializeBuild(b))) === JSON.stringify(b));
  ok('an unknown id falls to the default, never through', parseBuild('{"type":"showdown","matchup":"drip","draft":"linear","mode":"<script>"}').type === 'redraft'
    && parseBuild('{"type":"showdown","matchup":"drip","draft":"linear","mode":"<script>"}').draft === 'snake');
  ok('junk is null, not a crash', parseBuild('nope') === null && parseBuild('') === null && parseBuild(null) === null && parseBuild('[]') !== undefined);
  ok('optionFor never returns undefined', optionFor('mode', 'nothing').name === 'Classic');
}

if (fails) { console.log(`\n${fails} MASCOT ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL MASCOT ASSERTIONS PASSED');
