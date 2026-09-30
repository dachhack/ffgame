// KTC'S DEVY BOARD (0400/0401) — blended into devy market prices.
//
// KeepTradeCut publishes ~100 college players at /devy-rankings, 50 to a page,
// as server-rendered rows (rank, name, school, positional rank, value). There
// is no cross-id, so set_college_ktc matches by name + position, with the
// school breaking a tie. refresh_college_prices blends KTC's rank with the
// stats rank, half and half, all season (0401).
//
// SOURCE (v0.570.2): stathead publishes the board daily as
// public/data/ktc_rankings_devy.json — the same place the dynasty board comes
// from (dynasty.js). That file is read first; reading KTC's page directly is
// the fallback when it is missing or short.
//
// Best-effort: any failure leaves last read's board in place, and a short
// read (under 20 rows) is refused by the RPC rather than wiping it.
const PAGE = (n) => `https://keeptradecut.com/devy-rankings?page=${n}&filters=QB|WR|RB|TE&format=1`;

const unescape = (s) => s.replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();

/** One page's rows: [{ rank, name, pos, school, value }]. */
export function parseKtcDevy(html) {
  const out = [];
  const parts = String(html ?? '').split('<div class="onePlayer"').slice(1);
  for (const r of parts) {
    const rank = r.match(/class="rank-number">\s*<p>(\d+)<\/p>/)?.[1];
    const name = r.match(/href="\/devy-rankings\/players\/[^"]*"[^>]*>\s*([^<]+?)\s*</)?.[1];
    const pos = r.match(/<p class="position">([A-Z]+)\d*<\/p>/)?.[1];
    const school = r.match(/class="player-team">([^<]+)</)?.[1];
    const value = r.match(/<div class="value">\s*<p>(\d+)<\/p>/)?.[1];
    if (!rank || !name || !pos || !value) continue;
    if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
    out.push({ rank: Number(rank), name: unescape(name), pos, school: school?.trim() ?? null, value: Number(value) });
  }
  return out;
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (drip devy market)' } });
  if (!res.ok) throw new Error(`KTC ${res.status}`);
  return res.text();
}

/** The whole board, page by page until a page comes back empty. */
export async function loadKtcDevy(fetchText = getText) {
  const rows = [];
  for (let p = 0; p < 6; p++) {
    const page = parseKtcDevy(await fetchText(PAGE(p)));
    if (!page.length) break;
    rows.push(...page);
  }
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.rank) ? false : (seen.add(r.rank), true)));
}

const SH_BASE = process.env.STATHEAD_RAW || 'https://raw.githubusercontent.com/dachhack/stathead';
const SH_REF = process.env.STATHEAD_REF || 'claude/nfl-fantasy-workbench-6D1yd';
const STATHEAD_DEVY = `${SH_BASE}/${SH_REF}/public/data/ktc_rankings_devy.json`;

/** stathead's rows → ours. KTC's file has no overall rank, so the 1QB value
 *  orders it (the page's own order). */
export function statheadDevyRows(json) {
  const rows = (Array.isArray(json) ? json : [])
    .filter((r) => ['QB', 'RB', 'WR', 'TE'].includes(r?.position) && r?.playerName && Number.isFinite(Number(r?.value)))
    .map((r) => ({ name: String(r.playerName).trim(), pos: r.position, school: r.team ?? null, value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

async function getStatheadDevy() {
  const res = await fetch(STATHEAD_DEVY);
  if (!res.ok) throw new Error(`stathead devy ${res.status}`);
  return res.json();
}

/** The board: stathead's file, else KTC's page. */
export async function loadDevyBoard(log = () => {}, fetchStathead = getStatheadDevy, fetchText = undefined) {
  try {
    const rows = statheadDevyRows(await fetchStathead());
    if (rows.length >= 20) return rows;
    log(`stathead devy: only ${rows.length} rows — reading KTC directly`);
  } catch (e) { log(`stathead devy: ${e.message} — reading KTC directly`); }
  return loadKtcDevy(fetchText);
}
