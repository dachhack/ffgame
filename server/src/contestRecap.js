// THE WEEK'S RESULT, IN THE CHAT (v0.668.1). Founder, on the weekly contest
// suite: "Any more infrastructure … we need to flesh out?" — the first gap:
// "When a week goes final, nothing posts."
//
// Once every matchup of a contest league's week is final and stamped, and the
// morning-after release the weekly report waits for has passed (so the numbers
// are frozen — v0.457.0's lesson), one card goes into the league's chat: the
// podium, the field, the head-to-head results, the season leader, and the
// next week's lock. Each member with a squad also gets a push with THEIR
// place. Idempotent per league-week: the card itself is the record (a
// league_message of kind 'txn' whose txn is {kind: 'contest_recap', week}),
// so a restart never posts twice.
import { db } from './supabase.js';
import { contestConfigOf, contestLowerWins, contestScoreWord, CONTEST_WORD, CONTEST_EMOJI } from '../../packages/core/src/engine/contest.ts';
import { weekReportRelease } from '../../packages/core/src/data/weekReport.ts';

const log = (...a) => console.log(new Date().toISOString(), 'recap', ...a);
const RECHECK_MS = 5 * 60_000;
const lastCheck = new Map();          // week → last pass
const posted = new Set();             // `${league_id}:${week}` already carded
const release = new Map();            // `${season}:${week}` → release ms

const ET = { timeZone: 'America/New_York' };
export const etStamp = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', ...ET });
const r1 = (n) => Math.round(Number(n) * 10) / 10;
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** PURE: every seat's week, ranked by the contest's own rule. `matchups` are
 *  the league's rows for the week (a board league's are self-paired);
 *  `seats` map roster → {team_name, app_user_id, controller}. */
export function rankWeek(cfg, matchups, seats) {
  const golf = contestLowerWins(cfg);   // lower wins: golf, and a one-team-total Bullseye (v0.683.0)
  const rows = [];
  for (const m of matchups) {
    rows.push({ roster_id: m.home_roster_id, score: Number(m.home_final ?? 0), tb: m.home_tb ?? null, opp: m.away_roster_id === m.home_roster_id ? null : m.away_roster_id, oppScore: Number(m.away_final ?? 0) });
    if (m.away_roster_id !== m.home_roster_id) rows.push({ roster_id: m.away_roster_id, score: Number(m.away_final ?? 0), tb: m.away_tb ?? null, opp: m.home_roster_id, oppScore: Number(m.home_final ?? 0) });
  }
  rows.sort((a, b) => (golf ? a.score - b.score : b.score - a.score) || ((a.tb ?? Infinity) - (b.tb ?? Infinity)) || String(seats.get(a.roster_id)?.team_name ?? '').localeCompare(String(seats.get(b.roster_id)?.team_name ?? '')));
  let rank = 0, prev = null;
  return rows.map((r, i) => {
    const key = `${r.score}|${r.tb ?? ''}`;
    if (key !== prev) { rank = i + 1; prev = key; }
    const s = seats.get(r.roster_id) ?? {};
    return { ...r, rank, team: s.team_name ?? `Seat ${r.roster_id}`, uid: s.app_user_id ?? null, cpu: s.controller === 'ai' || !s.app_user_id,
      won: r.opp == null ? null : golf ? r.score < r.oppScore : r.score > r.oppScore };
  });
}

/** PURE: the card's words. `season` is {leader, total, weeks} or null;
 *  `next` is {week, lockMs} or null. */
export function recapBody(cfg, week, ranked, season, next) {
  const word = contestScoreWord(cfg.contest, cfg.bullseye?.variant);
  const medal = ['🥇', '🥈', '🥉'];
  const lines = [`🏁 WEEK ${week} RESULT · ${CONTEST_EMOJI[cfg.contest]} ${CONTEST_WORD[cfg.contest]}`];
  const podium = ranked.filter((r) => r.rank <= 3).slice(0, 3);
  podium.forEach((r, i) => lines.push(`${medal[Math.min(i, 2)]} ${r.team} — ${r1(r.score)} ${word}${r.tb != null && cfg.contest === 'bullseye' ? ` (tie-break ${r1(r.tb)} off)` : ''}${r.cpu ? ' · CPU' : ''}`));
  const cpu = ranked.filter((r) => r.cpu).length;
  lines.push(`${ranked.length} squad${ranked.length === 1 ? '' : 's'}${cpu ? ` · ${cpu} CPU` : ''}`);
  if (cfg.format === 'h2h') {
    const seen = new Set();
    const results = [];
    for (const r of ranked) {
      if (r.opp == null || seen.has(r.roster_id) || seen.has(r.opp)) continue;
      seen.add(r.roster_id); seen.add(r.opp);
      const o = ranked.find((x) => x.roster_id === r.opp);
      if (!o) continue;
      results.push(r.won === null || r.score === o.score ? `${r.team} tied ${o.team} ${r1(r.score)}–${r1(o.score)}` : r.won ? `${r.team} beat ${o.team} ${r1(r.score)}–${r1(o.score)}` : `${o.team} beat ${r.team} ${r1(o.score)}–${r1(r.score)}`);
    }
    if (results.length) lines.push(`Head-to-head: ${results.slice(0, 6).join(' · ')}${results.length > 6 ? ` · +${results.length - 6} more` : ''}`);
  }
  if (season?.leader) lines.push(season.record ? `Season: ${season.leader} leads at ${season.record} (${r1(season.total)} ${word}) after ${season.weeks} week${season.weeks === 1 ? '' : 's'}.` : `Season: ${season.leader} leads with ${r1(season.total)} ${word} after ${season.weeks} week${season.weeks === 1 ? '' : 's'}.`);
  if (next?.lockMs) lines.push(`Week ${next.week}'s board is up — squads lock ${etStamp(next.lockMs)} ET.`);
  return lines.join('\n');
}

