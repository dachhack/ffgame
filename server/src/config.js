// Worker configuration from the environment. Fails fast if the Supabase service
// credentials are missing (the worker can't do anything without them), but leaves
// the rest with sane defaults so a dev can run a single poll/sync easily.
import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name} (see server/.env.example)`);
  return v;
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  season: process.env.PILOT_SEASON || '2026',
  // ESPN seasontype the pollers query: 1=preseason, 2=regular (default), 3=postseason.
  seasonType: Number(process.env.PILOT_SEASON_TYPE || 2),
  // Board-week offset applied to every DB read/write while polling preseason, so
  // preseason weeks 1-3 land on board weeks 101-103 and never collide with the
  // regular-season slate/matchups. ESPN API calls still use the real (1-3) week.
  weekOffset: Number(process.env.PILOT_SEASON_TYPE || 2) === 1 ? 100 : 0,
  leagueIds: (process.env.PILOT_LEAGUE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Premium paywall enforcement at resolve (docs/premium-model.md). OFF for the
  // 2026 pilot — the tier is built but deliberately not turned on until 2027.
  // Without this flag the gating fails CLOSED when the premium schema/RPCs are
  // absent (matchup_premium() errors → "not premium" → K/DST picks and premium
  // power-ups silently stripped from live scoring). Flip with PREMIUM_ENFORCEMENT=1
  // once the 0036/0037 migrations are applied and Stripe is live.
  premiumEnforcement: process.env.PREMIUM_ENFORCEMENT === '1',
  playsPollMs: Number(process.env.PLAYS_POLL_MS || 25000),
  scoreboardPollMs: Number(process.env.SCOREBOARD_POLL_MS || 60000),
  injuryPollDailyMs: Number(process.env.INJURY_POLL_MS_DAILY || 86400000),
  injuryPollGamedayMs: Number(process.env.INJURY_POLL_MS_GAMEDAY || 3600000),
  // Weekly auto-sync: how often the worker checks if a sync is due, and the min gap
  // between full re-syncs of the current week (re-syncs catch lineup changes pre-lock).
  syncCheckMs: Number(process.env.SYNC_CHECK_MS || 3600000),         // 1h
  weeklySyncRefreshMs: Number(process.env.WEEKLY_SYNC_MS || 21600000), // 6h
};

/** Throws unless the Supabase service credentials are present. */
export function requireSupabase() {
  required('SUPABASE_URL');
  required('SUPABASE_SERVICE_ROLE_KEY');
}
