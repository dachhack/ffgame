// DEVY SHARES (0387) — the pure half, for both hosts.
//
// A shares league gives every team 100 shares to put on college players, at
// most 20 on one. The team whose stake reached 20 FIRST holds the player's
// right; failing that, the ONLY team holding him does, if it holds 5 or more.
// The right is a reservation in the rookie draft once he turns pro. The
// database decides all of it (devy_share_rights); this only words it.
import type { DevyMarketRow, DevySharePlayer, DevySharesState, DevyLaunchState, DevyLaunchCfg } from './liveApi';
import { collegeClassLabel } from './college';

export const DEVY_SHARE_RULES = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, max_spend: 60, min_spend: 15, refund: 0.5 } as const;

/** 0388: a team's cash and what its stakes would pay today. */
export function teamBook(st: DevySharesState | null | undefined, rosterId: number | null | undefined): { cash: number; value: number; shares: number } {
  const k = rosterId == null ? '' : String(rosterId);
  return {
    cash: rosterId == null ? 0 : Number(st?.cash?.[k] ?? st?.rules?.budget ?? DEVY_SHARE_RULES.budget),
    value: rosterId == null ? 0 : Number(st?.value?.[k] ?? 0),
    shares: rosterId == null ? 0 : Number(st?.used?.[k] ?? 0),
  };
}

/** "paid 20 · worth 40 (+20)" — a stake's cost basis against today. */
export function stakeLine(cost: number | undefined, value: number | undefined): string {
  const c = Number(cost ?? 0), v = Number(value ?? 0);
  const d = Math.round((v - c) * 100) / 100;
  return `paid ${fmtPts(c)} · worth ${fmtPts(v)} (${d >= 0 ? '+' : ''}${fmtPts(d)})`;
}

/** Points, always two decimals (v0.577.0, founder: "make the numbers always
 *  have the same decimal places"): 20.00, 12.50, 10.38. */
export const fmtPts = (n: number): string => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);

/** Shares a team has placed, and what's left of its budget. */
export function sharesUsed(st: DevySharesState | null | undefined, rosterId: number | null | undefined): { used: number; free: number; budget: number } {
  const budget = st?.rules?.budget ?? DEVY_SHARE_RULES.budget;
  const used = rosterId == null ? 0 : (st?.used?.[String(rosterId)] ?? 0);
  return { used, free: Math.max(0, budget - used), budget };
}

/** A team's own stake in a player (0 if none). */
export const myStake = (p: DevySharePlayer, rosterId: number | null | undefined): number =>
  (rosterId == null ? 0 : p.holders.find((h) => h.roster_id === rosterId)?.shares ?? 0);

/** Where a team stands on a player, in a few words (0396: a stake maxes at
 *  20 shares or 60 points spent; a sole right needs 5+ shares AND 15+ spent,
 *  and only a stake like that can break someone else's). */
export function rightLine(p: DevySharePlayer, rosterId: number | null | undefined, floor: number = DEVY_SHARE_RULES.floor, max: number = DEVY_SHARE_RULES.max,
  minSpend: number = DEVY_SHARE_RULES.min_spend): string {
  const mineH = rosterId == null ? undefined : p.holders.find((h) => h.roster_id === rosterId);
  const holder = p.right ? p.holders.find((h) => h.roster_id === p.right!.roster_id) : null;
  if (p.right && p.right.roster_id === rosterId) return p.right.via === 'max' ? '★ YOUR RIGHT — first to max' : '★ YOUR RIGHT — the only qualified team';
  if (p.right && holder) return p.right.via === 'max' ? `${holder.team} holds his right (first to max)` : `${holder.team} holds his right (the only qualified team)`;
  const qualified = p.holders.filter((h) => h.qualified ?? (h.shares >= floor && Number(h.cost ?? 0) >= minSpend));
  if (mineH && !qualified.some((h) => h.roster_id === rosterId)) {
    const needShares = Math.max(0, floor - mineH.shares);
    const needPts = Math.max(0, minSpend - Number(mineH.cost ?? 0));
    return `not qualified yet — ${[needShares ? `${needShares} more share${needShares === 1 ? '' : 's'}` : '', needPts ? `${fmtPts(needPts)} more points in` : ''].filter(Boolean).join(' and ')}`;
  }
  if (qualified.length > 1) return `${qualified.length} qualified teams — first to max (${max} shares or 60 points) holds his right`;
  return 'nobody holds his right yet';
}

