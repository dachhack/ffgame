// WHO THE HEAD COACH IS (0468) — the weekly name scan.
//
// Founder: "The head coaches are just listed as Jaguars Head coach and Bears
// Head coach. Can we get a scan for their names each week."
//
// The coach is a team unit (`jax-hc`) and the number is the team's, so the
// name is colour — but colour a league with a HEAD COACH spot looks at every
// week. It was a hand-typed list in projTeamRoles2026.ts that nothing read.
// This reads ESPN's team directory instead: the public site API's team list
// (32 ids), then the core API's coaches per team for the season, one small
// record per coach with a first and last name. ESPN lists the HEAD coach
// there (a team under an interim has the interim), which is the name a
// league wants on the card.
//
// Written like the depth chart: the whole map, upserted where it changed,
// then `sync_team_role_names` pushes the names into every pool and salary
// board that stores one. Runs with the daily directory refresh — a Monday
// firing shows by Tuesday — and never blocks game ops.
import { getJson } from '../sports/http.js';
import { db } from '../supabase.js';
import { NFL_CODES } from '../../../packages/core/src/data/kdst.ts';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/** ESPN's abbreviation → our unit code. Two differ; the rest lower-case. */
export function unitCodeOf(abbr) {
  const a = String(abbr ?? '').toUpperCase();
  const code = a === 'WSH' ? 'was' : a === 'LAR' ? 'la' : a === 'JAC' ? 'jax' : a.toLowerCase();
  return NFL_CODES.includes(code) ? code : null;
}

/** "Liam Coen" from a coach record; null when the record has no name. */
export function coachNameOf(rec) {
  const first = String(rec?.firstName ?? '').trim();
  const last = String(rec?.lastName ?? '').trim();
  const name = `${first} ${last}`.trim();
  return name || null;
}

/** PURE: the rows to store from ESPN's team list and each team's coach
 *  records (`coachesByTeamId`: ESPN team id → array of coach records). A
 *  team with no coach record keeps whatever row it had (not returned). */
export function teamRoleRows(teamsJson, coachesByTeamId) {
  const out = [];
  const teams = teamsJson?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const { team } of teams) {
    const code = unitCodeOf(team?.abbreviation);
    if (!code) continue;
    const recs = coachesByTeamId.get(String(team.id)) ?? [];
    const name = recs.map(coachNameOf).find(Boolean);
    if (!name) continue;
    out.push({ slug: `${code}-hc`, name, team: code.toUpperCase(), source: 'espn' });
  }
  return out;
}

/** ESPN: the 32 teams, then each team's season coach records. */
export async function fetchHeadCoaches(season, { fetchJson = getJson } = {}) {
  const teams = await fetchJson(`${SITE}/teams?limit=40`);
  const list = teams?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const byId = new Map();
  for (const { team } of list) {
    const id = String(team?.id ?? '');
    if (!id) continue;
    try {
      const page = await fetchJson(`${CORE}/seasons/${season}/teams/${id}/coaches?lang=en&region=us`);
      const recs = [];
      for (const it of page?.items ?? []) {
        const ref = typeof it?.$ref === 'string' ? it.$ref.replace(/^http:/, 'https:') : null;
        if (!ref) continue;
        recs.push(await fetchJson(ref));
      }
      byId.set(id, recs);
    } catch (e) {
      // One team's miss keeps its last name; the others still refresh.
      console.log('coach scan', team?.abbreviation ?? id, e?.message ?? e);
    }
  }
  return teamRoleRows(teams, byId);
}

/** Store the scan and push the names into pools and boards. Returns counts. */
export async function syncHeadCoaches(season, opts = {}) {
  const rows = await fetchHeadCoaches(season, opts);
  if (rows.length < 16) throw new Error(`coach scan too short: ${rows.length} of 32`);
  const { data: have, error: readErr } = await db().from('team_role').select('slug,name');
  if (readErr) throw new Error(`team_role read: ${readErr.message}`);
  const old = new Map((have ?? []).map((r) => [r.slug, r.name]));
  const changed = rows.filter((r) => old.get(r.slug) !== r.name);
  if (changed.length) {
    const { error } = await db().from('team_role').upsert(
      changed.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'slug' });
    if (error) throw new Error(`team_role upsert: ${error.message}`);
  }
  const { data: pushed, error: rpcErr } = await db().rpc('sync_team_role_names');
  if (rpcErr) throw new Error(`sync_team_role_names: ${rpcErr.message}`);
  return { scanned: rows.length, changed: changed.length, pushed: Number(pushed ?? 0), names: changed.map((r) => `${r.team} ${r.name}`) };
}
