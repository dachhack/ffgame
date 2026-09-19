// THE MASCOT BUILDER (v0.420.0) — the landing's league builder, as a character.
//
// Founder: "Build a mascot! … Every selection changes the mascot in some way.
// So start with four base mascot models. Like a blooper, gritty, etc. Then
// maybe put on a flashy gold chain with the drip logo if it's a drip league.
// Then something for the draft mode. Then additional features for each of the
// league modes. Then hit a button and the mascot slides to the left and you
// can interact with dialogues to set the rest of the league up."
//
// Four questions, in the founder's order, each one a layer on the mascot:
//   LEAGUE TYPE    → the BODY (four base characters)
//   MATCHUP STYLE  → the NECK (the gold chain with the drip mark, or a foam finger)
//   DRAFT TYPE     → the HAND (a snake over the shoulders, or a gavel)
//   LEAGUE MODE    → the HEAD (nothing, a visor and club, fangs and a cape, a hood and an axe)
//
// The words, the layer plan and the mapping onto the create screen's real
// settings all live here, platform-free, so the web builder, a future native
// one and the parity check share ONE definition. The art itself is a set of
// stickers in public/mascot/ (see its README); until a file exists the host
// draws the emoji in its place, the same fallback the icon sets use.

import type { LeagueContinuity, LeagueFormat } from './liveApi';

export type LeagueTypeId = 'redraft' | 'keeper' | 'dynasty' | 'contract_dynasty';
export type MatchupId = 'drip' | 'classic';
export type DraftId = 'snake' | 'auction';
export type ModeId = 'classic' | 'golf' | 'vampire' | 'guillotine';

export interface MascotBuild {
  type: LeagueTypeId;
  matchup: MatchupId;
  draft: DraftId;
  mode: ModeId;
}

export interface MascotOption<Id extends string = string> {
  id: Id;
  name: string;
  /** One line, from the manager's side of the screen. */
  line: string;
  /** The glyph on the option card, and the fallback for the sticker. */
  icon: string;
  /** What this choice does to the mascot — the copy under the stage. */
  wears: string;
}

export interface MascotStep<K extends keyof MascotBuild = keyof MascotBuild> {
  key: K;
  heading: string;
  options: MascotOption<MascotBuild[K]>[];
}

export const LEAGUE_TYPES: MascotOption<LeagueTypeId>[] = [
  { id: 'redraft', name: 'Redraft', icon: '🟢', line: 'Everyone starts empty every year. The draft is the whole season’s roster decision.', wears: 'the Rookie — fresh every August' },
  { id: 'keeper', name: 'Keeper', icon: '🔵', line: 'Hold a set number of players through the offseason and give up the picks they cost.', wears: 'the Vault — never lets go of a good one' },
  { id: 'dynasty', name: 'Dynasty', icon: '🟣', line: 'Keep the lot. Rookie drafts each spring, and future picks you can trade years ahead.', wears: 'the Duke — planning three seasons out' },
  { id: 'contract_dynasty', name: 'Contract Dynasty', icon: '🟠', line: 'Dynasty under a salary cap: auction bids become salaries with a term. Extend, tag, or let them walk.', wears: 'the Agent — reads the fine print' },
];

export const MATCHUP_STYLES: MascotOption<MatchupId>[] = [
  { id: 'drip', name: 'Drip Battle', icon: '💧', line: 'Eight starters in kickoff windows, each with a sealed scoring metric that reveals at kickoff and fires effects live — nukes, erasures, hot streaks, power-ups.', wears: 'a gold chain with the drip mark' },
  { id: 'classic', name: 'Classic Fantasy', icon: '🏈', line: 'A positional lineup, weekly point totals, scoring you tune knob by knob. Every spot locks at its own kickoff and scores live.', wears: 'a foam finger' },
];

export const DRAFT_TYPES: MascotOption<DraftId>[] = [
  { id: 'snake', name: 'Snake', icon: '🐍', line: 'Pick order reverses each round. The usual.', wears: 'a snake over the shoulders' },
  { id: 'auction', name: 'Auction', icon: '🔨', line: 'Nominate and bid. Anyone can own anyone, if the budget stretches.', wears: 'an auctioneer’s gavel' },
];

export const LEAGUE_MODES: MascotOption<ModeId>[] = [
  { id: 'classic', name: 'Classic', icon: '🤝', line: 'One opponent a week, a record, a playoff bracket. The shape everybody knows.', wears: 'game face' },
  { id: 'golf', name: 'Golf', icon: '⛳', line: 'The lowest weekly total wins. Every scoring value stays exactly the same — only the target moves.', wears: 'a visor and a putter' },
  { id: 'vampire', name: 'Vampire', icon: '🧛', line: 'Vampires skip the draft and live off the pool. Win the week and they bite: one of yours for one of theirs.', wears: 'fangs and a cape' },
  { id: 'guillotine', name: 'Guillotine', icon: '🪓', line: 'The lowest score each week is eliminated and their whole roster hits the wire. Last team standing takes it.', wears: 'an executioner’s hood and axe' },
];

