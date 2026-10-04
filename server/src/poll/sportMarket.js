// THE SPORT MARKET (v0.627.0) — pre-season ADP and the season's calendar,
// per sport, so a draft room can sort by ADP and a lineup can project a
// week. Founder: "pull in pre season ADP for these sports for draft testing"
// and "weekly and season long projections for new sports from previous
// season actuals".
//
//   ADP      FantasyPros' overall ADP page per sport — the consensus of the
//            sites it averages (Yahoo, ESPN, CBS, NFBC…) in its AVG column.
//            Names and teams crosswalk to sport_player through the same
//            normName/xref rule the box scores use.
//   CALENDAR ESPN's fantasy season payload (proTeamSchedules_wl): every pro
//            team's games for the season by date, one request per sport —
//            the feeds themselves only serve a day (or, for the NBA, a file
//            this container cannot reach). Written to sport_calendar; the
//            market RPC counts a team's games this week and left this season.
//
// Projections need no feed: a player's per-game rate is his season line
// over his games played (the directory already carries both), times the
// games his team has — computed where it is shown (core sports/market.ts).
import { db } from '../supabase.js';
import { getJson, getText } from '../sports/http.js';
import { buildXref, resolveXref, normName } from './sportDirectory.js';

const log = (...a) => console.log('[sport-market]', ...a);

/** Team codes as the ADP pages and ESPN write them → the feed tricodes the
 *  directory stores. Anything not listed passes through upper-cased. */
export const TEAM_ALIAS = {
  nhl: { NJ: 'NJD', TB: 'TBL', LA: 'LAK', SJ: 'SJS', MON: 'MTL', WAS: 'WSH', VEG: 'VGK', UTAH: 'UTA', ARI: 'UTA', CLB: 'CBJ', NAS: 'NSH', WIN: 'WPG' },
  nba: { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN', CHO: 'CHA' },
  wnba: { NY: 'NYL', LV: 'LVA', LA: 'LAS', CONN: 'CON', PHX: 'PHO', WSH: 'WAS', GS: 'GSV' },
  mlb: { CHW: 'CWS', ARI: 'AZ', WAS: 'WSH', OAK: 'ATH', SDP: 'SD', SFG: 'SF', TBR: 'TB', KCR: 'KC', WSN: 'WSH' },
};
export const feedTeam = (sport, code) => {
  const c = String(code ?? '').trim().toUpperCase();
  return TEAM_ALIAS[sport]?.[c] ?? c;
};

/** The ADP page's overall table → [{name, team, pos, adp, rank}]. The three
 *  pages differ in the small print beside the name — "(DEN - C)", "COL", or
 *  "(<a>LAD</a> - SP,DH)" — and their rows have no closing </tr>, so this
 *  splits on <tr and reads the first 2–4 capital letters of the small print
 *  as the team. The ADP is the AVG column: the last numeric cell. */
export function parseFantasyProsAdp(html, sport) {
  const start = html.indexOf('id="data"');
  if (start < 0) return [];
  const tableStart = html.lastIndexOf('<table', start);
  const tableEnd = html.indexOf('</table>', start);
  const table = html.slice(tableStart, tableEnd);
  const bodyAt = table.indexOf('<tbody');
  const body = bodyAt >= 0 ? table.slice(bodyAt) : table;
  const out = [];
  for (const row of body.split(/<tr\b/).slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 3) continue;
    const label = cells.find((c) => /player-name/.test(c)) ?? cells[1];
    const name = (/fp-player-name="([^"]+)"/.exec(label)?.[1] ?? /class="player-name[^"]*"[^>]*>([^<]+)</.exec(label)?.[1] ?? '').trim();
    if (!name) continue;
    const small = /<small[^>]*>([\s\S]*?)<\/small>/.exec(label)?.[1] ?? '';
    const smallText = small.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const team = feedTeam(sport, /\b([A-Z]{2,4})\b/.exec(smallText)?.[1] ?? '');
    const posText = (/-\s*([A-Z0-9,/ ]+)\)?\s*$/.exec(smallText)?.[1] ?? '').trim();
    let pos = posText ? posText.split(/[,/]/).map((p) => p.trim().replace(/\d+$/, '')).filter(Boolean) : [];
    // The NHL page keeps the position in its own column ("C1", "RW2", "G1").
    if (!pos.length) {
      const col = cells.map((c) => c.replace(/<[^>]+>/g, '').trim()).find((c) => /^[A-Z]{1,2}\d{1,2}$/.test(c));
      if (col) pos = [col.replace(/\d+$/, '')];
    }
    const nums = cells.map((c) => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim()).filter((c) => /^\d+(\.\d+)?$/.test(c));
    const adp = nums.length ? Number(nums[nums.length - 1]) : null;
    const rank = nums.length ? Number(nums[0]) : null;
    if (adp == null || !Number.isFinite(adp)) continue;
    out.push({ name, team, pos, adp, rank });
  }
  return out;
}

/** ESPN's season payload → the pro teams (id → feed tricode) and every game
 *  once: [{srcId, gameDate (ET), startUtc, home, away}]. Each game appears
 *  under both teams in the payload; the id dedupes. */
