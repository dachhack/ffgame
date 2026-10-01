// DECLARED (0409) — this year's NFL draft prospect pool, by college ESPN id.
//
// ESPN's core API lists a season's draft prospects as $refs to "draft
// athletes" (their own id space); each one points at the player's COLLEGE
// athlete record, whose id is our college_player.espn_id. The list is cheap
// (one page of refs); the details are one request each, so a pass fetches
// only the draft ids nfl_prospect doesn't hold yet — ~700 on the first pass
// of a year, a handful a day after that.
//
// WHEN. Between Jan 10 and May 15 of the draft year: the early-entry deadline
// is mid-January and the draft is late April. Outside that window the pool is
// a big board, not a list of who is going, and 0409 doesn't show it anyway.
// `node src/cli.js declared-sweep <year>` runs one pass for any year.
import { db } from '../supabase.js';

const LIST = (y) => `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${y}/draft/athletes?limit=1000`;
const EVERY_MS = Number(process.env.DECLARED_POLL_MS || 86400000);
const CONCURRENCY = 6;

/** The draft-athlete ids in a list page. Pure. */
export function draftIdsOf(page) {
  const out = [];
  for (const it of page?.items ?? []) {
    const m = /\/draft\/athletes\/(\d+)/.exec(String(it?.$ref ?? ''));
    if (m) out.push(m[1]);
  }
  return out;
}

/** One draft athlete's detail → { draft_id, espn_id, name }. Pure. */
export function prospectOf(draftId, detail) {
  const m = /college-football\/athletes\/(\d+)/.exec(String(detail?.athlete?.$ref ?? ''));
  return { draft_id: String(draftId), espn_id: m ? m[1] : null, name: detail?.fullName ?? detail?.displayName ?? null };
}

/** Is `now` inside the window a year's pool is worth reading? */
export function declaredWindowYear(now = new Date()) {
  const y = now.getUTCFullYear();
  const lo = Date.UTC(y, 0, 10), hi = Date.UTC(y, 4, 15);
  return now.getTime() >= lo && now.getTime() < hi ? y : null;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** One pass for a draft year. Injected fetch/rpc keep it testable. */
export async function runDeclared(year, log = () => {}, fetchJson = getJson, rpc = (fn, args) => db().rpc(fn, args)) {
  const ids = draftIdsOf(await fetchJson(LIST(year)));
  const { data: known, error } = await rpc('nfl_prospect_known', { p_year: year });
  if (error) return { year, listed: ids.length, added: 0, error: error.message };
  const have = new Set(known ?? []);
  const todo = ids.filter((id) => !have.has(id));
  const rows = [];
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const got = await Promise.all(batch.map((id) =>
      fetchJson(`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${year}/draft/athletes/${id}`)
        .then((d) => prospectOf(id, d))
        .catch((e) => { log('declared', id, e.message); return null; })));
    for (const r of got) if (r) rows.push(r);
  }
  if (!rows.length) return { year, listed: ids.length, added: 0 };
  const { data, error: uerr } = await rpc('upsert_nfl_prospects', { p_year: year, p_rows: rows });
  if (uerr) return { year, listed: ids.length, added: 0, error: uerr.message };
  return { year, listed: ids.length, added: Number(data ?? rows.length) };
}

let last = 0;
let inflight = null;

/** The tick's entry point: daily inside the window, detached, never overlapping. */
export function sweepDeclared(log = () => {}, now = new Date()) {
  const year = declaredWindowYear(now);
  if (year == null || inflight || Date.now() - last < EVERY_MS) return false;
  last = Date.now();
  inflight = runDeclared(year, log)
    .then((r) => { if (r.added || r.error) log(`declared ${r.year}: ${r.added} new of ${r.listed}` + (r.error ? ` — ${r.error}` : '')); })
    .catch((e) => log('declared error', e.message))
    .finally(() => { inflight = null; });
  return true;
}
