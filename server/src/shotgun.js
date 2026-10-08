// ── SHOTGUN WEDDING: THE WORKER'S HALF (v0.653.0) ───────────────────────────
//
// docs/shotgun-wedding.md. Two jobs, both idempotent, both riding tick():
//
//   • PROPOSE — Tuesday from 5 AM Eastern (the week's finals stop being
//     re-stamped at the 4 AM report release), each shotgun league's latest
//     fully-final regular-season week: one 2-for-2 per matchup, picked by
//     core's weddingPlan and filed through shotgun_propose (0453). The SQL
//     refuses a second wedding for the same matchup, so a re-run is a no-op;
//     after 6 PM it refuses too (a wedding needs time to talk), so a worker
//     that was down all Tuesday skips the week rather than springing a trade
//     with no window.
//   • THE DEADLINE — shotgun_sweep, once a minute: every pending wedding past
//     its 8 PM deadline is carried out (or fails cleanly if its players
//     moved). The deadline lives in the row, so this has no clock of its own.
import { db } from './supabase.js';
import { etClock } from './taco.js';
import { injuryStatusMap } from './injuries.js';
import { leagueSlotDefs } from '../../packages/core/src/engine/classic.ts';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueCatalogOf, projectedPoints } from '../../packages/core/src/engine/projScoring.ts';
import { replacementByPos } from '../../packages/core/src/data/tradeGrade.ts';
import { weddingPlan } from '../../packages/core/src/engine/shotgunWedding.ts';
import { isPreseasonWeek as isPracticeWeek } from '../../packages/core/src/data/nflSlate.ts';
import { modeOfSettings } from './resolve.js';
import { installLiveProjRate } from './poll/projections.js';
import { installTeamOverrides } from './poll/teamOverrides.js';

/** The hour (Eastern) weddings are filed from, and the hour they stop. */
export const WEDDING_HOUR_ET = 5;
export const WEDDING_LAST_HOUR_ET = 18;
const SEASON_WEEKS = 17;
/** A week whose first kickoff is older than this is not "last week". */
const FRESH_MS = 9 * 24 * 3600 * 1000;

/** Is it Tuesday morning-to-evening in New York? */
export function weddingDue(nowMs) {
  const { dow, hour } = etClock(nowMs);
  return dow === 2 && hour >= WEDDING_HOUR_ET && hour < WEDDING_LAST_HOUR_ET;
}

/**
 * The week to marry for, from a league's matchup rows: the latest regular
 * week whose every matchup is final with both scores, and fresh (its first
 * kickoff inside the last nine days — a league switched on mid-season, or a
 * week whose finals were late, never gets a wedding for a stale week).
 */