async function releaseAt(week, season) {
  const key = `${season}:${week}`;
  if (release.has(key)) return release.get(key);
  const { data } = await db().from('nfl_slate').select('kickoff').eq('week', week).eq('season', String(season)).order('kickoff', { ascending: false }).limit(1);
  const at = weekReportRelease(data?.[0]?.kickoff ? Date.parse(data[0].kickoff) : null);
  release.set(key, at);
  return at;
}

/** Post the week's recap into every contest league whose week is final.
 *  Returns how many were posted this pass. */
/** The week's card for one league: null when the week isn't ready (a matchup
 *  not final, no squads). `voids` holds the league's VOIDED weeks (0474): they
 *  don't count toward the season line. */
export async function buildContestRecap(lg, week, season, voids = new Set()) {
  const cfg = contestConfigOf(lg.settings_json, lg.kind);
  if (!cfg) return null;
  const { data: ms } = await db().from('matchup').select('id, home_roster_id, away_roster_id, home_final, away_final, home_tb, away_tb, status')
    .eq('league_id', lg.id).eq('week', week);
  if (!ms?.length || !ms.every((m) => m.status === 'final' && m.home_final != null && m.away_final != null)) return null;
  const { data: mems } = await db().from('league_membership').select('sleeper_roster_id, team_name, app_user_id, controller, enrolled').eq('league_id', lg.id);
  const seats = new Map((mems ?? []).map((m) => [m.sleeper_roster_id, m]));
  const ranked = rankWeek(cfg, ms, seats);
  if (!ranked.length) return null;
  let seasonLine = null;
  if (lg.contest_week == null) {
    const { data: fin } = await db().from('matchup').select('home_roster_id, away_roster_id, home_final, away_final, week, is_playoff')
      .eq('league_id', lg.id).eq('status', 'final').lte('week', week);
    const golf = contestLowerWins(cfg);
    const tot = new Map(); const weeks = new Set();
    const rec = new Map(); // roster → {w, l, t} (RECORDS, v0.670.0)
    const bump = (rid, k) => { const r = rec.get(rid) ?? { w: 0, l: 0, t: 0 }; r[k] += 1; rec.set(rid, r); };
    for (const m of fin ?? []) {
      if (voids.has(Number(m.week))) continue;   // VOIDED (0474): not played, not counted
      if (m.is_playoff) continue;                 // PLAYOFFS (0476): the bracket's, not the season's
      weeks.add(m.week);
      const h = Number(m.home_final ?? 0), a = Number(m.away_final ?? 0);
      tot.set(m.home_roster_id, (tot.get(m.home_roster_id) ?? 0) + h);
      if (m.away_roster_id === m.home_roster_id) continue;
      tot.set(m.away_roster_id, (tot.get(m.away_roster_id) ?? 0) + a);
      if (h === a) { bump(m.home_roster_id, 't'); bump(m.away_roster_id, 't'); continue; }
      const homeWon = golf ? h < a : h > a;
      bump(homeWon ? m.home_roster_id : m.away_roster_id, 'w'); bump(homeWon ? m.away_roster_id : m.home_roster_id, 'l');
    }
    const byTotal = (a, b) => (golf ? a[1] - b[1] : b[1] - a[1]);
    const top = cfg.format === 'h2h'
      ? [...tot.entries()].sort((a, b) => ((rec.get(b[0])?.w ?? 0) - (rec.get(a[0])?.w ?? 0)) || ((rec.get(a[0])?.l ?? 0) - (rec.get(b[0])?.l ?? 0)) || byTotal(a, b))[0]
      : [...tot.entries()].sort(byTotal)[0];
    if (top) {
      const r = rec.get(top[0]);
      seasonLine = { leader: seats.get(top[0])?.team_name ?? `Seat ${top[0]}`, total: top[1], weeks: weeks.size,
        record: cfg.format === 'h2h' && r ? `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}` : null };
    }
  }
  let next = null;
  if (lg.contest_week == null) {
    const { data: nk } = await db().from('nfl_slate').select('kickoff').eq('season', String(season)).eq('week', week + 1).not('kickoff', 'is', null).order('kickoff').limit(1);
    if (nk?.[0]?.kickoff) next = { week: week + 1, lockMs: Date.parse(nk[0].kickoff) };   // v0.669.0: a contest player locks at kickoff
  }
  const body = recapBody(cfg, week, ranked, seasonLine, next);
  const txn = { kind: 'contest_recap', week, contest: cfg.contest, top: ranked.slice(0, 3).map((r) => ({ team: r.team, score: r1(r.score) })) };
  return { cfg, ranked, body, txn };
}