export function espnCalendar(payload, sport) {
  const teams = payload?.settings?.proTeams ?? [];
  const abbr = new Map(teams.map((t) => [t.id, feedTeam(sport, t.abbrev)]));
  const seen = new Map();
  for (const t of teams) {
    for (const games of Object.values(t.proGamesByScoringPeriod ?? {})) {
      for (const g of games ?? []) {
        if (!g?.id || seen.has(g.id) || !g.date) continue;
        const home = abbr.get(g.homeProTeamId), away = abbr.get(g.awayProTeamId);
        if (!home || !away || home === 'FA' || away === 'FA') continue;
        const startUtc = new Date(g.date).toISOString();
        const gameDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(g.date));
        seen.set(g.id, { srcId: String(g.id), gameDate, startUtc, home, away });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.srcId.localeCompare(b.srcId));
}

/** ESPN's season id for a sport season (its starting year): the NBA and NHL
 *  name a season by the year it ends; MLB and the WNBA by the calendar year. */
export const espnSeasonId = (sport, season) => (sport === 'nba' || sport === 'nhl' ? Number(season) + 1 : Number(season));
const ESPN_GAME = { nba: 'fba', nhl: 'fhl', mlb: 'flb', wnba: 'wfba' };
const FP_SPORT = { nba: 'nba', nhl: 'nhl', mlb: 'mlb' };

export const fetchFantasyProsAdp = (sport) => getText(`https://www.fantasypros.com/${FP_SPORT[sport]}/adp/overall.php`);
export const fetchEspnSeason = (sport, season) =>
  getJson(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/${ESPN_GAME[sport]}/seasons/${espnSeasonId(sport, season)}?view=proTeamSchedules_wl`, { timeoutMs: 30000 });

/** Match ADP rows to directory keys: exact name + team, then surname +
 *  initial on the team (the box-score rule), then exact name alone when the
 *  directory has exactly one such name (a traded player the page has on his
 *  old team). Returns {rows: [{key, adp}], unmatched: [...]} */
export function matchAdp(adpRows, directory) {
  const x = buildXref(directory);
  const byNameOnly = new Map();
  for (const r of directory) {
    const nm = normName(r.full_name);
    byNameOnly.set(nm, byNameOnly.has(nm) ? null : r.player_key);
  }
  const rows = [], unmatched = [];
  const seen = new Set();
  for (const a of adpRows) {
    let key = resolveXref(x, 'adp', { extId: '', name: a.name, team: a.team });
    if (!key) key = byNameOnly.get(normName(a.name)) ?? null;
    if (!key || seen.has(key)) { if (!key) unmatched.push(a); continue; }
    seen.add(key);
    rows.push({ key, adp: a.adp });
  }
  return { rows, unmatched };
}

/** One sport's ADP sweep: fetch, match, write. */
export async function sweepSportAdp(sport) {
  if (!FP_SPORT[sport]) return { sport, skipped: 'no ADP page for this sport' };
  const html = await fetchFantasyProsAdp(sport);
  const parsed = parseFantasyProsAdp(html, sport);
  if (!parsed.length) throw new Error(`${sport}: the ADP page had no rows`);
  const { data: dir, error } = await db().from('sport_player').select('player_key, full_name, team, alt_ids').eq('sport', sport);
  if (error) throw new Error(`sport_player read: ${error.message}`);
  const { rows, unmatched } = matchAdp(parsed, dir ?? []);
  const { data, error: wErr } = await db().rpc('sport_adp_upsert', { p_sport: sport, p_rows: rows });
  if (wErr) throw new Error(`sport_adp_upsert: ${wErr.message}`);
  for (const u of unmatched.slice(0, 6)) log(`${sport}: no directory match for ${u.name} (${u.team})`);
  return { sport, parsed: parsed.length, matched: rows.length, written: data ?? rows.length, unmatched: unmatched.length };
}

/** One sport's calendar sweep for a season. */
export async function sweepSportCalendar(sport, season) {
  if (!ESPN_GAME[sport]) return { sport, skipped: 'no calendar source' };
  const payload = await fetchEspnSeason(sport, season);
  const games = espnCalendar(payload, sport);
  if (!games.length) throw new Error(`${sport} ${season}: the calendar had no games`);
  const rows = games.map((g) => ({ src_id: g.srcId, game_date: g.gameDate, start_utc: g.startUtc, home: g.home, away: g.away }));
  let written = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const { data, error } = await db().rpc('sport_calendar_upsert', { p_sport: sport, p_season: String(season), p_rows: rows.slice(i, i + 400) });
    if (error) throw new Error(`sport_calendar_upsert: ${error.message}`);
    written += data ?? 0;
  }
  const dates = games.map((g) => g.gameDate);
  return { sport, season: String(season), games: games.length, written, from: dates[0], to: dates[dates.length - 1] };
}

/** Both, for the daily sweep. Each half fails on its own. */
export async function sweepSportMarket(sport, season) {
  const out = { sport };
  try { out.adp = await sweepSportAdp(sport); } catch (e) { out.adpError = e.message; }
  try { out.calendar = await sweepSportCalendar(sport, season); } catch (e) { out.calendarError = e.message; }
  return out;
}
