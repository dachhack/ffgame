// THE JOIN-SCREEN TAGLINE (v0.325.0), checked in Node.
//
// Founder: "If the league being advertised is a classic league, we need a
// different tagline." A classic league has no hidden picks and no effects, so
// pitching them to a recruit is not a tone problem — it is a description of a
// game they are not about to play.
import { taglineFor, NEUTRAL_BLURB, joinDoorFor, readRecruitGame, recruitFraming, SITE_PITCH, LEAGUE_MENU, GAME_NOTES, FORMAT_NOTES, LANDING_FEATURES, FUNNEL, FUNNEL_GAMES } from '../packages/core/src/data/leagueTagline';

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

// ── THE DOOR: seat / waitlist / "League Full" (v0.326.0) ──────────────────
{
  ok('a free seat means the link just seats you',
    joinDoorFor({ seatsOpen: 3, waitlistOpen: true }) === 'seat');
  ok('full with the room open is a waitlist',
    joinDoorFor({ seatsOpen: 0, waitlistOpen: true }) === 'waitlist');
  ok('full with the room CLOSED is League Full',
    joinDoorFor({ seatsOpen: 0, waitlistOpen: false }) === 'full');

  // SEATS BEAT THE FLAG. A commissioner who closed the room and then freed a
  // seat has not barred the door, and telling an invited recruit the league is
  // full while a seat sits empty is the worst wrong answer available.
  ok('a free seat beats a closed waiting room',
    joinDoorFor({ seatsOpen: 1, waitlistOpen: false }) === 'seat');

  // UNKNOWN MUST NOT READ AS FULL — an older build's preview carries neither
  // field, and turning a joinable league away is worse than saying nothing.
  ok('a preview with no seat count says nothing special',
    joinDoorFor({}) === 'seat');
  ok('a null seat count is not zero', joinDoorFor({ seatsOpen: null, waitlistOpen: false }) === 'seat');
  ok('an unknown flag on a full league still offers the waiting room',
    joinDoorFor({ seatsOpen: 0 }) === 'waitlist'
    && joinDoorFor({ seatsOpen: 0, waitlistOpen: null }) === 'waitlist');
  ok('only an explicit false closes the door',
    joinDoorFor({ seatsOpen: 0, waitlistOpen: undefined }) === 'waitlist');
  ok('a negative seat count is treated as full, not as room',
    joinDoorFor({ seatsOpen: -1, waitlistOpen: false }) === 'full');
}

// ── THE RECRUITING LINK (v0.357.3) ──────────────────────────────────────────
// Founder: "Im starting to recruit for non-drip leagues but the site still
// draws people to the drip demo." The landing is the drip demo, so a classic
// recruit sent to the bare site met a pitch for the other game. `?game=` is
// the hint that fixes it, and these are the two ways it can go wrong: reading
// something off a URL that isn't one of our modes, and telling a classic
// recruit the drip story anyway.
{
  const q = (v) => (k) => (k === 'game' ? v : null);
  ok('a classic link is read', readRecruitGame(q('classic')) === 'classic');
  ok('a drip link is read', readRecruitGame(q('drip')) === 'drip');
  ok('case and padding do not matter', readRecruitGame(q('  CLASSIC ')) === 'classic');
  // NARROW ON PURPOSE — this value comes off a URL a stranger can edit, and it
  // decides which pitch a visitor reads. Anything unrecognised means "no hint".
  ok('junk is not a game', readRecruitGame(q('guillotine')) === null
    && readRecruitGame(q('<script>')) === null && readRecruitGame(q('')) === null);
  ok('a link with no hint says nothing', readRecruitGame(() => null) === null);

  const classic = recruitFraming('classic', 'drip');
  ok('a classic recruit is told the demo plays the OTHER game', classic.mismatch, classic);
  ok('a classic recruit is named a CLASSIC league', /CLASSIC/.test(classic.lead), classic.lead);
  // The whole point: the words that describe drip must not reach a classic
  // recruit's headline OR their blurb.
  ok('a classic recruit is never pitched hidden picks or effects',
    !DRIP_WORDS.test(classic.blurb) && !DRIP_WORDS.test(classic.lead), classic);

  const drip = recruitFraming('drip', 'drip');
  ok('a drip recruit is told the demo IS their game', !drip.mismatch, drip);

  const none = recruitFraming(null, 'drip');
  ok('no hint still says there are two games', !none.mismatch && /[Tt]wo games/.test(none.lead), none.lead);
  ok('no hint falls back to the line true of both', none.blurb === NEUTRAL_BLURB, none.blurb);
}