export function weddingWeekOf(rows, nowMs) {
  const byWeek = new Map();
  for (const m of rows ?? []) {
    if (isPracticeWeek(m.week)) continue;
    const list = byWeek.get(m.week) ?? [];
    list.push(m);
    byWeek.set(m.week, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => b - a);
  for (const w of weeks) {
    const list = byWeek.get(w);
    const done = list.every((m) => m.status === 'final' && m.home_final != null && m.away_final != null);
    if (!done) continue;
    const kick = list.map((m) => (m.lock_at ? Date.parse(m.lock_at) : NaN)).filter(Number.isFinite);
    if (kick.length && nowMs - Math.min(...kick) > FRESH_MS) return null;
    return w;
  }
  return null;
}

let lastSweep = 0;
let lastPropose = 0;

/**
 * The weddings the CPU would file for one league: the week (latest
 * fully-final and fresh, or the one asked for), and per matchup the plan with
 * both valued rosters. Pure reading — sweepShotgun files these, the ops
 * preview prints them. `skip` holds home seats already married that week.
 */
export async function planLeagueWeddings(lg, { week = null, nowMs = Date.now(), skip = new Set(), log = () => {} } = {}) {
  const { data: rows } = await db().from('matchup')
    .select('week,status,home_roster_id,away_roster_id,home_final,away_final,lock_at,is_playoff').eq('league_id', lg.id);
  const wk = week ?? weddingWeekOf(rows, nowMs);
  if (wk == null) return { week: null, plans: [] };
  const todo = (rows ?? []).filter((m) => m.week === wk && !m.is_playoff && !skip.has(m.home_roster_id));
  if (!todo.length) return { week: wk, plans: [] };

  // The worker's projection level, as the boards show it (cached, cheap).
  try { await installTeamOverrides(log); } catch (e) { log('shotgun team overrides', e.message); }
  await installLiveProjRate(log);
  const statuses = await injuryStatusMap();
  const mode = modeOfSettings(lg.settings_json);
  setLeagueProjScoring(leagueCatalogOf(mode));
  try {
    const slots = leagueSlotDefs(mode);
    const { data: pool } = await db().from('league_pool').select('slug,full_name,pos,team,sleeper_id').eq('league_id', lg.id).range(0, 2999);
    const meta = new Map((pool ?? []).map((p) => [p.slug, p]));
    const { data: ros } = await db().from('native_roster').select('roster_id,slug,spot').eq('league_id', lg.id);
    const teams = new Set((ros ?? []).map((r) => r.roster_id)).size || 10;
    // The trade grader's replacement line, read off this league's pool.
    const repl = replacementByPos((pool ?? []).filter((p) => p.pos)
      .map((p) => ({ slug: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeper_id ?? null })), teams, slots);
    const playersOf = (rid) => (ros ?? [])
      .filter((r) => r.roster_id === rid && (r.spot ?? 'active') === 'active')
      .map((r) => meta.get(r.slug)).filter((p) => p && p.pos)
      .map((p) => {
        const pts = statuses.get(p.slug) === 'IR' ? 0
          : projectedPoints({ id: p.slug, pos: p.pos, team: p.team, sleeperId: p.sleeper_id ?? null }) * SEASON_WEEKS;
        const points = Number.isFinite(pts) ? pts : 0;
        return { id: p.slug, name: p.full_name, pos: p.pos, team: p.team, sleeperId: p.sleeper_id ?? null,
          points, value: Math.max(0, points - (repl.get(p.pos) ?? 0)) };
      });
    const plans = todo.map((m) => {
      const home = playersOf(m.home_roster_id); const away = playersOf(m.away_roster_id);
      const plan = weddingPlan({ slots, home, away, seed: `${lg.id}|${wk}|${m.home_roster_id}v${m.away_roster_id}` });
      return { m, plan, home, away };
    });
    return { week: wk, plans };
  } finally {
    clearLeagueProjScoring();
  }
}

export async function sweepShotgun(log = () => {}, nowMs = Date.now()) {
  const out = { married: 0, failed: 0, proposed: 0 };
  if (nowMs - lastSweep >= 60_000) {
    lastSweep = nowMs;
    const { data, error } = await db().rpc('shotgun_sweep');
    if (error) log('shotgun sweep error', error.message);
    else { out.married = data?.married ?? 0; out.failed = data?.failed ?? 0; }
  }
  if (!weddingDue(nowMs) || nowMs - lastPropose < 10 * 60_000) return out;
  lastPropose = nowMs;

  const { data: lgs } = await db().from('league')
    .select('id,settings_json').eq('settings_json->>shotgun_wedding', 'true').eq('settings_json->>game_mode', 'classic');
  for (const lg of lgs ?? []) {
    const { data: rows } = await db().from('matchup').select('week,status,home_final,away_final,lock_at').eq('league_id', lg.id);
    const wk = weddingWeekOf(rows, nowMs);
    if (wk == null) continue;
    const { data: done } = await db().from('shotgun_wedding').select('home_roster').eq('league_id', lg.id).eq('week', wk);
    const { week, plans } = await planLeagueWeddings(lg, { week: wk, nowMs, skip: new Set((done ?? []).map((d) => d.home_roster)), log });
    for (const { m, plan } of plans) {
      if (!plan) { log('shotgun', lg.id, 'week', week, m.home_roster_id, 'v', m.away_roster_id, '— no fair 2-for-2'); continue; }
      const { data: r, error } = await db().rpc('shotgun_propose', {
        p_league_id: lg.id, p_week: week, p_home: m.home_roster_id, p_away: m.away_roster_id,
        p_home_gives: plan.homeGives, p_away_gives: plan.awayGives,
      });
      if (error || r?.ok !== true) {
        log('shotgun refused', lg.id, week, m.home_roster_id, 'v', m.away_roster_id, error?.message ?? r?.error);
        // A league-wide refusal (off, ineligible, past the deadline) is the
        // same for every matchup — stop asking for this league.
        if (/off|classic|redraft|head-to-head|football|deadline|too late/.test(String(error?.message ?? r?.error ?? ''))) break;
        continue;
      }
      out.proposed += 1;
      log('shotgun', lg.id, 'week', week, m.home_roster_id, plan.homeGives.join('+'), '⇄', m.away_roster_id, plan.awayGives.join('+'),
        `(${plan.homeValue} v ${plan.awayValue} ${plan.scale})`);
    }
  }
  return out;
}

/**
 * READ-ONLY: what the CPU would hand each matchup, for an ops request
 * (`shotgun-preview`). Files nothing. Seats by number, never by team name:
 * the ops log of a public repo is public, and the members are not.
 */
export async function shotgunPreview(leagueId, week = null) {
  const { data: lg } = await db().from('league').select('id,settings_json').eq('id', leagueId).maybeSingle();
  if (!lg) return `no league ${leagueId}`;
  const s = lg.settings_json ?? {};
  const { week: wk, plans } = await planLeagueWeddings(lg, { week: week == null ? null : Number(week), nowMs: Date.now() });
  const lines = [
    `SHOTGUN WEDDING PREVIEW · league ${leagueId} · week ${wk ?? '—'}`,
    `mode=${s.game_mode ?? 'drip'} continuity=${s.continuity ?? '(default)'} format=${s.format ?? 'standard'} shotgun=${s.shotgun_wedding === true ? 'on' : 'off'}`,
  ];
  if (wk == null) { lines.push('no fully-final, fresh regular week to marry for'); return lines.join('\n'); }
  const tag = (p) => `${p.name} (${p.pos}${p.team ? ', ' + p.team : ''}) ${Math.round(p.value)} over repl / ${Math.round(p.points)} pts`;
  for (const { m, plan, home, away } of plans) {
    const won = m.home_final > m.away_final ? `seat ${m.home_roster_id} won` : m.away_final > m.home_final ? `seat ${m.away_roster_id} won` : 'tie';
    lines.push('', `── seat ${m.home_roster_id} (${m.home_final}) v seat ${m.away_roster_id} (${m.away_final}) · ${won} (high score; golf leagues flip it)`);
    if (!plan) { lines.push('   no fair 2-for-2'); continue; }
    const by = (list, id) => list.find((p) => p.id === id);
    lines.push(`   seat ${m.home_roster_id} sends: ${plan.homeGives.map((id) => tag(by(home, id))).join('; ')}`);
    lines.push(`   seat ${m.away_roster_id} sends: ${plan.awayGives.map((id) => tag(by(away, id))).join('; ')}`);
    lines.push(`   ${plan.scale === 'value' ? 'value over replacement' : 'raw points (thin roster)'}: ${plan.homeValue} v ${plan.awayValue}`);
  }
  return lines.join('\n');
}
