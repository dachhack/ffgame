// THE DYNASTY BOARD, REFRESHED BY THE WORKER (0335).
//
// `dyn2026.ts` and `pickValues2026.ts` are the same market seen twice: the
// dynasty value of a player, and what a rookie pick trades for. Both were
// bakes, which means both were a person remembering.
//
// THE VALUE IS NOT A BLACK BOX, which is why this can exist. It is KTC's
// board rescaled onto FantasyCalc's scale by a per-player ratio — with a
// positional-median fallback for anyone below a value floor of 500 — and both
// halves are published:
//
//   ktc_rankings_1qb.json    500 rows: 416 players and the 84 rookie-pick
//                            rows, each with a 1QB and a superflex value.
//   dynasty-fc-rescale.json  371 per-player ratios plus the positional
//                            medians, and the floor.
//
// The rule below is the upstream's own, transcribed from the client they
// publish (stathead/dynasty.py, itself mirroring src/lib/valueRescale.ts):
// ratio = per-player where the KTC value clears the floor, else the
// positional median; value = round(ktc × ratio); UNSUPPORTED POSITIONS KEEP
// THEIR RAW VALUE, which is how the pick rows pass through untouched. This is
// running their model, not approximating it.
//
// RESOLUTION IS THE HARD PART, because KTC publishes no cross-id — it has its
// own playerID and a name. A bare name join would be exactly the bug this
// session has spent four versions removing: measured, it drops Kenneth/Kenny
// Gainwell (3,487), Travis Hunter (3,116) and Chig/Chigoziem Okonkwo (2,925),
// all top-200 assets. So the ladder is:
//
//   1. the crosswalk's ALIASES — `all_names` carries both spellings of a man,
//      which is what aliases are for (413 of 416);
//   2. the player index's own ranked name+team resolver, for the rest;
//   3. nothing: the row is written with a null slug, keeping its value and
//      its id so a later index can claim it, and the bake still answers.
import { db } from '../supabase.js';
import { normName } from '../../../packages/core/src/data/players.ts';

const SH_BASE = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const SH_REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const file = (p) => `${SH_BASE}/${SH_REF}/public/data/${p}`;

/** Positions the rescale applies to. Everything else — kickers, and the
 *  rookie picks — keeps its raw KTC value, per the upstream's rule. */
const RESCALED = new Set(['QB', 'RB', 'WR', 'TE']);

/** The upstream's ratio rule, verbatim: per-player above the floor, else the
 *  positional median, else no rescale at all. */
export function rescaledValue(row, snap, fmt) {
  const raw = Number(fmt === 'sf' ? row.superflexValue : row.value);
  if (!Number.isFinite(raw)) return null;
  if (!RESCALED.has(row.position)) return Math.round(raw);
  const key = fmt === 'sf' ? 'sf' : 'oneQB';
  const floor = Number(snap?.floor ?? 500);
  const per = snap?.perPlayer?.[String(row.playerID)];
  const ratio = (per?.[key] != null && raw >= floor)
    ? Number(per[key])
    : Number(snap?.positional?.[row.position]?.[key]);
  return Number.isFinite(ratio) ? Math.round(raw * ratio) : Math.round(raw);
}

/** Every alias the crosswalk knows → sleeper id. Built once per sweep. */
function aliasIndex(xwalk) {
  const byNamePos = new Map(); const byName = new Map();
  for (const x of xwalk?.players ?? []) {
    if (!x.sleeper_id) continue;
    for (const n of x.all_names ?? [x.display_name]) {
      if (!n) continue;
      const k = normName(n);
      if (!byNamePos.has(`${k}|${x.position}`)) byNamePos.set(`${k}|${x.position}`, String(x.sleeper_id));
      if (!byName.has(k)) byName.set(k, String(x.sleeper_id));
    }
  }
  return { byNamePos, byName };
}

/** The board's rows, players and picks, in the shape upsert_dyn_board wants. */
export function dynRows(ktc, snap, xwalk, playerIndex) {
  const alias = aliasIndex(xwalk);
  const rows = [];
  for (const r of ktc ?? []) {
    const v1qb = rescaledValue(r, snap, '1qb');
    const vsf = rescaledValue(r, snap, 'sf');
    if (v1qb == null && vsf == null) continue;
    if (r.position === 'RDP') {
      // A pick is an asset, not a player: keyed by the market's own label,
      // which is what pickValues2026 reads it by.
      rows.push({ key: `pick:${r.playerName}`, kind: 'pick', label: r.playerName, v1qb, vsf });
      continue;
    }
    const k = normName(r.playerName ?? '');
    const sid = alias.byNamePos.get(`${k}|${r.position}`) ?? alias.byName.get(k) ?? null;
    const slug = (sid ? playerIndex?.sleeper(sid)?.slug : null)
      ?? playerIndex?.slugForName?.(r.playerName, r.team) ?? null;
    rows.push({
      key: sid ?? `ktc:${r.playerID}`, kind: 'player',
      sleeper_id: sid, slug, v1qb, vsf,
    });
  }
  return rows;
}

// WEEKLY, not daily. A dynasty value is a long-horizon opinion of a player's
// career; it does not move on a Tuesday, and the upstream board is not
// rebuilt daily either. Env-tunable like every other cadence here.
const EVERY_MS = Number(process.env.DYN_POLL_MS || 7 * 86400000);
const CHUNK = 400;
let last = 0;

export async function sweepDynasty(playerIndex, log = () => {}) {
  if (Date.now() - last < EVERY_MS) return { rows: 0 };
  last = Date.now();
  let ktc; let snap; let xwalk;
  try {
    const get = async (p) => {
      const res = await fetch(file(p), { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`${p} ${res.status}`);
      return await res.json();
    };
    [ktc, snap, xwalk] = await Promise.all([
      get('ktc_rankings_1qb.json'), get('dynasty-fc-rescale.json'), get('player-crosswalk.json'),
    ]);
  } catch (e) { log('dynasty', e.message); return { rows: 0, error: e.message }; }

  const rows = dynRows(ktc, snap, xwalk, playerIndex);
  if (!rows.length) return { rows: 0, skipped: 'nothing valued' };
  const stamp = snap?.generatedAt ?? null;
  let wrote = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await db().rpc('upsert_dyn_board', {
      p_rows: rows.slice(i, i + CHUNK),
      p_fetched_at: stamp,
      p_prune: i + CHUNK >= rows.length,
    });
    if (error) { log('dynasty upsert', error.message); return { rows: wrote, error: error.message }; }
    wrote += Number(data?.rows ?? 0);
  }
  const players = rows.filter((r) => r.kind === 'player');
  return {
    rows: wrote,
    players: players.length,
    picks: rows.length - players.length,
    placed: players.filter((r) => r.slug).length,
    stamp,
  };
}
