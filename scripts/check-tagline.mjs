// THE JOIN-SCREEN TAGLINE (v0.325.0), checked in Node.
//
// Founder: "If the league being advertised is a classic league, we need a
// different tagline." A classic league has no hidden picks and no effects, so
// pitching them to a recruit is not a tone problem — it is a description of a
// game they are not about to play.
import { taglineFor, NEUTRAL_BLURB } from '../packages/core/src/data/leagueTagline';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const DRIP_WORDS = /hidden|nuke|erasure|hot streak|secret|effect/i;

{
  const c = taglineFor('classic');
  ok('a classic league is labelled CLASSIC', c.label === 'CLASSIC' && c.known, c);
  // THE ASSERTION THE FOUNDER ASKED FOR, stated as the thing that was wrong.
  ok('a classic league is NEVER pitched hidden picks or effects', !DRIP_WORDS.test(c.blurb), c.blurb);
  ok('…and says what it DOES play', /standard scoring/i.test(c.blurb) && /open lineups/i.test(c.blurb), c.blurb);

  const d = taglineFor('drip');
  ok('a drip league keeps its own pitch', d.label === 'DRIP' && DRIP_WORDS.test(d.blurb), d);
  ok('the two modes never share a blurb', c.blurb !== d.blurb);
}

// ── THE DEFAULT MATCHES THE DATABASE, or the card disagrees with the game ──
// league_game_mode, the resolver and the board all coalesce an unset mode to
// 'drip'. A different default here would mislabel every legacy league.
{
  ok('an UNSET mode is not guessed at — it falls to the neutral line',
    taglineFor(null).blurb === NEUTRAL_BLURB && !taglineFor(null).known);
  ok('…and the neutral line is true of both modes',
    !DRIP_WORDS.test(NEUTRAL_BLURB) && /head-to-head/i.test(NEUTRAL_BLURB), NEUTRAL_BLURB);
  ok('a mode this build has never heard of gets the neutral line, not a wrong one',
    taglineFor('showdown-2029').blurb === NEUTRAL_BLURB && !taglineFor('showdown-2029').known);
  ok('an empty string is not a mode', taglineFor('').known === false);
  ok('undefined never throws', taglineFor().blurb === NEUTRAL_BLURB);
}

// ── WHAT THE FEED ACTUALLY SENDS ───────────────────────────────────────────
{
  ok('case and padding from settings_json do not change the answer',
    taglineFor('  Classic ').label === 'CLASSIC' && taglineFor('DRIP').label === 'DRIP');
  ok('a known mode always carries a label; the neutral one never does',
    taglineFor('classic').label !== '' && taglineFor('nope').label === '');
}

if (fails) { console.log(`\n${fails} TAGLINE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL TAGLINE ASSERTIONS PASSED');
