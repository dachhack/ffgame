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

// ── THE OFFENSE, AGAINST THE BOOKS (v0.740.0) ───────────────────────────────
// Founder, on a Josh Allen touchdown the app never had (2026 wk 10): "Let's
// reconcile the scoring and play by play to see if we are missing anything."
// It was: two touchdowns ESPN sent as scoring-summary text, twelve plays on
// the wrong man, two completions the books do not have. The live parser is
// fixed for each (espnAdapter v0.740.0), and this is the net under it: a day
// after the games, every pass, rush and catch the live feed holds is checked
// against nflverse's play-by-play and made to agree.
//
// The live rows stay in the ESPN namespace (its game id; ESPN's play-id
// suffix IS the nflverse play_id, the join scripts/espn/validate.mjs gates
// on), so nothing is counted twice: a play is corrected where it already is.
//   • missing from the feed            → written;
//   • on the wrong player              → moved to the right one;
//   • different yards or touchdown     → set to the books';
//   • in the feed, not a play in the books (a "No Play", a catch that was an
//     interception) → removed.
// A play the feed filed under an id nflverse does not use is matched by
// player, kind and game clock instead, and never written a second time. A
// man the directory cannot resolve is left exactly as the live feed had him.

/** The offensive lines nflverse credits on one play: [{ k, gsis, name, y, td, … }]. */
export function offenseOfRow(g) {
  const out = [];
  if (g('two_point_attempt') === '1') return out;            // tp_* rows are the live feed's own
  const type = g('play_type');
  const num = (name) => { const v = g(name); return v === '' || v === 'NA' ? null : Number(v); };
  const tdBy = g('td_player_id').trim();
  const fd = (flag) => (g(flag) === '1' ? 1 : null);
  const passer = g('passer_player_id').trim();
  if ((type === 'pass' || type === 'qb_spike') && passer) {
    const complete = g('complete_pass') === '1', sack = g('sack') === '1', pick = g('interception') === '1';
    out.push({ k: 'pass', gsis: passer, name: g('passer_player_name').trim(),
      y: complete ? num('passing_yards') ?? 0 : 0, td: g('pass_touchdown') === '1' ? 1 : 0,
      cp: complete ? 1 : null, ic: !complete && !sack ? 1 : null, sk: sack ? 1 : null, to: pick ? 1 : null, fd: complete ? fd('first_down_pass') : null });
    const recv = g('receiver_player_id').trim();
    if (complete && recv) out.push({ k: 'rec', gsis: recv, name: g('receiver_player_name').trim(),
      y: num('receiving_yards') ?? 0, td: g('pass_touchdown') === '1' && tdBy === recv ? 1 : 0, ca: 1, tg: 1, fd: fd('first_down_pass') });
  }
  const rusher = g('rusher_player_id').trim();
  if ((type === 'run' || type === 'qb_kneel') && rusher) {
    out.push({ k: 'rush', gsis: rusher, name: g('rusher_player_name').trim(),
      y: num('rushing_yards') ?? num('yards_gained') ?? 0, td: g('rush_touchdown') === '1' && tdBy === rusher ? 1 : 0, fd: fd('first_down_rush') });
  }
  return out;
}

/** Every play of the season's CSV: { week, gid, pid, c, posteam, lines[] }.
 *  A play with no offensive line (a punt, a "No Play") still comes back —
 *  knowing the books HAVE the play is what lets a feed row on it be removed. */
export function extractOffense(csvText, weeks) {
  let header = null; const col = {}; const out = [];
  for (const row of csvRows(csvText)) {
    if (!header) { header = row; for (let i = 0; i < row.length; i++) col[row[i]] = i; continue; }
    const g = (name) => (col[name] == null ? '' : row[col[name]] ?? '');
    const week = Number(g('week'));
    if (!week || (weeks && !weeks.has(week))) continue;
    const pid = Number(g('play_id'));
    if (!Number.isFinite(pid)) continue;
    out.push({ week, gid: g('game_id'), pid, c: clockOf(Number(g('qtr')), g('time')), posteam: g('posteam').trim(), lines: offenseOfRow(g) });
  }
  return out;
}

