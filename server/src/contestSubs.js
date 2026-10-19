// THE SWAP MADE FOR YOU (v0.669.0). Founder, with Rico Dowdle ruled out
// before a 1:00 game: "Should I be able to swap out dowdle since he was
// declared out?" Every contest player now locks at his own kickoff (0470),
// so the swap is yours to make until then — and with the league's AUTO-SUB
// on, the worker makes it if you don't: in the minutes before a ruled-out
// pick's kickoff, the best affordable body for his spot goes in, the rest of
// the squad kept. CPU seats get the same swap any time before kickoff (they
// have nobody watching). Each sub is pushed to the seat's owner.
//
// Its own five-minute clock (the hourly pod tick is too coarse for a
// kickoff window) and its own module, so the plan is pure and testable.
import { db } from './supabase.js';
import { config } from './config.js';
import { ruledOutSlugs } from './injuries.js';
import { contestConfigOf, contestCard, contestAutoBuild, contestPriced, contestPriceAdjOf } from '../../packages/core/src/engine/contest.ts';
import { leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';
import { TeamMap, normTeam } from '../../packages/core/src/data/teamCodes.ts';

const log = (...a) => console.log(new Date().toISOString(), '[subs]', ...a);
/** A human's ruled-out pick is swapped inside this window before his kickoff. */
export const AUTO_SUB_WINDOW_MS = 20 * 60_000;

/** PURE: the squads to rewrite. `entries` are sleeper_lineup rows; `seats`
 *  roster → membership; `kicks` team → kickoff ms; `outs` the ruled-out
 *  slugs; `now` the clock. Returns [{roster_id, uid, cpu, out: [{slug, name}],
 *  in: [{slug, name}], starters_json}]. */
export function planSubs({ league, cfg, board, entries, seats, kicks, outs, card, now = Date.now() }) {
  const bySlug = new Map(board.map((b) => [b.slug, b]));
  const kickOf = (team) => kicks.get(normTeam(team)); // the caller's map may be plain: normalise here too (v0.707.0)
  const locked = (team) => { const k = kickOf(team); return Number.isFinite(k) && k <= now; };
  const out = [];
  for (const e of entries) {
    const seat = seats.get(e.roster_id) ?? {};
    const cpu = seat.controller === 'ai' || !seat.app_user_id;
    if (!cpu && !cfg.autoSub) continue;
    const rows = Array.isArray(e.starters_json) ? e.starters_json : [];
    // A CPU seat is fixed any time before kickoff; a human only in the window,
    // so the swap stays theirs to make for as long as it can.
    const due = (team) => { const k = kickOf(team); if (!Number.isFinite(k) || k <= now) return false; return cpu || k - now <= AUTO_SUB_WINDOW_MS; };
    const hurt = rows.filter((r) => r?.player_slug && outs.has(r.player_slug) && due(bySlug.get(r.player_slug)?.team));
    if (!hurt.length) continue;
    const keep = Object.fromEntries(cfg.slots.map((d) => [d.slot, null]));
    for (const r of rows) if (r?.slot in keep && r.player_slug && !hurt.includes(r)) keep[r.slot] = r.player_slug;
    // The kept picks stay in the pool even when their games have kicked off —
    // their salaries must still count against the cap (they are `taken`, so
    // they are never re-picked); only the CANDIDATES are the unlocked and fit.
    const kept = new Set(Object.values(keep).filter(Boolean));
    const pool = board.filter((b) => kept.has(b.slug) || (!outs.has(b.slug) && !locked(b.team)));
    const built = contestAutoBuild(pool, cfg, `${league.id}|w${e.week}|sub${e.roster_id}|${hurt.map((h) => h.player_slug).join(',')}`, card, keep);
    const swapped = cfg.slots.filter((d) => built[d.slot] && built[d.slot] !== keep[d.slot]);
    if (!swapped.length) continue;
    out.push({
      roster_id: e.roster_id, uid: cpu ? null : seat.app_user_id, cpu,
      // SWAP HISTORY (0478): spot by spot, who went out for whom.
      swaps: swapped.map((d) => ({ slot: d.slot, out_slug: rows.find((r) => r?.slot === d.slot)?.player_slug ?? null, in_slug: built[d.slot] })),
      out: hurt.map((h) => ({ slug: h.player_slug, name: bySlug.get(h.player_slug)?.name ?? h.player_slug })),
      in: swapped.map((d) => ({ slug: built[d.slot], name: bySlug.get(built[d.slot])?.name ?? built[d.slot] })),
      starters_json: cfg.slots.filter((d) => built[d.slot]).map((d) => ({ slot: d.slot, sleeper_id: null, player_slug: built[d.slot], pos: bySlug.get(built[d.slot])?.pos ?? d.pos[0] })),
    });
  }
  return out;
}

/** One pass over every contest league playing `week`. Returns the subs made. */
export async function sweepContestSubs(week, season, now = Date.now()) {
  const { data: leagues } = await db().from('league').select('id, name, kind, contest_week, settings_json')
    .in('kind', ['dfs', 'bullseye']).eq('season', String(season));
  const live = (leagues ?? []).filter((l) => l.contest_week == null || Number(l.contest_week) === Number(week));
  if (!live.length) return 0;
  const [{ data: slate }, { data: boardRows }, outs] = await Promise.all([
    db().from('nfl_slate').select('home, away, kickoff').eq('season', String(season)).eq('week', week),
    db().from('pod_salary').select('slug, name, pos, team, salary, proj, exp').eq('season', String(season)).eq('week', week).range(0, 4999),
    ruledOutSlugs(now),
  ]);
  if (!boardRows?.length || !outs.size) return 0;
  const kicks = new TeamMap();
  for (const g of slate ?? []) {
    const ms = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (!Number.isFinite(ms)) continue;
    for (const t of [g.home, g.away]) if (t) kicks.set(t, Math.min(kicks.get(t) ?? Infinity, ms));
  }
  let made = 0;
  for (const lg of live) {
    const cfg = contestConfigOf(lg.settings_json, lg.kind);
    if (!cfg) continue;
    const { data: entries } = await db().from('sleeper_lineup').select('roster_id, week, starters_json').eq('league_id', lg.id).eq('week', week);
    if (!entries?.length) continue;
    const { data: mems } = await db().from('league_membership').select('sleeper_roster_id, app_user_id, controller, team_name').eq('league_id', lg.id);
    const seats = new Map((mems ?? []).map((m) => [m.sleeper_roster_id, m]));
    const card = cfg.contest === 'bullseye' ? contestCard(lg.id, week, cfg.slots, leagueCatalogOf({ scoring: lg.settings_json?.scoring_classic ?? null, ppr: lg.settings_json?.ppr })) : null;
    const plan = planSubs({ league: lg, cfg, board: contestPriced(boardRows, contestPriceAdjOf(lg.settings_json)), entries, seats, kicks, outs, card, now });
    if (!plan.length) continue;
    const { error } = await db().from('sleeper_lineup').upsert(
      plan.map((p) => ({ league_id: lg.id, week, roster_id: p.roster_id, starters_json: p.starters_json })), { onConflict: 'league_id,week,roster_id' });
    if (error) { log(lg.name, error.message); continue; }
    made += plan.length;
    // SWAP HISTORY (0478): the seat's own history carries the sub.
    const swapRows = plan.flatMap((p) => p.swaps.map((x) => ({ league_id: lg.id, week, roster_id: p.roster_id, slot: x.slot, out_slug: x.out_slug, in_slug: x.in_slug, kind: 'sub', by_user: null })));
    if (swapRows.length) { const { error: sErr } = await db().from('contest_swap').insert(swapRows); if (sErr) log(lg.name, 'swap log', sErr.message); }
    const pushes = plan.filter((p) => p.uid).map((p) => ({
      app_user_id: p.uid, kind: 'lineup',
      title: `🔁 ${p.out.map((x) => x.name).join(', ')} ${p.out.length === 1 ? 'was' : 'were'} ruled out`,
      body: `${lg.name}: ${p.in.map((x) => x.name).join(', ')} ${p.in.length === 1 ? 'is' : 'are'} in for week ${week}. You can still swap until each player's kickoff.`,
      data: { league_id: lg.id, open: 'league' },
      dedupe_key: `contest-sub:${lg.id}:${week}:${p.roster_id}:${p.out.map((x) => x.slug).join(',')}`,
    }));
    if (pushes.length) await db().from('push_outbox').upsert(pushes, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    log(lg.name, 'wk', week, plan.map((p) => `${seats.get(p.roster_id)?.team_name ?? p.roster_id}: ${p.out.map((x) => x.name).join('/')} → ${p.in.map((x) => x.name).join('/')}${p.cpu ? ' (CPU)' : ''}`).join(' · '));
  }
  return made;
}

export const contestSubsEveryMs = () => Number(process.env.CONTEST_SUB_MS || 5 * 60_000) || config.podCheckMs;
