// ESPN → RealPlay adapter (pilot data spine).
//
// Normalizes ESPN's free/unofficial NFL feed (site.api.espn.com `summary`
// endpoint) into the project's `RealPlay` contract — the SAME per-player,
// slug-keyed, per-play timeline the engine (src/engine/sim.ts) already consumes
// from baked nflverse data (public/pbp/wN.json). The whole point of the contract
// is that only the ADAPTER changes between baked-historical, ESPN-live, and a
// future paid feed; the engine never knows the difference.
//
// Output of `gameToRealPlays(summary)` is `{ [slug]: RealPlay[] }`, mergeable
// across games into a week exactly like the baker's `pbp[week]`.
//
// Network note: only `site.api.espn.com` is reachable in this environment; the
// richer `sports.core.api.espn.com` per-play `participants` (structured athlete
// ids per role) is blocked by egress policy. So attribution is reconstructed
// from each play's `text` ("D.Prescott pass short right to G.Pickens ...") using
// the game's boxscore roster to resolve "F.Last" abbreviations to full names,
// then to our slug via the crosswalk. If core.api is later allowlisted, swap the
// text parser for participants and the rest stays put.

// ── slug helpers (mirror src/data/players.ts normName, but hyphenated like the
// crosswalk keys) ──────────────────────────────────────────────────────────────
export function normName(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
/** normName, hyphen-joined — the form used as the pbp/crosswalk slug key. */
export const slugOf = (raw) => normName(raw).replace(/\s+/g, '-');

// ESPN team abbreviation → nflverse abbreviation (used in K/DST slugs + teams).
// Only the genuine mismatches; everything else is identical.
const TEAM_FIX = { WSH: 'WAS', LAR: 'LAR', JAX: 'JAX', LV: 'LV' };
export const fixTeam = (t) => TEAM_FIX[t] ?? t;

// ── game clock (game-elapsed seconds), identical to scripts/pbp/genRealPbp.mjs ──
export function clockOf(qtr, mmss) {
  const [m, s] = String(mmss).split(':').map(Number);
  const rem = (m || 0) * 60 + (s || 0);
  if (qtr >= 5) return 3600 + (qtr - 5) * 600 + (600 - rem); // OT: 10-min periods
  return Math.max(0, Math.min(3599, (qtr - 1) * 900 + (900 - rem)));
}

// ── build a per-game name resolver from the boxscore ────────────────────────────
// Collects every athlete that appears in any boxscore stat category (both teams)
// and indexes them by their play-text abbreviation ("F.Last"). The play text only
// ever names players who touched the ball / made the tackle, so the boxscore is a
// superset of the names we need to resolve.
const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;
/** "Marvin Harrison Jr." -> "M.Harrison" (suffix dropped, as play text writes it). */
function abbrevOf(displayName) {
  const dn = displayName.replace(SUFFIX, '');
  const parts = dn.split(/\s+/);
  return `${parts[0][0]}.${parts.slice(1).join(' ')}`;
}

// `resolveSlug(displayName)` maps an ESPN athlete name to the contract slug. The
// default is name-derived (slugOf); pass a crosswalk/Sleeper-id-backed resolver
// (see validate.mjs / the production Sleeper espn_id join) to be robust to
// nickname variants ("Joshua Palmer" vs "Josh Palmer").
export function buildRoster(summary, resolveSlug = slugOf) {
  const byAbbrev = new Map(); // "D.Prescott" -> { name, team, slug }
  const teams = summary?.boxscore?.players ?? [];
  for (const tm of teams) {
    const team = fixTeam(tm?.team?.abbreviation ?? '');
    for (const cat of tm?.statistics ?? []) {
      for (const a of cat?.athletes ?? []) {
        const dn = a?.athlete?.displayName;
        if (!dn) continue;
        const abbr = abbrevOf(dn); // "Dak Prescott" -> "D.Prescott"
        if (!byAbbrev.has(abbr)) byAbbrev.set(abbr, { name: dn, team, slug: resolveSlug(dn) || slugOf(dn) });
      }
    }
  }
  // Anchor matching to the actual roster: a regex alternation of every known
  // abbreviation (longest first, so "A.St. Brown" wins over "A.St"). This never
  // mis-grabs a verb the way a generic "F.Last" token would.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const abbrs = [...byAbbrev.keys()].sort((a, b) => b.length - a.length).map(esc);
  byAbbrev._re = abbrs.length ? new RegExp(`(?:${abbrs.join('|')})`, 'g') : /$^/g;
  return byAbbrev;
}

/** Ordered roster-name hits in `text`: [{ abbr, idx }] by position. */
function findNames(text, roster) {
  const re = roster._re; re.lastIndex = 0;
  const hits = []; let m;
  while ((m = re.exec(text))) hits.push({ abbr: m[0], idx: m.index });
  return hits;
}
const reFG = /(\d+)\s+yard field goal/;

// ── normalize one ESPN play into zero or more { slug, play } RealPlay rows ──────
// `gameStartMs` is the game's earliest wallclock (ms) — `t` is seconds since it.
export function playToRows(p, roster, eventId, gameStartMs) {
  const out = [];
  const typeText = p?.type?.text ?? '';
  const text = p?.text ?? '';
  const qtr = p?.period?.number ?? 1;
  const mmss = p?.clock?.displayValue ?? '15:00';
  const c = clockOf(Number(qtr), mmss);
  const wm = Date.parse(p?.wallclock ?? '');
  const t = Number.isFinite(wm) && gameStartMs != null
    ? Math.max(0, Math.round((wm - gameStartMs) / 1000)) : null;
  const idStr = String(p?.id ?? '');
  const pid = idStr.startsWith(String(eventId)) ? Number(idStr.slice(String(eventId).length)) : null;
  const ride = { ...(t != null ? { t } : {}), ...(pid != null ? { pid } : {}) };
  const yds = Number(p?.statYardage ?? 0) || 0;
  const isTD = !!p?.scoringPlay && /TOUCHDOWN/i.test(text);
  const offTeam = fixTeam(offenseAbbr(p, summaryTeamCache));
  const names = findNames(text, roster);
  const resolve = (abbr) => roster.get(abbr);
  // First roster name at/after a marker substring (e.g. "to ", "sacked").
  const nameAfter = (marker) => {
    const i = text.indexOf(marker); if (i < 0) return null;
    const h = names.find((n) => n.idx >= i); return h ? resolve(h.abbr) : null;
  };
  // Last roster name strictly before a marker substring.
  const nameBefore = (marker) => {
    const i = text.indexOf(marker); if (i < 0) return null;
    let h = null; for (const n of names) { if (n.idx < i) h = n; else break; }
    return h ? resolve(h.abbr) : null;
  };
  // Whoever fumbled: the roster name immediately before "FUMBLES".
  const fumblerR = nameBefore('FUMBLES');
  const fumbler = fumblerR ? fumblerR.slug : null;
  // Trust the play TYPE, not the text, for interceptions: reversed-on-replay picks
  // and 2-point-conversion picks still say "INTERCEPTED" in the text but are typed
  // "Pass Incompletion" / "… Touchdown" and are NOT defensive turnovers.
  const isInt = typeText.includes('Interception');

  if (typeText === 'Rush' || typeText === 'Rushing Touchdown') {
    const r = names[0] && resolve(names[0].abbr); // ball-carrier is the first name
    if (r) out.push({ slug: r.slug, play: row(c, ride, 'rush', yds, isTD ? 1 : 0, 0, 0, fumbler === r.slug ? 1 : 0) });
  } else if (typeText === 'Pass Reception' || typeText === 'Passing Touchdown') {
    const passer = nameBefore(' pass');
    const recv = nameAfter(' to ');
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', yds, isTD ? 1 : 0, 0, 0, fumbler === passer.slug ? 1 : 0) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'rec', yds, isTD ? 1 : 0, 1, 1, fumbler === recv.slug ? 1 : 0) });
  } else if (typeText === 'Pass Incompletion') {
    const passer = nameBefore(' pass');
    const recv = nameAfter(' to '); // absent on a throwaway
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, 0) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'incomplete', 0, 0, 0, 1, 0) });
  } else if (isInt) {
    // Interception (return / return-TD): passer threw it (pass y=0, turnover); the
    // intended receiver gets a target (incomplete); the TD, if any, is the defense's.
    const passer = nameBefore(' pass');
    const recv = nameAfter('intended for');
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, 1) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'incomplete', 0, 0, 0, 1, 0) });
  } else if (typeText.startsWith('Sack')) {
    const passer = nameBefore(' sacked');
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, fumbler === passer.slug ? 1 : 0) });
  }

  // Kicker — FG (own play, incl. missed/blocked) + XP (rides inside a TD play).
  // Attribute by the KICKER's team (the kicker is always named in the text), which
  // is more robust than the play's offense id (some scoring plays omit team ids).
  const kTeam = (kicker) => fixTeam(kicker?.team || offTeam);
  if (typeText.startsWith('Field Goal') || typeText === 'Blocked Field Goal') {
    const m = reFG.exec(text);
    const team = kTeam(names[0] && resolve(names[0].abbr)); // kicker is the first name
    if (m && team) out.push({ slug: `${team.toLowerCase()}-k`, play: row(c, ride, /\bGOOD\b/.test(text) ? 'fg' : 'fgmiss', Number(m[1]) || 0, 0, 0, 0, 0) });
  }
  if (/extra point/i.test(text)) {
    const team = kTeam(nameBefore(' extra point'));
    if (team) out.push({ slug: `${team.toLowerCase()}-k`, play: row(c, ride, /extra point is GOOD/i.test(text) ? 'xp' : 'xpmiss', 0, 0, 0, 0, 0) });
  }

  // Kick/punt RETURN yards (the `return` kind, for the retyd metric). The return
  // clause is "<returner> ... for N yards" (kick/punt DISTANCE is "yards from/to",
  // never "for N yards"), so a lone "for N yards" is the return. Touchbacks / fair
  // catches have none. Returner is the last roster name before that "for".
  if (typeText === 'Kickoff' || typeText === 'Punt' ||
      typeText === 'Punt Return Touchdown' || typeText === 'Kickoff Return Touchdown') {
    const rm = /\bfor (\d+) yards?/.exec(text);
    if (rm) {
      // Returner = last roster name before the "for N yards" return clause. The
      // kicker is named earlier ("X kicks/punts ..."), so the later name wins.
      let h = null; for (const n of names) if (n.idx < rm.index) h = n; else break;
      const returner = h ? resolve(h.abbr) : null;
      if (returner) out.push({ slug: returner.slug, play: row(c, ride, 'return', Number(rm[1]) || 0, /TOUCHDOWN/i.test(text) ? 1 : 0, 0, 0, 0) });
    }
  }

  // Team defense — sack / INT / fumble recovery / def(+ST) TD / safety, keyed by
  // the DEFENSE (the team NOT on offense for this play).
  const defTeam = fixTeam(defenseAbbr(p, summaryTeamCache));
  if (defTeam) {
    const d = `${defTeam.toLowerCase()}-dst`;
    if (typeText.startsWith('Sack')) out.push({ slug: d, play: row(c, ride, 'sack', 0, 0, 0, 0, 0) });
    if (isInt) out.push({ slug: d, play: row(c, ride, 'int', 0, 0, 0, 0, 0) });
    if (p?.isTurnover && /FUMBLE/i.test(text) && /RECOVERED by/i.test(text)) out.push({ slug: d, play: row(c, ride, 'fumrec', 0, 0, 0, 0, 0) });
    if (typeText !== 'Penalty' && /\bSAFETY\b/.test(text)) out.push({ slug: d, play: row(c, ride, 'safety', 0, 0, 0, 0, 0) });
    // Defensive / special-teams TD (INT-return, fumble-return, punt/kick-return):
    // scored by the team on defense for this play (matches the baker's td_team===defteam).
    if (/Return Touchdown$/.test(typeText)) out.push({ slug: d, play: row(c, ride, 'dst_td', 0, 0, 0, 0, 0) });
  }
  return out;
}