/** The worker's own 6-hourly pass, over the week being played and the three
 *  before it. ON since v0.740.2: ops 092 and 093 dry-ran week 10 against
 *  production's directory (24 to write, 11 to correct, 17 to remove, each one
 *  a play the reconciliation had already found) before anything was written. */
export const OFFENSE_AUTO = true;
const OFF_KINDS = ['pass', 'rush', 'rec'];
/** What one game's feed rows need to agree with the books. Pure.
 *    plays     extractOffense's rows for this game
 *    existing  the feed's pass/rush/rec rows: { id, pid, c, player_slug, k, y, td, to }
 *    resolve   (gsis, name, team) → slug | null
 *  → { insert: rows (no week/game_id), update: [{ id, y, td, to? }], remove: [id], unresolved } */
export function planOffense(plays, existing, resolve) {
  const insert = [], update = [], remove = []; let unresolved = 0;
  const bookPids = new Set(plays.map((p) => p.pid));
  const byPidKind = new Map();
  for (const r of existing) {
    if (!OFF_KINDS.includes(r.k)) continue;
    const key = `${r.pid}|${r.k}`;
    if (!byPidKind.has(key)) byPidKind.set(key, []);
    byPidKind.get(key).push(r);
  }
  const claimed = new Set();     // feed row ids a book line has accounted for
  const expectedKeys = new Set();
  const fix = (r, ln) => {
    claimed.add(r.id);
    const to = ln.to && !r.to ? { to: 1 } : {};
    if (Number(r.y) !== ln.y || Number(r.td) !== ln.td || to.to) update.push({ id: r.id, y: ln.y, td: ln.td, ...to });
  };
  for (const p of plays) {
    for (const ln of p.lines) {
      expectedKeys.add(`${p.pid}|${ln.k}`);
      const rows = byPidKind.get(`${p.pid}|${ln.k}`) ?? [];
      const slug = resolve(ln.gsis, ln.name, p.posteam);
      if (!slug) { unresolved++; for (const r of rows) claimed.add(r.id); continue; }   // leave the live feed's answer alone
      const same = rows.find((r) => r.player_slug === slug);
      if (same) { fix(same, ln); for (const r of rows) if (r !== same) { claimed.add(r.id); remove.push(r.id); } continue; }
      // Filed under an id the books do not use? The same man, kind and clock.
      const alias = existing.find((r) => !claimed.has(r.id) && r.k === ln.k && r.player_slug === slug
        && !bookPids.has(r.pid) && Math.abs(Number(r.c) - p.c) <= 5);
      if (alias) { fix(alias, ln); for (const r of rows) { claimed.add(r.id); remove.push(r.id); } continue; }
      // On the wrong man (or nobody): his row goes, the right one is written.
      const model = rows[0];
      for (const r of rows) { claimed.add(r.id); remove.push(r.id); }
      insert.push({
        player_slug: slug, c: model ? Number(model.c) : p.c, t: model?.t ?? null, pid: p.pid, k: ln.k, y: ln.y, td: ln.td,
        ca: ln.ca ?? 0, tg: ln.tg ?? 0, to: ln.to ?? null, fd: ln.fd ?? null, cp: ln.cp ?? null, ic: ln.ic ?? null, sk: ln.sk ?? null,
        rk: null, tt: null, hf: null, p6: null,
      });
    }
  }
  // In the feed, on a play the books have, as a line the books do not give it.
  for (const r of existing) {
    if (!OFF_KINDS.includes(r.k) || claimed.has(r.id)) continue;
    if (bookPids.has(r.pid) && !expectedKeys.has(`${r.pid}|${r.k}`)) remove.push(r.id);
  }
  return { insert, update, remove: [...new Set(remove)], unresolved };
}

/** Apply planOffense to every game of `weeks` the books cover. `dry` plans and
 *  reports without writing; `detail` logs each change (the operator's run). */
