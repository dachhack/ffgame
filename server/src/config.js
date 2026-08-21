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
  // OPTIONAL override — pin the worker to ONE ESPN seasontype (1=preseason,
  // 2=regular, 3=postseason). Leave it UNSET in normal operation: the scheduler
  // now runs every context that currently has games (index.js activeContexts),
  // so preseason and the regular season coexist and neither needs a flag.
  //
  // This exists for one-off debugging and for cli.js, which operates on a single
  // week by definition. It used to be the only way to reach preseason at all,
  // and forgetting to unset it would have silently stopped the regular season
  // from ever locking or resolving — which is precisely why it stopped being
  // load-bearing.
  forcedSeasonType: process.env.PILOT_SEASON_TYPE ? Number(process.env.PILOT_SEASON_TYPE) : null,
  // Legacy single-mode values, still read by cli.js (one week, one mode).
  seasonType: Number(process.env.PILOT_SEASON_TYPE || 2),
  weekOffset: Number(process.env.PILOT_SEASON_TYPE || 2) === 1 ? 100 : 0,
  // Lineups lock this long BEFORE kickoff (matchup lock_at = first kickoff − lead;
  // the 0102 enforce_window_lock trigger applies the same lead per window). Must
  // stay in lockstep with the client's LOCK_LEAD_MS (Matchup.tsx) and the trigger.
  lockLeadMs: 3_600_000,
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
  // SEVERAL TIMES A DAY (v0.305.0, founder). The off-day injury poll was a flat
  // 24h, which meant a Wednesday practice report could be a day old when a
  // manager set his lineup on Thursday. 3h off-days, still 1h near games.
  injuryPollDailyMs: Number(process.env.INJURY_POLL_MS_DAILY || 10800000),
  injuryPollGamedayMs: Number(process.env.INJURY_POLL_MS_GAMEDAY || 3600000),
  // The ESPN roster sweep (32 small fetches): where every player currently
  // plays. Separate from the Sleeper DIRECTORY refresh below, which is 14MB and
  // stays daily because Sleeper asks for at most one pull a day — one feed
  // answers "who exists", the other "where is he now", and only the second one
  // churns on a cut-down week.
  rosterPollMs: Number(process.env.ROSTER_POLL_MS || 10800000),      // 3h
  // ESPN ownership percentages (0202) — 105KB a pull, so this can be as current
  // as anything else on the board.
  marketPollMs: Number(process.env.MARKET_POLL_MS || 10800000),      // 3h
  // AGENT SEATS ON THE WIRE (v0.338.1). Hourly, not per tick: the tick is 25s,
  // and at that rate an agent takes every cleared player within half a minute
  // of him becoming available — at 3am, ahead of every human in the league.
  seatWireMs: Number(process.env.SEAT_WIRE_MS || 3600000),           // 1h
  directoryRefreshMs: Number(process.env.DIRECTORY_REFRESH_MS || 86400000), // 24h — Sleeper's own guidance
  // ── AUTO-SYNC (v0.319.0) ──────────────────────────────────────────────────
  // `syncCheckMs` is how often the worker ASKS whether a sync is due; the gap
  // between actual syncs is decided per-instant by `syncCadenceAt` (core:
  // data/syncCadence.ts) from the clock and the week's kickoffs. The check has
  // to be at least as fast as the tightest rung it can be asked to honour — a
  // 1-minute cadence polled hourly is a 1-hour cadence — and it is cheap: a
  // cached fixture read and some arithmetic, with no network call unless a sync
  // actually fires.
  syncCheckMs: Number(process.env.SYNC_CHECK_MS || 30000),           // 30s
  // Public pods (0089) used to share `syncCheckMs`, which was fine while that
  // meant an hour. v0.319.0 dropped it to 30s for the sync ramp, and a shared
  // knob would have silently multiplied the pod loop — an ESPN week lookup plus
  // `ensurePods` DB writes — by 120. Its own constant, at the old value.
  podCheckMs: Number(process.env.POD_CHECK_MS || 3600000),            // 1h
  // Fixtures (kickoff times) move a couple of times a day, so the cadence
  // decision reads them through the opt-in scoreboard cache (v0.314.0) rather
  // than pulling 194KB from ESPN every 30 seconds.
  fixtureCacheMs: Number(process.env.FIXTURE_CACHE_MS || 600000),    // 10m
  // RETIRED as the sync gap, kept as the FLOOR the cadence can never undercut,
  // so a misconfigured ramp cannot hammer Sleeper. Set WEEKLY_SYNC_MS to pin
  // the old flat behaviour (21600000 = the pre-v0.319.0 six hours).
  syncFloorMs: Number(process.env.SYNC_FLOOR_MS || 60000),           // 1m
  weeklySyncRefreshMs: Number(process.env.WEEKLY_SYNC_MS || 0),      // 0 = use the cadence
};

/** Throws unless the Supabase service credentials are present. */
export function requireSupabase() {
  required('SUPABASE_URL');
  required('SUPABASE_SERVICE_ROLE_KEY');
}
