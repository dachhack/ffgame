// THE SHADOW READ (v0.634.0) — Stathead beside the public feeds, compared.
//
// Before a sport switches provider, a week of its games has to agree
// between the two: the same slate, and for every final the same lines
// under the sport's default table. This module reads BOTH adapters for a
// day or a game, writes nothing, and logs one line per comparison that a
// person can read in the deploy log or `sport-shadow`:
//
//   shadow nhl 2026-10-06: slate 8/8 matched by teams (0 only ours, 0 only theirs, 0 status diffs);
//     finals 3: 2 agree, 1 differ — MTL@TOR: 2 lines differ (max 1.5 pts: Suzuki ours 9.5 theirs 8.0 [a]), 0 only ours, 1 only theirs
//
// Lines are matched by id where the id spaces agree (NHL, MLB; WNBA and
// soccer on ESPN ids), else by team and normalised name (NBA: CDN ids vs
// ESPN ids). Points under the default table decide "agree" (|Δ| < 0.05).
import { adapterFor, publicAdapterFor } from '../sports/index.js';
import { statheadAdapter } from '../sports/statheadAdapter.js';
import { statheadConfigured } from '../stathead.js';
import { feedTeam } from './sportMarket.js';
import { normName } from './sportDirectory.js';
import { SPORTS } from '../../../packages/core/src/sports/index.ts';
import { linePoints } from '../../../packages/core/src/sports/score.ts';

const log = (...a) => console.log('[shadow]', ...a);
const SAME_IDS = new Set(['nhl', 'mlb', 'wnba', 'epl', 'mls']);
/** Fields the PUBLIC feed does not serve, so a difference there is our gap,
 *  not a disagreement: the NHL box score gives faceoffs as a percentage only
 *  (sports/nhl.js writes fow/fol 0); Stathead counts them from the
 *  play-by-play. Left out of the comparison and named in the day's line. */
export const PUBLIC_GAPS = { nhl: ['fow', 'fol'] };
/** Fields the two feeds round differently: the NBA CDN gives minutes as
 *  PT25M01.00S (25.02), ESPN as 25. A difference under the tolerance is not
 *  a disagreement. */
export const TOLERANCE = { min: 1, toi: 0.1, gtoi: 0.1 };
const EPS = 0.05;
/** Games already compared this process (sport:gameId), so a final is read once. */
const done = new Set();

/** Both slates, matched by `AWAY@HOME` through each feed's team aliases. */
export function compareSlates(sport, ours, theirs) {
  const key = (g) => `${feedTeam(sport, g.away)}@${feedTeam(sport, g.home)}`;
  const a = new Map(ours.map((g) => [key(g), g])), b = new Map(theirs.map((g) => [key(g), g]));
  const matched = [], statusDiffs = [];
  for (const [k, g] of a) {
    const t = b.get(k);
    if (!t) continue;
    matched.push({ key: k, ours: g, theirs: t });
    if (g.status !== t.status) statusDiffs.push(`${k} ours ${g.status} theirs ${t.status}`);
  }
  return { matched, onlyOurs: [...a.keys()].filter((k) => !b.has(k)), onlyTheirs: [...b.keys()].filter((k) => !a.has(k)), statusDiffs };
}

/** Both line sets for one game, scored under the sport's default table. */
export function compareLines(sport, ours, theirs, { ignore = PUBLIC_GAPS[sport] ?? [] } = {}) {
  const def = SPORTS[sport];
  const skip = new Set([...ignore, 'posn']);
  const nameKey = (l) => `${feedTeam(sport, l.team)}|${normName(l.name)}`;
  const byId = SAME_IDS.has(sport);
  const idx = new Map(theirs.map((l) => [byId ? l.extId : nameKey(l), l]));
  const seen = new Set();
  const diffs = [];
  let agree = 0;
  for (const o of ours) {
    const k = byId ? o.extId : nameKey(o);
    const t = idx.get(k);
    if (!t) continue;
    seen.add(k);
    const po = linePoints(def, o.line ?? {}), pt = linePoints(def, t.line ?? {});
    const fields = [...new Set([...Object.keys(o.line ?? {}), ...Object.keys(t.line ?? {})])]
      .filter((f) => !skip.has(f) && Math.abs((o.line?.[f] ?? 0) - (t.line?.[f] ?? 0)) > (TOLERANCE[f] ?? 1e-9));
    if (Math.abs(po - pt) < EPS && !fields.length) agree++;
    else diffs.push({ name: o.name, team: o.team, ours: Math.round(po * 10) / 10, theirs: Math.round(pt * 10) / 10, delta: Math.round((po - pt) * 10) / 10, fields, values: fields.slice(0, 4).map((f) => `${f} ${o.line?.[f] ?? 0}≠${t.line?.[f] ?? 0}`) });
  }
  diffs.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const onlyOurs = ours.filter((o) => !idx.has(byId ? o.extId : nameKey(o))).map((l) => l.name);
  const onlyTheirs = theirs.filter((t) => !seen.has(byId ? t.extId : nameKey(t))).map((l) => l.name);
  // A DNP row only one side lists is not a disagreement about anybody's points.
  const dnp = (l) => l.played === false || !Object.values(l.line ?? {}).some((v) => v);
  return {
    matched: agree + diffs.length, agree, diffs,
    onlyOurs, onlyTheirs,
    onlyOursScoring: ours.filter((o) => !idx.has(byId ? o.extId : nameKey(o)) && !dnp(o)).map((l) => l.name),
    onlyTheirsScoring: theirs.filter((t) => !seen.has(byId ? t.extId : nameKey(t)) && !dnp(t)).map((l) => l.name),
    maxDelta: diffs.length ? Math.abs(diffs[0].delta) : 0,
  };
}