/** How many shares a buy may add before the stake maxes: 20 shares, or 60
 *  points spent (every share but the last must start under 60). */
export function maxBuy(cur: number, cost: number, price: number, max: number = DEVY_SHARE_RULES.max, maxSpend: number = DEVY_SHARE_RULES.max_spend): number {
  if (cur >= max || cost >= maxSpend || !(price > 0)) return 0;
  return Math.max(0, Math.min(max - cur, Math.ceil((maxSpend - cost) / price)));
}

/** "Locked since Jan 15 — until the rookie draft is done" / "Locks Jan 15". */
export function lockLine(st: DevySharesState | null | undefined): string {
  if (!st?.on) return '';
  // 0399: a league that hasn't drafted yet waits on its first draft, unless
  // the commissioner opened the market at creation.
  if (st.locked && st.drafted === false) return st.open_now
    ? 'Paused while the draft runs — it reopens when the draft is done.'
    : 'Opens when the league\u2019s first draft is done (the commissioner can open it sooner).';
  if (st.locked) return 'Locked since Jan 15 until the rookie draft is done.';
  if (st.drafted === false && st.open_now) return 'Open now — the commissioner opened the market before the draft. From Jan 15 until the rookie draft, shares lock.';
  return 'You can move shares until Jan 15. From then until the rookie draft, they are locked.';
}

/** A trade leg's devy items as words (0397): "5 shares of Arch Manning → Team 3",
 *  "12.5 devy cash → Team 3". The team namer is the screen's. */
export function devyLegParts(l: { send_shares?: { slug: string; shares: number; to: number; name?: string | null }[]; send_devy_cash?: { to: number; amount: number }[] },
  teamName: (rid: number) => string): string[] {
  return [
    ...(l.send_shares ?? []).map((x) => `${x.shares} share${x.shares === 1 ? '' : 's'} of ${x.name ?? x.slug} → ${teamName(x.to)}`),
    ...(l.send_devy_cash ?? []).map((c) => `${fmtPts(Number(c.amount))} devy cash → ${teamName(c.to)}`),
  ];
}

/** A two-team offer that carries DEVY SHARES or devy cash (0398) files as a
 *  two-leg trade (propose_multi_trade), since the two-seat offer knows nothing
 *  of shares. Everything else the offer holds rides along on the legs:
 *  players, picks, FAAB and cap room, each addressed to the other seat.
 *  Signed amounts follow the two-seat builder: + = I send, − = I ask. */
export function twoSeatDevyLegs(o: {
  me: number; partner: number;
  give: string[]; get: string[];
  givePicks: { season: string; round: number; orig: number }[];
  getPicks: { season: string; round: number; orig: number }[];
  faab?: number; cap?: number;
  giveShares: Record<string, number>; getShares: Record<string, number>;
  devyCash?: number;
}) {
  const shares = (m: Record<string, number>, to: number) =>
    Object.entries(m).filter(([, n]) => n > 0).map(([slug, n]) => ({ slug, shares: n, to }));
  const amt = (v: number | undefined, sign: 1 | -1) => ((v ?? 0) * sign > 0 ? Math.abs(v ?? 0) : 0);
  const leg = (rid: number, to: number, players: string[], picks: { season: string; round: number; orig: number }[],
    m: Record<string, number>, sign: 1 | -1) => ({
    roster: rid,
    send: players.map((slug) => ({ slug, to })),
    send_picks: picks.map((p) => ({ season: p.season, round: p.round, orig: p.orig, to })),
    send_faab: amt(o.faab, sign) ? [{ to, amount: amt(o.faab, sign) }] : [],
    send_cap: amt(o.cap, sign) ? [{ to, amount: amt(o.cap, sign) }] : [],
    send_shares: shares(m, to),
    send_devy_cash: amt(o.devyCash, sign) ? [{ to, amount: Math.round(amt(o.devyCash, sign) * 100) / 100 }] : [],
  });
  return [
    leg(o.me, o.partner, o.give, o.givePicks, o.giveShares, 1),
    leg(o.partner, o.me, o.get, o.getPicks, o.getShares, -1),
  ];
}