/** The four questions, in the founder's order. */
export const MASCOT_STEPS: MascotStep[] = [
  { key: 'type', heading: 'LEAGUE TYPE', options: LEAGUE_TYPES },
  { key: 'matchup', heading: 'MATCHUP STYLE', options: MATCHUP_STYLES },
  { key: 'draft', heading: 'DRAFT TYPE', options: DRAFT_TYPES },
  { key: 'mode', heading: 'LEAGUE MODE', options: LEAGUE_MODES },
];

export const DEFAULT_BUILD: MascotBuild = { type: 'redraft', matchup: 'drip', draft: 'snake', mode: 'classic' };

export function optionFor<K extends keyof MascotBuild>(key: K, id: MascotBuild[K]): MascotOption<MascotBuild[K]> {
  const step = MASCOT_STEPS.find((s) => s.key === key) as MascotStep<K>;
  return (step.options.find((o) => o.id === id) ?? step.options[0]) as MascotOption<MascotBuild[K]>;
}

// ── THE LAYERS ─────────────────────────────────────────────────────────────
// Each layer is a sticker anchored to a region of the base body. Stickers are
// SEPARATE files placed by anchor, not registered overlays: generated art will
// never line up pixel for pixel across four bodies, and an anchor box that the
// host can tune per base is the honest way to composite it.

export type MascotAnchor = 'scene' | 'body' | 'neck' | 'hand' | 'head' | 'back';

export interface MascotLayer {
  /** Stable key for React and for the parity check. */
  key: string;
  /** File under public/mascot/, without extension. */
  file: string;
  /** What to draw until the file exists. */
  emoji: string;
  anchor: MascotAnchor;
  /** Draw order: lower first. The body is 0; a cape goes BEHIND the body. */
  z: number;
  /** Files to try in order when `file` is missing, before the emoji. The
   *  body's baked mode render falls back to the plain body this way. */
  fallbacks?: string[];
  /** Head gear and the cape are only drawn when the BODY did not load a
   *  baked render that already wears them (v0.420.1). */
  unlessBaked?: boolean;
}

/** Everything the mascot wears for a build, bottom layer first. */
export function mascotLayers(b: MascotBuild): MascotLayer[] {
  const out: MascotLayer[] = [];
  // THE SCENE (v0.420.1). Founder: "Ooooh or the background changes. A golf
  // course, an actual guillotine, etc." One backdrop per league mode, behind
  // everything; nothing is drawn in its place until the file exists.
  out.push({ key: 'scene', file: `bg-${b.mode}`, emoji: '', anchor: 'scene', z: -2 });
  if (b.mode === 'vampire') out.push({ key: 'cape', file: 'mode-vampire-cape', emoji: '🦇', anchor: 'back', z: -1, unlessBaked: true });
  // THE BODY. Mode gear that wraps the head and shoulders — fangs and cloak,
  // hood and blade, visor and club — is BAKED onto the body as its own render
  // (`base-<type>-<mode>`), because a sticker can't wrap. Until that render
  // exists the plain body loads and the head sticker stands in.
  out.push(b.mode === 'classic'
    ? { key: 'body', file: `base-${b.type}`, emoji: optionFor('type', b.type).icon, anchor: 'body', z: 0 }
    : { key: 'body', file: `base-${b.type}-${b.mode}`, fallbacks: [`base-${b.type}`], emoji: optionFor('type', b.type).icon, anchor: 'body', z: 0 });
  out.push(b.matchup === 'drip'
    ? { key: 'chain', file: 'chain-drip', emoji: '📿', anchor: 'neck', z: 2 }
    : { key: 'finger', file: 'finger-classic', emoji: '☝️', anchor: 'hand', z: 2 });
  out.push(b.draft === 'snake'
    ? { key: 'snake', file: 'draft-snake', emoji: '🐍', anchor: 'neck', z: 3 }
    : { key: 'gavel', file: 'draft-auction', emoji: '🔨', anchor: 'hand', z: 3 });
  if (b.mode === 'golf') out.push({ key: 'visor', file: 'mode-golf', emoji: '⛳', anchor: 'head', z: 4, unlessBaked: true });
  if (b.mode === 'vampire') out.push({ key: 'fangs', file: 'mode-vampire', emoji: '🧛', anchor: 'head', z: 4, unlessBaked: true });
  if (b.mode === 'guillotine') out.push({ key: 'hood', file: 'mode-guillotine', emoji: '🪓', anchor: 'head', z: 4, unlessBaked: true });
  return out.sort((a, c) => a.z - c.z);
}