/** One line of prose for a game's comparison. */
export function describeLines(key, c) {
  if (!c.diffs.length && !c.onlyOursScoring.length && !c.onlyTheirsScoring.length) return `${key}: ${c.matched} lines agree`;
  const top = c.diffs.slice(0, 3).map((d) => `${d.name} ours ${d.ours} theirs ${d.theirs} [${(d.values ?? d.fields.slice(0, 4)).join(', ')}]`).join('; ');
  return `${key}: ${c.diffs.length}/${c.matched} lines differ (max ${c.maxDelta} pts: ${top})${c.onlyOursScoring.length ? `, ${c.onlyOursScoring.length} scoring only ours (${c.onlyOursScoring.slice(0, 3).join(', ')})` : ''}${c.onlyTheirsScoring.length ? `, ${c.onlyTheirsScoring.length} scoring only theirs (${c.onlyTheirsScoring.slice(0, 3).join(', ')})` : ''}`;
}

/** Shadow one day: both slates, then every game our slate calls final. */
export async function shadowDay(sport, date, { log: out = log, maxGames = 20 } = {}) {
  if (!statheadConfigured()) { out(`shadow ${sport} ${date}: no Stathead token`); return null; }
  const pub = publicAdapterFor(sport), sh = statheadAdapter(sport);
  if (!pub) { out(`shadow ${sport} ${date}: no public adapter to compare against`); return null; }
  const [ours, theirs] = await Promise.all([pub.schedule(date), sh.schedule(date)]);
  const slate = compareSlates(sport, ours, theirs);
  const finals = slate.matched.filter((m) => m.ours.status === 'final' || m.theirs.status === 'final').slice(0, maxGames);
  const games = [];
  for (const m of finals) {
    done.add(`${sport}:${m.ours.gameId}`);
    try {
      const [a, b] = await Promise.all([pub.game(m.ours.gameId), sh.game(m.theirs.gameId)]);
      const c = compareLines(sport, a.lines, b.lines);
      games.push({ key: m.key, ...c, theirStored: b.stored, revisedAt: b.revisedAt });
    } catch (e) { games.push({ key: m.key, error: e.message }); }
  }
  const agree = games.filter((g) => !g.error && !g.diffs.length && !g.onlyOursScoring.length && !g.onlyTheirsScoring.length).length;
  const gap = PUBLIC_GAPS[sport]?.length ? ` (${PUBLIC_GAPS[sport].join('/')} not compared: the public feed has none)` : '';
  out(`shadow ${sport} ${date}${gap}: slate ${slate.matched.length}/${ours.length} matched by teams (${slate.onlyOurs.length} only ours${slate.onlyOurs.length ? ` ${slate.onlyOurs.join(' ')}` : ''}, ${slate.onlyTheirs.length} only theirs${slate.onlyTheirs.length ? ` ${slate.onlyTheirs.join(' ')}` : ''}, ${slate.statusDiffs.length} status diffs${slate.statusDiffs.length ? `: ${slate.statusDiffs.join('; ')}` : ''}); finals ${games.length}: ${agree} agree, ${games.length - agree} differ`);
  for (const g of games) out(`  ${g.error ? `${g.key}: ${g.error}` : describeLines(g.key, g)}`);
  return { slate, games };
}

/** The live loop's hook: compare each game once as it goes final. */
export async function shadowOnTick(sport, games, { log: out = log } = {}) {
  if (!statheadConfigured()) return 0;
  const pub = publicAdapterFor(sport);
  if (!pub) return 0;
  const sh = statheadAdapter(sport);
  let n = 0;
  for (const g of games ?? []) {
    if (g.status !== 'final' || done.has(`${sport}:${g.gameId}`)) continue;
    done.add(`${sport}:${g.gameId}`);
    try {
      // Their id for our game: the same id where the spaces agree, else by
      // teams on their slate for the date.
      let theirId = g.gameId;
      if (!SAME_IDS.has(sport)) {
        const slate = await sh.schedule(g.gameDate);
        theirId = slate.find((t) => feedTeam(sport, t.away) === feedTeam(sport, g.away) && feedTeam(sport, t.home) === feedTeam(sport, g.home))?.gameId ?? null;
        if (!theirId) { out(`shadow ${sport} ${g.gameDate} ${g.away}@${g.home}: not on Stathead's slate`); continue; }
      }
      const [a, b] = await Promise.all([pub.game(g.gameId), sh.game(theirId)]);
      const c = compareLines(sport, a.lines, b.lines);
      out(`shadow ${sport} ${g.gameDate} final: ${describeLines(`${g.away}@${g.home}`, c)}${b.stored ? ' (theirs stored)' : ''}`);
      n++;
    } catch (e) { out(`shadow ${sport} ${g.gameDate} ${g.away}@${g.home}: ${e.message}`); }
  }
  return n;
}

/** At boot: the fixture days, then yesterday, for each shadowed sport. */
export async function shadowBoot(sports, { log: out = log } = {}) {
  if (!statheadConfigured()) return;
  const FIXTURE_DAYS = { nhl: ['2026-09-29'], mlb: ['2026-09-29'] };
  const y = new Date(Date.now() - 86400e3).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  for (const sport of sports) {
    for (const d of [...(FIXTURE_DAYS[sport] ?? []), y]) {
      try { await shadowDay(sport, d, { log: out, maxGames: 8 }); } catch (e) { out(`shadow ${sport} ${d}: ${e.message}`); }
    }
  }
}