/** Does an offer carry anything from the devy market? */
export const offersDevy = (giveShares: Record<string, number>, getShares: Record<string, number>, devyCash?: number) =>
  Object.values(giveShares).some((n) => n > 0) || Object.values(getShares).some((n) => n > 0) || Math.abs(devyCash ?? 0) > 0;

// ── League creation (0398) ─────────────────────────────────────────────────
/** The devy question a new league answers: none, devy roster spots, or the
 *  devy market. */
export type DevyChoice = 'none' | 'spots' | 'shares';

/** Why a devy choice is not open to this league, or null when it is. College
 *  players are a classic-league thing, and the market runs on a snake draft's
 *  picks (a contract type's startup is an auction). */
export function devyChoiceBlocked(choice: DevyChoice, o: { classic: boolean; auction: boolean; contract: boolean }): string | null {
  if (choice === 'none') return null;
  if (!o.classic) return 'devy needs a CLASSIC league';
  if (choice === 'shares' && o.contract) return 'the devy market needs a snake draft — contract leagues start with an auction';
  if (choice === 'shares' && o.auction) return 'the devy market needs a snake draft — switch the draft to SNAKE';
  return null;
}

/** One line for the review screen. */
export function devyChoiceLine(choice: DevyChoice, spots: number, openNow = false): string {
  if (choice === 'spots') return `DEVY · ${spots} college roster spot${spots === 1 ? '' : 's'} per team`;
  if (choice === 'shares') return `DEVY MARKET · opens ${openNow ? 'right away' : 'after the draft'} · shares reserve rookie-draft rights`;
  return 'NO DEVY · NFL players only';
}

export const DEVY_CHOICE_INFO =
  'Devy leagues let teams invest in COLLEGE players before they reach the NFL.\n\n'
  + 'NO DEVY — NFL players only.\n\n'
  + 'DEVY SPOTS — college players join the draft pool, and each team gets extra roster spots that only hold college players. '
  + 'They are drafted and kept like anyone else, and move to the NFL roster when they graduate.\n\n'
  + 'DEVY MARKET — college players stay out of the draft. Each team gets 100 points to buy shares in them: '
  + 'the first team to 20 shares (or the only team holding 5+ shares and 15+ points) reserves the right to draft that player '
  + 'in the rookie draft. Prices rise as players play well, so early scouting pays; shares trade like picks. '
  + 'The commissioner decides when the market opens: right away, so teams can scout before the startup draft, '
  + 'or once the startup draft is done. Every year after, shares lock on Jan 15 until the rookie draft.\n\n'
  + 'After the league is made, devy spots and the SPOTS / MARKET switch live in COMMISH.';

// ── The underclass discount (0413) ─────────────────────────────────────────
/** A freshman prices ×0.85 and a sophomore ×0.92 of his rank's price, so a
 *  young player who holds his rank gains as he ages. Mirrors 0413's
 *  _college_class_mult. */
export function underclassMult(classYear: number | null | undefined): number {
  return classYear === 1 ? 0.85 : classYear === 2 ? 0.92 : 1;
}
/** "underclass −15%", or null for a junior and up. */
export function underclassLabel(classYear: number | null | undefined): string | null {
  const m = underclassMult(classYear);
  return m < 1 ? `underclass −${Math.round((1 - m) * 100)}%` : null;
}

// ── The deep market (0404) ─────────────────────────────────────────────────
/** A market row's detail line: school, class, where the price sits (or that
 *  he is unpriced and costs the floor) and StatHead's devy rank. */
