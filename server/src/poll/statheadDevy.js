// STATHEAD'S DEVY BOARD (0403) — what the devy market prices on.
//
// devy-rankings.json is StatHead's board of every current college QB/RB/WR/TE
// its models score (6,441 on Oct 1 2026): a composite of its value model and
// its NFL career projection, per format. It replaces KeepTradeCut's board
// (0400–0402) under StatHead's rule that a player only ever sees StatHead
// numbers — third-party values are inputs, never outputs.
//
// cfbdId is ESPN's athlete id, so the board joins college_player.espn_id
// exactly. The file is ~5.7 MB; it is read once per college sweep (weekly in
// season; StatHead refreshes profiles on Sundays) and loaded in chunks under
// one as_of, then finish_stathead_devy swaps it in — or refuses a short read
// and keeps last week's board.
const URL = process.env.STATHEAD_DEVY_URL || 'https://dachhack.github.io/stathead/data/devy-rankings.json';
const CHUNK = 800;   // 0406: rows carry a ~1 KB card each now

/** 0406: what the player card shows — StatHead's own numbers for him, as
 *  its board publishes them. marketListed / pListed (whether a third-party
 *  devy list carries him) are left out: third-party facts are inputs, never
 *  shown. */
const CARD_FIELDS = ['compositeValue', 'compositeRank', 'compositePosRank', 'compositeWeight',
  'marketValue', 'marketRank', 'marketPosRank', 'careerScore', 'careerPPG', 'careerRank', 'careerPct',
  'careerVsMarket', 'dynasty', 'profile', 'careerModel2027', 'draftYear', 'school'];
export function cardOf(p) {
  const out = {};
  for (const k of CARD_FIELDS) if (p?.[k] != null) out[k] = p[k];
  return out;
}

/** The board's players → our rows. Players with no ESPN id or no 1QB
 *  composite rank are skipped. */
export function statheadDevyRows(json) {
  const out = [];
  for (const p of json?.players ?? []) {
    const id = String(p?.cfbdId ?? '');
    const r1 = Number(p?.compositeRank?.oneQB);
    if (!/^\d+$/.test(id) || !Number.isFinite(r1) || r1 < 1) continue;
    if (!['QB', 'RB', 'WR', 'TE'].includes(p?.pos)) continue;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    out.push({
      espn_id: id, name: p.name ?? null, pos: p.pos,
      rank_1qb: Math.round(r1), rank_sf: num(p.compositeRank?.sf),
      value_1qb: num(p.compositeValue?.oneQB), value_sf: num(p.compositeValue?.sf),
      draft_year: num(p.draftYear),
      card: cardOf(p),
    });
  }
  return out;
}

async function getBoard() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`stathead devy board ${res.status}`);
  return res.json();
}

/** Load the board into stathead_devy. Returns finish_stathead_devy's answer. */
export async function loadStatheadDevy(rpc, log = () => {}, fetchBoard = getBoard) {
  const rows = statheadDevyRows(await fetchBoard());
  const asOf = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await rpc('upsert_stathead_devy', { p_rows: rows.slice(i, i + CHUNK), p_as_of: asOf });
    if (error) throw new Error(`upsert_stathead_devy: ${error.message}`);
  }
  const { data, error } = await rpc('finish_stathead_devy', { p_as_of: asOf });
  if (error) throw new Error(`finish_stathead_devy: ${error.message}`);
  log(`stathead devy: ${rows.length} on the board, ${data?.matched ?? 0} matched to college players`
    + (data?.ok === false ? ` — ${data.error}` : ''));
  return data;
}

// ── THE WEEKLY REPRICE (v0.592.0) ──────────────────────────────────────────
// StatHead's handoff: "Reprice weekly, in season. Pull devy-rankings.json
// after the Sunday run (check profilesThrough, e.g. '2026 week 5') and re-run
// the rank-preserving remap." The college sweep runs every seven days from
// whenever the worker last booted, so it could land the day before the
// rescore and price off a week-old board for six days. This watcher reads the
// board every few hours and reprices the moment profilesThrough moves — the
// board's own signal that a new week of stats is in. A boot reprices once, off
// whatever board is current, which is the same answer as before the boot.
const WATCH_EVERY_MS = Number(process.env.STATHEAD_WATCH_MS || 3 * 3600 * 1000);

/** One check. `state.through` is the profilesThrough last priced from. */
export async function checkDevyBoard(rpc, log = () => {}, fetchBoard = getBoard, state = { through: null }) {
  const board = await fetchBoard();
  const through = board?.profilesThrough ?? null;
  if (!through || through === state.through) return { changed: false, through };
  await loadStatheadDevy(rpc, log, async () => board);
  const { data, error } = await rpc('refresh_college_prices', {});
  if (error) throw new Error(`refresh_college_prices: ${error.message}`);
  state.through = through;
  log(`devy prices: repriced off StatHead's board through ${through}` + (data?.frozen ? ' (prices frozen for the offseason)' : ` — ${data?.priced ?? 0} priced`));
  return { changed: true, through, priced: data?.priced ?? 0, frozen: !!data?.frozen };
}

const watchState = { through: null };
let watchLast = 0;
let watchInflight = null;

/** The tick's entry point: every few hours, detached, never overlapping. */
export function sweepDevyBoard(rpc, log = () => {}) {
  if (watchInflight || Date.now() - watchLast < WATCH_EVERY_MS) return false;
  watchLast = Date.now();
  watchInflight = checkDevyBoard(rpc, log, getBoard, watchState)
    .catch((e) => log('stathead devy watch', e.message))
    .finally(() => { watchInflight = null; });
  return true;
}