export async function trueupOffense(csvText, weeks, resolve, { dry = false, detail = false } = {}) {
  const plays = extractOffense(csvText, weeks);
  const byGame = new Map();
  for (const p of plays) { const k = `${p.week}|${p.gid}`; if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(p); }
  const tot = { games: 0, inserted: 0, updated: 0, removed: 0, unresolved: 0 };
  for (const [key, gp] of byGame) {
    const [wk, gid] = key.split('|');
    const parts = gid.split('_');                       // 2026_10_AWAY_HOME
    if (parts.length < 4) continue;
    // A game still being played has only some of its plays in the books; the
    // release is nightly, but a half-written game must not delete the rest.
    if (gp.length < 100) continue;
    const { data: gf } = await db().from('game_feed').select('game_id, state').eq('week', Number(wk)).eq('away', parts[2]).eq('home', parts[3]);
    const feed = (gf ?? []).find((g) => /^\d+$/.test(String(g.game_id)));
    if (!feed) continue;
    if (feed.state && feed.state !== 'post') continue;
    const existing = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db().from('live_play').select('id, pid, c, t, player_slug, k, y, td, to')
        .eq('week', Number(wk)).eq('game_id', feed.game_id).in('k', OFF_KINDS).order('id').range(from, from + 999);
      if (error) throw new Error(`true-up offense read ${feed.game_id}: ${error.message}`);
      existing.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    if (!existing.length) continue;                     // the live feed never had this game — not ours to invent
    const plan = planOffense(gp, existing, resolve);
    // A plan that would rewrite a large share of a game is a join gone wrong
    // (ids that stopped lining up), not a correction. Refuse it and say so.
    const touched = plan.insert.length + plan.update.length + plan.remove.length;
    if (touched > Math.max(40, existing.length * 0.15)) {
      log(`true-up offense ${gid}: REFUSED — ${touched} changes against ${existing.length} rows (insert ${plan.insert.length}, update ${plan.update.length}, remove ${plan.remove.length})`);
      continue;
    }
    if (detail) {
      const byId = new Map(existing.map((r) => [r.id, r]));
      for (const r of plan.insert) log(`  ${gid} write   pid ${r.pid} ${r.player_slug} ${r.k} ${r.y} yd${r.td ? ' TD' : ''}`);
      for (const u of plan.update) { const r = byId.get(u.id); log(`  ${gid} correct pid ${r.pid} ${r.player_slug} ${r.k} ${r.y}→${u.y} yd, td ${r.td}→${u.td}${u.to ? ', +turnover' : ''}`); }
      for (const i of plan.remove) { const r = byId.get(i); log(`  ${gid} remove  pid ${r.pid} ${r.player_slug} ${r.k} ${r.y} yd${r.td ? ' TD' : ''}`); }
    }
    if (dry) {
      tot.games++; tot.inserted += plan.insert.length; tot.updated += plan.update.length; tot.removed += plan.remove.length; tot.unresolved += plan.unresolved;
      if (touched) log(`true-up offense ${gid} (dry): +${plan.insert.length} to write, ${plan.update.length} to correct, ${plan.remove.length} to remove${plan.unresolved ? `, ${plan.unresolved} unresolved` : ''}`);
      continue;
    }
    for (let i = 0; i < plan.remove.length; i += 200) {
      const { error } = await db().from('live_play').delete().in('id', plan.remove.slice(i, i + 200));
      if (error) throw new Error(`true-up offense delete ${gid}: ${error.message}`);
    }
    for (const u of plan.update) {
      const { id, ...set } = u;
      const { error } = await db().from('live_play').update(set).eq('id', id);
      if (error) throw new Error(`true-up offense update ${gid}: ${error.message}`);
    }
    if (plan.insert.length) {
      const rows = plan.insert.map((r) => ({ week: Number(wk), game_id: feed.game_id, ...r }));
      const { error } = await db().from('live_play').upsert(rows, { onConflict: 'week,game_id,pid,player_slug,k' });
      if (error) throw new Error(`true-up offense insert ${gid}: ${error.message}`);
    }
    tot.games++; tot.inserted += plan.insert.length; tot.updated += plan.update.length; tot.removed += plan.remove.length; tot.unresolved += plan.unresolved;
    if (touched) log(`true-up offense ${gid}: +${plan.insert.length} written, ${plan.update.length} corrected, ${plan.remove.length} removed${plan.unresolved ? `, ${plan.unresolved} unresolved` : ''}`);
  }
  return tot;
}

