// Native-league sweep (migration 0064): the worker-side safety net.
//
// Native leagues are self-driving from the client — the draft room's poll calls
// draft_tick and the team screen calls process_waivers — but both stall if no
// manager has the app open. This sweep keeps them moving:
//   • draft_tick     — autopicks every live draft whose seat is overdue, vacant,
//                      or AI-controlled (the RPC is idempotent + advisory-locked,
//                      so racing a browser's own tick is harmless).
//   • process_waivers — resolves pending claims whose 24h waiver window closed.
//   • auto_weekly_budget — credits each active week's coin allowance to every
//                      league that set one (0132). Same ledger idem_key as the
//                      commissioner's manual GRANT, so however many ticks — or
//                      button presses — hit a week, it pays exactly once.
// Lineup materialization needs no sweep: every roster-mutating RPC rewrites the
// still-scheduled weeks' sleeper_lineup itself.
import { db } from './supabase.js';

// The season's endgame — build round 1 when the regular season closes, advance
// a finished round, and drop a guillotine week — used to move ONLY when a
// member opened the right screen (the client's generate/advance/tick pokes). So
// a league whose managers were away between rounds simply stalled, and a bracket
// advanced late landed its next round on a lock_at the tick had already passed.
// The worker drives all three now, hourly: rounds are weekly, and the round's
// own SCORING is stamped every tick by the resolver, so nothing here is
// latency-sensitive. Everything below is idempotent and self-guarding
// server-side (0249 lets the service role in; the auto/guillotine/advance
// guards are unchanged), so a quiet sweep is cheap and a redundant one is a
// no-op.
const PROGRESSION_MS = Number(process.env.PROGRESSION_MS || 3600000); // 1h
let lastProgression = 0;

async function sweepProgression(log) {
  if (Date.now() - lastProgression < PROGRESSION_MS) return { generated: 0, advanced: 0, eliminated: 0 };
  lastProgression = Date.now();   // before the awaits: a slow sweep must not queue a second
  let generated = 0, advanced = 0, eliminated = 0;
  // Full leagues only — pods and weekly showdowns (kind <> 'league') play no
  // bracket, and mocks are practice rooms.
  const { data: leagues, error } = await db()
    .from('league').select('id, settings_json')
    .eq('provider', 'native').eq('kind', 'league').eq('is_mock', false);
  if (error) { log('progression sweep', error.message); return { generated, advanced, eliminated }; }
  for (const lg of leagues ?? []) {
    const format = lg.settings_json?.format;
    try {
      if (format === 'guillotine') {
        // Idempotent catch-up loop; eliminates at most one seat per completed
        // week, and a guillotine league books no bracket (0246).
        const { data } = await db().rpc('guillotine_tick', { p_league_id: lg.id });
        eliminated += Number(data?.eliminated ?? 0);
      } else {
        // Round 1, once the regular season is final. Auto = seedless, and the
        // RPC refuses before the season ends, never builds over an existing
        // bracket, and quiet-no-ops when playoffs are off — so "regular season
        // not finished" is the ordinary mid-season answer, not an error.
        const { data: g } = await db().rpc('generate_playoffs', { p_league_id: lg.id, p_seeds: null, p_auto: true });
        if (g?.bracket) generated += 1;
        // Advance a finished round; no-op without a bracket or a completed round.
        const { data: a } = await db().rpc('advance_playoffs', { p_league_id: lg.id });
        if (a?.advanced) advanced += 1;
      }
    } catch (e) { log('progression', lg.id, e.message); }
  }
  return { generated, advanced, eliminated };
}

export async function sweepNative(log = () => {}, weeks = []) {
  let drafts = 0, won = 0, lost = 0, allowance = 0, started = 0;

  // Scheduled starts (0177) run FIRST, so a draft whose time arrived this
  // minute is live before the tick below looks for overdue seats — otherwise
  // its first pick would wait a whole sweep for its clock to be noticed.
  // One statement for every league; the RPC is the only thing that decides
  // whether a start is due, so there's no clock arithmetic out here.
  try {
    const { data } = await db().rpc('draft_autostart_sweep');
    started = Number(data?.started ?? 0);
    // A scheduled start that CAN'T run (unseeded pool, a seat short) retries on
    // later sweeps — logged every time, because a league sitting armed and
    // failing is exactly the thing nobody notices until draft night.
    for (const e of data?.errors ?? []) log('draft autostart blocked:', e.league_id, e.error);
  } catch (e) { log('draft_autostart_sweep', e.message); }

  const { data: live, error: de } = await db()
    .from('draft').select('league_id').eq('status', 'live');
  if (de) { log('native draft sweep', de.message); }
  for (const d of live ?? []) {
    try {
      const { data } = await db().rpc('draft_tick', { p_league_id: d.league_id });
      // snake autopicks + auction lot awards/auto-nominations, one counter
      drafts += Number(data?.autopicks ?? 0) + Number(data?.lots_awarded ?? 0);
    } catch (e) { log('draft_tick', d.league_id, e.message); }
  }

  const { data: pending, error: we } = await db()
    .from('waiver_claim').select('league_id').eq('status', 'pending');
  if (we) { log('native waiver sweep', we.message); }
  for (const leagueId of new Set((pending ?? []).map((c) => c.league_id))) {
    try {
      const { data } = await db().rpc('process_waivers', { p_league_id: leagueId });
      won += Number(data?.won ?? 0); lost += Number(data?.lost ?? 0);
    } catch (e) { log('process_waivers', leagueId, e.message); }
  }

  // The weekly allowance, one call per active board week (regular + preseason
  // contexts both pass theirs). Scope and idempotency live server-side.
  for (const w of new Set(weeks.filter((w) => Number.isInteger(w) && w > 0))) {
    try {
      const { data } = await db().rpc('auto_weekly_budget', { p_week: w });
      allowance += Number(data?.credited ?? 0);
    } catch (e) { log('auto_weekly_budget', w, e.message); }
  }

  // The endgame — hourly-gated internally, so calling it every sweep is cheap.
  const prog = await sweepProgression(log);

  return { autopicks: drafts, claimsWon: won, claimsLost: lost, allowance, drafted: started, ...prog };
}
