// nflverse TRUE-UP (0169): QB hits + passes defended land ~a day after games.
//
// ESPN's live play text never reliably names QB hits or pass breakups, so the
// live poller can't emit them (the Phase-3 ruling: never guess). nflverse's
// play-by-play — published on GitHub releases and refreshed nightly during the
// season — carries exact per-defender attribution (qb_hit_1/2_player_id,
// pass_defense_1/2_player_id). This job streams the season CSV, extracts those
// credits, resolves gsis → our slug through the Sleeper directory (name
// fallback when Sleeper lacks the gsis), and upserts live_play rows:
//   • kind 'qbhit' / 'pd' per credited defender;
//   • one team row per play on the DEF pseudo-player ("xxx-dst").
// game_id is the NFLVERSE gid (2026_01_BUF_NYJ) and pid the nflverse play_id —
// a namespace that can never collide with the ESPN poller's rows on the
// (week, game_id, pid, player_slug, k) key, and re-runs upsert idempotently.
//
// Cadence: the caller runs this every TRUEUP_MS (6h default) — nflverse data
// lags the games by up to ~a day, so IDP QB-hit/PD points "tick up" after the
// fact by design (docs/play-feed-enrichment-scope.md, Phase 3 decision).
// Preseason note: nflverse pbp covers REG/POST only — preseason games never
// true up; the knobs simply stay quiet there.
import { db } from '../supabase.js';
import { gunzipSync } from 'node:zlib';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const RELEASE = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${season}.csv.gz`;

// Minimal CSV state machine — pbp desc fields carry commas, quotes, newlines.
function* csvRows(text) {
  let field = '', row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; yield row; row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); yield row; }
}

function clockOf(qtr, mmss) {
  const [m, s] = String(mmss).split(':').map(Number);
  const rem = (m || 0) * 60 + (s || 0);
  if (qtr >= 5) return 3600 + (qtr - 5) * 600 + (600 - rem);
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - rem)));
}

/** Extract per-defender qbhit/pd credits from a season CSV's text. Pure —
 *  exercised directly by the smoke check with a fixture CSV. */
export function extractCredits(csvText) {
  let header = null; const col = {};
  const out = [];
  for (const row of csvRows(csvText)) {
    if (!header) { header = row; for (let i = 0; i < row.length; i++) col[row[i]] = i; continue; }
    const g = (name) => row[col[name]] ?? '';
    const week = Number(g('week'));
    if (!week) continue;
    const base = { week, gid: g('game_id'), pid: Number(g('play_id')), c: clockOf(Number(g('qtr')), g('time')), defteam: g('defteam').trim() };
    if (g('qb_hit') === '1') {
      for (const n of [1, 2]) {
        const gsis = g(`qb_hit_${n}_player_id`).trim();
        if (gsis) out.push({ ...base, k: 'qbhit', gsis, name: g(`qb_hit_${n}_player_name`).trim() });
      }
      out.push({ ...base, k: 'qbhit', gsis: '', name: '' }); // team credit
    }
    let anyPd = false;
    for (const n of [1, 2]) {
      const gsis = g(`pass_defense_${n}_player_id`).trim();
      if (gsis) { anyPd = true; out.push({ ...base, k: 'pd', gsis, name: g(`pass_defense_${n}_player_name`).trim() }); }
    }
    if (anyPd) out.push({ ...base, k: 'pd', gsis: '', name: '' }); // team credit
    // 0170: INDIVIDUAL defensive TD + safety credit — the two knobs live ESPN
    // text can't attribute to a person. Individual rows ONLY: the ESPN poller
    // already emits the team dst_td/safety rows, so a team credit here would
    // double-count across the two game-id namespaces.
    // …and NOT an interception or fumble return (v0.531.0): the live feed
    // already credits that returner with his own dst_td row (espnAdapter,
    // 0170), and the two game-id namespaces never collide, so the TD paid
    // twice a day after the game. What is left here is what live text cannot
    // attribute — blocked-kick and other defensive returns.
    const tdTeam = g('td_team').trim();
    const takeawayReturn = g('interception') === '1' || g('fumble_lost') === '1';
    // …nor a kick or punt RETURN TD (v0.533.0): the returner's own return row
    // already carries it, and a dst_td on an offensive player made a scoped
    // per-TD rule count the same touchdown twice. A BLOCKED punt returned for
    // six is the defense's and stays.
    const kickReturn = g('kickoff_attempt') === '1' || (g('punt_attempt') === '1' && g('punt_blocked') !== '1');
    if (tdTeam && tdTeam === base.defteam && !takeawayReturn && !kickReturn) {
      const gsis = g('td_player_id').trim();
      if (gsis) out.push({ ...base, k: 'dst_td', gsis, name: g('td_player_name').trim() });
    }
    if (g('safety') === '1') {
      const gsis = g('safety_player_id').trim();
      if (gsis) out.push({ ...base, k: 'safety', gsis, name: g('safety_player_name').trim() });
    }
  }
  return out;
}

/** Credits → live_play rows, resolving defenders through the player index.
 *  `resolve(gsis, name)` answers a slug or null; unresolvable defenders are
 *  dropped (counted), team rows always land on "xxx-dst". */
export function creditsToRows(credits, resolve) {
  const rows = []; let dropped = 0;
  for (const cr of credits) {
    let slug = null;
    if (!cr.gsis) {
      if (cr.defteam) slug = `${cr.defteam.toLowerCase()}-dst`;
    } else {
      // These are DEFENSIVE credits (qb hits, pass defenses), so `defteam` is
      // the crediting player's own club — the name fallback's disambiguator
      // (v0.345.0), and IDP names are exactly where namesakes bite.
      slug = resolve(cr.gsis, cr.name, cr.defteam);
      if (!slug) { dropped++; continue; }
    }
    if (!slug) continue;
    rows.push({
      week: cr.week, game_id: cr.gid, player_slug: slug,
      c: cr.c, t: null, pid: cr.pid, k: cr.k, y: 0, td: 0, ca: 0, tg: 0, to: null,
      fd: null, cp: null, ic: null, sk: null, rk: null, tt: null, hf: null, p6: null,
    });
  }
  return { rows, dropped };
}

/** Run one true-up pass for `season`, limited to `weeks` (the weeks the worker
 *  is actively scoring — keeps the upsert focused). */
export async function trueupTick(season, weeks, playerIndex) {
  const wanted = new Set(weeks);
  if (!wanted.size) return { rows: 0 };
  const res = await fetch(RELEASE(season), { redirect: 'follow' });
  if (!res.ok) throw new Error(`nflverse pbp fetch ${res.status}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  const credits = extractCredits(text).filter((c) => wanted.has(c.week));
  const resolve = (gsis, name, team) =>
    playerIndex.slugForGsis(gsis) ?? (name ? playerIndex.slugForNflAbbr(name, team) : null);
  const { rows, dropped } = creditsToRows(credits, resolve);
  // De-dupe on the conflict key (paranoia — nflverse rows are unique already).
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.week}|${r.game_id}|${r.pid}|${r.player_slug}|${r.k}`, r);
  const uniq = [...byKey.values()];
  for (let i = 0; i < uniq.length; i += 500) {
    const { error } = await db().from('live_play')
      .upsert(uniq.slice(i, i + 500), { onConflict: 'week,game_id,pid,player_slug,k' });
    if (error) throw new Error(`true-up upsert: ${error.message}`);
  }
  // THE OFFICIAL CREDITS REPLACE THE LIVE ESTIMATES (v0.535.0). The poller
  // writes QB hits and passes defended live from ESPN's text under the ESPN
  // game id; for every game this pass now covers, those estimates are retired
  // (and pollGame stops re-emitting them once it sees these rows). Games are
  // matched on week + away/home through game_feed, whose codes are the same
  // nflverse vocabulary (espnAdapter fixTeam).
  {
    const gids = [...new Set(uniq.filter((r) => r.k === 'qbhit' || r.k === 'pd').map((r) => `${r.week}|${r.game_id}`))];
    let retired = 0;
    for (const key of gids) {
      const [wk, gid] = key.split('|');
      const parts = gid.split('_');                     // 2026_03_AWAY_HOME
      if (parts.length < 4) continue;
      const away = parts[2], home = parts[3];
      const { data: gf } = await db().from('game_feed').select('game_id').eq('week', Number(wk)).eq('away', away).eq('home', home);
      for (const g of gf ?? []) {
        const { data: del, error } = await db().from('live_play').delete()
          .eq('week', Number(wk)).eq('game_id', g.game_id).in('k', ['qbhit', 'pd']).select('id');
        if (error) log(`true-up retire live ${g.game_id}: ${error.message}`);
        else retired += (del ?? []).length;
      }
    }
    if (retired) log(`true-up ${season}: replaced ${retired} live QB-hit/PD estimates with official credits`);
  }
  // RETIRE WHAT THIS PASS NO LONGER CLAIMS (v0.531.0). An upsert only adds,
  // so the individual return-TD rows earlier passes wrote for INT and fumble
  // returns — the live feed's own dst_td already pays those — would stay and
  // keep paying twice. Scoped to this pass's own namespace (nflverse game ids
  // carry underscores, ESPN's are numeric), its own weeks and dst_td only.
  {
    const { data: mine } = await db().from('live_play').select('week,game_id,pid,player_slug,k')
      .in('week', [...wanted]).eq('k', 'dst_td').like('game_id', '%\\_%');
    const stale = (mine ?? []).filter((r) => r.player_slug && !r.player_slug.endsWith('-dst')
      && !byKey.has(`${r.week}|${r.game_id}|${r.pid}|${r.player_slug}|${r.k}`));
    for (const r of stale) {
      const { error } = await db().from('live_play').delete()
        .eq('week', r.week).eq('game_id', r.game_id).eq('pid', r.pid).eq('player_slug', r.player_slug).eq('k', 'dst_td');
      if (error) log(`true-up retire ${r.game_id}/${r.pid}/${r.player_slug}: ${error.message}`);
    }
    if (stale.length) log(`true-up ${season}: retired ${stale.length} duplicate return-TD rows`);
  }
  log(`true-up ${season}: ${uniq.length} qbhit/pd rows across weeks [${[...wanted]}], ${dropped} unresolvable defenders dropped`);
  return { rows: uniq.length, dropped };
}