export function marketRowDetail(r: DevyMarketRow): string {
  return [
    r.declared ? 'DECLARED' : null,
    r.school, r.fcs ? 'FCS' : null, r.class_year ? collegeClassLabel(r.class_year) : null,
    r.rank ? `#${r.rank} in college` : 'unpriced (1-pt floor)',
    r.sh_rank ? `StatHead devy #${r.sh_rank}` : null,
    r.youth ? underclassLabel(r.class_year) : null,
  ].filter(Boolean).join(' · ');
}

// ── Lazy loading (v0.605.0, founder: "lazy load the listings in the devy
// market so you can keep scrolling") ─────────────────────────────────────────
// The market shows MARKET_PAGE rows and adds a page each time the reader nears
// the end. The first fetch is MARKET_FIRST_FETCH rows (by price); scrolling
// past them fetches the rest once, up to the server's cap.
export const MARKET_PAGE = 60;
export const MARKET_FIRST_FETCH = 1000;
export const MARKET_FULL_FETCH = 5000;

/** What reaching the end does: show another page, and/or fetch the rest of
 *  the market (a bigger limit), or nothing when everything is showing. Pure. */
export function marketNext(shown: number, lines: number, fetched: number, limit: number): { shown: number; fetch: number | null } {
  if (shown < lines) return { shown: Math.min(lines, shown + MARKET_PAGE), fetch: null };
  if (limit < MARKET_FULL_FETCH && fetched >= limit) return { shown: shown + MARKET_PAGE, fetch: MARKET_FULL_FETCH };
  return { shown, fetch: null };
}

/** The line under the list: more coming, or the count when it's all here. */
export function marketFooter(shown: number, lines: number, fetched: number, limit: number): string | null {
  if (!lines) return null;
  if (shown < lines || (limit < MARKET_FULL_FETCH && fetched >= limit)) return 'Scroll for more…';
  return `All ${lines.toLocaleString('en-US')} players`;
}

/** Typed this much, the search goes to the server and covers every college
 *  player, not just the loaded list. */
export const DEEP_SEARCH_MIN = 2;

// ── One team's stakes, for its roster view (v0.576.0) ─────────────────────
export interface TeamStake { p: DevySharePlayer; shares: number; cost: number; value: number; right: boolean }

/** Every college player a team holds shares in, biggest stake first — what
 *  the roster card shows under any team's roster in a devy-market league. */
export function stakesOf(st: DevySharesState | null | undefined, rid: number | null | undefined): TeamStake[] {
  if (rid == null) return [];
  const out: TeamStake[] = [];
  for (const p of st?.players ?? []) {
    const h = p.holders.find((x) => x.roster_id === rid);
    if (!h || h.shares <= 0) continue;
    out.push({ p, shares: h.shares, cost: Number(h.cost ?? 0), value: Number(h.value ?? 0), right: p.right?.roster_id === rid });
  }
  return out.sort((a, b) => Number(b.right) - Number(a.right) || b.shares - a.shares || b.value - a.value);
}

/** The rules, for the market's ⓘ — the paragraph the header used to carry. */
export function devyRulesText(rules: { max: number; max_spend?: number; floor: number; min_spend?: number; payout_cap?: number; cash_cap?: number; refund?: number },
  st?: DevySharesState | null): string {
  return [
    'Invest in college players by buying shares. Prices follow how they play, updated weekly in season and frozen from Jan 15 until the next season’s first stats.',
    `A stake maxes at ${rules.max} shares or ${rules.max_spend ?? 60} points spent. The first team to max holds his right; if only one team has ${rules.floor}+ shares and ${rules.min_spend ?? 15}+ points in, that team does. The right reserves him for you in the rookie draft.`,
    `When he’s drafted into the NFL your shares pay the better of his college price and his draft round (R1 8, R2 6, R3 5, later 2), up to ${rules.payout_cap ?? 3}× what you paid. If he leaves college undrafted, ${Math.round((rules.refund ?? 0.5) * 100)}% of what you paid comes back.`,
    `Selling pays today’s price, up to ${rules.payout_cap ?? 3}× what you paid; cash tops out at ${rules.cash_cap ?? 200} from sales.`,
    'Shares trade like players and picks: add them to any trade offer from the TRADES tab.',
    `${lockLine(st)}${st?.frozen ? ' Prices are frozen for the offseason.' : ''}`,
  ].join('\n\n');
}

