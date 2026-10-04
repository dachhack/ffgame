// SEAL AUDIT (v0.600.0) — did classic picks lock at their own kickoff?
//
// Founder: keep a fix that wasn't confirmed against live data open, and check
// back after the next kickoff. #1028 (week 3) shipped two plausible fixes for
// Mooney's frozen lineup, was closed unconfirmed, and the real cause (the
// Rams' LA/LAR codes, #1095) struck again in week 4. This is the check that
// would have caught it: for a week, every sealed classic weekly pick, compared
// with its player's own kickoff. A pick sealed more than a minute before its
// player's game started was sealed early.
//
// Read-only. Prints counts and team codes, never players or managers: ops logs
// are public.
import { db } from './supabase.js';
import { normTeam } from '../../packages/core/src/data/slugMeta.ts';

const SLACK_MS = 60_000;

/** Pure: classify sealed picks. `picks` [{ slug, team, sealedAt }], `kicks` { TEAM: ms }. */
export function auditSeals(picks, kicks) {
  const out = { checked: 0, early: 0, onTime: 0, unplaced: 0, earlyTeams: {} };
  for (const p of picks) {
    if (!p.slug || !p.sealedAt) continue;
    out.checked++;
    const k = p.team ? kicks[normTeam(String(p.team))] : undefined;
    if (!Number.isFinite(k)) { out.unplaced++; continue; }
    if (Date.parse(p.sealedAt) < k - SLACK_MS) {
      out.early++;
      const t = normTeam(String(p.team));
      out.earlyTeams[t] = (out.earlyTeams[t] ?? 0) + 1;
    } else out.onTime++;
  }
  return out;
}

/** One week's audit, optionally one league. */
export async function sealAudit(week, season, leagueId = null) {
  const { data: slate } = await db().from('nfl_slate').select('home, away, kickoff').eq('season', String(season)).eq('week', week);
  const kicks = {};
  for (const g of slate ?? []) {
    const ms = Date.parse(g.kickoff);
    if (!Number.isFinite(ms)) continue;
    for (const t of [g.home, g.away]) if (t) kicks[normTeam(t)] = Math.min(kicks[normTeam(t)] ?? Infinity, ms);
  }
  let q = db().from('matchup').select('id, league_id').eq('week', week);
  if (leagueId) q = q.eq('league_id', leagueId);
  const { data: ms } = await q;
  if (!ms?.length) return { week, season, error: 'no matchups' };
  const leagueOf = new Map(ms.map((m) => [m.id, m.league_id]));
  const picks = [];
  for (let i = 0; i < ms.length; i += 200) {
    const { data } = await db().from('sealed_pick').select('matchup_id, player_slug, revealed_at')
      .in('matchup_id', ms.slice(i, i + 200).map((m) => m.id)).eq('game_window', 'wk').eq('locked', true);
    picks.push(...(data ?? []).filter((p) => p.player_slug && !/^c-\d+$/.test(p.player_slug)));
  }
  const leagues = [...new Set(picks.map((p) => leagueOf.get(p.matchup_id)))];
  const { data: pool } = leagues.length
    ? await db().from('league_pool').select('league_id, slug, team').in('league_id', leagues) : { data: [] };
  const teamOf = new Map((pool ?? []).map((r) => [`${r.league_id}:${r.slug}`, r.team]));
  const rows = picks.map((p) => ({ slug: p.player_slug, team: teamOf.get(`${leagueOf.get(p.matchup_id)}:${p.player_slug}`) ?? null, sealedAt: p.revealed_at }));
  return { week, season, ...(leagueId ? { league: leagueId } : {}), games: Object.keys(kicks).length / 2, ...auditSeals(rows, kicks) };
}
