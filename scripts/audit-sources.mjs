// WHERE TWO SOURCES ANSWER THE SAME QUESTION (v0.451.0). NETWORK —
// `npm run audit:sources`, deliberately NOT in check:parity.
//
// After the StatHead audit this app holds several facts TWICE, from feeds
// that were built by different people for different reasons:
//
//   identity      Sleeper's directory, StatHead's crosswalk, FantasyCalc's
//                 board — three opinions about which ESPN athlete a Sleeper
//                 id is.
//   team          Sleeper's directory vs StatHead's weekly feed.
//   depth chart   Sleeper's availability-ordered depth vs the roster depth
//                 StatHead publishes.
//   injuries      ESPN's live report vs Sleeper's designation.
//   this week     ESPN's weekly projection vs StatHead's.
//   this season   our August bake vs StatHead's live board.
//   the market    our August ADP/dynasty bakes vs the live ones.
//   the schedule  ESPN's slate vs StatHead's team weeks.
//
// A disagreement is not automatically a bug — two models SHOULD disagree
// about a projection. It is a bug when two sources disagree about a FACT: a
// player's team, his id, whether he plays this week. This script sorts the
// two and prints the second kind loudly.
//
// Everything joins on ids. Where a join has to fall back to a name it says
// so in the output, because a name join is the thing this repo keeps
// getting bitten by.
import { PROJ_2026, PROJ_2026_SID } from '../packages/core/src/data/proj2026.ts';
import { ADP_BY_SID, ADP_AS_OF } from '../packages/core/src/data/adp2026.ts';
import { DYN_AS_OF, DYN_BY_SID } from '../packages/core/src/data/dyn2026.ts';
import { statheadFeed } from '../server/src/poll/projections.js';

const SEASON = Number(process.env.SEASON || 2026);
const RAW = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const shFile = (p) => `${RAW}/${REF}/public/data/${p}`;

// Some proxies 403 a bare `fetch` of site.api.espn.com (no user-agent). The
// worker never sees this, but an audit that silently skips a source is worse
// than no audit, so every request out of this script carries one.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('user-agent')) headers.set('user-agent', process.env.AUDIT_UA || 'curl/8.5.0');
  return realFetch(url, { ...init, headers });
};

const say = (s = '') => console.log(s);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
// Sleeper's directory stores some ids with leading whitespace (" 00-0026300")
// and some as numbers. Comparing raw would report 52 gsis "disagreements"
// that are one space — a reminder that the id you join on is only as good as
// the trim around it.
const num = (x) => {
  const s = x == null ? '' : String(x).trim();
  return s === '' ? null : s;
};

async function getJson(url, what) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${what} ${res.status}`);
  return await res.json();
}

/** Run one section; a section that cannot reach its sources says so and the
 *  rest of the audit continues. */
async function section(title, fn) {
  say(`\n## ${title}\n`);
  try { await fn(); } catch (e) { say(`  (skipped — ${e.message})`); }
}

const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
const FINDINGS = [];
const finding = (kind, text) => { FINDINGS.push({ kind, text }); say(`  ${kind === 'fact' ? '!!' : '··'} ${text}`); };

// ── the feeds ────────────────────────────────────────────────────────────
say(`# Source audit — season ${SEASON}, ${new Date().toISOString()}`);

const sleeper = await getJson('https://api.sleeper.app/v1/players/nfl', 'sleeper directory');
const xwalk = await getJson(shFile('player-crosswalk.json'), 'crosswalk');
const weekly = await statheadFeed(SEASON);
// THE NEXT week, not this one. Comparing projections for a week whose games
// have started is comparing two different questions: ESPN drops a projection
// once a game is final, so half the "disagreements" would be "one of them
// already knows the answer".
const WEEK = Number(process.env.WEEK || (weekly.currentWeek ?? 0) + 1 || 1);
say(`\nSleeper directory: ${Object.keys(sleeper).length} players · StatHead crosswalk: ${xwalk.players.length}`
  + ` · weekly feed: ${weekly.players.length} (built ${weekly.generatedAt}, week ${WEEK})`);

