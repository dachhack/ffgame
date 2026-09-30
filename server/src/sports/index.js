// The adapter registry. Each adapter answers two questions the poller asks:
//   schedule(date)  → sport_game row fields for that day
//   game(gameId)    → { game, lines } from the live/final box score
// with lines in the sport's core vocabulary (packages/core/src/sports/*.ts).
import { nhl } from './nhl.js';
import { mlb } from './mlb.js';
import { nba, wnba } from './nba.js';

export const ADAPTERS = { nhl, mlb, nba, wnba };

export const adapterFor = (sport) => {
  const a = ADAPTERS[sport];
  if (!a) throw new Error(`no adapter for sport ${sport}`);
  return a;
};