/** The voided weeks (0474) of these leagues: league id → Set of weeks. */
async function voidedWeeks(leagueIds) {
  const out = new Map();
  if (!leagueIds.length) return out;
  const { data } = await db().from('week_void').select('league_id, week').in('league_id', leagueIds);
  for (const v of data ?? []) { if (!out.has(v.league_id)) out.set(v.league_id, new Set()); out.get(v.league_id).add(Number(v.week)); }
  return out;
}

export async function postContestRecaps(week, season, opts = {}) {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - (lastCheck.get(week) ?? 0) < RECHECK_MS) return 0;
  lastCheck.set(week, now);
  const due = opts.force ? 0 : await releaseAt(week, season);
  if (due > now) return 0;
  const { data: leagues, error } = await db().from('league').select('id, name, kind, season, contest_week, settings_json')
    .in('kind', ['dfs', 'bullseye']).eq('season', String(season));
  if (error) { log('leagues', error.message); return 0; }
  const live = (leagues ?? []).filter((l) => (l.contest_week == null || Number(l.contest_week) === Number(week)) && !posted.has(`${l.id}:${week}`));
  if (!live.length) return 0;
  // The card is the record: a league whose chat already carries this week's is done.
  const { data: done } = await db().from('league_message').select('league_id').in('league_id', live.map((l) => l.id))
    .eq('kind', 'txn').eq('txn->>kind', 'contest_recap').eq('txn->>week', String(week));
  for (const d of done ?? []) posted.add(`${d.league_id}:${week}`);
  const voids = await voidedWeeks(live.map((l) => l.id));
  let n = 0;
  for (const lg of live) {
    if (posted.has(`${lg.id}:${week}`)) continue;
    // A VOIDED week (0474) gets no card: the commissioner struck it.
    if (voids.get(lg.id)?.has(Number(week))) continue;
    const card = await buildContestRecap(lg, week, season, voids.get(lg.id));
    if (!card) continue;
    const { cfg, ranked, body, txn } = card;
    const { error: mErr } = await db().from('league_message').insert({ league_id: lg.id, author_id: null, kind: 'txn', body, mentions: [], txn });
    if (mErr) { log(lg.name, 'wk', week, 'card', mErr.message); continue; }
    posted.add(`${lg.id}:${week}`);
    n += 1;
    // YOUR PLACE, on your phone. Only people who played the week.
    const word = contestScoreWord(cfg.contest, cfg.bullseye?.variant);
    const pushes = ranked.filter((r) => r.uid && !r.cpu).map((r) => ({
      app_user_id: r.uid, kind: 'report',
      title: `🏁 Week ${week}: ${ord(r.rank)} of ${ranked.length} in ${lg.name}`,
      body: `${r1(r.score)} ${word}${r.opp != null ? (r.won === null || r.score === r.oppScore ? ' — a tie' : r.won ? ` — you beat ${ranked.find((x) => x.roster_id === r.opp)?.team ?? 'your opponent'}` : ` — ${ranked.find((x) => x.roster_id === r.opp)?.team ?? 'your opponent'} beat you`) : ''}. ${ranked[0].team} took the week.`,
      data: { league_id: lg.id, open: 'league' },
      dedupe_key: `contest-recap:${lg.id}:${week}:${r.uid}`,
    }));
    if (pushes.length) {
      const { error: pErr } = await db().from('push_outbox').upsert(pushes, { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (pErr) log(lg.name, 'pushes', pErr.message);
    }
    log(lg.name, 'wk', week, '—', ranked[0].team, r1(ranked[0].score), word, `(${ranked.length} squads, ${pushes.length} pushes)`);
  }
  return n;
}

/** AFTER A RE-SCORE (0474): rebuild the week's card from the corrected finals
 *  and replace the one in chat (post it if there was none). No pushes — the
 *  re-score's own house line says which results moved. Returns 'rebuilt',
 *  'posted', or null when the week has no card to build. */
export async function repostContestRecap(league, week) {
  const voids = (await voidedWeeks([league.id])).get(league.id);
  const card = await buildContestRecap(league, week, league.season, voids);
  if (!card) return null;
  const { data: had } = await db().from('league_message').select('id').eq('league_id', league.id)
    .eq('kind', 'txn').eq('txn->>kind', 'contest_recap').eq('txn->>week', String(week)).order('id', { ascending: false }).limit(1);
  const id = had?.[0]?.id;
  if (id != null) {
    const { error } = await db().from('league_message').update({ body: card.body, txn: card.txn }).eq('id', id);
    if (error) throw new Error(error.message);
    return 'rebuilt';
  }
  const { error } = await db().from('league_message').insert({ league_id: league.id, author_id: null, kind: 'txn', body: card.body, mentions: [], txn: card.txn });
  if (error) throw new Error(error.message);
  posted.add(`${league.id}:${week}`);
  return 'posted';
}
