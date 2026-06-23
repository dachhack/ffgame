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
  leagueIds: (process.env.PILOT_LEAGUE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  playsPollMs: Number(process.env.PLAYS_POLL_MS || 25000),
  scoreboardPollMs: Number(process.env.SCOREBOARD_POLL_MS || 60000),
  injuryPollDailyMs: Number(process.env.INJURY_POLL_MS_DAILY || 86400000),
  injuryPollGamedayMs: Number(process.env.INJURY_POLL_MS_GAMEDAY || 3600000),
};

/** Throws unless the Supabase service credentials are present. */
export function requireSupabase() {
  required('SUPABASE_URL');
  required('SUPABASE_SERVICE_ROLE_KEY');
}
