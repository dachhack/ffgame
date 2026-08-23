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

// ESPN team abbreviation → the SLATE's codes (v0.344.0). This is the same
// table as slugMeta.normTeam and scoreboard.js's TEAM_FIX, and the three MUST
// agree: every team string this adapter emits — game_feed away/home/key, the
// teams index, each play's `tm`, and the K/DST slugs in live_play — is compared
// somewhere against a slate/slugMeta code ('LA', 'WAS', 'JAX').
//
// The old map kept LAR as LAR ("nflverse abbreviation"), which put the whole
// live feed in a different vocabulary from everything it meets: gameFeedFor
// lookups by a player's slugMeta team missed every Rams game (no per-player
// field, possession gating fell to its ungated fallback), the box score's team
// filter dropped the entire LAR column ("weird that only saints have stats?"),
// window-pot settlement's game_feed.home = nfl_slate.home compare (0117) never
// matched a Rams game, and the adapter's 'lar-k' never matched the picks'
// 'la-k'. One vocabulary now; the client additionally accepts the old codes
// (gameFeed widenTeams) for the baked 2025 docs and rows written before this.
const TEAM_FIX = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LA', AZ: 'ARI' };
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
        // The ESPN athlete id rides along (0200): an id-aware resolver matches
        // by id FIRST — the athlete in THIS game, not whoever shares the name —
        // and one-arg resolvers (slugOf, the validators) just ignore it.
        // The TEAM rides along too (v0.345.0), for the case the id cannot
        // answer: 646 of the 647 players in Sleeper's 2026 rookie class carry
        // no espn_id, so the whole class resolves by name — and a name is only
        // ambiguous until you know which club it just played for.
        if (!byAbbrev.has(abbr)) byAbbrev.set(abbr, { name: dn, team, slug: resolveSlug(dn, a?.athlete?.id ?? null, team) || slugOf(dn) });
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
  // First down gained (0166): a scrimmage play that covered the distance —
  // TDs count, nflverse-style. Turnovers never award one; down 0 = free kicks.
  const dn = Number(p?.start?.down ?? 0) || 0;
  const dist = Number(p?.start?.distance ?? 0) || 0;
  const fd = dn > 0 && dist > 0 && yds >= dist && !p?.isTurnover ? { fd: 1 } : undefined;
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

  // Truth flags (0166) ride on the QB row — the adapter is branch-aware here,
  // so cp/ic/sk are exact: exactly one of them on every flag-aware dropback.
  if (typeText === 'Rush' || typeText === 'Rushing Touchdown') {
    const r = names[0] && resolve(names[0].abbr); // ball-carrier is the first name
    if (r) out.push({ slug: r.slug, play: row(c, ride, 'rush', yds, isTD ? 1 : 0, 0, 0, fumbler === r.slug ? 1 : 0, fd) });
  } else if (typeText === 'Pass Reception' || typeText === 'Passing Touchdown') {
    const passer = nameBefore(' pass');
    const recv = nameAfter(' to ');
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', yds, isTD ? 1 : 0, 0, 0, fumbler === passer.slug ? 1 : 0, { cp: 1, ...fd }) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'rec', yds, isTD ? 1 : 0, 1, 1, fumbler === recv.slug ? 1 : 0, fd) });
  } else if (typeText === 'Pass Incompletion') {
    const passer = nameBefore(' pass');
    const recv = nameAfter(' to '); // absent on a throwaway
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, 0, { ic: 1 }) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'incomplete', 0, 0, 0, 1, 0) });
  } else if (isInt) {
    // Interception (return / return-TD): passer threw it (pass y=0, turnover); the
    // intended receiver gets a target (incomplete); the TD, if any, is the defense's.
    // An INT is a pass ATTEMPT and an incompletion in the books — ic rides along;
    // a pick returned for a TD marks the passer's row p6 (0170) — never `td`, so
    // no TD points can ever fire on a pick thrown.
    const passer = nameBefore(' pass');
    const recv = nameAfter('intended for');
    const p6 = /Return Touchdown$/.test(typeText) ? { ic: 1, p6: 1 } : { ic: 1 };
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, 1, p6) });
    if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'incomplete', 0, 0, 0, 1, 0) });
  } else if (typeText.startsWith('Sack')) {
    const passer = nameBefore(' sacked');
    if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'pass', 0, 0, 0, 0, fumbler === passer.slug ? 1 : 0, { sk: 1 }) });
  }

  // Head coach conversions (0171): a converted 3rd/4th down is the offense
  // coach's play — rows on the "xxx-hc" pseudo-player.
  if (fd && (dn === 3 || dn === 4) && offTeam) {
    out.push({ slug: `${offTeam.toLowerCase()}-hc`, play: row(c, ride, dn === 3 ? 'hc_3dc' : 'hc_4dc', 0, 0, 0, 0, 0) });
  }

  // 2-pt conversions (0166) ride inside the scoring play's text ("TWO-POINT
  // CONVERSION ATTEMPT. X pass to Y is complete. ATTEMPT SUCCEEDS."). Only
  // successes emit rows, as their OWN kinds (tp_*) with zero yards and ca:0 —
  // distinct on live_play's (pid,slug,k) key from the same play's TD row, paid
  // only by the classic 2-pt knob, invisible to every drip metric.
  const tpi = text.search(/TWO-POINT CONVERSION ATTEMPT/i);
  if (tpi >= 0 && /ATTEMPT SUCCEEDS/i.test(text)) {
    const seg = names.filter((n) => n.idx > tpi);
    const passIdx = text.indexOf(' pass', tpi);
    if (passIdx > tpi && seg.length) {
      const passer = seg[0].idx < passIdx ? resolve(seg[0].abbr) : null;
      const recvHit = seg.find((n) => n.idx > passIdx);
      const recv = recvHit ? resolve(recvHit.abbr) : null;
      if (passer) out.push({ slug: passer.slug, play: row(c, ride, 'tp_pass', 0, 0, 0, 0, 0) });
      if (recv) out.push({ slug: recv.slug, play: row(c, ride, 'tp_rec', 0, 0, 0, 0, 0) });
    } else if (seg.length) {
      const runner = resolve(seg[0].abbr);
      if (runner) out.push({ slug: runner.slug, play: row(c, ride, 'tp_rush', 0, 0, 0, 0, 0) });
    }
    // The coach's team 2-pt conversion (0171).
    if (offTeam) out.push({ slug: `${offTeam.toLowerCase()}-hc`, play: row(c, ride, 'hc_2pt', 0, 0, 0, 0, 0) });
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
      // rk (0167) splits the KR/PR yardage knobs; retYd still scores combined.
      let h = null; for (const n of names) if (n.idx < rm.index) h = n; else break;
      const returner = h ? resolve(h.abbr) : null;
      const rk = typeText.startsWith('Kickoff') ? 'kr' : 'pr';
      if (returner) out.push({ slug: returner.slug, play: row(c, ride, 'return', Number(rm[1]) || 0, /TOUCHDOWN/i.test(text) ? 1 : 0, 0, 0, 0, { rk }) });
    }
  }

  // Punter rows (0167 groundwork): distance-keyed like the kicker's FG rows,
  // on the team pseudo-player "xxx-p". No knob scores them until position P
  // exists — the data just starts accumulating now.
  if (typeText === 'Punt' || typeText === 'Blocked Punt' || typeText === 'Punt Return Touchdown') {
    const pm = /\bpunts (\d+) yards?/.exec(text);
    if (pm && offTeam) out.push({ slug: `${offTeam.toLowerCase()}-p`, play: row(c, ride, 'punt', Number(pm[1]) || 0, 0, 0, 0, 0) });
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
    // Blocked punt / PAT / FG (0167) — the blocking defense's play.
    if (typeText.startsWith('Blocked') || /is BLOCKED/i.test(text)) out.push({ slug: d, play: row(c, ride, 'blk', 0, 0, 0, 0, 0) });
    // Team forced fumble (0168): "FUMBLES (M.Parsons)" names the forcer.
    if (/FUMBLES\s*\(/.test(text)) out.push({ slug: d, play: row(c, ride, 'ff', 0, 0, 0, 0, 0) });
  }

  // ── Individual defender attribution (0168) ─────────────────────────────────
  // ESPN's play text ends with the tacklers in parentheses — "(M.Parsons)" is a
  // solo, "(K.Elam; T.Bernard)" a split. Solo/assist, TFL (negative-yard
  // scrimmage plays), individual sack credit (halved when split), forced
  // fumbles, INTs and fumble recoveries all resolve through the same boxscore
  // roster as everything else. QB hits and passes defended are NOT parsed —
  // live text doesn't carry them reliably; those knobs wait for the nflverse
  // true-up loop (docs/play-feed-enrichment-scope.md, Phase 3 decision).
  const isScrim = typeText === 'Rush' || typeText === 'Rushing Touchdown'
    || typeText === 'Pass Reception' || typeText === 'Passing Touchdown' || typeText.startsWith('Sack');
  const isStPlay = typeText === 'Kickoff' || typeText === 'Punt'
    || typeText === 'Punt Return Touchdown' || typeText === 'Kickoff Return Touchdown';
  if ((isScrim || isStPlay) && !isTD) {
    const pm = /\(([^()]+)\)\s*\.?\s*$/.exec(text);
    if (pm) {
      const start = text.lastIndexOf(pm[1]);
      const hits = names.filter((n) => n.idx >= start && n.idx < start + pm[1].length);
      const solo = hits.length === 1;
      for (const h of hits) {
        const dd = resolve(h.abbr); if (!dd) continue;
        // Coverage tackles (0170) are their own kind — they must not inflate
        // scrimmage tackle counts or the 10+ tackle game bonus.
        out.push({ slug: dd.slug, play: row(c, ride, isStPlay ? 'st_tkl' : 'tackle', 0, 0, 0, 0, 0, { tt: solo ? 's' : 'a' }) });
        if (isScrim && yds < 0 && !typeText.startsWith('Sack')) out.push({ slug: dd.slug, play: row(c, ride, 'tfl', 0, 0, 0, 0, 0) });
        // Sack yards (0170) ride `y` — split credit halves the yardage too.
        if (typeText.startsWith('Sack')) out.push({ slug: dd.slug, play: row(c, ride, 'sack', solo ? Math.abs(yds) : Math.round(Math.abs(yds) / 2), 0, 0, 0, 0, solo ? undefined : { hf: 1 }) });
      }
    }
  }
  // Forced fumble — the name inside "FUMBLES (…)".
  const ffm = /FUMBLES\s*\(([^()]+)\)/.exec(text);
  if (ffm) {
    const start = text.indexOf(ffm[1], ffm.index);
    for (const h of names.filter((n) => n.idx >= start && n.idx < start + ffm[1].length)) {
      const dd = resolve(h.abbr);
      if (dd) out.push({ slug: dd.slug, play: row(c, ride, 'ff', 0, 0, 0, 0, 0) });
    }
  }
  // Return yards after a takeaway (0170): the "for N yards" clause AFTER the
  // takeaway marker — never the scrimmage clause earlier in the text.
  const retYdsAfter = (marker) => {
    const i = text.indexOf(marker); if (i < 0) return 0;
    const ms = [...text.matchAll(/\bfor (\d+) yards?/g)].filter((m) => m.index > i);
    return ms.length ? Number(ms[ms.length - 1][1]) || 0 : 0;
  };
  const retTd = /Return Touchdown$/.test(typeText);
  // Individual INT + fumble recovery credit — with return yards, the return-TD
  // flag, and (0170) the individual defensive TD row for the scorer.
  if (isInt) {
    const dd = nameAfter('INTERCEPTED by');
    if (dd) {
      out.push({ slug: dd.slug, play: row(c, ride, 'int', retYdsAfter('INTERCEPTED by'), retTd ? 1 : 0, 0, 0, 0) });
      if (retTd) out.push({ slug: dd.slug, play: row(c, ride, 'dst_td', 0, 0, 0, 0, 0) });
    }
  }
  if (p?.isTurnover && /RECOVERED by/.test(text)) {
    const dd = nameAfter('RECOVERED by');
    if (dd) {
      out.push({ slug: dd.slug, play: row(c, ride, 'fumrec', retYdsAfter('RECOVERED by'), retTd && !isInt ? 1 : 0, 0, 0, 0) });
      if (retTd && !isInt) out.push({ slug: dd.slug, play: row(c, ride, 'dst_td', 0, 0, 0, 0, 0) });
    }
  }
  // Any fumble by the fumbler (0170) — kept or lost; 'to' still marks lost.
  if (fumblerR) out.push({ slug: fumblerR.slug, play: row(c, ride, 'fum', 0, 0, 0, 0, 0) });
  // Own-team fumble-recovery TD (0170): a recovery on a NON-turnover play that
  // scored — the recoverer takes the TD.
  if (!p?.isTurnover && /RECOVERED by/.test(text) && isTD) {
    const dd = nameAfter('RECOVERED by');
    if (dd) out.push({ slug: dd.slug, play: row(c, ride, 'frtd', 0, 0, 0, 0, 0) });
  }
  return out;
}

