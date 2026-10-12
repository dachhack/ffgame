// ── THE WIRE, AUDITED (v0.688.1) — a read-only ops errand ───────────────────
//
// #1237, from Kickoff League chat: "how did Bagent get picked up. He should be
// on waivers until Weds AM". Whether the run was right turns on rows nobody in
// a session can see: the league's schedule as it is TODAY (not as 0392 set it),
// the player's own hold (league_pool.waived_until), the claim's stamp
// (waiver_claim.clears_at — the run honours that before the hold), and the
// house lines that say who dropped him and when. This gathers all of it for one
// league and one player, prints it, and (with an issue) posts it onto the ask,
// so the fix can be tied to what the member saw rather than to a code path
// that could have done it (CLAUDE.md: #1028 shipped two plausible wrong fixes).
//
// Reads only. Names are team names and player names — what the league chat
// already shows — never a member's account.
import { db } from './supabase.js';

const ET = 'America/New_York';

/** A timestamp as the league reads it: Eastern, with the UTC beside it. */
export function et(x) {
  if (!x) return '—';
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return String(x);
  const local = d.toLocaleString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${local} ET (${d.toISOString().slice(0, 16).replace('T', ' ')}Z)`;
}

/** Which chat lines matter for these players: their own moves, every run, and
 *  the schedule changes. Pure. */
export function relevantLines(lines, slugs, names) {
  const s = new Set(slugs);
  const lowered = names.map((n) => n.toLowerCase()).filter(Boolean);
  return (lines ?? []).filter((m) => {
    const t = m.txn ?? {};
    if (t.kind === 'waiver' || t.kind === 'waiver_days') return true;
    if (s.has(t.drop) || s.has(t.add)) return true;
    const body = String(m.body ?? '').toLowerCase();
    return lowered.some((n) => body.includes(n));
  });
}

/** The report, as markdown. Pure. */
export function wireReport(f) {
  const lg = f.league ?? {};
  const sj = lg.settings_json ?? {};
  const team = (r) => f.teams?.[r] ?? `Team ${r}`;
  const out = [];
  out.push(`## Wire audit — ${lg.name ?? f.leagueId} · ${f.player}`);
  out.push(`_Read at ${et(f.now)}. Reads only._`);
  out.push('');
  out.push('### The league\'s wire settings, as stored now');
  out.push('```');
  out.push(`sport ${lg.sport ?? '—'} · season ${lg.season ?? '—'}`);
  out.push(`waiver_days          ${JSON.stringify(sj.waiver_days ?? null)}  (index 0 = Sunday)`);
  out.push(`waiver_clear_min     ${sj.waiver_clear_min ?? 'unset (3:00 AM ET)'}`);
  out.push(`waiver_hold_days     ${sj.waiver_hold_days ?? 'unset (1)'}`);
  out.push(`waiver_game_hold_dow ${sj.waiver_game_hold_dow === undefined ? 'unset (Wednesday)' : JSON.stringify(sj.waiver_game_hold_dow)}`);
  out.push(`waiver_clear_dow     ${JSON.stringify(sj.waiver_clear_dow ?? null)} · waiver_mode ${sj.waiver_mode ?? 'unset'}`);
  out.push(`fa_mode ${sj.fa_mode ?? 'unset (open)'} · fa_start_min ${sj.fa_start_min ?? '—'} · fa_end_min ${sj.fa_end_min ?? '—'}`);
  out.push('```');
  out.push('### What the SQL answers right now');
  out.push('```');
  for (const [k, v] of Object.entries(f.rpc ?? {})) out.push(`${k.padEnd(32)} ${v?.error ? `ERROR ${v.error}` : typeof v?.data === 'string' && /^\d{4}-\d\d-\d\dT/.test(v.data) ? et(v.data) : JSON.stringify(v?.data ?? null)}`);
  out.push('```');
  out.push('### The slate around now (nfl_slate)');
  out.push('```');
  for (const g of f.slate ?? []) out.push(`wk ${g.week}  ${g.away} @ ${g.home}  ${g.win.padEnd(5)}  ${et(g.kickoff)}`);
  if (!(f.slate ?? []).length) out.push('(no games stored within the window)');
  out.push('```');
  out.push('### The player(s) in the pool');
  out.push('```');
  for (const p of f.pool ?? []) {
    const owner = (f.roster ?? []).find((r) => r.slug === p.slug);
    out.push(`${p.slug}  ${p.full_name} ${p.pos} ${p.team || ''}`);
    out.push(`  waived_until ${et(p.waived_until)}${p.waived_until && new Date(p.waived_until) > new Date(f.now) ? '  ← HELD now' : ''}`);
    out.push(`  on roster    ${owner ? `${team(owner.roster_id)} · ${owner.acquired} · ${owner.spot ?? 'active'} · since ${et(owner.added_at)}` : 'nobody'}`);
  }
  if (!(f.pool ?? []).length) out.push('(no pool row matches)');
  out.push('```');
  out.push('### Claims naming them (waiver_claim)');
  out.push('```');
  for (const c of f.claims ?? []) {
    out.push(`#${c.id}  ${team(c.roster_id)}  add ${c.add_slug}${c.drop_slug ? ` drop ${c.drop_slug}` : ''}  bid $${c.bid ?? 0}  ${c.status}${c.note ? ` (${c.note})` : ''}`);
    out.push(`  filed ${et(c.created_at)} · clears_at ${et(c.clears_at)} · processed ${et(c.processed_at)}${c.group_id ? ` · group ${String(c.group_id).slice(0, 8)}/${c.group_seq ?? '-'}` : ''}`);
  }
  if (!(f.claims ?? []).length) out.push('(no claims)');
  out.push('```');
  out.push(`### Chat house lines (last ${f.days} days: their moves, every run, schedule changes)`);
  out.push('```');
  for (const m of f.lines ?? []) out.push(`${et(m.created_at)}  ${m.body}${m.txn?.kind ? `  [${m.txn.kind}${m.txn.add ? ` add ${m.txn.add}` : ''}${m.txn.drop ? ` drop ${m.txn.drop}` : ''}]` : ''}`);
  if (!(f.lines ?? []).length) out.push('(nothing)');
  out.push('```');
  return out.join('\n');
}

