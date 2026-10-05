// The adapter registry. Each adapter answers two questions the poller asks:
//   schedule(date)  → sport_game row fields for that day
//   game(gameId)    → { game, lines } from the live/final box score
// with lines in the sport's core vocabulary (packages/core/src/sports/*.ts).
import { nhl } from './nhl.js';
import { mlb } from './mlb.js';
import { nba, wnba } from './nba.js';
import { config } from '../config.js';

/** The public feeds' adapters, by sport. Soccer has none: its data is
 *  Stathead's (v0.634.0). */
export const ADAPTERS = { nhl, mlb, nba, wnba };

/** THE PROVIDER SWITCH (v0.634.0): which feed serves a sport — 'public'
 *  (the league and fan feeds, as before) or 'stathead' (poll/statheadAdapter)
 *  — from SPORT_PROVIDER (config.js). Soccer is Stathead's or nothing. */
export const providerOf = (sport) => {
  const want = config.sportProvider[sport] ?? config.sportProvider['*'] ?? (ADAPTERS[sport] ? 'public' : 'stathead');
  return want === 'stathead' && config.statheadToken ? 'stathead' : 'public';
};

/** The public adapter for a sport, or null (soccer). */
export const publicAdapterFor = (sport) => ADAPTERS[sport] ?? null;

let statheadMod = null;
export const adapterFor = (sport) => {
  if (providerOf(sport) === 'stathead') {
    // Lazy, so a worker with no token never loads the module.
    if (!statheadMod) throw new Error(`stathead adapter not loaded for ${sport} — call loadAdapters() first`);
    return statheadMod.statheadAdapter(sport);
  }
  const a = ADAPTERS[sport];
  if (!a) throw new Error(`no adapter for sport ${sport}`);
  return a;
};
/** Load the Stathead module when any sport is served by it (index.js, CLI). */
export async function loadAdapters() {
  if (!statheadMod && config.statheadToken) statheadMod = await import('./statheadAdapter.js');
  return statheadMod;
}
