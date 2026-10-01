// THE DEVY PLAYER CARD (0406) — everything a college player's card shows, as
// pure parsers over ESPN's public athlete endpoints plus StatHead's devy
// profile, so the web modal and the native sheet render the same answer.
//
// WHERE IT COMES FROM. What changes by the game is read from ESPN when the card
// opens — CORS-open, no key, keyed by the ESPN athlete id the slug already
// carries (c-<espn_id>):
//   · the core athlete record (~5 KB): height, weight, hometown, class, jersey;
//   · the athlete overview: a stat line for every college season, his news,
//     and the next game;
//   · the season game log, fetched only when its tab is opened.
// What is OURS comes from college_player_card (0406): the devy market price
// and StatHead's devy profile — composite rank, NFL career projection,
// breakout age, the rookie-draft slot he prices as. Only StatHead numbers are
// shown; no third-party rank or value is.
//
// FANTASY POINTS on the card are PPR (1 a catch, 0.1 a yard, 6 a touchdown,
// 0.04 a passing yard, 4 a passing TD, −2 an interception or lost fumble) —
// the same line college_directory ranks by, so the card agrees with the pool.

import type { CollegePlayerCard } from './liveApi';

export type DevyFormat = '1qb' | 'sf';

export interface CollegeBio {
  height: string | null; weight: string | null; hometown: string | null;
  classLabel: string | null; jersey: string | null; headshot: string | null; active: boolean;
}
export interface CollegeSeasonRow { season: string; line: string; pts: number | null }
export interface CollegeGameRow {
  id: string; week: number | null; date: string | null; opp: string | null; atVs: string | null;
  result: string | null; score: string | null; line: string; pts: number;
}
export interface CollegeNewsItem { id: string; headline: string; at: string | null; url: string | null; blurb: string | null }
export interface CollegeNextGame { date: string | null; name: string | null; short: string | null }
export interface CollegeOverview { seasons: CollegeSeasonRow[]; news: CollegeNewsItem[]; next: CollegeNextGame | null }

const BASE = 'https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/athletes';

/** The college season a moment belongs to: August on is the new one. */
export function collegeSeasonOf(at: Date = new Date()): number {
  return at.getUTCMonth() >= 7 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
}

