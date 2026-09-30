// KTC'S DEVY BOARD (0400) — seeds early-season devy market prices.
//
// KeepTradeCut publishes ~100 college players at /devy-rankings, 50 to a page,
// as server-rendered rows (rank, name, school, positional rank, value). There
// is no cross-id, so set_college_ktc matches by name + position, with the
// school breaking a tie. refresh_college_prices gives KTC's rank a weight that
// fades over each player's first four games of the season.
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