/** Gather one league's wire and one player's trail. `player` is a slug or a
 *  name fragment, case-insensitive. */
export async function wireAudit({ league, player, days = 21, now = new Date() }) {
  if (!league || !player) throw new Error('wire-audit needs a league and a player');
  const q = String(player).trim().replace(/[%,()]/g, '');
  const { data: lg, error: le } = await db().from('league').select('id,name,sport,season,settings_json').eq('id', league).maybeSingle();
  if (le) throw new Error(`league: ${le.message}`);
  if (!lg) throw new Error(`no league ${league}`);
  const rpc = {};
  for (const [name, params] of [
    ['league_waiver_day(now)', ['league_waiver_day', { p_league_id: league, p_at: now.toISOString() }]],
    ['league_waiver_day_clears(now)', ['league_waiver_day_clears', { p_league_id: league, p_at: now.toISOString() }]],
    ['fa_window_open', ['fa_window_open', { p_league_id: league }]],
    ['fa_opens_at', ['fa_opens_at', { p_league_id: league }]],
    ['next_waiver_run', ['next_waiver_run', { p_league_id: league }]],
    ['claim_clears_at', ['claim_clears_at', { p_league_id: league }]],
    ['waiver_hold_until (a drop now)', ['waiver_hold_until', { p_league_id: league }]],
    ['waiver_game_hold_dow_effective', ['waiver_game_hold_dow_effective', { p_league_id: league }]],
    ['league_waiver_clear_min', ['league_waiver_clear_min', { p_league_id: league }]],
  ]) {
    const [fn, args] = params;
    const { data, error } = await db().rpc(fn, args);
    rpc[name] = error ? { error: error.message } : { data };
  }
  const { data: pool } = await db().from('league_pool').select('slug,full_name,pos,team,waived_until')
    .eq('league_id', league).or(`slug.ilike.*${q}*,full_name.ilike.*${q}*`).limit(10);
  const slugs = (pool ?? []).map((p) => p.slug);
  const names = (pool ?? []).map((p) => p.full_name);
  const { data: roster } = slugs.length ? await db().from('native_roster').select('roster_id,slug,acquired,added_at,spot').eq('league_id', league).in('slug', slugs) : { data: [] };
  const { data: members } = await db().from('league_membership').select('sleeper_roster_id,team_name').eq('league_id', league);
  const teams = Object.fromEntries((members ?? []).map((m) => [m.sleeper_roster_id, m.team_name || `Team ${m.sleeper_roster_id}`]));
  const sel = 'id,roster_id,add_slug,drop_slug,bid,status,note,created_at,clears_at,processed_at,group_id,group_seq';
  const claims = [];
  if (slugs.length) {
    const { data: a } = await db().from('waiver_claim').select(sel).eq('league_id', league).in('add_slug', slugs);
    const { data: d } = await db().from('waiver_claim').select(sel).eq('league_id', league).in('drop_slug', slugs);
    const seen = new Set();
    for (const c of [...(a ?? []), ...(d ?? [])]) if (!seen.has(c.id)) { seen.add(c.id); claims.push(c); }
    claims.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  }
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const { data: lines } = await db().from('league_message').select('id,created_at,body,txn')
    .eq('league_id', league).eq('kind', 'txn').gte('created_at', since).order('created_at').limit(1000);
  const season = lg.season ?? String(now.getUTCFullYear());
  const { data: slate } = await db().from('nfl_slate').select('season,week,home,away,win,kickoff').eq('season', season)
    .gte('kickoff', new Date(now.getTime() - 10 * 86400_000).toISOString()).lte('kickoff', new Date(now.getTime() + 3 * 86400_000).toISOString())
    .order('kickoff');
  const facts = { leagueId: league, league: lg, player: q, now: now.toISOString(), days, rpc, pool: pool ?? [], roster: roster ?? [], teams, claims, lines: relevantLines(lines, slugs, names), slate: slate ?? [] };
  return { facts, report: wireReport(facts) };
}