function row(c, ride, k, y, td, ca, tg, to) {
  return { c, ...ride, k, y, td, ca, tg, ...(to ? { to: 1 } : {}) };
}

// Offense/defense team abbreviations for a play. ESPN's `start.team.id` is the
// offense; `teamParticipants` carries offense/defense ids. We map id->abbr from a
// per-summary cache populated by `gameToRealPlays`.
let summaryTeamCache = new Map();
function offenseAbbr(p, cache) {
  const id = p?.start?.team?.id ?? p?.teamParticipants?.find((x) => x.type === 'offense')?.id;
  return cache.get(String(id)) ?? '';
}
function defenseAbbr(p, cache) {
  const id = p?.teamParticipants?.find((x) => x.type === 'defense')?.id;
  return cache.get(String(id)) ?? '';
}

// ── whole-game entry point ──────────────────────────────────────────────────────
/** Normalize one ESPN `summary` payload into { slug: RealPlay[] } for the game. */
export function gameToRealPlays(summary, resolveSlug = slugOf) {
  const roster = buildRoster(summary, resolveSlug);
  // id -> abbr (from the header competitors), for offense/defense resolution.
  summaryTeamCache = new Map();
  for (const c of summary?.header?.competitions?.[0]?.competitors ?? []) {
    summaryTeamCache.set(String(c?.id ?? c?.team?.id), fixTeam(c?.team?.abbreviation ?? ''));
  }
  const eventId = summary?.header?.id ?? summary?.boxscore?.teams?.[0]?.team?.id ?? '';
  const drives = summary?.drives?.previous ?? [];
  const allPlays = [];
  for (const dr of drives) for (const p of dr?.plays ?? []) allPlays.push(p);
  if (summary?.drives?.current?.plays) for (const p of summary.drives.current.plays) allPlays.push(p);
  // game start wallclock = earliest play wallclock
  let startMs = Infinity;
  for (const p of allPlays) { const ms = Date.parse(p?.wallclock ?? ''); if (Number.isFinite(ms) && ms < startMs) startMs = ms; }
  const gameStartMs = Number.isFinite(startMs) ? startMs : null;

  const pbp = {};
  for (const p of allPlays) {
    for (const { slug, play } of playToRows(p, roster, eventId, gameStartMs)) {
      (pbp[slug] ||= []).push(play);
    }
  }
  for (const slug of Object.keys(pbp)) pbp[slug].sort((a, b) => a.c - b.c);
  return pbp;
}