// ── The market table (v0.577.0) ─────────────────────────────────────────────
// Founder: "a chart to show how far away before the player is fully owned …
// a button to see owners and shares … headers on the columns and sorting …
// simple filter buttons."

/** How far a stake is toward maxing — 20 shares or 60 points spent, whichever
 *  comes first — as 0..1. 1 is a maxed stake; the first to 1 owns the right. */
export function stakeProgress(shares: number, cost: number, rules: { max: number; max_spend?: number } = DEVY_SHARE_RULES): number {
  const bySh = rules.max > 0 ? shares / rules.max : 0;
  const byPts = (rules.max_spend ?? DEVY_SHARE_RULES.max_spend) > 0 ? cost / (rules.max_spend ?? DEVY_SHARE_RULES.max_spend) : 0;
  return Math.max(0, Math.min(1, Math.max(bySh, byPts)));
}

export interface MarketOwner { roster_id: number; team: string; shares: number; cost: number; progress: number; right: boolean; mine: boolean }
export interface MarketLine {
  row: DevyMarketRow; held: DevySharePlayer | null; price: number;
  /** My stake in shares, and how far it is toward maxing. */
  mine: number; myProgress: number;
  /** The furthest stake toward maxing (anyone's, mine included) — the bar. */
  lead: number; leadMine: boolean;
  owners: MarketOwner[]; totalShares: number;
  /** Who holds his right, if anyone. */
  right: { team: string; mine: boolean } | null;
}

/** A market row with the league's stakes in him laid alongside. */
export function marketLines(rows: DevyMarketRow[], st: DevySharesState | null | undefined, myRoster: number | null | undefined): MarketLine[] {
  const rules = { ...DEVY_SHARE_RULES, ...(st?.rules ?? {}) };
  const bySlug = new Map((st?.players ?? []).map((p) => [p.slug, p]));
  return rows.map((row) => {
    const held = bySlug.get(row.slug) ?? null;
    const owners: MarketOwner[] = (held?.holders ?? []).filter((h) => h.shares > 0).map((h) => ({
      roster_id: h.roster_id, team: h.team, shares: h.shares, cost: Number(h.cost ?? 0),
      progress: h.maxed ? 1 : stakeProgress(h.shares, Number(h.cost ?? 0), rules),
      right: held?.right?.roster_id === h.roster_id, mine: myRoster != null && h.roster_id === myRoster,
    })).sort((a, b) => Number(b.right) - Number(a.right) || b.progress - a.progress || b.shares - a.shares);
    const me = owners.find((o) => o.mine);
    const top = owners[0];
    const rightOwner = owners.find((o) => o.right);
    return {
      row, held, price: held?.price ?? row.price,
      mine: me?.shares ?? 0, myProgress: me?.progress ?? 0,
      lead: top?.progress ?? 0, leadMine: !!top?.mine,
      owners, totalShares: owners.reduce((n, o) => n + o.shares, 0),
      right: rightOwner ? { team: rightOwner.team, mine: rightOwner.mine } : null,
    };
  });
}

export type MarketSort = 'rank' | 'name' | 'price' | 'lead' | 'owners' | 'mine';
export type MarketFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'OPEN';
export const MARKET_FILTERS: { id: MarketFilter; label: string }[] = [
  { id: 'ALL', label: 'ALL' }, { id: 'QB', label: 'QB' }, { id: 'RB', label: 'RB' },
  { id: 'WR', label: 'WR' }, { id: 'TE', label: 'TE' }, { id: 'OPEN', label: 'NO RIGHT YET' },
];

/** Filter and sort the market. 'rank' is the market's own order (priced
 *  first, then StatHead's devy rank); a sort's first tap is the useful
 *  direction — A→Z for names, highest first for the numbers. */
