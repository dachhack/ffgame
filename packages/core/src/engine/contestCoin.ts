// ── THE COIN RULES (v0.692.0) ────────────────────────────────────────────────
//
// Founder: "Let's have a standard suite of ways to earn drip coin, but create
// a section in the commish settings for weekly competition leagues for
// commissioners to change the events that earn coin and the values. Also
// edit individual purses and set any allowance."
//
// The standard suite is 0483's (pay for showing up, reading the board and
// losing — never for winning), written down once here with its defaults, so
// the commissioner's console, the SQL (`_contest_coin_defaults`, kept in
// step by a probe) and the chat lines all name the same events. A league's
// overrides live in `settings_json.coin_rules`; a value of 0 turns an event
// off; the ceiling at 0 means none.

export type CoinEventId =
  | 'seed' | 'allowance' | 'built' | 'streak' | 'bargain' | 'call' | 'deadon'
  | 'heartbreaker' | 'loss' | 'bottomhalf' | 'catchup' | 'cap';

export interface CoinEventDef {
  id: CoinEventId;
  name: string;
  /** What earns it, for the console and the explainer. */
  blurb: string;
  /** How the number reads: once, a week, each, or a ceiling. */
  unit: 'once' | 'week' | 'per week in a row' | 'each' | 'ceiling';
  def: number;
  /** A cap that rides with the event (the streak's, the dead-on's). */
  capId?: 'streak_cap' | 'deadon_cap';
  capDef?: number;
  /** Which leagues it applies to; the rest see it greyed. */
  only?: 'h2h' | 'board' | 'bullseye' | 'season';
  group: 'the start' | 'showing up' | 'reading the board' | 'losing' | 'the ceiling';
}

export const CONTEST_COIN_EVENTS: CoinEventDef[] = [
  { id: 'seed', name: 'Starting coin', blurb: 'every seat, once, on the way in', unit: 'once', def: 100, group: 'the start' },
  { id: 'allowance', name: 'Weekly allowance', blurb: 'every seat, every week the league plays, whatever happened', unit: 'week', def: 0, group: 'the start' },
  { id: 'built', name: 'Built your squad', blurb: 'a squad of your own saved before the first kickoff', unit: 'week', def: 40, group: 'showing up' },
  { id: 'streak', name: 'Weeks in a row', blurb: 'for each week in a row with a squad of your own, up to the cap', unit: 'per week in a row', def: 5, capId: 'streak_cap', capDef: 25, group: 'showing up' },
  { id: 'bargain', name: 'The bargain', blurb: 'a player priced in the bottom third of his position doubled his projection', unit: 'week', def: 15, group: 'reading the board' },
  { id: 'call', name: 'The call', blurb: 'your cheapest spot outscored your priciest', unit: 'week', def: 10, group: 'reading the board' },
  { id: 'deadon', name: 'Dead-on', blurb: 'a spot inside the bullseye band, each, up to the cap (a one-team total inside its band counts three)', unit: 'each', def: 10, capId: 'deadon_cap', capDef: 30, only: 'bullseye', group: 'reading the board' },
  { id: 'heartbreaker', name: 'The heartbreaker', blurb: 'a head-to-head loss by under 10', unit: 'week', def: 25, only: 'h2h', group: 'losing' },
  { id: 'loss', name: 'A loss', blurb: 'a head-to-head loss by 10 or more', unit: 'week', def: 15, only: 'h2h', group: 'losing' },
  { id: 'bottomhalf', name: 'The bottom half', blurb: 'a leaderboard finish below the middle seat', unit: 'week', def: 20, only: 'board', group: 'losing' },
  { id: 'catchup', name: 'Catch-up', blurb: 'below the season’s median, until you cross it (two weeks in or more)', unit: 'week', def: 10, only: 'season', group: 'losing' },
  { id: 'cap', name: 'Wallet ceiling', blurb: 'a wallet above this burns down to it at the week’s end, so nobody banks a season; 0 = no ceiling', unit: 'ceiling', def: 150, group: 'the ceiling' },
];

/** The standard suite as the SQL stores it (event and cap keys alike). */
export const CONTEST_COIN_DEFAULTS: Record<string, number> = Object.fromEntries(
  CONTEST_COIN_EVENTS.flatMap((e) => (e.capId ? [[e.id, e.def], [e.capId, e.capDef ?? 0]] : [[e.id, e.def]])),
);
export const CONTEST_COIN_KEYS: string[] = Object.keys(CONTEST_COIN_DEFAULTS);

export type ContestCoinRules = Record<string, number>;

/** A league's rules in full: the standard suite under its overrides. */
export const contestCoinRules = (over?: Record<string, number | null | undefined> | null): ContestCoinRules => {
  const out: ContestCoinRules = { ...CONTEST_COIN_DEFAULTS };
  for (const [k, v] of Object.entries(over ?? {})) if (k in CONTEST_COIN_DEFAULTS && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
};

/** Only what differs from the standard suite — what a house line should say. */
export const contestCoinOverrides = (rules: ContestCoinRules): ContestCoinRules =>
  Object.fromEntries(Object.entries(rules).filter(([k, v]) => k in CONTEST_COIN_DEFAULTS && v !== CONTEST_COIN_DEFAULTS[k]));

/** Does this event apply to a league of this shape? */
export const coinEventApplies = (e: CoinEventDef, lg: { format?: string | null; contest?: string | null; span?: string | null }): boolean =>
  e.only == null
  || (e.only === 'h2h' && lg.format === 'h2h')
  || (e.only === 'board' && lg.format === 'board')
  || (e.only === 'bullseye' && lg.contest === 'bullseye')
  || (e.only === 'season' && (lg.span ?? 'season') === 'season');

/** One line on the suite as a league plays it, for the console and the explainer. */
export function coinRulesLine(rules: ContestCoinRules, lg: { format?: string | null; contest?: string | null; span?: string | null }): string {
  const parts = CONTEST_COIN_EVENTS.filter((e) => coinEventApplies(e, lg)).map((e) => {
    const v = rules[e.id] ?? e.def;
    if (e.id === 'cap') return v > 0 ? `ceiling ◎${v}` : 'no ceiling';
    if (v <= 0) return null;
    const cap = e.capId ? rules[e.capId] ?? e.capDef ?? 0 : 0;
    return `${e.name.toLowerCase()} ◎${v}${e.unit === 'per week in a row' || e.unit === 'each' ? ` ${e.unit}` : ''}${cap > 0 ? ` (up to ◎${cap})` : ''}`;
  }).filter((s): s is string => !!s);
  return parts.join(' · ');
}
