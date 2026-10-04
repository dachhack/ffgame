// THE SPORT DIRECTORY (phase 2, v0.617.0) — sport_player, per sport.
//
// One sweep per sport: the adapter's directory() (rosters + a season line
// per player for ranking) → eligibility in core's vocabulary → a rank →
// upsert. Like the college sweep (poll/college.js), retirement is by
// absence: a player the completed sweep did not see goes inactive, and a
// sweep that failed part-way retires nobody.
//
// THE RANK. Draft rooms autopick and sort by `rank` (league_pool.rank, seeded
// from here). No free, licensable ADP exists for these sports, so the rank
// is fantasy points under the sport's default table over the ranking
// season the adapter chose (this season once it has enough games, else
// last), with Sleeper's search_rank as the tiebreak for the NBA and the
// only order for a player with no line. Commissioners can override per
// league later; this is the floor, not the ceiling.
//
// THE CROSSWALK. NHL and MLB box scores carry the same ids as their
// directories. Basketball does not: the NBA directory is Sleeper's (its own
// ids), the WNBA's is ESPN's, and both leagues' box scores carry nba.com
// personIds. `xrefKey` resolves a box-score row to a directory key by
// normalised name + team, remembers the answer in sport_player.alt_ids, and
// falls back to the feed's own id so a line is never dropped.
import { db, allRows } from '../supabase.js';
import { adapterFor } from '../sports/index.js';
import { SPORTS, eligibleFor, playerKey } from '../../../packages/core/src/sports/index.ts';
import { linePoints } from '../../../packages/core/src/sports/score.ts';

const log = (...a) => console.log('[sport-dir]', ...a);

/** Lower-case letters and spaces only, suffixes and accents dropped — the
 *  same idea as the NFL slug rule, applied to "Jaylen Brown" ≡ "J. Brown"
 *  only when the surname and team agree (see nameKey/initialKey). */