export function shapeMarket(lines: MarketLine[], filter: MarketFilter, sort: MarketSort, dir: 'asc' | 'desc'): MarketLine[] {
  const kept = lines.filter((l) => filter === 'ALL' ? true
    : filter === 'OPEN' ? !l.right && l.lead < 1
    : l.row.pos === filter);
  if (sort === 'rank') return dir === 'asc' ? kept : [...kept].reverse();
  const val = (l: MarketLine): number | string =>
    sort === 'name' ? l.row.name.toLowerCase() : sort === 'price' ? l.price : sort === 'lead' ? l.lead : sort === 'mine' ? l.mine : l.owners.length;
  const sgn = dir === 'asc' ? 1 : -1;
  return [...kept].sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return c * sgn || a.row.name.localeCompare(b.row.name);
  });
}

/** The next state when a column header is tapped: a new column starts in its
 *  useful direction, the same column flips, and a third tap returns to the
 *  market's own order. */
export function nextSort(cur: { key: MarketSort; dir: 'asc' | 'desc' }, key: MarketSort): { key: MarketSort; dir: 'asc' | 'desc' } {
  const first: 'asc' | 'desc' = key === 'name' ? 'asc' : 'desc';
  if (cur.key !== key) return { key, dir: first };
  if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return { key: 'rank', dir: 'asc' };
}

/** The small line under a name: school, class, and where he ranks. */
export function marketSubline(r: DevyMarketRow): string {
  return [
    r.declared ? 'DECLARED' : null,
    r.school, r.fcs ? 'FCS' : null, r.class_year ? collegeClassLabel(r.class_year) : null,
    r.sh_rank ? `devy #${r.sh_rank}` : r.rank ? `#${r.rank} in college` : null,
  ].filter(Boolean).join(' · ');
}