/** WHO THE BOOKS MEAN (v0.740.1). The books name a man by gsis id; the
 *  directory carries one for most players and for almost no rookie, so the
 *  rest are found by name — and the first dry run of week 10 showed what a
 *  loose name match does: "A.Ogletree" of the Colts resolved to Alec
 *  Ogletree, a linebacker five years retired (the only "A. Ogletree" the
 *  directory holds; the Colts' tight end is listed as Drew), and
 *  "J.Sturdivant" resolved to nobody (the directory says "J. Michael").
 *  So, in order:
 *    1. the gsis id;
 *    2. the one man ON THE PLAY'S TEAM with that last name — a skill-position
 *       player first, anybody if there is no such; the first initial settles
 *       two;
 *    3. nobody. An unresolved play is left as the live feed had it. */
const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'FB', 'K', 'P']);
const NAME_SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;
const lastOf = (name) => String(name ?? '').replace(NAME_SUFFIX, '').trim().split(/[\s.]+/).filter(Boolean).pop()?.toLowerCase() ?? '';
export function offenseResolver(playerIndex) {
  const byTeamLast = new Map();
  for (const e of playerIndex.allSlugs?.() ?? []) {
    if (!e.team || !e.full) continue;
    const key = `${e.team}|${lastOf(e.full)}`;
    if (!byTeamLast.has(key)) byTeamLast.set(key, []);
    byTeamLast.get(key).push(e);
  }
  return (gsis, name, team) => {
    const byId = playerIndex.slugForGsis(gsis);
    if (byId) return byId;
    if (!name || !team) return null;
    let pool = byTeamLast.get(`${team}|${lastOf(name)}`) ?? [];
    const skill = pool.filter((e) => SKILL.has(String(e.pos ?? '').toUpperCase()));
    if (skill.length) pool = skill;
    if (pool.length > 1) {
      const ini = String(name).trim()[0]?.toLowerCase();
      const same = pool.filter((e) => e.full.trim()[0]?.toLowerCase() === ini);
      if (same.length) pool = same;
    }
    return pool.length === 1 ? pool[0].slug : null;
  };
}

/** THE OPERATOR'S RUN (v0.740.0): one week's offense against the books, now,
 *  with every change listed. `dry` writes nothing.
 *    node src/cli.js trueup-week <week> [season] [--dry] */
export async function trueupOffenseWeek(season, week, playerIndex, { dry = false } = {}) {
  const res = await fetch(RELEASE(season), { redirect: 'follow' });
  if (!res.ok) throw new Error(`nflverse pbp fetch ${res.status}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  return trueupOffense(text, new Set([week]), offenseResolver(playerIndex), { dry, detail: true });
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
  // THE OFFENSE (v0.740.0): passes, rushes and catches against the books. Its
  // own try — a failure here must not cost the defensive credits above.
  let offense = null;
  try {
    offense = OFFENSE_AUTO ? await trueupOffense(text, wanted, offenseResolver(playerIndex)) : { games: 0, inserted: 0, updated: 0, removed: 0, unresolved: 0 };
    if (offense.inserted || offense.updated || offense.removed) {
      log(`true-up ${season}: offense — ${offense.inserted} written, ${offense.updated} corrected, ${offense.removed} removed across ${offense.games} games`);
    }
  } catch (e) { log(`true-up ${season}: offense failed: ${e.message}`); }
  return { rows: uniq.length, dropped, offense };
}