// Index everything by sleeper id, which is the one key all three carry.
const xBySleeper = new Map();
for (const p of xwalk.players) if (p.sleeper_id) xBySleeper.set(String(p.sleeper_id), p);
const shBySleeper = new Map();
for (const p of weekly.players) if (p.sleeper) shBySleeper.set(String(p.sleeper), p);
const slBySleeper = new Map(Object.entries(sleeper));
/** The players this app could actually roster: a fantasy position, on a team. */
const rosterable = [...slBySleeper.entries()]
  .filter(([, p]) => FANTASY.has(p.position) && p.team && p.active);

// ── 1. IDENTITY ──────────────────────────────────────────────────────────
await section('Identity — who is this player, according to whom', async () => {
  const fc = await getJson(shFile('fantasycalc_dynasty_1qb.json'), 'fantasycalc');
  const fcBySleeper = new Map();
  for (const r of fc) if (r?.player?.sleeperId) fcBySleeper.set(String(r.player.sleeperId), r.player);

  const FIELDS = [
    ['espn_id', (p) => num(p.espn_id), (x) => num(x.espn_id)],
    ['gsis_id', (p) => num(p.gsis_id), (x) => num(x.gsis_id)],
    ['sportradar_id', (p) => num(p.sportradar_id), (x) => num(x.sportradar_id)],
    ['rotowire_id', (p) => num(p.rotowire_id), (x) => num(x.rotowire_id)],
    ['fantasy_data_id', (p) => num(p.fantasy_data_id), (x) => num(x.fantasy_data_id)],
    ['yahoo_id', (p) => num(p.yahoo_id), (x) => num(x.yahoo_id)],
  ];
  for (const [name, fromSleeper, fromX] of FIELDS) {
    let both = 0; let same = 0; const bad = [];
    for (const [sid, sp] of rosterable) {
      const x = xBySleeper.get(sid);
      if (!x) continue;
      const a = fromSleeper(sp); const b = fromX(x);
      if (!a || !b) continue;
      both++;
      if (a === b) same++; else bad.push(`${sp.full_name ?? sid} (${sp.position} ${sp.team}): sleeper ${a} vs stathead ${b}`);
    }
    const line = `${name}: ${same}/${both} agree (${pct(same, both)})`;
    if (bad.length) { finding('fact', `${line} — ${bad.length} disagree`); for (const b of bad.slice(0, 8)) say(`       ${b}`); }
    else say(`  ok ${line}`);
  }

  // Coverage: who can each source place at all?
  let onlySleeper = 0; let onlyX = 0; let neither = 0;
  for (const [sid, sp] of rosterable) {
    const x = xBySleeper.get(sid);
    const a = num(sp.espn_id); const b = x ? num(x.espn_id) : null;
    if (a && !b) onlySleeper++; else if (!a && b) onlyX++; else if (!a && !b) neither++;
  }
  say(`  espn_id coverage over ${rosterable.length} rosterable players:`
    + ` only Sleeper has one ${onlySleeper}, only StatHead ${onlyX}, neither ${neither}`);

  // The third opinion.
  let fcBoth = 0; let fcSame = 0; const fcBad = [];
  for (const [sid, sp] of rosterable) {
    const f = fcBySleeper.get(sid);
    if (!f?.espnId || !sp.espn_id) continue;
    fcBoth++;
    if (String(f.espnId) === String(sp.espn_id)) fcSame++;
    else fcBad.push(`${sp.full_name}: sleeper ${sp.espn_id} vs fantasycalc ${f.espnId}`);
  }
  const fcLine = `fantasycalc espnId vs Sleeper: ${fcSame}/${fcBoth} agree (${pct(fcSame, fcBoth)})`;
  if (fcBad.length) { finding('fact', `${fcLine} — ${fcBad.length} disagree`); for (const b of fcBad.slice(0, 8)) say(`       ${b}`); }
  else say(`  ok ${fcLine}`);
});

// ── 2. TEAM ──────────────────────────────────────────────────────────────
await section('Team — where does he play', async () => {
  const norm = (t) => (t === 'LAR' ? 'LA' : t === 'WSH' ? 'WAS' : t === 'JAC' ? 'JAX' : t === 'OAK' ? 'LV' : t === 'AZ' ? 'ARI' : t);
  let both = 0; let same = 0; const bad = [];
  for (const [sid, sp] of rosterable) {
    const sh = shBySleeper.get(sid);
    if (!sh?.team) continue;
    both++;
    if (norm(sp.team) === norm(sh.team)) same++;
    else bad.push(`${sp.full_name} (${sp.position}): sleeper ${sp.team} vs stathead ${sh.team}`);
  }
  const line = `${same}/${both} agree (${pct(same, both)})`;
  if (bad.length) { finding('fact', `team: ${line} — ${bad.length} disagree`); for (const b of bad.slice(0, 12)) say(`       ${b}`); }
  else say(`  ok team: ${line}`);
});