/** ESPN prints numbers as strings, with thousands separators and '-' for none. */
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** A name → value map from ESPN's parallel `names` and `stats` arrays. */
export function statMap(names: readonly string[] | undefined, stats: readonly unknown[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  (names ?? []).forEach((n, i) => { out[n] = num(stats?.[i]); });
  return out;
}

/** PPR points for one line (see the header). */
export function collegePprPoints(m: Record<string, number>): number {
  const p = (m.passingYards ?? 0) * 0.04 + (m.passingTouchdowns ?? 0) * 4 - (m.interceptions ?? 0) * 2
    + (m.rushingYards ?? 0) * 0.1 + (m.rushingTouchdowns ?? 0) * 6
    + (m.receptions ?? 0) + (m.receivingYards ?? 0) * 0.1 + (m.receivingTouchdowns ?? 0) * 6
    - (m.fumblesLost ?? 0) * 2;
  return Math.round(p * 10) / 10;
}

/** A stat line in the position's own order — what a scout reads first. */
export function collegeStatLine(pos: string, m: Record<string, number>): string {
  const pass = (m.passingAttempts ?? 0) > 0
    ? `${m.completions ?? 0}/${m.passingAttempts} ${m.passingYards ?? 0} yd ${m.passingTouchdowns ?? 0} TD ${m.interceptions ?? 0} INT` : null;
  const rush = (m.rushingAttempts ?? 0) > 0 || (m.rushingYards ?? 0) !== 0
    ? `${m.rushingAttempts ?? 0} ru ${m.rushingYards ?? 0} yd${m.rushingTouchdowns ? ` ${m.rushingTouchdowns} TD` : ''}` : null;
  const rec = (m.receptions ?? 0) > 0 || (m.receivingYards ?? 0) !== 0
    ? `${m.receptions ?? 0} rec ${m.receivingYards ?? 0} yd${m.receivingTouchdowns ? ` ${m.receivingTouchdowns} TD` : ''}` : null;
  const order = pos === 'QB' ? [pass, rush, rec] : pos === 'RB' ? [rush, rec, pass] : [rec, rush, pass];
  return order.filter(Boolean).join(' · ') || 'no offensive stats';
}

/** The core athlete record → the bio strip. */
export function parseCollegeBio(a: any): CollegeBio {
  const bp = a?.birthPlace;
  return {
    height: a?.displayHeight ?? null,
    weight: a?.displayWeight ?? null,
    hometown: bp ? [bp.city, bp.state].filter(Boolean).join(', ') || null : null,
    classLabel: a?.experience?.abbreviation ?? null,
    jersey: a?.jersey != null ? String(a.jersey) : null,
    headshot: a?.headshot?.href ?? null,
    active: (a?.status?.type ?? 'active') === 'active',
  };
}

/** The overview → every college season, his news, and the next game. */
export function parseCollegeOverview(o: any, pos: string): CollegeOverview {
  const st = o?.statistics;
  const seasons: CollegeSeasonRow[] = (st?.splits ?? [])
    .filter((s: any) => /^\d{4}$/.test(String(s?.displayName ?? '')))
    .map((s: any) => {
      const m = statMap(st.names, s.stats);
      return { season: String(s.displayName), line: collegeStatLine(pos, m), pts: collegePprPoints(m) };
    });
  const news: CollegeNewsItem[] = (o?.news ?? []).slice(0, 8).map((n: any) => ({
    id: String(n?.id ?? n?.headline ?? ''),
    headline: String(n?.headline ?? '').trim(),
    at: n?.published ?? n?.lastModified ?? null,
    url: n?.links?.web?.href ?? null,
    blurb: n?.description ?? null,
  })).filter((n: CollegeNewsItem) => n.headline);
  const ev = o?.nextGame?.league?.events?.[0];
  const next = ev ? { date: ev.date ?? null, name: ev.name ?? null, short: ev.shortName ?? null } : null;
  return { seasons, news, next };
}

/** The season game log → one row a game, newest first. */
export function parseCollegeGameLog(g: any, pos: string): CollegeGameRow[] {
  const byId: Record<string, Record<string, number>> = {};
  for (const t of g?.seasonTypes ?? []) {
    for (const c of t?.categories ?? []) {
      for (const e of c?.events ?? []) byId[String(e.eventId)] = statMap(g.names, e.stats);
    }
  }
  const rows: CollegeGameRow[] = [];
  for (const [id, m] of Object.entries(byId)) {
    const e = g?.events?.[id] ?? {};
    rows.push({
      id, week: Number.isFinite(Number(e.week)) ? Number(e.week) : null, date: e.gameDate ?? null,
      opp: e.opponent?.abbreviation ?? null, atVs: e.atVs ?? null,
      result: e.gameResult ?? null, score: e.score ?? null,
      line: collegeStatLine(pos, m), pts: collegePprPoints(m),
    });
  }
  return rows.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
}

async function getJson(url: string, ms = 12000): Promise<any> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    return await r.json();
  } finally { if (t) clearTimeout(t); }
}

/** Bio and overview together — what the card's first view needs. Either can
 *  fail alone; the card shows what came back. */
export async function loadCollegeEspn(espnId: string, pos: string): Promise<{ bio: CollegeBio | null; overview: CollegeOverview | null }> {
  const [bio, ov] = await Promise.allSettled([getJson(`${CORE}/${espnId}`), getJson(`${BASE}/${espnId}/overview`)]);
  return {
    bio: bio.status === 'fulfilled' ? parseCollegeBio(bio.value) : null,
    overview: ov.status === 'fulfilled' ? parseCollegeOverview(ov.value, pos) : null,
  };
}

/** This season's games, for the GAME LOG tab. */
export async function loadCollegeGameLog(espnId: string, pos: string, season = collegeSeasonOf()): Promise<CollegeGameRow[]> {
  return parseCollegeGameLog(await getJson(`${BASE}/${espnId}/gamelog?season=${season}`), pos);
}

// ── StatHead's evaluation ───────────────────────────────────────────────────
/** One labelled line of the EVALUATION panel. */
export interface EvalRow { label: string; value: string }

const fk = (fmt: DevyFormat) => (fmt === 'sf' ? 'sf' : 'oneQB');
const pick = (v: any, fmt: DevyFormat): any => (v && typeof v === 'object' && !Array.isArray(v) ? v[fk(fmt)] : v);
const pct = (x: unknown) => `${Math.round(Number(x) * 100)}%`;

/** StatHead's devy profile as the EVALUATION panel's lines, in the league's
 *  format (superflex or 1QB). Lines whose data is missing are left out. */