// ── Launches (0407) ─────────────────────────────────────────────────────────
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LABELS = DOW;
/** "Tue 12:00 PM ET" — a launch slot in the commissioner's terms. */
export function slotLabel(cfg: Pick<DevyLaunchCfg, 'dow' | 'hour'>): string {
  const h = cfg.hour % 12 === 0 ? 12 : cfg.hour % 12;
  return `${DOW[cfg.dow] ?? '?'} ${h}:00 ${cfg.hour < 12 ? 'AM' : 'PM'} ET`;
}
/** "3d 4h" / "5h 20m" / "12m" until a moment. */
export function timeLeft(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return 'closing';
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

/** The banner over INVEST: what's launching, and when. Null when nothing is. */
export function launchBanner(ls: DevyLaunchState | null | undefined): { tone: 'open' | 'soon'; title: string; sub: string } | null {
  if (!ls?.ok || !ls.cfg?.on) return null;
  if (ls.open) {
    const n = ls.open.players.length;
    return { tone: 'open', title: `🚀 ${ls.open.kind === 'catchup' ? 'CATCH-UP LAUNCH' : 'LAUNCH'} OPEN · ${n} new player${n === 1 ? '' : 's'}`,
      sub: `Sealed orders close in ${timeLeft(ls.open.closes_at)}. Everyone fills together at the opening price; teams that max a player draw lots for his right.` };
  }
  const n = ls.pending_count ?? 0;
  if (!n) return null;
  return { tone: 'soon', title: `🆕 ${n} new player${n === 1 ? '' : 's'} listing`,
    sub: ls.catchup_next || ls.locked ? 'They open together in a catch-up launch when the market reopens.'
      : `They open together ${slotLabel(ls.cfg)} (in ${timeLeft(ls.next_at)}). Scout them now; nobody can buy them early.` };
}

/** What a sealed order may hold on one player: the commissioner's cap, a
 *  full stake (20 shares) and the 60-point stake cap at his opening price. */
export function launchOrderMax(price: number, cfg: Pick<DevyLaunchCfg, 'cap'> | null | undefined, rules: { max: number; max_spend?: number } = DEVY_SHARE_RULES): number {
  if (!(price > 0)) return 0;
  return Math.max(0, Math.min(cfg?.cap ?? rules.max, rules.max, Math.ceil((rules.max_spend ?? DEVY_SHARE_RULES.max_spend) / price)));
}

/** The launch's rules, for its ⓘ. */
export function launchRulesText(cfg: DevyLaunchCfg | null | undefined): string {
  const c = cfg ?? { on: true, dow: 2, hour: 12, window_h: 72, catchup_h: 168, cap: 20 };
  return [
    'New college players don’t go straight on sale — whoever happened to open the app first would get them. They list, and launch together.',
    `Every week (${slotLabel(c)}) the new listings open for ${c.window_h} hours. Place a sealed order on any of them, up to ${c.cap} shares. Nobody sees anyone else’s orders, and you can change yours until the window closes.`,
    'At the close every order fills together at the player’s opening price (his market price, or StatHead’s devy rank on the price curve). If more than one team maxes him, they draw lots: the winner is first to max and holds his right.',
    `Players who arrive while the market is locked (Jan 15 to the rookie draft) wait, and open together in a ${Math.round(c.catchup_h / 24)}-day catch-up launch when it reopens.`,
    'The commissioner sets the day, the hour, the windows and the order cap, and can switch launches off.',
  ].join('\n\n');
}

// ── The purchase sheet (v0.579.0) ───────────────────────────────────────────
export interface TradePreview {
  mode: 'buy' | 'sell';
  /** Shares this trade moves (clamped to what's allowed). */
  n: number;
  /** The most this trade could move: room to max and cash (buy), or the stake (sell). */
  maxN: number;
  /** Points out (buy) or in (sell). */
  amount: number;
  cashAfter: number;
  sharesAfter: number; costAfter: number; progressAfter: number;
  /** A buy that maxes his stake. */
  maxes: boolean;
  /** A sale paid at the 3× cap rather than today's price. */
  capped: boolean;
  ok: boolean; why: string | null;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

/** What a buy or sale of `n` shares would do — the server's arithmetic
 *  (0396: 20 shares or 60 points maxes a stake; a sale pays today's price up
 *  to 3× what was paid; cash tops out at 200 from sales). */
export function tradePreview(o: { mode: 'buy' | 'sell'; n: number; cur: number; cost: number; price: number; cash: number;
  rules?: { max: number; max_spend?: number; payout_cap?: number; cash_cap?: number } }): TradePreview {
  const R = { ...DEVY_SHARE_RULES, ...(o.rules ?? {}) };
  const price = Number(o.price) || 0;
  if (o.mode === 'buy') {
    const room = maxBuy(o.cur, o.cost, price, R.max, R.max_spend);
    const afford = price > 0 ? Math.floor((o.cash + 1e-9) / price) : 0;
    const maxN = Math.max(0, Math.min(room, afford));
    const n = Math.max(0, Math.min(Math.round(o.n), room));
    const amount = r2(n * price);
    const sharesAfter = o.cur + n, costAfter = r2(o.cost + amount);
    const ok = n > 0 && amount <= o.cash + 1e-9;
    return { mode: 'buy', n, maxN, amount, cashAfter: r2(o.cash - amount), sharesAfter, costAfter,
      progressAfter: stakeProgress(sharesAfter, costAfter, R), maxes: sharesAfter >= R.max || costAfter >= (R.max_spend ?? 60),
      capped: false, ok,
      why: room <= 0 ? 'your stake is maxed' : n > 0 && !ok ? `that's ${fmtPts(amount)} — you have ${fmtPts(o.cash)}` : null };
  }
  const n = Math.max(0, Math.min(Math.round(o.n), o.cur));
  const full = price * n;
  const capAmt = o.cur > 0 ? (R.payout_cap ?? 3) * o.cost * n / o.cur : 0;
  const amount = r2(Math.min(full, capAmt));
  const cashAfter = r2(o.cash + amount);
  const ok = n > 0 && cashAfter <= (R.cash_cap ?? 200) + 1e-9;
  const sharesAfter = o.cur - n, costAfter = o.cur > 0 ? r2(Math.max(0, o.cost - o.cost * n / o.cur)) : 0;
  return { mode: 'sell', n, maxN: o.cur, amount, cashAfter, sharesAfter, costAfter,
    progressAfter: stakeProgress(sharesAfter, costAfter, R), maxes: false, capped: amount < r2(full), ok,
    why: n > 0 && !ok ? `cash tops out at ${R.cash_cap ?? 200} — sell fewer` : null };
}