/** Every sticker file the builder can ever ask for — the README's checklist
 *  and the parity check's "nothing references a file that isn't planned". */
const TYPES_ = ['redraft', 'keeper', 'dynasty', 'contract_dynasty'] as const;
const GEAR_MODES = ['golf', 'vampire', 'guillotine'] as const;
export const MASCOT_FILES = [
  // scenes, one per league mode
  'bg-classic', 'bg-golf', 'bg-vampire', 'bg-guillotine',
  // the four plain bodies
  ...TYPES_.map((t) => `base-${t}`),
  // the four bodies wearing each mode's gear (12)
  ...TYPES_.flatMap((t) => GEAR_MODES.map((m) => `base-${t}-${m}`)),
  // body-agnostic stickers
  'chain-drip', 'finger-classic',
  'draft-snake', 'draft-auction',
  // head-gear stand-ins, drawn only while a baked body is missing
  'mode-golf', 'mode-vampire', 'mode-vampire-cape', 'mode-guillotine',
] as const;

// ── THE NAME ───────────────────────────────────────────────────────────────
// A first name from the body, a title from the wildest thing it's wearing.
const FIRST: Record<LeagueTypeId, string> = { redraft: 'Rook', keeper: 'Vault', dynasty: 'Duke', contract_dynasty: 'Suits' };
const TITLE: Record<ModeId, string | null> = { classic: null, golf: 'the Low Scorer', vampire: 'the Night Bite', guillotine: 'the Last One Standing' };

export function mascotName(b: MascotBuild): string {
  const first = FIRST[b.type];
  const title = TITLE[b.mode] ?? (b.draft === 'auction' ? 'the Auctioneer' : b.matchup === 'drip' ? 'the Dripper' : 'the Regular');
  return `${first} ${title}`;
}

/** "Dynasty · Drip Battle · Auction · Guillotine" — the recipe line. */
export function describeBuild(b: MascotBuild): string {
  return [optionFor('type', b.type).name, optionFor('matchup', b.matchup).name, optionFor('draft', b.draft).name, optionFor('mode', b.mode).name].join(' · ');
}

// ── WHAT IT MEANS TO THE CREATE SCREEN ─────────────────────────────────────
// The mascot's four answers are four of create_native_league's arguments (plus
// the golf flag, which is a setter). Everything else the setup dialogs ask.
export interface BuildSeed {
  continuity: LeagueContinuity;
  gameMode: 'drip' | 'classic';
  draftMode: 'snake' | 'auction';
  format: LeagueFormat;
  golf: boolean;
  /** Guillotine's crowd: 18 teams reaches one survivor on the final week. */
  minTeams: number;
}

export function buildSeed(b: MascotBuild): BuildSeed {
  return {
    continuity: b.type,
    gameMode: b.matchup,
    // A contract league IS an auction — bids become salaries — so the draft
    // card can say snake and the seed still says auction. The card is told.
    draftMode: b.type === 'contract_dynasty' ? 'auction' : b.draft,
    format: b.mode === 'guillotine' ? 'guillotine' : b.mode === 'vampire' ? 'vampire' : 'standard',
    golf: b.mode === 'golf',
    minTeams: b.mode === 'guillotine' ? 18 : 2,
  };
}

// ── THE STASH ──────────────────────────────────────────────────────────────
// The build survives a reload (and a sign-in) in localStorage under this key.
// Parsing is NARROW: only the four known ids come back, anything else falls
// to the default, because this string is editable by whoever holds the phone.
export const MASCOT_STASH_KEY = 'dripMascotBuild';

const isId = <T extends string>(opts: MascotOption<T>[], v: unknown): v is T => typeof v === 'string' && opts.some((o) => o.id === v);

export function parseBuild(raw: string | null | undefined): MascotBuild | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || typeof j !== 'object') return null;
    return {
      type: isId(LEAGUE_TYPES, j.type) ? j.type : DEFAULT_BUILD.type,
      matchup: isId(MATCHUP_STYLES, j.matchup) ? j.matchup : DEFAULT_BUILD.matchup,
      draft: isId(DRAFT_TYPES, j.draft) ? j.draft : DEFAULT_BUILD.draft,
      mode: isId(LEAGUE_MODES, j.mode) ? j.mode : DEFAULT_BUILD.mode,
    };
  } catch { return null; }
}

export const serializeBuild = (b: MascotBuild): string => JSON.stringify(b);