// ── THE SITE LEADS WITH THE LEAGUE YOU CAN BUILD (v0.419.0) ───────────────
// Founder: "It's not the place exclusively for drip-style fantasy." The
// landing's pitch and menu come from here, and the rule they must keep is the
// one the join card keeps: the classic line never borrows drip vocabulary,
// and the menu names the switches the create screen really has.
{
  ok('the pitch names the product beyond drip', /guillotine/i.test(SITE_PITCH.sub) && /classic/i.test(SITE_PITCH.sub), SITE_PITCH.sub);
  ok('…and still names Drip mode as one of the games', /drip mode/i.test(SITE_PITCH.sub), SITE_PITCH.sub);
  ok('the headline is not a drip pitch', !DRIP_WORDS.test(SITE_PITCH.headline), SITE_PITCH.headline);
  ok('the founder\'s three lines are the ones on the page', /your league, your rules/i.test(SITE_PITCH.kicker) && /league of your dreams/i.test(SITE_PITCH.headline) && /anything goes/i.test(SITE_PITCH.title));
  const games = GAME_NOTES.map((n) => n.name.toLowerCase());
  ok('the menu offers both games, by the names the create screen uses', games.includes('drip') && games.includes('classic'), games);
  const classic = GAME_NOTES.find((n) => n.name === 'Classic');
  ok('the classic game line is never pitched hidden picks or effects', classic && !DRIP_WORDS.test(classic.line), classic?.line);
  ok('the menu opens on WHICH GAME — the create screen\'s first question', LEAGUE_MENU[0].heading === 'WHICH GAME' && LEAGUE_MENU[0].notes === GAME_NOTES);
  const names = LEAGUE_MENU.flatMap((g) => g.notes.map((n) => n.name));
  for (const must of ['Guillotine', 'Vampire', 'Golf', 'Bullseye', 'Shotgun Wedding', 'Dynasty', 'Contract', 'Auction', 'Best ball', 'IDP']) {
    ok(`the menu names ${must}`, names.includes(must));
  }
  ok('every menu line is one sentence a manager can read, not a paragraph', LEAGUE_MENU.every((g) => g.notes.every((n) => n.line.length > 30 && n.line.length < 220)));
  ok('no two menu entries share a name', new Set(names).size === names.length, names);
  ok('every builder card has a glyph', LEAGUE_MENU.every((g) => g.notes.every((n) => typeof n.icon === 'string' && n.icon.length > 0)));
  ok('the plain shape is on the menu beside the wild ones', names.includes('Head-to-head'));
}

