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
import { helmetMode, setHelmetMode, onHelmetMode, helmetTeam, helmetUrl, playerHelmet, helmetNumberSvg, helmetSvg, HELMET_NUMBER_SCALE } from '../packages/core/src/data/helmets';
import { HELMET_SPEC } from '../packages/core/src/data/helmetSpec';
import { teamLogo, headshot, espnHeadshot } from '../packages/core/src/data/media';
import { PLAYER_BIO } from '../packages/core/src/data/playerBio';

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
ok('spec: ten digits, each a path with an advance', Array.from({ length: 10 }, (_, n) => HELMET_SPEC.digits[n]).every((d) => d && /^M/.test(d.d) && d.adv > 0));
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
ok('url: named helmet, facing left by default', helmetUrl('KC') === 'https://dripfantasy.com/helmets/png/KC-left.png', helmetUrl('KC'));
ok('url: every team\'s file is in the manifest', Object.keys(HELMET_SPEC.teams).every((k) => manifest.teams[k].files.left === new URL(helmetUrl(k)).pathname));

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
ok('number: none for a player without one', helmetNumberSvg('KC', null) === '');
const whole = helmetSvg('KC', 15);
ok('svg: the helmet image under the number', /<image href="https:\/\/dripfantasy\.com\/helmets\/png\/KC-left\.png"/.test(whole) && whole.indexOf('<image') < whole.indexOf('<path'));

// ── mark-free: plain helmets ───────────────────────────────────────────────
setMarkFree(true);
ok('mark-free: the plain helmet (abbreviation only)', teamLogo('KC') === 'https://dripfantasy.com/helmets/png/KC-left-plain.png', teamLogo('KC'));
setMarkFree(false);
setHelmetMode(false);
ok('off again: ESPN logos back', /espncdn/.test(teamLogo('KC') ?? '') && heard === 2);

// ── both apps draw it ──────────────────────────────────────────────────────
const web = read('src/app/ui.tsx');
ok('web: PlayerImg draws the helmet with the number', /const helmet = helmetMode\(\) \? playerHelmet\(playerId, team\) : null;/.test(web) && /export function HelmetFace/.test(web));
ok('web: the settings menu has the switch', /setHelmetMode\(!helmetMode\(\)\)/.test(web));
const face = read('apps/mobile/src/ui/HelmetFace.tsx');
ok('app: HelmetFace draws through SvgXml', /<SvgXml xml=\{xml\}/.test(face));
for (const f of ['ui/ClassicBoard.tsx', 'screens/Team.tsx', 'screens/Draft.tsx', 'ui/RosterPanel.tsx', 'ui/PlayerCardSheet.tsx', 'ui/PlayerPicker.tsx', 'ui/cards.tsx', 'ui/LiveCard.tsx', 'ui/TradeCenter.tsx', 'ui/ShotgunWeddingCard.tsx', 'ui/GameView.tsx']) {
  ok(`app: ${f} draws player helmets`, /playerHelmetFace\(/.test(read(`apps/mobile/src/${f}`)));
}
{
  const set = read('apps/mobile/src/ui/SettingsModal.tsx');
  ok('app: settings has the switch', /function HelmetPicker/.test(set));
  // v0.713.1: its own row on the settings menu, not tucked inside Cards.
  ok('app: "Player pictures" is its own settings row', /id: 'pictures', icon: '⛑', name: 'Player pictures'/.test(set) && /section === 'pictures' && <HelmetPicker \/>/.test(set));
}
ok('app: the tree re-renders when it flips', /onHelmetMode\(/.test(read('apps/mobile/App.tsx')));

if (fails) { console.log(`\n${fails} HELMET ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL HELMET ASSERTIONS PASSED');
