// Injury poller: ESPN /nfl/injuries + Sleeper's directory → injury_status.
//
// TWO SOURCES SINCE v0.489.0. Founder: "I think Alec Pierce is out but he's
// listed as D in the platform." He was Doubtful on ESPN's report and Out on
// Sleeper, seventeen hours fresher — and this poller read ESPN and only ESPN.
// Across the two feeds that day, 23 of the 51 players both designate disagreed
// and 174 of Sleeper's designations were absent from ESPN's report entirely.
// Which of the two to believe is a rule with reasons, and it lives in core
// (data/injuryMerge.ts) where a check script can hold it.
//
// AND IT PRUNES NOW, which is the older bug of the two. This poller has only
// ever UPSERT-ed, so a designation was permanent: a player who got hurt in
// October and was cleared in November stayed Out in this table for ever, unless
// some later report happened to name him again. Nothing else deletes from it —
// not the worker, not a migration, not a cron. So the table could only ever
// accumulate, and 0333's discount, the lock's auto-fill and IR eligibility all
// read it. A poll now writes the WHOLE picture: what the two sources say, and
// the removal of everyone they no longer say anything about.
//
// THE PRUNE IS GUARDED. Deleting on the strength of a feed that came back short
// would un-injure the league, so it only runs when ESPN's report looks whole
// (PRUNE_FLOOR entries) and the Sleeper snapshot is in hand. A poll that cannot
// see both leaves the table alone and says so.
import { fetchInjuries, normalizeInjuries } from '../../../scripts/espn/injuries.mjs';
import { mapSleeperStatus, mergeInjury } from '../../../packages/core/src/data/injuryMerge.ts';
import { getPlayers } from '../sleeper.js';
import { db } from '../supabase.js';

/** ESPN entries below which the report is assumed partial and nothing is
 *  pruned. Its quiet Tuesday is ~150 rows counting Actives; a tenth of that is
 *  a feed in trouble, not a healthy league. */
const PRUNE_FLOOR = 40;

// Sleeper asks callers to pull the player directory at most once a day — it is
// ~15 MB — and the injury poll ramps to every three minutes before kickoff. So
// the directory is fetched on its own slow clock and reused in between; the
// staleness costs nothing, because merging compares the timestamps INSIDE each
// statement, not when we happened to fetch them. ESPN, which carries the
// minutes-old inactive news, keeps its fast cadence and wins on freshness in
// exactly the window where it should.
const SLEEPER_TTL_MS = Number(process.env.SLEEPER_INJURY_MS || 6 * 3600_000);
let sleeperCache = null; // { at, rows: Map<slug, {status, at}> }

/** Sleeper's designations, keyed by our slug. Cached; null when we have never
 *  managed a fetch (which switches the prune off rather than pruning on half a
 *  picture). */
export function sleeperRows(players, slugForSleeperId) {
  const rows = new Map();
  for (const [sid, p] of Object.entries(players ?? {})) {
    const status = mapSleeperStatus(p?.injury_status);
    if (!status) continue;
    // `.slug`, NOT the entry. playerIndex.sleeper() answers with a META OBJECT
    // — { slug, full, pos, team, espnId } — and v0.489.0 keyed this map by the
    // object itself. Every Sleeper designation then sat under a key no ESPN
    // slug could equal and no database column could take, so the merge saw
    // nothing from Sleeper, the upsert carried objects where text belonged,
    // and Alec Pierce stayed Doubtful through the whole fix built to correct
    // him. Every other caller in the worker writes `?.slug`; this one now does
    // too, and check:injurymerge builds a fake index of the real shape so the
    // contract is asserted rather than remembered.
    const slug = slugForSleeperId(sid)?.slug;
    if (typeof slug !== 'string' || !slug) continue;
    // news_updated is the only per-player clock Sleeper gives. It moves on any
    // news, not only an injury one — which is imprecise in our favour: the news
    // that clears a player bumps it too.
    rows.set(slug, {
      status, at: Number(p?.news_updated) || null,
      team: p?.team ?? null, body: p?.injury_body_part ?? null,
    });
  }
  return rows;
}