export const normName = (raw) => String(raw ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[.'’]/g, '')
  .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
  .replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();

/** The row a sweep writes. `feedCodes` are the adapter's raw position codes;
 *  `eligible` is core's. A player whose codes map to nothing is skipped. */
export function directoryRow(sport, p, rank) {
  const def = SPORTS[sport];
  const eligible = [...new Set((p.feedCodes ?? [p.pos]).flatMap((c) => eligibleFor(sport, c)))];
  if (!eligible.length) return null;
  const line = p.season ?? null;
  const rankPts = line ? linePoints(def, line) : null;
  return {
    sport, player_key: playerKey(sport, p.extId), ext_id: String(p.extId),
    full_name: p.name, team: p.team ?? '', pos: eligible[0], eligible, feed_pos: p.pos ?? null,
    jersey: p.jersey ?? null, headshot: p.headshot ?? null,
    active: p.active !== false && !p.minors,
    injury_status: p.injury?.code ?? null, injury_note: p.injury?.note ?? null,
    rank, rank_pts: rankPts, season: p.seasonId ?? null, gp: p.gp ?? 0, season_line: line,
    exp: Number.isFinite(p.exp) ? p.exp : null,
    seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
}

/** Order the directory: points desc, then the feed's own order (search
 *  rank) asc, then name — and number them 1..N. */
export function rankDirectory(sport, players) {
  const def = SPORTS[sport];
  const scored = players.map((p) => ({ p, pts: p.season ? linePoints(def, p.season) : null }));
  scored.sort((a, b) => {
    if (a.pts != null || b.pts != null) {
      if (a.pts == null) return 1;
      if (b.pts == null) return -1;
      if (b.pts !== a.pts) return b.pts - a.pts;
    }
    const ra = a.p.searchRank ?? Infinity, rb = b.p.searchRank ?? Infinity;
    if (ra !== rb) return ra - rb;
    return String(a.p.name).localeCompare(String(b.p.name));
  });
  return scored.map(({ p }) => p);
}

// ── Injuries on the boards ───────────────────────────────────────────────────
// The boards read one table, injury_status (O / D / Q / IR by player_slug),
// and the directory already knows each sport's designation; so the sweep
// writes the injured into that table under the sport key, in the NFL's
// four-letter vocabulary, and clears the sport's rows that healed. The NFL
// injury poll's prune skips sport keys (poll/injuries.js).
const TO_BOARD = { O: 'O', SUSP: 'O', D: 'D', Q: 'Q', GTD: 'Q', DTD: 'Q', IR: 'IR', LTIR: 'IR', OFS: 'IR', IL7: 'IR', IL10: 'IR', IL15: 'IR', IL60: 'IR' };
export const boardInjury = (code) => (code ? TO_BOARD[code] ?? null : null);

export function injuryRows(rows) {
  const out = [];
  for (const r of rows) {
    const st = boardInjury(r.injury_status);
    if (!st) continue;
    out.push({ player_slug: r.player_key, status: st, comment: r.injury_note ?? null, team: r.team || null, source: `${r.sport}-dir`, updated_at: new Date().toISOString() });
  }
  return out;
}

async function syncSportInjuries(sport, rows) {
  const inj = injuryRows(rows);
  const keep = new Set(inj.map((r) => r.player_slug));
  for (let i = 0; i < inj.length; i += 250) {
    const { error } = await db().from('injury_status').upsert(inj.slice(i, i + 250), { onConflict: 'player_slug' });
    if (error) { log(`${sport}: injury upsert: ${error.message}`); return { injured: 0, cleared: 0 }; }
  }
  const { data: held } = await db().from('injury_status').select('player_slug').like('player_slug', `${sport}-%`);
  const gone = (held ?? []).map((r) => r.player_slug).filter((k) => !keep.has(k));
  for (let i = 0; i < gone.length; i += 200) await db().from('injury_status').delete().in('player_slug', gone.slice(i, i + 200));
  return { injured: inj.length, cleared: gone.length };
}

/** One sport's sweep. Returns counts; throws (retiring nobody) on a partial
 *  sweep. */
export async function syncSportDirectory(sport, season) {
  const adapter = adapterFor(sport);
  // The sweep's start is taken BEFORE any row is stamped: the retirement
  // pass below marks rows seen before it, and every row this sweep writes
  // is stamped after it.
  const sweepStart = new Date().toISOString();
  const players = rankDirectory(sport, await adapter.directory(season));
  const rows = [];
  let skipped = 0;
  players.forEach((p, i) => {
    try {
      const r = directoryRow(sport, p, i + 1);
      if (r) rows.push(r); else skipped++;
    } catch (e) { skipped++; log(`${sport}: skipped ${p.name}: ${e.message}`); }
  });
  if (!rows.length) throw new Error(`${sport}: directory came back empty`);
  for (let i = 0; i < rows.length; i += 250) {
    const { error } = await db().from('sport_player').upsert(rows.slice(i, i + 250), { onConflict: 'sport,player_key' });
    if (error) throw new Error(`sport_player upsert: ${error.message}`);
  }
  // Retirement: anyone this completed sweep did not touch.
  const { data: retired, error: rErr } = await db().from('sport_player')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('sport', sport).eq('active', true).lt('seen_at', sweepStart).select('player_key');
  if (rErr) log(`${sport}: retirement pass: ${rErr.message}`);
  // Every league pool of this sport follows the directory (0430): a traded
  // player's team, a newly earned eligibility. The pool is what the locks
  // and the DB lock read, so a stale team there is a player who never scores.
  const { data: moved, error: mErr } = await db().rpc('sport_pool_refresh', { p_sport: sport });
  if (mErr) log(`${sport}: pool refresh: ${mErr.message}`);
  const inj = await syncSportInjuries(sport, rows);
  return { sport, players: rows.length, skipped, retired: retired?.length ?? 0, poolMoved: Number(moved ?? 0), ...inj };
}

// ── The box-score crosswalk (NBA / WNBA) ─────────────────────────────────────
const NEEDS_XREF = new Set(['nba', 'wnba']);
const xref = new Map();   // sport → { at, byAlt: Map(feedId → key), byName: Map("team|name" → key), bySurname: Map("team|surname" → [key…]) }
const XREF_TTL_MS = 60 * 60e3;

/** Build the lookup from directory rows (pure; tests feed rows directly). */
export function buildXref(rows) {
  const byAlt = new Map(), byName = new Map(), bySurname = new Map();
  for (const r of rows) {
    for (const [feed, id] of Object.entries(r.alt_ids ?? {})) byAlt.set(`${feed}:${id}`, r.player_key);
    const nm = normName(r.full_name);
    byName.set(`${r.team}|${nm}`, r.player_key);
    const parts = nm.split(' ');
    const surname = parts[parts.length - 1];
    const k = `${r.team}|${surname}`;
    bySurname.set(k, [...(bySurname.get(k) ?? []), { key: r.player_key, initial: parts[0]?.[0] ?? '' }]);
  }
  return { at: Date.now(), byAlt, byName, bySurname };
}

/** A box-score row's directory key, or null when nobody matches. */
export function resolveXref(x, feed, line) {
  const alt = x.byAlt.get(`${feed}:${line.extId}`);
  if (alt) return alt;
  const nm = normName(line.name);
  const exact = x.byName.get(`${line.team}|${nm}`);
  if (exact) return exact;
  const parts = nm.split(' ');
  const cands = x.bySurname.get(`${line.team}|${parts[parts.length - 1]}`) ?? [];
  if (cands.length === 1) return cands[0].key;
  const byInitial = cands.filter((c) => c.initial === parts[0]?.[0]);
  return byInitial.length === 1 ? byInitial[0].key : null;
}

async function loadXref(sport) {
  const cached = xref.get(sport);
  if (cached && Date.now() - cached.at < XREF_TTL_MS) return cached;
  // Every row (v0.627.3), page by page — the directory is past 1000.
  const data = await allRows((from, to) => db().from('sport_player').select('player_key,full_name,team,alt_ids').eq('sport', sport).order('player_key').range(from, to));
  const x = buildXref(data);
  xref.set(sport, x);
  return x;
}

/** For the poller: the player_key a box-score line should be stored under.
 *  Sports whose feeds share ids get the feed id straight; basketball goes
 *  through the crosswalk and remembers a fresh match in alt_ids. */
export async function xrefKey(sport, line) {
  if (!NEEDS_XREF.has(sport)) return playerKey(sport, line.extId);
  const feed = sport; // the box-score feed's id space, named by the sport
  const x = await loadXref(sport);
  const key = resolveXref(x, feed, line);
  if (key && !x.byAlt.has(`${feed}:${line.extId}`)) {
    x.byAlt.set(`${feed}:${line.extId}`, key);
    // Remember it: one small update, fire-and-forget (a failure only means
    // the name match runs again next poll).
    db().rpc('sport_player_add_alt', { p_sport: sport, p_key: key, p_feed: feed, p_id: String(line.extId) })
      .then(({ error }) => { if (error) log(`${sport}: alt id ${line.extId}: ${error.message}`); });
  }
  return key ?? playerKey(sport, line.extId);
}

/** Test-only: seed or clear the crosswalk cache. */
export function __setXrefForTest(sport, rows) { if (rows) xref.set(sport, buildXref(rows)); else xref.delete(sport); }