// ── THE FUNNEL (v0.650.0) ───────────────────────────────────────────────────
// Founder's revision of the front door: the welcome, the dreamers line, two
// buttons and nothing under them — "No sub text about limits or anything" —
// and Bullseye on the competitive-modes card. The demo page keeps SITE_PITCH
// and the create screen keeps GAME_NOTES, so the funnel's words are its own.
{
  ok('the funnel opens on the welcome', /cutting edge of fantasy football/i.test(FUNNEL.welcome), FUNNEL.welcome);
  ok('the pitch says free, bespoke, and names who builds it', /100% free/.test(FUNNEL.pitch) && /bespoke/.test(FUNNEL.pitch) && /AI/.test(FUNNEL.pitch) && /YOU/.test(FUNNEL.pitch), FUNNEL.pitch);
  ok('the dreamers line is there', /^Welcome dreamers\./.test(FUNNEL.dreamers) && /doesn.t fit an existing platform/i.test(FUNNEL.dreamersLine), FUNNEL.dreamersLine);
  ok('the two buttons are Count me in! and Sign in', FUNNEL.cta === 'Count me in!' && FUNNEL.signIn === 'Sign in', FUNNEL);
  // Nothing in the funnel's copy promises a spot count, a cap or a waiting
  // list — that line is gone from under the buttons.
  const all = Object.values(FUNNEL).join(' ');
  ok('the funnel never mentions limits, spots or a waiting list', !/spot|waiting list|waitlist|limit|cap\b/i.test(all), all);
  ok('the demo door says click here', /click here for a demo/i.test(FUNNEL.demo), FUNNEL.demo);

  const classic = FUNNEL_GAMES.find((n) => n.name === 'Classic');
  const drip = FUNNEL_GAMES.find((n) => n.name === 'Drip');
  ok('the funnel\'s classic line is the one everybody knows', classic && /H2H fantasy football/.test(classic.line) && !DRIP_WORDS.test(classic.line), classic?.line);
  ok('the funnel\'s drip line is written at an existing league', drip && /existing leagues/i.test(drip.line) && /card battles/i.test(drip.line) && /power-ups/i.test(drip.line), drip?.line);

  const bullseye = FORMAT_NOTES.find((n) => n.name === 'Bullseye');
  ok('Bullseye is a format, beside golf', !!bullseye && FORMAT_NOTES.findIndex((n) => n.name === 'Golf') < FORMAT_NOTES.findIndex((n) => n.name === 'Bullseye'));
  ok('…its line says target and closest, and never "rings"', bullseye && /target/i.test(bullseye.line) && /closest/i.test(bullseye.line) && !/ring/i.test(bullseye.line), bullseye?.line);
  const modes = LANDING_FEATURES.find((g) => g.heading === 'Competitive modes');
  ok('the competitive-modes card names Vampire, Guillotine, Golf, Bullseye and Shotgun Wedding, in that order',
    modes && modes.notes.map((n) => n.name).join(',') === 'Vampire,Guillotine,Golf,Bullseye,Shotgun Wedding', modes?.notes.map((n) => n.name));
  const sw = FORMAT_NOTES.find((n) => n.name === 'Shotgun Wedding');
  ok('Shotgun Wedding\'s line says 2-for-2, like for like, and new vows', sw && /2-for-2/.test(sw.line) && /like-for-like/.test(sw.line) && /new vows/.test(sw.line), sw?.line);
  const matchup = LANDING_FEATURES.find((g) => g.heading === 'Matchup style');
  ok('the matchup card speaks the funnel\'s lines, Classic first', matchup && matchup.notes[0]?.name === 'Classic' && matchup.notes[1]?.line === drip?.line, matchup?.notes.map((n) => n.name));
  ok('the five cards are still the five the founder named',
    LANDING_FEATURES.map((g) => g.heading).join('|') === 'League types|Competitive modes|Positions|Scoring options|Matchup style', LANDING_FEATURES.map((g) => g.heading));
  ok('every landing chip has a line', LANDING_FEATURES.every((g) => g.notes.every((n) => n.line.length > 20)));
  // v0.652.0 — founder: one chip for the plain shapes, one for every position, no "Others".
  const lt = LANDING_FEATURES.find((g) => g.heading === 'League types');
  ok('League types opens on one chip for redraft, keeper and dynasty', lt?.notes[0]?.name === 'Redraft · Keeper · Dynasty', lt?.notes.map((n) => n.name));
  const pos = LANDING_FEATURES.find((g) => g.heading === 'Positions');
  ok('Positions is two chips: every position, and the scoped spot', pos?.notes.map((n) => n.name).join('|') === 'Every position|Scoped positions', pos?.notes.map((n) => n.name));
  const sc = LANDING_FEATURES.find((g) => g.heading === 'Scoring options');
  ok('Scoring options has no "Others" chip', sc && !sc.notes.some((n) => n.name === 'Others'), sc?.notes.map((n) => n.name));
}

if (fails) { console.log(`\n${fails} TAGLINE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL TAGLINE ASSERTIONS PASSED');