async function sleeperInjuries(playerIndex, now = Date.now()) {
  if (sleeperCache && now - sleeperCache.at < SLEEPER_TTL_MS) return sleeperCache.rows;
  let players;
  try { players = await getPlayers(); } catch { return sleeperCache?.rows ?? null; }
  const rows = sleeperRows(players, (sid) => playerIndex.sleeper(sid));
  sleeperCache = { at: now, rows };
  return rows;
}

/** Pull both reports, write what they agree the league looks like now. */
export async function pollInjuries(playerIndex) {
  const feed = await fetchInjuries();
  // ID-FIRST (0200) — same contract as the play poller: the report's athlete id
  // wins where Sleeper maps it, ranked name fallback otherwise.
  const resolve = (name, espnId, team) => playerIndex.slugForEspnId(espnId) ?? playerIndex.slugForName(name, team);
  // `keepActive` (v0.489.0): the feed's 600-odd Active entries used to be
  // dropped here. They are a statement that a man is available, dated — the
  // thing that stops a stale flag on another feed benching him.
  const espn = normalizeInjuries(feed, resolve, { keepActive: true });
  const sleeper = await sleeperInjuries(playerIndex);

  const slugs = new Set([...Object.keys(espn), ...(sleeper?.keys() ?? [])]);
  const now = new Date().toISOString();
  const records = [];
  for (const slug of slugs) {
    const e = espn[slug];
    const s = sleeper?.get(slug);
    const merged = mergeInjury(e ? { status: e.status, at: e.date } : null, s ? { status: s.status, at: s.at } : null);
    if (!merged) continue;
    records.push({
      player_slug: slug, status: merged.status, source: merged.source,
      // The DETAIL stays ESPN's whatever wins the designation: it is the only
      // side that writes a sentence about what happened and when he is back.
      designation_date: e?.date ?? null, return_date: e?.returnDate ?? null,
      // ESPN writes the sentence; where it has none, Sleeper's body part is
      // still better than a blank in the detail sheet.
      comment: e?.comment ?? s?.body ?? null, team: e?.team ?? s?.team ?? null,
      updated_at: now,
    });
  }
  // NOTHING MALFORMED GOES TO THE DATABASE. A slug is a text primary key; a
  // record carrying anything else fails the whole batch, and v0.489.0 sent
  // objects and never looked at the error.
  const clean = records.filter((r) => typeof r.player_slug === 'string' && r.player_slug.length > 0);
  const malformed = records.length - clean.length;
  let wrote = false;
  if (clean.length) {
    const { error } = await db().from('injury_status').upsert(clean, { onConflict: 'player_slug' });
    if (error) console.log('[injuries] upsert failed:', error.message);
    else wrote = true;
  }

  // ── and clear everyone neither source designates any more ────────────────
  //
  // NEVER ON THE BACK OF A WRITE THAT DID NOT LAND. v0.489.0 pruned whether or
  // not the upsert succeeded, so a poll that wrote nothing could still delete —
  // subtraction with no addition, which is the one shape of this job that loses
  // data. The prune now needs the write confirmed, every record well-formed,
  // a whole ESPN report, and a Sleeper snapshot in hand.
  let pruned = 0;
  const espnEntries = (feed?.injuries ?? []).reduce((n, t) => n + (t?.injuries?.length ?? 0), 0);
  const canPrune = wrote && malformed === 0 && sleeper != null && espnEntries >= PRUNE_FLOOR;
  if (canPrune) {
    const keep = new Set(clean.map((r) => r.player_slug));
    const { data: held } = await db().from('injury_status').select('player_slug');
    const gone = (held ?? []).map((r) => r.player_slug).filter((s) => !keep.has(s));
    // Chunked: a delete-in with a thousand slugs is one URL too long for PostgREST.
    for (let i = 0; i < gone.length; i += 200) {
      const chunk = gone.slice(i, i + 200);
      const { error } = await db().from('injury_status').delete().in('player_slug', chunk);
      if (!error) pruned += chunk.length;
    }
  }
  return {
    feedTimestamp: feed?.timestamp, count: clean.length, pruned, malformed,
    espn: Object.keys(espn).length, sleeper: sleeper?.size ?? null, prunedSkipped: !canPrune,
  };
}