function row(c, ride, k, y, td, ca, tg, to, fl) {
  return { c, ...ride, k, y, td, ca, tg, ...(to ? { to: 1 } : {}), ...(fl || {}) };
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

// ── game feed (field visuals) ───────────────────────────────────────────────────
// Normalizes the SAME summary payload into the per-game GamePlay[] contract that
// drives FieldView/FieldBoard (src/data/gameFeed.ts): every scrimmage play with
// down/distance/start-end yards-to-endzone/possession/text/score. Used by the
// baker (scripts/pbp/genGameFeed.mjs) and the live poller (server poll/plays.js)
// so replay and live render identically.

// Clock-management rows carry no field situation — the visual skips them.
const SKIP_TYPES = new Set([
  'Timeout', 'Official Timeout', 'Two-minute warning', 'End Period',
  'End of Half', 'End of Game', 'Coin Toss',
]);

// Yards-to-endzone for a situation, from the perspective of the team named in
// `abbrs` (the situation's own team). ESPN's numeric `yardsToEndzone` is flipped
// on a small share of plays (e.g. a 4th & 19 punt at "TEN 25" carrying yte 25
// instead of 75); `possessionText` ("TEN 25" / "50") matches the broadcast spot
// and is authoritative, so parse it first and fall back to the number.
function yteOf(sit, abbrs) {
  const yte = Number(sit?.yardsToEndzone ?? 0) || 0;
  const pt = String(sit?.possessionText ?? '').trim();
  if (pt === '50') return 50;
  const m = /^([A-Z]{2,4})\s+(\d{1,2})$/.exec(pt);
  if (!m) return yte;
  const n = Number(m[2]);
  return abbrs.has(m[1]) ? 100 - n : n;
}

/** One ESPN summary → [gameKey, [away, home], GamePlay[]] (null if no drives yet). */
export function gameToFeed(summary) {
  const comp = summary?.header?.competitions?.[0];
  const byId = new Map();   // competitor id -> nflverse abbr
  const abbrsOf = new Map(); // competitor id -> Set of raw + fixed abbrs (possessionText matching)
  let home = '', away = '';
  for (const c of comp?.competitors ?? []) {
    const raw = c?.team?.abbreviation ?? '';
    const abbr = fixTeam(raw);
    const id = String(c?.id ?? c?.team?.id);
    byId.set(id, abbr);
    abbrsOf.set(id, new Set([raw, abbr]));
    if (c?.homeAway === 'home') home = abbr; else if (c?.homeAway === 'away') away = abbr;
  }
  if (!home || !away) return null;
  const eventId = summary?.header?.id ?? '';

  const drives = [...(summary?.drives?.previous ?? [])];
  if (summary?.drives?.current?.plays) drives.push(summary.drives.current);
  const all = [];
  for (let d = 0; d < drives.length; d++) for (const p of drives[d]?.plays ?? []) all.push([d, p]);
  if (!all.length) return null;

  let startMs = Infinity;
  for (const [, p] of all) { const ms = Date.parse(p?.wallclock ?? ''); if (Number.isFinite(ms) && ms < startMs) startMs = ms; }

  const plays = [];
  for (const [drv, p] of all) {
    const ty = p?.type?.text ?? '';
    const tm = byId.get(String(p?.start?.team?.id ?? ''));
    if (SKIP_TYPES.has(ty) || !tm) continue;
    const c = clockOf(Number(p?.period?.number ?? 1), p?.clock?.displayValue ?? '15:00');
    const wm = Date.parse(p?.wallclock ?? '');
    const t = Number.isFinite(wm) && Number.isFinite(startMs) ? Math.max(0, Math.round((wm - startMs) / 1000)) : null;
    const idStr = String(p?.id ?? '');
    const pid = idStr.startsWith(String(eventId)) ? Number(idStr.slice(String(eventId).length)) : null;
    plays.push({
      c, ...(t != null ? { t } : {}), ...(pid != null ? { pid } : {}),
      drv, tm,
      ...(() => { const t2 = byId.get(String(p?.end?.team?.id ?? '')); return t2 && t2 !== tm ? { tm2: t2 } : {}; })(),
      dn: Number(p?.start?.down ?? 0) || 0,
      dist: Number(p?.start?.distance ?? 0) || 0,
      yl: yteOf(p?.start, abbrsOf.get(String(p?.start?.team?.id ?? '')) ?? new Set()),
      yl2: yteOf(p?.end ?? p?.start, abbrsOf.get(String(p?.end?.team?.id ?? p?.start?.team?.id ?? '')) ?? new Set()),
      ty, txt: p?.text ?? '',
      // Yards after catch (receptions only) — lets the field visual split a
      // completed pass into its air arc + the flat run-after segment.
      ...(p?.yardsAfterCatch != null && Number.isFinite(Number(p.yardsAfterCatch)) ? { yac: Number(p.yardsAfterCatch) } : {}),
      // Return yards on kicks/punts (same clause the retyd metric parses: the
      // lone "for N yards" is the return — kick DISTANCE is "yards from/to").
      // Lets the field split the kick arc from the runback line.
      ...(() => {
        if (ty === 'Kickoff' || ty === 'Punt' || ty === 'Punt Return Touchdown' || ty === 'Kickoff Return Touchdown') {
          const rm = /\bfor (\d+) yards?/.exec(p?.text ?? '');
          if (rm) return { ret: Number(rm[1]) || 0 };
        }
        return {};
      })(),
      ...(p?.scoringPlay ? { sc: 1 } : {}),
      ...(p?.isPenalty ? { pen: 1 } : {}),
      ...(p?.isTurnover ? { to: 1 } : {}),
      hs: Number(p?.homeScore ?? 0) || 0,
      as: Number(p?.awayScore ?? 0) || 0,
    });
  }
  // ESPN re-emits the SAME play under a fresh id when it restructures drives
  // (observed live at the 2026 preseason opener, at halftime): same clock,
  // same text, new pid and drive index. This is the whole-doc feed the worker
  // persists to game_feed, so without this the duplicate is stored forever and
  // every consumer must dedupe for itself (the web game log already does, on
  // exactly this key — keep that as belt and braces for docs written before
  // this shipped). Identity is (clock, text); the LAST copy wins because the
  // re-listed play is the restructured revision.
  const byIdent = new Map();
  for (const p of plays) byIdent.set(`${p.c}|${p.txt}`, p);
  const uniq = [...byIdent.values()];
  uniq.sort((a, b) => a.c - b.c || (a.pid ?? 0) - (b.pid ?? 0));
  return [`${away}@${home}`, [away, home], uniq];
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

  // Team brackets (0167): once the game is FINAL, each defense gets one `pa`
  // (points allowed = opponent's final score) and one `ya` (opponent total
  // yards, from the boxscore) game-summary row. Stable synthetic pids keep the
  // per-poll live_play reconcile idempotent; before final, the rows simply
  // don't exist, so brackets never score a game in progress.
  const comp2 = summary?.header?.competitions?.[0];
  if (comp2?.status?.type?.completed) {
    const score = new Map(); let homeAb = '', awayAb = '';
    for (const cmt of comp2?.competitors ?? []) {
      const a = fixTeam(cmt?.team?.abbreviation ?? '');
      score.set(a, Number(cmt?.score ?? 0) || 0);
      if (cmt?.homeAway === 'home') homeAb = a; else if (cmt?.homeAway === 'away') awayAb = a;
    }
    const yardsOf = new Map();
    for (const tb of summary?.boxscore?.teams ?? []) {
      const a = fixTeam(tb?.team?.abbreviation ?? '');
      const ty = (tb?.statistics ?? []).find((s) => s?.name === 'totalYards');
      const v = Number(ty?.displayValue ?? NaN);
      if (Number.isFinite(v)) yardsOf.set(a, v);
    }
    let maxC = 0;
    for (const arr of Object.values(pbp)) for (const p of arr) if (p.c > maxC) maxC = p.c;
    for (const [me, opp] of [[homeAb, awayAb], [awayAb, homeAb]]) {
      if (!me || !opp) continue;
      const d = `${me.toLowerCase()}-dst`;
      (pbp[d] ||= []).push({ c: maxC, pid: 900000001, k: 'pa', y: score.get(opp) ?? 0, td: 0, ca: 0, tg: 0 });
      if (yardsOf.has(opp)) (pbp[d] ||= []).push({ c: maxC, pid: 900000002, k: 'ya', y: yardsOf.get(opp), td: 0, ca: 0, tg: 0 });
      // Head coach result rows (0171): signed margin + points scored.
      const hc = `${me.toLowerCase()}-hc`;
      (pbp[hc] ||= []).push({ c: maxC, pid: 900000003, k: 'hc_res', y: (score.get(me) ?? 0) - (score.get(opp) ?? 0), td: 0, ca: 0, tg: 0 });
      (pbp[hc] ||= []).push({ c: maxC, pid: 900000004, k: 'hc_pts', y: score.get(me) ?? 0, td: 0, ca: 0, tg: 0 });
    }
  }

  for (const slug of Object.keys(pbp)) pbp[slug].sort((a, b) => a.c - b.c);
  return pbp;
}
