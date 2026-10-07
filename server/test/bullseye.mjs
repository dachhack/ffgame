// BULLSEYE (v0.643.0): the worker's half — the setting survives the mode
// mapper, the card is the published one or the seed's (never a third thing),
// and the install is unconditional. Pure; no database.
// Run from server/:  npx tsx test/bullseye.mjs
import assert from 'node:assert';
import { modeOfSettings } from '../src/resolve.js';
import { bullseyeCfgOf, bullseyeCardOf, installBullseye } from '../src/bullseye.js';
import { leagueBullseye, clearLeagueBullseye, dealBullseyeCard } from '../../packages/core/src/engine/bullseye.ts';
import { leagueSlotDefs } from '../../packages/core/src/engine/classic.ts';
import { leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';

// ── The mapper carries the setting, raw ─────────────────────────────────────
const plain = modeOfSettings({ game_mode: 'classic' });
assert.strictEqual(plain.bullseye, null, 'off by default');
assert.strictEqual(plain.bullseye_radius, null);
const on = modeOfSettings({ game_mode: 'classic', bullseye: 'slots', bullseye_radius: '25' });
assert.strictEqual(on.bullseye, 'slots');
assert.strictEqual(on.bullseye_radius, 25, 'the radius is numeric');
assert.strictEqual(modeOfSettings({ game_mode: 'classic', bullseye: 'darts' }).bullseye, null, 'an unknown variant is off');
assert.strictEqual(modeOfSettings(undefined).bullseye, null, 'no settings → off, not a throw');

// ── The engine config: classic only, defaults owned by the engine ──────────
assert.deepStrictEqual(bullseyeCfgOf(on), { variant: 'slots', radius: 25, deal: 'shared' });
assert.deepStrictEqual(bullseyeCfgOf(modeOfSettings({ game_mode: 'classic', bullseye: 'total' })), { variant: 'total', radius: 10, deal: 'shared' });
assert.strictEqual(bullseyeCfgOf(modeOfSettings({ game_mode: 'classic', bullseye: 'hybrid' })), null, 'hybrid is gone (v0.646.0)');
assert.deepStrictEqual(bullseyeCfgOf(modeOfSettings({ game_mode: 'classic', bullseye: 'total', bullseye_rings: 'fixed', bullseye_deal: 'team' })), { variant: 'total', radius: 10, deal: 'team' }, 'rings is ignored, the deal parses');
assert.strictEqual(bullseyeCfgOf(plain), null);
assert.strictEqual(bullseyeCfgOf(modeOfSettings({ game_mode: 'drip', bullseye: 'slots' })), null, 'a drip league never aims');

// ── The card: published wins, else the seed's — and the seed's is stable ───
const LEAGUE = '11111111-2222-4333-8444-555555555555';
const dealt = dealBullseyeCard(LEAGUE, 5, leagueSlotDefs(on), leagueCatalogOf(on));
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, on, new Map()), dealt, 'no published rows → the seed deals');
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, on, null), dealt, 'no map at all → the seed deals');
const published = { targets: { QB: 15, RB1: 5, RB2: 10, WR1: 20, WR2: 10, TE: 5, FLEX: 15, K: 10, DEF: 5 }, total: 95 };
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, on, new Map([[LEAGUE, { card: published, cards: {} }]])), published, 'published rows win');
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, on, new Map([['other', { card: published, cards: {} }]])), dealt, 'another league\'s card is not mine');
// PER-TEAM (v0.645.0): a roster's card is its published one, else its own seed's; a shared deal ignores the roster.
const team = modeOfSettings({ game_mode: 'classic', bullseye: 'slots', bullseye_deal: 'team' });
const own7 = dealBullseyeCard(LEAGUE, 5, leagueSlotDefs(team), leagueCatalogOf(team), 7);
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, team, null, 7), own7, 'per team, unpublished → the roster\'s own seed');
assert.notDeepStrictEqual(own7.targets, dealt.targets, '…which differs from the shared card');
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, team, new Map([[LEAGUE, { card: published, cards: { 7: published } }]]), 7), published, 'per team, published → the roster\'s row');
assert.deepStrictEqual(bullseyeCardOf(LEAGUE, 5, on, null, 7), dealt, 'a shared deal ignores the roster');

// The deal is anchored to the league's catalog: a standard-scoring league
// deals a different (lower) card than a full-PPR one from the same seed.
const std = modeOfSettings({ game_mode: 'classic', bullseye: 'slots', ppr: 0, scoring_classic: { ppr: 0 } });
const stdCard = bullseyeCardOf(LEAGUE, 5, std, null);
assert.notDeepStrictEqual(stdCard.targets, dealt.targets, 'a standard-scoring league deals its own card');
assert.ok(stdCard.total <= dealt.total, 'and it aims lower, since its catalog pays less');

// ── The install: unconditional, so no league inherits another's ────────────
clearLeagueBullseye();
assert.strictEqual(installBullseye(LEAGUE, 5, on, new Map([[LEAGUE, { card: published, cards: {} }]])).card, published);
assert.deepStrictEqual(leagueBullseye(), { cfg: { variant: 'slots', radius: 25, deal: 'shared' }, card: published });
assert.strictEqual(installBullseye(LEAGUE, 5, plain, new Map([[LEAGUE, { card: published, cards: {} }]])), null, 'a league with it off installs nothing…');
assert.strictEqual(leagueBullseye(), null, '…and CLEARS what the previous league left');
installBullseye(LEAGUE, 6, on, new Map());
assert.deepStrictEqual(leagueBullseye()?.card, dealBullseyeCard(LEAGUE, 6, leagueSlotDefs(on), leagueCatalogOf(on)), 'unpublished → the seed\'s card is installed');
clearLeagueBullseye();
// Per team: the seats named get their own cards; the shared card rides along.
const inst = installBullseye(LEAGUE, 6, team, new Map(), [7, 8, 7]);
assert.deepStrictEqual(Object.keys(inst.cards).sort(), ['7', '8'], 'a card per named seat, deduped');
assert.deepStrictEqual(leagueBullseye().cards[7], dealBullseyeCard(LEAGUE, 6, leagueSlotDefs(team), leagueCatalogOf(team), 7));
assert.deepStrictEqual(leagueBullseye().card, dealBullseyeCard(LEAGUE, 6, leagueSlotDefs(team), leagueCatalogOf(team)), 'the shared card is still installed');
assert.strictEqual(installBullseye(LEAGUE, 6, on, new Map(), [7, 8]).cards[7], undefined, 'a shared deal deals no per-team cards');
clearLeagueBullseye();

console.log('bullseye worker tests passed');
