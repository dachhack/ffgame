// HELMET MODE (v0.713.0). Founder: "we want a mode that replaces the head shots
// and team logos with the helmets. For the headshots, superimpose the player's
// jersey number in a sporty font over the lower corner of the helmet in a
// consistent spot."
//
// Pins: the switch, what teamLogo/headshot answer in the mode (and outside it),
// mark-free → plain helmets, college left alone, the number's paths and anchor,
// and that both apps draw it. Run: npx tsx scripts/check-helmets.mjs
import { readFileSync } from 'node:fs';
import { setPlatform } from '../packages/core/src/platform';
import { setMarkFree } from '../packages/core/src/data/markFree';
import { helmetMode, setHelmetMode, onHelmetMode, helmetTeam, helmetUrl, playerHelmet, helmetNumberSvg, helmetSvg, helmetFacing, HELMET_NUMBER_SCALE, HELMET_CARD_NUMBER_SCALE } from '../packages/core/src/data/helmets';
import { HELMET_SPEC } from '../packages/core/src/data/helmetSpec';
import { teamLogo, headshot, espnHeadshot } from '../packages/core/src/data/media';
import { PLAYER_BIO } from '../packages/core/src/data/playerBio';
import { setTeamOverrides, clearTeamOverrides } from '../packages/core/src/data/playerTeam';
import { withLiveTeams } from '../packages/core/src/data/liveApi';

const store = new Map();
setPlatform({
  storage: { get: (k) => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: (k) => store.delete(k) },
  env: () => undefined,
  url: { query: () => new URLSearchParams('') },
});

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── the generated spec ─────────────────────────────────────────────────────
ok('spec: ten digits and K D H C P, each a path with an advance', [...'0123456789KDHCP'].every((c) => HELMET_SPEC.digits[c] && /^M/.test(HELMET_SPEC.digits[c].d) && HELMET_SPEC.digits[c].adv > 0));
ok('spec: all 32 teams have number colours', Object.keys(HELMET_SPEC.teams).length === 32);
const manifest = JSON.parse(read('public/helmets/manifest.json'));
ok('spec: size and anchor match the manifest', HELMET_SPEC.size === manifest.size
  && JSON.stringify(HELMET_SPEC.number.anchor) === JSON.stringify(manifest.number.anchor)
  && HELMET_SPEC.number.fontSize === manifest.number.fontSize);

// ── team codes ─────────────────────────────────────────────────────────────
ok('team: LA is the Rams helmet', helmetTeam('LA') === 'LAR', helmetTeam('LA'));
ok('team: WSH is the Commanders helmet', helmetTeam('WSH') === 'WAS', helmetTeam('WSH'));
ok('team: JAC is the Jaguars helmet', helmetTeam('JAC') === 'JAX');
ok('team: an unknown code has none', helmetTeam('XYZ') === null && helmetUrl('XYZ') === null);
// v0.713.4, founder: "Can we have helmets for the user face right and opposing helmets face left?"
ok('facing: yours (and the default) face right, the opponent\'s face left', helmetFacing() === 'right' && helmetFacing(false) === 'right' && helmetFacing(true) === 'left');
ok('url: named helmet, facing right by default', helmetUrl('KC') === 'https://dripfantasy.com/helmets/png/KC-right.png', helmetUrl('KC'));
ok('url: the opponent\'s helmet faces left', helmetUrl('KC', helmetFacing(true)) === 'https://dripfantasy.com/helmets/png/KC-left.png');
ok('url: every team\'s files are in the manifest', Object.keys(HELMET_SPEC.teams).every((k) => manifest.teams[k].files.left === new URL(helmetUrl(k, 'left')).pathname && manifest.teams[k].files.right === new URL(helmetUrl(k, 'right')).pathname));

// ── the switch ─────────────────────────────────────────────────────────────
let heard = 0;
onHelmetMode(() => heard++);
ok('mode: off by default', helmetMode() === false);
const slug = 'aaron-jones';
ok('off: logos are ESPN logos', /espncdn\.com\/i\/teamlogos\/nfl/.test(teamLogo('KC') ?? ''), teamLogo('KC'));
setHelmetMode(true);
ok('mode: on, and listeners hear it', helmetMode() === true && heard === 1);
ok('on: a team logo is its helmet', teamLogo('KC') === helmetUrl('KC'));
ok('on: the Rams logo (LA) is the LAR helmet', teamLogo('LA') === helmetUrl('LAR'));
ok('on: NFL headshots step aside (the spot falls back to the helmet logo)', headshot(slug) === null && espnHeadshot('3042519') === null);
ok('on: college teams keep their logos', teamLogo('HOU', { college: true }) === null);
ok('on: a college player keeps his photo path', headshot('c-4433') === null || !String(headshot('c-4433')).includes('helmets'));
const ph = playerHelmet(slug);
ok('player: team and number from the bio', ph?.team === 'MIN' && ph?.num === PLAYER_BIO[slug].num, ph);
ok('player: a team hint covers a missing team', playerHelmet('no-such-player', 'DAL')?.team === 'DAL');
// v0.713.3, founder: "K on a helmet for Kicker D for Defense. HC, P".
ok('unit: a kicker wears K', JSON.stringify(playerHelmet('jax-k')) === JSON.stringify({ team: 'JAX', num: 'K' }), playerHelmet('jax-k'));
ok('unit: a defense wears D', playerHelmet('hou-dst')?.num === 'D' && playerHelmet('hou-dst')?.team === 'HOU');
ok('unit: a head coach wears HC, a punter P', playerHelmet('kc-hc')?.num === 'HC' && playerHelmet('kc-p')?.num === 'P');
ok('unit: the Rams unit (la-k) is the LAR helmet', playerHelmet('la-k')?.team === 'LAR');
ok('unit: a player whose name ends -p is not a punter', playerHelmet('john-smith-p')?.num !== 'P');
ok('unit: the letters are drawn (outline, stroke, fill per letter)', (helmetNumberSvg('KC', 'HC').match(/<path /g) ?? []).length === 6);
ok('unit: a glyph the font slice lacks is skipped, not drawn blank', helmetNumberSvg('KC', 'Z') === '');