// ── 3. DEPTH CHART ───────────────────────────────────────────────────────
await section('Depth chart — who starts', async () => {
  let both = 0; let same = 0; const bad = [];
  for (const [sid, sp] of rosterable) {
    const sh = shBySleeper.get(sid);
    if (!sh || sh.depth == null || sp.depth_chart_order == null) continue;
    both++;
    if (Number(sp.depth_chart_order) === Number(sh.depth)) same++;
    else bad.push(`${sp.full_name} (${sp.position} ${sp.team}): sleeper #${sp.depth_chart_order} vs stathead #${sh.depth}`);
  }
  say(`  ${same}/${both} agree (${pct(same, both)}) — the two are built differently:`);
  say('  Sleeper re-orders for AVAILABILITY week to week (0293 reads it for exactly that),');
  say('  StatHead publishes the nflverse roster depth. A disagreement is usually an injury.');
  // Only the STARTER disagreements matter to a lineup.
  const starters = bad.filter((b) => /#1 vs|vs stathead #1$/.test(b));
  if (starters.length) say(`  ${starters.length} of them disagree about who is #1:`);
  for (const b of starters.slice(0, 10)) say(`       ${b}`);
});

// ── 4. INJURIES ──────────────────────────────────────────────────────────
await section('Injuries — is he playing', async () => {
  const { fetchInjuries, normalizeInjuries } = await import('../scripts/espn/injuries.mjs');
  const feed = await fetchInjuries();
  // Keyed by ESPN athlete id where the report carries one, else by name.
  const espnByName = new Map();
  const rows = normalizeInjuries(feed, (name) => name.toLowerCase());
  for (const [key, r] of Object.entries(rows)) espnByName.set(key, r);
  const MAP = { O: 'Out', IR: 'IR', D: 'Doubtful', Q: 'Questionable', Sus: 'Suspended', PUP: 'PUP' };
  let both = 0; let same = 0; const bad = [];
  for (const [, sp] of rosterable) {
    const key = `${sp.first_name} ${sp.last_name}`.toLowerCase();
    const e = espnByName.get(key);
    const s = sp.injury_status;
    if (!e && !s) continue;
    const eStat = e?.status ? String(e.status) : null;
    const sStat = s ? (MAP[s] ?? String(s)) : null;
    if (!eStat || !sStat) {
      if (eStat || sStat) bad.push(`${sp.full_name} (${sp.position} ${sp.team}): espn ${eStat ?? '—'} vs sleeper ${sStat ?? '—'}`);
      continue;
    }
    both++;
    if (eStat.toLowerCase().startsWith(sStat.toLowerCase().slice(0, 3))) same++;
    else bad.push(`${sp.full_name} (${sp.position} ${sp.team}): espn ${eStat} vs sleeper ${sStat}`);
  }
  say(`  ${same}/${both} agree where both carry a designation (${pct(same, both)})`);
  say(`  ${bad.length} rows where only one source says anything, or they say different things:`);
  for (const b of bad.slice(0, 12)) say(`       ${b}`);
  say('  (ESPN is the live report and the one the worker stores; this is a freshness gap,');
  say('   not a contradiction — but a player OUT on one and silent on the other is worth a look.)');
});

// ── 5. THIS WEEK'S PROJECTION ────────────────────────────────────────────
await section(`This week's projection — ESPN vs StatHead (week ${WEEK})`, async () => {
  // THE POLLER'S OWN REQUEST, deliberately — an audit that builds its own
  // query proves nothing about what the worker stores. (This is how the
  // filter bug in v0.445.0's fetchProjections was found: one side came back
  // empty.)
  const { fetchProjections } = await import('../server/src/poll/projections.js');
  const feed = await fetchProjections(SEASON, WEEK, 900);
  // espn athlete id → sleeper id, through the crosswalk (never by name).
  const sleeperByEspn = new Map();
  for (const p of xwalk.players) if (p.espn_id && p.sleeper_id) sleeperByEspn.set(String(p.espn_id), String(p.sleeper_id));

  const pairs = [];
  let unjoinable = 0;
  for (const entry of feed?.players ?? []) {
    const p = entry?.player;
    const row = (p?.stats ?? []).find((s) => s.statSourceId === 1 && s.statSplitTypeId === 1 && Number(s.scoringPeriodId) === WEEK);
    if (!p?.id || !row) continue;
    const sid = sleeperByEspn.get(String(p.id));
    if (!sid) { unjoinable++; continue; }
    const sh = shBySleeper.get(sid);
    if (!sh) continue;
    const shPts = (sh.wk ?? [])[WEEK - 1];
    if (shPts == null) continue;
    pairs.push({
      name: p.fullName, pos: sh.pos, team: sh.team,
      espn: Number(row.appliedTotal ?? 0), sh: Number(shPts),
      active: sh.active !== false, backup: !!sh.backup,
    });
  }
  // A BACKUP'S StatHead line is a rate CONDITIONAL ON PLAYING — the feed says
  // so, and it is why Nick Mullens comes back at 18.5 while ESPN, which is
  // answering "what will he score", says 0. Those are not the same question,
  // so they are counted apart rather than called a disagreement.
  const all = pairs.filter((x) => x.active && (x.espn > 0 || x.sh > 0));
  const live = all.filter((x) => !x.backup);
  say(`  ${all.length - live.length} of them are StatHead backup rows (a rate conditional on playing,`);
  say('  against ESPN answering "will he play at all") — counted separately below.');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const diffs = live.map((x) => x.sh - x.espn);
  const abs = diffs.map(Math.abs);
  say(`  ${pairs.length} players both sources project this week (${unjoinable} ESPN rows the crosswalk cannot place)`);
  say(`  mean difference ${mean(diffs).toFixed(2)} pts (StatHead − ESPN), mean absolute ${mean(abs).toFixed(2)} pts`);
  const sorted = [...live].sort((a, b) => Math.abs(b.sh - b.espn) - Math.abs(a.sh - a.espn));
  say('  biggest disagreements:');
  for (const x of sorted.slice(0, 12)) {
    say(`       ${x.name} (${x.pos} ${x.team}): espn ${x.espn.toFixed(1)} vs stathead ${x.sh.toFixed(1)}`);
  }
  // A zero on one side and a real number on the other is not a modelling
  // difference — one of them thinks he is not playing.
  const contradictions = live.filter((x) => (x.espn === 0) !== (x.sh === 0));
  if (contradictions.length) {
    finding('fact', `${contradictions.length} players are projected zero by one source and not the other`);
    for (const x of contradictions.slice(0, 10)) say(`       ${x.name} (${x.pos} ${x.team}): espn ${x.espn.toFixed(1)} vs stathead ${x.sh.toFixed(1)}`);
  }
  // Ranking agreement matters more than points: a lineup is an ordering.
  const byEspn = [...live].sort((a, b) => b.espn - a.espn).map((x) => x.name);
  const bySh = [...live].sort((a, b) => b.sh - a.sh).map((x) => x.name);
  const top = (n) => new Set(byEspn.slice(0, n));
  for (const n of [12, 24, 48]) {
    const overlap = bySh.slice(0, n).filter((x) => top(n).has(x)).length;
    say(`  top ${n} overlap: ${overlap}/${n} (${pct(overlap, n)})`);
  }
});

// ── 6. THIS SEASON'S PROJECTION ──────────────────────────────────────────
// v0.455.0 CHANGED WHAT THIS MEASURES. The worker now stores the live season
// rate and `projectedPoints` uses it as the LEVEL its league-scoring ratio
// multiplies, so the live board is what a screen shows and the bake is the
// fallback underneath it. This section is therefore no longer "how stale is
// the number a user sees" — it is "how far has the fallback drifted", which
// is the honest question about a fallback and still worth asking.
await section('This season — the live board against the bake beneath it', async () => {
  // The weekly feed carries the season line (ppg × gp) with ids, which is
  // exactly what proj2026 stores as a per-week rate.
  const pairs = [];
  for (const [sid, baked] of PROJ_2026_SID ?? []) {
    const sh = shBySleeper.get(String(sid));
    if (!sh || !(sh.ppg > 0)) continue;
    pairs.push({ name: sh.name, pos: sh.pos, baked, live: (sh.ppg * (sh.gp ?? 17)) / 17 });
  }
  if (!pairs.length) { say('  (no sleeper-keyed bake to compare)'); return; }
  const diffs = pairs.map((x) => x.live - x.baked);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  say(`  ${pairs.length} players in both, joined by sleeper id`);
  say(`  mean drift ${mean(diffs).toFixed(2)} pts/week, mean absolute ${mean(diffs.map(Math.abs)).toFixed(2)}`);
  say('  (the bake is a season rate frozen in August; the live board blends what has');
  say('   actually happened, and since v0.455.0 it is the level the app scores off —');
  say('   so this is the size of the fallback\'s error, not of the app\'s)');
  const moved = [...pairs].sort((a, b) => Math.abs(b.live - b.baked) - Math.abs(a.live - a.baked));
  say('  moved most since the bake:');
  for (const x of moved.slice(0, 12)) say(`       ${x.name} (${x.pos}): ${x.baked.toFixed(1)} → ${x.live.toFixed(1)} per week`);
});

// ── 7. THE MARKET ────────────────────────────────────────────────────────
await section('The market — our ADP and dynasty bakes vs the live ones', async () => {
  const ffc = await getJson(shFile(`ffc_adp_ppr_${SEASON}.json`), 'ffc adp');
  // v0.452.0: our bake carries a sleeper id now, so the comparison goes
  // through it. FFC publishes its own player_id and no sleeper id, so the
  // crosswalk resolves FFC's NAME once — a name join done in the audit,
  // where a miss is printed, rather than in the app, where it is silent.
  const xById = new Map();
  for (const x of xwalk.players) {
    if (!x.sleeper_id) continue;
    for (const n of x.all_names ?? [x.display_name]) {
      const k = `${n.toLowerCase()}|${x.position}`;
      if (!xById.has(k)) xById.set(k, String(x.sleeper_id));
    }
  }
  const live = new Map(); let unmapped = 0;
  for (const p of ffc.players ?? []) {
    const sid = xById.get(`${String(p.name).toLowerCase()}|${p.position}`);
    if (!sid) { unmapped++; continue; }
    live.set(sid, Number(p.adp));
  }
  let both = 0; const moves = [];
  for (const [sid, adp] of ADP_BY_SID ?? []) {
    const l = live.get(sid);
    if (l == null) continue;
    both++;
    moves.push({ name: xBySleeper.get(sid)?.display_name ?? `sleeper ${sid}`, baked: Number(adp), live: l });
  }
  say(`  ADP bake as of ${ADP_AS_OF}; FFC's live board has ${ffc.players?.length ?? 0} players,`
    + ` ${both} joined BY SLEEPER ID (${unmapped} FFC rows the crosswalk could not place)`);
  if (both) {
    const d = moves.map((m) => Math.abs(m.live - m.baked));
    say(`  mean absolute move ${(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1)} picks`);
    for (const m of [...moves].sort((a, b) => Math.abs(b.live - b.baked) - Math.abs(a.live - a.baked)).slice(0, 8)) {
      say(`       ${m.name}: ${m.baked} → ${m.live}`);
    }
  }
  // THE DYNASTY BOARD CAN BE COMPARED NOW (v0.455.0). This used to say a
  // value-to-value diff would be comparing two scales, because the blend was
  // computed inside a tool we could not call. The worker runs that rescale
  // itself now — the upstream's own rule over the published KTC board — so
  // the same arithmetic can be run here and diffed against the bake BY ID.
  const [ktc, snap] = await Promise.all([
    getJson(shFile('ktc_rankings_1qb.json'), 'ktc'),
    getJson(shFile('dynasty-fc-rescale.json'), 'rescale'),
  ]);
  const { dynRows } = await import('../server/src/poll/dynasty.js');
  const dynLive = dynRows(ktc, snap, xwalk, { sleeper: () => null, slugForName: () => null });
  const dmoves = [];
  for (const r of dynLive) {
    if (r.kind !== 'player' || !r.sleeper_id) continue;
    const baked = DYN_BY_SID.get(r.sleeper_id);
    if (!baked || r.v1qb == null) continue;
    dmoves.push({ name: xBySleeper.get(r.sleeper_id)?.display_name ?? r.sleeper_id, baked: baked[0], live: r.v1qb });
  }
  say(`\n  dynasty bake as of ${DYN_AS_OF}; the live rescale prices ${dynLive.length} rows,`
    + ` ${dmoves.length} joined BY SLEEPER ID`);
  // BY RANK BAND, NOT BY MEAN PERCENT. The first version of this measured a
  // mean absolute percentage and reported 56%, which was the metric failing
  // rather than the data: the deep tail's baked values fall to 18, where a
  // few points of absolute difference is a 20× ratio. The median ratio inside
  // a band says what is actually true — the two agree where the values mean
  // anything, and diverge where neither is really pricing a player.
  dmoves.sort((a, b) => b.baked - a.baked);
  const bandRatio = (lo, hi) => {
    const s = dmoves.slice(lo, hi).map((m) => m.live / m.baked).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  for (const [lo, hi] of [[0, 100], [100, 200], [200, 300], [300, dmoves.length]]) {
    const r = bandRatio(lo, hi);
    if (r != null) {
      say(`  baked rank ${String(lo + 1).padStart(3)}–${String(Math.min(hi, dmoves.length)).padStart(3)}:`
        + ` median live/baked ${r.toFixed(2)}`);
    }
  }
  const top = dmoves.slice(0, 200).map((m) => Math.abs(m.live - m.baked) / m.baked);
  if (top.length) {
    say(`  over the top 200, mean absolute move ${((top.reduce((a, b) => a + b, 0) / top.length) * 100).toFixed(1)}%`
      + ' — a month of market, not a formula error');
  }
  say('  (the worker rebakes this weekly now; the tail divergence is why a fresh');
  say('   live board answers by SILENCE rather than falling through — v0.455.1)');
});

// ── 8. THE SCHEDULE ──────────────────────────────────────────────────────
await section(`The schedule — ESPN's slate vs StatHead's team weeks (week ${WEEK})`, async () => {
  const { buildSlate } = await import('../server/src/poll/scoreboard.js');
  const slate = await buildSlate(SEASON, WEEK, 2, 0);
  if (!slate.length) throw new Error('espn slate empty');
  const shGames = new Map();
  for (const [team, games] of Object.entries(weekly.teamWeeks ?? {})) {
    const g = games.find((x) => Number(x.w) === WEEK);
    if (g) shGames.set(team, g);
  }
  let same = 0; const bad = [];
  for (const g of slate) {
    for (const [team, opp, home] of [[g.home, g.away, true], [g.away, g.home, false]]) {
      const sh = shGames.get(team);
      if (!sh) { bad.push(`${team}: ESPN has a game vs ${opp}, StatHead has none`); continue; }
      if (sh.opp === opp && !!sh.home === home) same++;
      else bad.push(`${team}: espn ${home ? 'vs' : '@'} ${opp} vs stathead ${sh.home ? 'vs' : '@'} ${sh.opp}`);
    }
  }
  const total = same + bad.length;
  const line = `${same}/${total} team-games agree (${pct(same, total)})`;
  if (bad.length) { finding('fact', `schedule: ${line}`); for (const b of bad.slice(0, 12)) say(`       ${b}`); }
  else say(`  ok schedule: ${line}`);
  // Byes are the other half: a team StatHead has on bye that ESPN has playing
  // would silently zero a lineup.
  const espnTeams = new Set(slate.flatMap((g) => [g.home, g.away]));
  const shPlaying = [...shGames.keys()];
  const onlySh = shPlaying.filter((t) => !espnTeams.has(t));
  if (onlySh.length) finding('fact', `StatHead has ${onlySh.join(', ')} playing in week ${WEEK}; ESPN's slate does not`);
});

say(`\n## Summary\n`);
const facts = FINDINGS.filter((f) => f.kind === 'fact');
say(facts.length
  ? `${facts.length} disagreement(s) about a FACT (not a model):\n` + facts.map((f) => `  · ${f.text}`).join('\n')
  : 'No two sources disagree about a fact. Projection differences are models disagreeing, which is what models do.');