export function statheadEvalRows(card: any, pos: string, fmt: DevyFormat = '1qb'): EvalRow[] {
  if (!card || typeof card !== 'object') return [];
  const out: EvalRow[] = [];
  const rank = pick(card.compositeRank, fmt);
  const posRank = pick(card.compositePosRank, fmt);
  if (rank) out.push({ label: 'DEVY RANK', value: `#${rank} overall${posRank ? ` · ${pos}${posRank}` : ''}${card.draftYear ? ` · ${card.draftYear} class` : ''}` });
  const dyn = pick(card.dynasty, fmt);
  if (dyn?.pickEquiv) out.push({ label: 'PRICES AS', value: `a ${dyn.pickEquiv} rookie pick` });
  const cm = card.careerModel2027;
  if (cm?.tier) out.push({ label: 'NFL TIER', value: `${cm.tier}${cm.projPick ? ` · projected pick ${cm.projPick}` : ''}` });
  const cpct = pick(card.careerPct, fmt);
  if (card.careerPPG != null) {
    out.push({ label: 'NFL OUTLOOK', value: `${Number(card.careerPPG).toFixed(1)} PPR/g in his best early NFL seasons${cpct != null ? ` (top ${Math.max(1, 100 - Math.round(Number(cpct)))}%)` : ''}` });
  }
  const p = card.profile ?? {};
  const prof = [
    p.breakout_age != null ? `breakout ${Number(p.breakout_age).toFixed(1)}` : null,
    p.best_dominator != null ? `dominator ${pct(p.best_dominator)}` : null,
    p.stars != null ? `${'★'.repeat(Math.max(0, Math.min(5, Math.round(Number(p.stars)))))} recruit` : null,
  ].filter(Boolean);
  if (prof.length) out.push({ label: 'PROFILE', value: prof.join(' · ') });
  const age = [
    p.est_age != null ? `about ${Number(p.est_age).toFixed(1)} now` : null,
    p.est_draft_age != null ? `${Number(p.est_draft_age).toFixed(1)} at the draft` : null,
    p.n_seasons != null ? `${Math.round(Number(p.n_seasons))} college season${Math.round(Number(p.n_seasons)) === 1 ? '' : 's'} with stats` : null,
  ].filter(Boolean);
  if (age.length) out.push({ label: 'AGE', value: age.join(' · ') });
  return out;
}

// ── Our side: the fallback seasons and the fact strip ───────────────────────
/** Our stored season lines (college_player_stats) in the card's shape — used
 *  when ESPN's overview can't be reached. */
export function storedSeasonRows(card: CollegePlayerCard | null | undefined): CollegeSeasonRow[] {
  return (card?.seasons ?? []).map((r) => {
    const m: Record<string, number> = {
      passingYards: r.pass_yds ?? 0, passingTouchdowns: r.pass_td ?? 0, interceptions: r.ints ?? 0,
      rushingYards: r.rush_yds ?? 0, rushingTouchdowns: r.rush_td ?? 0,
      receptions: r.rec ?? 0, receivingYards: r.rec_yds ?? 0, receivingTouchdowns: r.rec_td ?? 0,
    };
    // Our lines carry no attempts; the yardage still reads.
    const line = [
      m.passingYards ? `${m.passingYards} pass yd ${m.passingTouchdowns} TD ${m.interceptions} INT` : null,
      m.rushingYards ? `${m.rushingYards} ru yd${m.rushingTouchdowns ? ` ${m.rushingTouchdowns} TD` : ''}` : null,
      m.receptions || m.receivingYards ? `${m.receptions} rec ${m.receivingYards} yd${m.receivingTouchdowns ? ` ${m.receivingTouchdowns} TD` : ''}` : null,
    ].filter(Boolean).join(' · ') || 'no offensive stats';
    return { season: String(r.season), line: `${r.gp ? `${r.gp} G · ` : ''}${line}`, pts: collegePprPoints(m) };
  });
}

/** The four numbers across the top of the card. */
export function collegeFactStrip(card: CollegePlayerCard | null | undefined, bio: CollegeBio | null, fmt: DevyFormat = '1qb'): [string, string][] {
  const sh = card?.stathead;
  const rank = sh ? (fmt === 'sf' ? sh.rank_sf ?? sh.rank_1qb : sh.rank_1qb) : null;
  const cls = bio?.classLabel ?? card?.class_label ?? null;
  const size = [bio?.height?.replace(/\s/g, ''), bio?.weight?.replace(/\s*lbs/, '')].filter(Boolean).join(' · ');
  return [
    ['CLASS', cls ?? '—'],
    ['HT · WT', size || '—'],
    ['DEVY #', rank ? `#${rank}` : '—'],
    ['PRICE', card?.market ? `${card.market.price}` : '—'],
  ];
}