// ── the number ─────────────────────────────────────────────────────────────
const svg = helmetNumberSvg('KC', 15, 'left');
ok('number: two digits × (outline, stroke, fill) = 6 paths', (svg.match(/<path /g) ?? []).length === 6, (svg.match(/<path /g) ?? []).length);
ok('number: no paint-order (react-native-svg ignores it)', !svg.includes('paint-order'));
ok('number: the dark outline is drawn first', svg.indexOf(HELMET_SPEC.number.outlineColor) < svg.indexOf(HELMET_SPEC.teams.KC.stroke));
ok('number: the fill is the team\'s number colour', svg.includes(`fill="${HELMET_SPEC.teams.KC.fill}"`));
// Left-facing: right-aligned, so the number ENDS at the anchor; right-facing starts there.
// v0.713.2: drawn 1.45× the manifest's size ("bigger numbers"), still pinned to the anchor.
ok('number: drawn bigger than the manifest, within reason', HELMET_NUMBER_SCALE > 1 && HELMET_NUMBER_SCALE <= 1.5, HELMET_NUMBER_SCALE);
const S = HELMET_SPEC.size, fs = HELMET_SPEC.number.fontSize * S * HELMET_NUMBER_SCALE, sc = fs / HELMET_SPEC.unitsPerEm;
const firstX = (s) => Number(/translate\(([-\d.]+)/.exec(s)[1]);
const w15 = (HELMET_SPEC.digits[1].adv + HELMET_SPEC.digits[5].adv) * sc;
ok('number: left-facing ends at the anchor (lower right)', Math.abs(firstX(svg) + w15 - HELMET_SPEC.number.anchor.left.x * S) < 0.05);
ok('number: right-facing starts at the anchor (lower left)', Math.abs(firstX(helmetNumberSvg('KC', 15, 'right')) - HELMET_SPEC.number.anchor.right.x * S) < 0.05);
// v0.713.5, founder: "numbers a touch smaller on weekly contest".
ok('card: the playing card\'s number is smaller than a row\'s, still bigger than the manifest', HELMET_CARD_NUMBER_SCALE > 1 && HELMET_CARD_NUMBER_SCALE < HELMET_NUMBER_SCALE);
ok('card: helmetSvg draws at the scale it is given', helmetSvg('KC', 15, 'right', HELMET_CARD_NUMBER_SCALE).includes(helmetNumberSvg('KC', 15, 'right', HELMET_CARD_NUMBER_SCALE)) && !helmetSvg('KC', 15, 'right', HELMET_CARD_NUMBER_SCALE).includes(helmetNumberSvg('KC', 15, 'right')));
ok('number: none for a player without one', helmetNumberSvg('KC', null) === '');
const whole = helmetSvg('KC', 15);
ok('svg: the helmet image under the number', /<image href="https:\/\/dripfantasy\.com\/helmets\/png\/KC-right\.png"/.test(whole) && whole.indexOf('<image') < whole.indexOf('<path'));
ok('svg: facing right, the number sits lower left (the back of the shell)', firstX(whole) === firstX(helmetNumberSvg('KC', 15, 'right')));
ok('svg: the opponent\'s helmet faces left, number lower right', /KC-left\.png/.test(helmetSvg('KC', 15, 'left')) && firstX(helmetSvg('KC', 15, 'left')) === firstX(svg));

// ── mark-free: plain helmets ───────────────────────────────────────────────
setMarkFree(true);
ok('mark-free: the plain helmet (abbreviation only)', teamLogo('KC') === 'https://dripfantasy.com/helmets/png/KC-right-plain.png', teamLogo('KC'));
setMarkFree(false);
setHelmetMode(false);
ok('off again: ESPN logos back', /espncdn/.test(teamLogo('KC') ?? '') && heard === 2);

// ── the row agrees with the helmet ─────────────────────────────────────────
// v0.713.4, founder: "Interesting mis match HOU van ARZ for Marvin Harrison".
// The helmet followed his trade (teamFor reads the worker's overrides); the
// wire row printed league_pool's seeded team, its bye and its opponent.
setTeamOverrides([{ slug: 'marvin-harrison', team: 'HOU' }]);
{
  const rows = withLiveTeams([{ slug: 'marvin-harrison', team: 'ARI' }, { slug: 'c-4433', team: '' }, { slug: 'no-such-player', team: 'DAL' }, { slug: 'la-k', team: 'LAR' }]);
  ok('pool: a traded player\'s row carries his new team', rows[0].team === 'HOU' && playerHelmet('marvin-harrison', rows[0].team)?.team === 'HOU', rows[0]);
  ok('pool: a college row keeps its (empty) team', rows[1].team === '');
  ok('pool: a player the bake lacks keeps the pool\'s team', rows[2].team === 'DAL');
  ok('pool: a unit keeps its own team', rows[3].team === 'LA', rows[3]);
}
clearTeamOverrides();
for (const f of ['apps/mobile/src/screens/Team.tsx', 'src/screens/NativeLeague.tsx']) {
  ok(`pool: ${f} reads the live teams`, /leaguePoolLive\(leagueId\)/.test(read(f)));
}

// ── both apps draw it ──────────────────────────────────────────────────────
const web = read('src/app/ui.tsx');
ok('web: PlayerImg draws the helmet with the number', /const helmet = helmetMode\(\) \? playerHelmet\(playerId, team\) : null;/.test(web) && /export function HelmetFace/.test(web));
ok('web: the board\'s right column (the opponent) faces left', /opponent=\{right\}/.test(read('src/screens/ClassicBoard.tsx')) && /helmetFacing\(opponent\)/.test(web));
ok('web: the duel\'s score card and mini card face by side', /opponent=\{side === 'their'\}/.test(read('src/screens/Matchup.tsx')) && /helmetArt\(slug, team, side === 'their'\)/.test(read('src/app/cardTable.tsx')));
ok('web: the settings menu has the switch', /setHelmetMode\(!helmetMode\(\)\)/.test(web));
const face = read('apps/mobile/src/ui/HelmetFace.tsx');
ok('app: HelmetFace draws through SvgXml', /<SvgXml xml=\{xml\}/.test(face));
ok('app: the opponent\'s helmet faces left', /facing=\{helmetFacing\(opponent\)\}/.test(face) && /playerHelmetFace\(slug, float \? 46 : 50, team, side === 'their'\)/.test(read('apps/mobile/src/ui/LiveCard.tsx')));
for (const f of ['ui/ClassicBoard.tsx', 'screens/Team.tsx', 'screens/Draft.tsx', 'ui/RosterPanel.tsx', 'ui/PlayerCardSheet.tsx', 'ui/PlayerPicker.tsx', 'ui/cards.tsx', 'ui/LiveCard.tsx', 'ui/TradeCenter.tsx', 'ui/ShotgunWeddingCard.tsx', 'ui/GameView.tsx']) {
  ok(`app: ${f} draws player helmets`, /playerHelmetFace\(/.test(read(`apps/mobile/src/${f}`)));
}
{
  const set = read('apps/mobile/src/ui/SettingsModal.tsx');
  ok('app: settings has the switch', /function HelmetPicker/.test(set));
  // v0.713.1: its own row on the settings menu, not tucked inside Cards.
  ok('app: "Player pictures" is its own settings row', /id: 'pictures', icon: '⛑', name: 'Player pictures'/.test(set) && /section === 'pictures' && <HelmetPicker \/>/.test(set));
}
// v0.713.4, founder: "Numbers on helmets for weekly contest leagues please".
ok('contest: the phone\'s card face draws the numbered helmet, theirs facing left', /playerHelmetFace\(slug, undefined, team, !mine, HELMET_CARD_NUMBER_SCALE\)/.test(read('apps/mobile/src/ui/ContestCards.tsx')));
ok('contest: the web\'s playing card draws it, the opponent\'s facing left', /const helmet = helmetArt\(slug, team, opp, HELMET_CARD_NUMBER_SCALE\);/.test(read('src/app/cardTable.tsx')));
ok('app: Team and the board draw helmets 1.5× the photo size (v0.713.5)', /export const helmetSize = \(photo: number\) => Math\.round\(photo \* 1\.5\)/.test(face)
  && ['apps/mobile/src/screens/Team.tsx', 'apps/mobile/src/ui/ClassicBoard.tsx'].every((f) => /playerHelmetFace\(slug, helmetSize\(size\)\)/.test(read(f))));
ok('app: the tree re-renders when it flips', /onHelmetMode\(/.test(read('apps/mobile/App.tsx')));

if (fails) { console.log(`\n${fails} HELMET ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL HELMET ASSERTIONS PASSED');
