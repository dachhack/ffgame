// Publish Sleeper's depth chart into player_depth (0293).
//
// Founder, on a projected lineup that had Sam Darnold starting: "Lock is the
// QB2 but Darnold is hurt and out this week." The sheet ranked by projection,
// and Drew Lock has none — so taking the injured man off (v0.415.0) promoted
// the third-stringer instead of the backup. This is the other half.
//
// Sleeper's depth_chart_order is re-ordered for AVAILABILITY week to week, so
// it answers the question a pre-kickoff sheet is actually asking. The worker
// already pulls that directory daily; this stores what it has been reading and
// throwing away since the preseason pool builder.
//
// The WHOLE map, not a drift: there is no baked depth chart to diff against,
// and at a few hundred rows there does not need to be one. Written the same
// way the team overrides are — upsert what changed, prune what is gone — so a
// player who loses his rank loses the row rather than keeping a stale one.
import { db } from '../supabase.js';

/** Positions a fantasy sheet ever ranks. A depth chart of offensive linemen is
 *  real and useless here, and storing it would triple the table for nothing.
 *
 *  NO KICKERS, deliberately. This game scores kicking as a TEAM UNIT (`sea-k`),
 *  so an individual kicker is not an entity any roster holds — publishing his
 *  rank would put "Jason Myers —" in a slot where the unit's real projection
 *  belongs, which is a worse sheet, not a better one. Same for defences, which
 *  the directory does not rank anyway. */
const RANKED = new Set(['QB', 'RB', 'WR', 'TE']);

/** Reconcile player_depth against the index. Returns counts for the log. */
export async function syncDepthChart(playerIndex) {
  const want = new Map(); // slug -> { team, pos, depth }
  for (const { slug, team, pos, depth } of playerIndex.allSlugs()) {
    if (!team || !RANKED.has(pos)) continue;
    // A rank of 0 or a negative is not a rank; Sleeper uses 1 for the starter.
    if (!Number.isFinite(depth) || depth < 1) continue;
    want.set(slug, { team, pos, depth });
  }

  const { data: existing, error: exErr } = await db().from('player_depth').select('slug,team,pos,depth');
  if (exErr) throw new Error(`depth scan: ${exErr.message}`);
  const have = new Map((existing ?? []).map((r) => [r.slug, r]));

  const upserts = [];
  for (const [slug, w] of want) {
    const h = have.get(slug);
    if (!h || h.team !== w.team || h.pos !== w.pos || h.depth !== w.depth) {
      upserts.push({ slug, ...w, updated_at: new Date().toISOString() });
    }
  }
  const stale = [...have.keys()].filter((slug) => !want.has(slug));

  // CHUNKED. This is the whole map on a first run — a few hundred rows — and a
  // single upsert of everything is the one call most likely to time out on the
  // day it matters (a deploy right before kickoff).
  for (let i = 0; i < upserts.length; i += 500) {
    const { error } = await db().from('player_depth').upsert(upserts.slice(i, i + 500), { onConflict: 'slug' });
    if (error) throw new Error(`depth upsert: ${error.message}`);
  }
  for (let i = 0; i < stale.length; i += 500) {
    const { error } = await db().from('player_depth').delete().in('slug', stale.slice(i, i + 500));
    if (error) throw new Error(`depth prune: ${error.message}`);
  }
  return { changed: upserts.length, cleared: stale.length, standing: want.size };
}
