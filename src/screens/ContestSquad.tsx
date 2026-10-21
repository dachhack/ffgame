// THE CONTEST SQUAD, web (v0.664.0; the builder v0.665.0) —
// docs/dfs-bullseye.md §13–14.
//
// One screen for every contest league: the builder before kickoff, the live
// numbers after. The spots are the league's own roster builder spots (S1…Sn
// from contest_state — a FLEX, an HC, a rookie-only RB are just spots), the
// budget is the league's, and the pick sheet sorts the way the contest
// scores. Saving goes through save_contest_entry, which re-checks everything.
//
// THE BUILDER (founder: "We want the budget and player selection to be a
// rich, interactive, fun experience on web and app"): a budget bar that fills
// as you pick, spot cards with the player's face, game and value, a pick
// sheet with position tabs from the league's own spots, a team filter,
// search, sort by projection / value / salary, every player's eligibility
// said in words (the spot's filter, the pool filter, your seat's rule), FILL
// FOR ME for the spots you haven't picked, and the week's injuries.
//
// The pre-0466 BullseyeSquad (BullseyeContest.tsx) stays for a salary-cap
// league that merely plays Bullseye; this one is for contest leagues.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { contestCardMove, contestApplyCardMove, type ContestCardMove } from '@drip/core/engine/contest';
import {
  contestState, addContestEntry, contestBuyPlay, type ContestPlayRow, saveContestEntry, podSalaries, weekGameLocks, weekSlateByTeam, seatPlayerRules, leagueGameMode, loadLiveInjuries, friendlyError,
  contestSwaps, contestBoard, contestLeague, type SwapRow, leagueWeekProjections,
  type ContestState, type PodSalaryRow, type SlateSpot,
} from '@drip/core/data/liveApi';
import { opponentMatchupGrade, matchupGradeLabel, MATCHUP_BAND_COLOR, MATCHUP_BAND_WORD, MATCHUP_GRADE_INFO } from '@drip/core/data/weekProj';
import { injuryFor } from '@drip/core/data/injuries';
import { type SeatRule, seatRuleText } from '@drip/core/data/seatRules';
import { contestPlaysFor, contestPlayAsPowerup, contestRedeal, contestPlayById, contestPlayCap, GHOST_POINTS,
  contestConfigOf, contestCard, contestSquadOf, contestTiebreak, contestSlotLabels, CONTEST_WORD,
  type ContestConfig,
} from '@drip/core/engine/contest';
import { CardTableCss, Felt, PlayerCard, SealedCard } from '../app/cardTable';
import { Sheet } from '../app/ui';
import { openPlayerCard } from '../app/playerCard';
import { ShopModal } from './LeagueOverview';
import { InfoChip } from './adminUi';
import { GHOST_PLAYER } from '@drip/core/engine/sim';
import { GHOST_CARD } from '@drip/core/data/ghostCard';
import { squadCardText } from '@drip/core/data/squadCard';
import { SITE_ORIGIN } from '@drip/core/data/invite';
import {
  builderTabs, rankCandidates, fillOpenSpots, budgetLine, roomFor, posLabel, valueOf, leagueWeekProj, pricedDelta, BUILDER_SORTS,
  type BuilderCtx, type BuilderPlayer, type BuilderSort, type PoolFilter,
} from '@drip/core/engine/contestBuilder';
import { classicSlotsFromSpec, type ClassicSlotDef, type ClassicScoring } from '@drip/core/engine/classic';
import { leagueCatalogOf } from '@drip/core/engine/projScoring';
import { projectedRing, tiebreakDistance } from '@drip/core/engine/dfsBullseye';
import { ringLabel } from '@drip/core/engine/bullseye';

const fmt$ = (n: number) => `$${n.toLocaleString('en-US')}`;
/** "18.1 ↑2.7" when the feed has moved since the price was set. */
const projWord = (p: BuilderPlayer): string => { const d = pricedDelta(p); return `${p.proj.toFixed(1)}${d ? ` ${d.dir}${d.by.toFixed(1)}` : ''}`; };
const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : fmt$(n));
const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14 };
const chip = (on: boolean, dim = false): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
  color: on ? 'var(--on-accent, var(--bg))' : dim ? 'var(--faint)' : 'var(--you)', background: on ? 'var(--you)' : 'transparent',
  border: `1px solid ${on ? 'var(--you)' : 'color-mix(in srgb, var(--you) 45%, var(--bd))'}`, borderRadius: 999, padding: '5px 12px',
});
const tabStyle = (on: boolean): CSSProperties => ({
  fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer', padding: '6px 10px',
  color: on ? 'var(--you)' : 'var(--dim)', background: 'none', border: 'none', borderBottom: `2px solid ${on ? 'var(--you)' : 'transparent'}`,
});
const small: CSSProperties = { fontSize: 10, color: 'var(--faint)' };
const head: CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' };
const input: CSSProperties = { fontSize: 13, padding: '7px 10px', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 6, fontFamily: 'inherit', boxSizing: 'border-box' };
const INJ_WORD: Record<string, string> = { O: 'OUT', D: 'DOUBTFUL', Q: 'QUESTIONABLE', IR: 'IR' };

/** How this contest scores, in a sentence. */
export function contestHowTo(cfg: ContestConfig): string {
  if (cfg.contest === 'golf') return 'Lowest score wins. Build the squad you think scores the FEWEST points — but a player who posts a zero banks the spot’s penalty, so a no-show is no bargain.';
  if (cfg.contest === 'high') return 'Highest score wins. Build the squad you think scores the most points under the budget.';
  const radius = cfg.bullseye?.radius ?? 10;
  return cfg.bullseye?.variant === 'total'
    ? `Build a squad whose points land as close to the card's total as you can. Dead-on doubles your score; any player who posts a zero costs ${radius}.`
    : `Every spot has a number. Pick the player you think lands closest to it: ${radius} points for dead-on plus ${radius} more for a bullseye, less the farther off. A zero costs ${radius}.`;
}

/** The league's spots and config from a contest_state read — what every
 *  room of a contest league needs to draw its squad. */
export function contestSetupOf(st: ContestState) {
  const slots = classicSlotsFromSpec(st.slots ?? null) ?? [];
  // v0.693.1: the coin and entries rules ride along — without `coin` the PLAYS bar, the shop and the hand never showed (founder: "Still don't see where I can buy powrups").
  const cfg = contestConfigOf({ contest: st.contest, contest_format: st.format, budget: st.budget, min_spend: st.min_spend ?? 0, roster_slots: st.slots, bullseye: st.variant, bullseye_radius: st.radius, coin: st.coin === true, max_entries: st.max_entries }, st.kind);
  const catalog = leagueCatalogOf({ scoring: (st.scoring_classic ?? null) as Partial<ClassicScoring> | null, ppr: st.ppr ?? null });
  return { slots, cfg, catalog, labels: contestSlotLabels(slots) };
}

/** Their squad, one row per spot: a player once his game locked, else sealed. */
function sealedRows(entry: unknown, slots: ClassicSlotDef[]): { slot: string; slug: string | null }[] {
  const rows = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const bySlot = new Map<string, string | null>();
  for (const r of rows) if (typeof r?.slot === 'string') bySlot.set(r.slot, r.sealed ? null : (typeof r.player_slug === 'string' ? r.player_slug : null));
  return slots.map((d) => ({ slot: d.slot, slug: bySlot.get(d.slot) ?? null }));
}

/** "vs KC · Sun 1:00p" / "@ KC · Mon 8:15p" / "BYE". */
export function gameLine(team: string, slate: Map<string, SlateSpot>): string {
  const g = slate.get(team);
  if (!g) return slate.size ? 'BYE' : '';
  const when = g.kickoff ? new Date(g.kickoff).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(', ', ' ').replace(' AM', 'a').replace(' PM', 'p') : '';
  return `${g.home ? 'vs' : '@'} ${g.opp}${when ? ` · ${when}` : ''}`;
}

/** "@ KC" and the matchup pill under a card (v0.732.0); a bye says so. */
function MatchupLine({ team, pos, slate, dvp }: { team: string; pos: string; slate: Map<string, SlateSpot>; dvp: Record<string, Record<string, number>> }) {
  if (!slate.size) return null;
  const g = slate.get(team);
  if (!g) return <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--warn, #c66)' }}>BYE</span>;
  const mg = opponentMatchupGrade(g.opp, pos, dvp);
  return (
    <span className="mono" title={mg ? `${MATCHUP_BAND_WORD[mg.band]} matchup — what ${g.opp} gives up to ${pos === 'DEF' ? 'DST' : pos}s vs the league average` : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 700, color: 'var(--text)' }}>
      {`${g.home ? 'vs' : '@'} ${g.opp}`}
      {mg && <span style={{ fontSize: 8, color: MATCHUP_BAND_COLOR[mg.band], border: `1px solid ${MATCHUP_BAND_COLOR[mg.band]}`, borderRadius: 4, padding: '0 4px' }}>{matchupGradeLabel(mg)}</span>}
    </span>
  );
}

function InjuryTag({ week, slug }: { week: number; slug: string }) {
  const s = injuryFor(week, slug);
  if (!s) return null;
  const bad = s === 'O' || s === 'IR';
  return <span className="mono" title={INJ_WORD[s]} style={{ fontSize: 8.5, fontWeight: 800, color: bad ? 'var(--warn, #c66)' : '#D9A441', border: `1px solid ${bad ? 'var(--warn, #c66)' : '#D9A441'}`, borderRadius: 3, padding: '0 3px', marginLeft: 5 }}>{s}</span>;
}

/** THE TIE-BREAKER CHIP (v0.682.2): what the number on the card means. */
const TB_NOTE = 'This spot is your tie-breaker: its player aims at this number. If the matchup ties on rings, the squad whose tie-breaker lands closer to its own number wins.';

export function ContestSquad({ leagueId, week: weekProp, onBack, embedded, onMatchup }: { leagueId: string; week?: number; onBack: () => void;
  /** Inside the league's own frame: no back row, no outer padding. */
  embedded?: boolean;
  /** THE HAND ON THE MATCHUP (v0.695.0): the plays are played from MATCHUP; this opens it. */
  onMatchup?: () => void }) {
  const [st, setSt] = useState<ContestState | null>(null);
  const [board, setBoard] = useState<PodSalaryRow[] | null>(null);
  const [locks, setLocks] = useState<Map<string, number>>(new Map());
  const [slate, setSlate] = useState<Map<string, SlateSpot>>(new Map());
  const [seatRule, setSeatRule] = useState<SeatRule | null>(null);
  const [poolFilter, setPoolFilter] = useState<PoolFilter | null>(null);
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [saved, setSaved] = useState<Record<string, string | null>>({});
  const [active, setActive] = useState<string | null | 'any'>(null);
  const [tab, setTab] = useState('ALL');
  const [team, setTeam] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<BuilderSort | null>(null);
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [injTick, setInjTick] = useState(0);
  // THE MATCHUP ON EACH CARD (v0.732.0): the season's defense-vs-position table, read once a week.
  const [dvp, setDvp] = useState<Record<string, Record<string, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  // MY SEATS (v0.682.0): which of my seats the builder is on; null = my first.
  const [rosterId, setRosterId] = useState<number | null>(null);
  // THE PLAYS (v0.685.0): this seat's armed plays (a badge on the spot, the phantom in it) and its wallet.
  // They are PLAYED from MATCHUP since v0.695.0 (founder: "put the card hand and power up application on the matchup").
  const [plays, setPlays] = useState<ContestPlayRow[]>([]);
  const [wallet, setWallet] = useState<number | null>(null);
  // THE SHOP AND THE HAND (v0.688.0): what the seat has bought and not yet played, and the shop sheet
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [shop, setShop] = useState(false);

  const load = useCallback(async () => {
    const s = await contestState(leagueId, weekProp, '2026', rosterId);
    setSt(s);
    if (!s.ok || s.week == null) return;
    setPlays(s.plays ?? []); setWallet(s.wallet ?? null); setInventory(s.inventory ?? {});
    const slots = classicSlotsFromSpec(s.slots ?? null) ?? [];
    const mine = contestSquadOf(s.entry, slots);
    setPicks(mine); setSaved(mine);
    const [rows, lk, sl] = await Promise.all([podSalaries(s.week, '2026', leagueId).catch(() => []), weekGameLocks(s.week, '2026', 0).catch(() => new Map<string, number>()), weekSlateByTeam(s.week).catch(() => new Map<string, SlateSpot>())]);
    setBoard(rows); setLocks(lk); setSlate(sl);
    void leagueWeekProjections(leagueId, s.week).then((r) => setDvp(r?.def_vs_pos ?? {})).catch(() => setDvp({}));
    void loadLiveInjuries(s.week).then(() => setInjTick((n) => n + 1));
  }, [leagueId, weekProp, rosterId]);
  useEffect(() => { void load().catch((e) => setNote(friendlyError(e))); }, [load]);
  // The pool filter and my seat's rule: what greys a player out before I tap him.
  useEffect(() => {
    leagueGameMode(leagueId).then((g) => { if (g.ok) setPoolFilter(g.pool_filter ?? null); }).catch(() => {});
    seatPlayerRules(leagueId).then((r) => { if (r.ok) setSeatRule((r.rules ?? []).find((x) => x.roster_id === (st?.roster_id ?? r.mine)) ?? null); }).catch(() => {});
  }, [leagueId, st?.roster_id]);
  // Live numbers: re-read while the week is being played.
  useEffect(() => {
    if (!st?.started || st.matchup?.status === 'final') return;
    const id = setInterval(() => { void contestState(leagueId, weekProp, '2026', rosterId).then(setSt).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [st?.started, st?.matchup?.status, leagueId, weekProp, rosterId]);

  const bySlug = useMemo(() => new Map((board ?? []).map((r) => [r.slug, r])), [board]);
  const salaryOf = useCallback((slug: string) => bySlug.get(slug)?.salary ?? 0, [bySlug]);
  const setup = useMemo(() => (st?.ok ? contestSetupOf(st) : null), [st]);
  const theCard = useMemo(() => (setup?.cfg?.contest === 'bullseye' && st?.week != null ? contestCard(leagueId, st.week, setup.slots, setup.catalog) : null), [leagueId, st?.week, setup]);
  const ctx = useMemo<BuilderCtx | null>(() => (setup?.cfg ? { slots: setup.slots, cfg: setup.cfg, picks, seatRule, poolFilter, card: theCard } : null), [setup, picks, seatRule, poolFilter, theCard]);
  const locked = useCallback((slug: string | null) => { if (!slug) return false; const t = locks.get(bySlug.get(slug)?.team ?? ''); return t != null && t <= now; }, [locks, bySlug, now]);
  // THE LEAGUE'S OWN PROJECTION (v0.666.0): the board's PPR number scaled to
  // this league's catalog (leagueWeekProj) — the price is the shared sheet,
  // the projection is yours. `feedProj` keeps the feed's number for the
  // "↑ since priced" readout.
  const players = useMemo<BuilderPlayer[]>(() => (board ?? []).map((r) => ({ slug: r.slug, name: r.name, pos: r.pos, team: r.team, salary: r.salary, proj: leagueWeekProj(r, setup?.catalog, r.pos === 'HC' ? (slate.size ? slate.get(r.team) ?? null : undefined) : undefined), feedProj: r.proj, priced: r.priced_proj ?? null, exp: r.exp ?? null })), [board, setup?.catalog, slate]);
  // RULED OUT (v0.666.0): O or IR on the report — not a new pick; one already
  // saved stays, swappable until his game locks (the server's rule too).
  const byPlayer = useMemo(() => new Map(players.map((p) => [p.slug, p])), [players]);
  const ruledOut = useCallback((slug: string) => { const s = injuryFor(st?.week ?? 0, slug); return s === 'O' || s === 'IR'; }, [st?.week, injTick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const teams = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players]);
  const tabs = useMemo(() => (setup ? builderTabs(setup.slots) : ['ALL']), [setup]);
  const dirty = useMemo(() => JSON.stringify(picks) !== JSON.stringify(saved), [picks, saved]);
  const playOn = useCallback((slot: string) => plays.find((x) => x.slot === slot && contestPlayById(x.id)?.target !== 'opp') ?? null, [plays]);
  const playAt = useCallback((slot: string) => plays.filter((x) => x.slot === slot && contestPlayById(x.id)?.target === 'opp'), [plays]);   // aimed across the table
  const ghosted = useCallback((slot: string) => playOn(slot)?.id === 'ghost', [playOn]);
  /** What the play chip opens: the play's line, its number, and where it is taken back. */
  const playInfo = (x: ContestPlayRow) => { const d = contestPlayById(x.id); return `${d?.blurb ?? ''}${x.proj != null ? `\n\nHis number to beat: ${Number(x.proj).toFixed(1)}.` : ''}\n\nOn this spot this week. Take it back on MATCHUP until his kickoff.`; };

  // SWAP HISTORY (0478): my seat's changes this week, newest first.
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [showSwaps, setShowSwaps] = useState(false);
  useEffect(() => {
    if (!st?.ok || st.roster_id == null || st.week == null) return;
    contestSwaps(leagueId, st.week, st.roster_id).then((r) => { if (r.ok) setSwaps(r.swaps ?? []); }).catch(() => {});
  }, [leagueId, st?.ok, st?.roster_id, st?.week, saved]);
  // THE SQUAD CARD (v0.676.0): share the squad once the week's games are on.
  const [shared, setShared] = useState<string | null>(null);
  // DRAG A CARD, THE HOOKS (v0.701.5: v0.700.0 put these after the early returns below, so the hook count changed
  // once the league loaded — "Rendered more hooks than during the previous render"). Every hook the drag uses lives
  // here, above every return; the handlers that read them follow the setup, below.
  type Over = string | 'trash' | null;
  const [drag, setDrag] = useState<{ slot: string; x: number; y: number; over: Over } | null>(null);
  const [bump, setBump] = useState<{ from: string; to: string; mv: ContestCardMove & { kind: 'bump' } } | null>(null);
  const dragRef = useRef<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const playerLite = useCallback((slug: string) => { const q = byPlayer.get(slug) as { slug: string; pos: string; team?: string | null; exp?: number | null } | undefined; return q ? { slug: q.slug, pos: q.pos, team: q.team ?? null, exp: q.exp ?? null } : null; }, [byPlayer]);
  const slotDefs = setup?.slots ?? [];
  const moveOf = useCallback((from: string, to: string): ContestCardMove => contestCardMove(slotDefs, picks, from, to, playerLite, { locked, ghosted }), [slotDefs, picks, playerLite, locked, ghosted]);
  // a finger that is dragging a card must not scroll the page; a long press must not open the context menu
  useEffect(() => {
    if (!drag) return;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('contextmenu', stop);
    return () => { document.removeEventListener('touchmove', stop); document.removeEventListener('contextmenu', stop); };
  }, [drag]);
  // The card's choice (v0.713.10) — its state sits above the early returns, with the other hooks.
  type AskP = { slug: string; name: string; pos: string; team: string | null };
  const [ask, setAsk] = useState<{ p: AskP; sub?: string; act: { label: string; run: () => void } | null } | null>(null);
  if (!st) return <div className="mono" style={{ padding: 24, ...small }}>Loading…</div>;
  if (!st.ok) return <div style={{ padding: 24 }}><div className="mono" style={{ color: 'var(--warn, #c66)', fontSize: 12 }}>{st.error}</div><button onClick={onBack} style={{ marginTop: 10 }}>← BACK</button></div>;
  if (!setup?.cfg || !setup.slots.length || !ctx) return <div style={{ padding: 24 }}><div className="mono" style={small}>This league has no spots to fill yet — its commissioner sets the roster.</div><button onClick={onBack}>← BACK</button></div>;
  const { slots, cfg, labels } = setup;
  const n = slots.length;
  const budget = cfg.budget;
  // NO CAP / THE FLOOR (v0.668.0): the bar fills against the cap, else the
  // minimum spend, else what's spent (a free squad is always 'full').
  const barBase = cfg.capped ? budget : cfg.minSpend > 0 ? cfg.minSpend : Math.max(1, cfg.slots.length * 3000);
  const bull = cfg.contest === 'bullseye';
  const isTotal = bull && cfg.bullseye?.variant === 'total';
  const radius = cfg.bullseye?.radius ?? 10;
  const mySide: 'home' | 'away' = st.matchup && st.matchup.home !== st.roster_id ? 'away' : 'home';
  const live = st.state?.slots?.filter((r) => r.side === mySide) ?? [];
  const liveOf = (slot: string) => live.find((r) => r.slot === slot);
  const myScore = st.matchup?.status === 'final' ? (mySide === 'home' ? st.matchup.home_final : st.matchup.away_final) : st.state ? (mySide === 'home' ? st.state.home : st.state.away) : null;
  const theirScore = st.opponent && st.state ? (mySide === 'home' ? st.state.away : st.state.home) : null;
  const myPoints = live.reduce((s, r) => s + (r.score || 0), 0);
  const editable = st.matchup?.status !== 'final';
  const myTb = theCard && st.roster_id != null && st.week != null ? contestTiebreak(leagueId, st.week, st.roster_id, theCard, slots, contestRedeal(plays)) : null;
  const tbLive = myTb ? liveOf(myTb.slot) : undefined;
  const myTbDist = st.matchup?.status === 'final'
    ? (mySide === 'home' ? st.matchup.home_tb : st.matchup.away_tb) ?? null
    : tbLive && myTb ? tiebreakDistance(tbLive.score, myTb.target, radius) : null;
  const tieBroken = bull && st.matchup?.status === 'final' && st.opponent && myScore != null && theirScore != null && Math.abs(Number(myScore) - Number(theirScore)) < 0.0101 && Number(myScore) !== Number(theirScore);
  const theirSquad = st.opponent ? sealedRows(st.opponent.entry, slots) : [];
  // a ghosted spot is filled (by the phantom, at no salary)
  const blRaw = budgetLine(ctx, salaryOf);
  const ghosts = slots.filter((d) => !picks[d.slot] && ghosted(d.slot)).length;
  const bl = { ...blRaw, open: blRaw.open - ghosts, perSpot: blRaw.open - ghosts > 0 ? Math.floor(blRaw.left / (blRaw.open - ghosts) / 100) * 100 : 0 };
  const filled = n - bl.open;
  const projTotal = Object.values(picks).reduce((s, slug) => s + (slug ? byPlayer.get(slug)?.proj ?? 0 : 0), 0);
  const week = st.week!;

  const share = async () => {
    if (!st?.ok || st.week == null) return;
    const [bd, lgInfo] = await Promise.all([contestBoard(leagueId, st.week, 1, 0).catch(() => null), contestLeague(leagueId).catch(() => null)]);
    const text = squadCardText({ variant: cfg.bullseye?.variant ?? null,
      league: st.name ?? 'Contest', week: st.week, contest: cfg.contest, status: st.matchup?.status === 'final' ? 'final' : st.started ? 'live' : null,
      slots, labels, picks, nameOf: (slug) => bySlug.get(slug)?.name ?? slug,
      scoreOf: (slot) => { const r = live.find((x) => x.slot === slot); return r ? r.score : null; },
      total: myScore != null ? Number(myScore) : null, rank: bd?.me?.rank ?? null, entries: bd?.entries ?? null,
      opponent: st.opponent ? { team: st.opponent.team, score: theirScore != null ? Number(theirScore) : null } : null,
      link: lgInfo?.invite_code ? `${SITE_ORIGIN}/?bullseye=${lgInfo.invite_code}` : null,
    });
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) { await (navigator as Navigator & { share: (d: { text: string }) => Promise<void> }).share({ text }); setShared('✓ shared'); return; }
    } catch { /* the sheet was dismissed — fall through to the clipboard */ }
    try { await navigator.clipboard.writeText(text); setShared('✓ copied — paste it anywhere'); } catch { setShared('couldn’t copy'); }
    setTimeout(() => setShared(null), 2500);
  };
  const save = async () => {
    if (filled < n) { setNote(`Fill all ${n} spots first.`); return; }
    setBusy(true); setNote(null);
    try {
      const r = await saveContestEntry(leagueId, week, picks as Record<string, string>, '2026', st.roster_id);
      setNote(r.ok ? '✓ squad saved' : (r.error ?? 'Didn’t save.'));
      if (r.ok) await load();
    } catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const fill = () => {
    const built = fillOpenSpots(players.filter((p) => !locked(p.slug)), ctx, `${leagueId}|w${week}|${st.roster_id}|${Date.now()}`, ruledOut);
    for (const d of slots) if (ghosted(d.slot)) built[d.slot] = null;   // the phantom keeps its spot
    const open = slots.filter((d) => !picks[d.slot]).length;
    const got = slots.filter((d) => !picks[d.slot] && built[d.slot]).length;
    setPicks(built);
    setNote(got === open ? `✓ filled ${got} spot${got === 1 ? '' : 's'} — swap any you like, then save` : got ? `filled ${got} of ${open} — the rest don’t fit the budget; free some up` : 'nothing fits the budget — clear a pricey pick first');
  };
  // ANOTHER ENTRY (v0.682.0): a second seat under the league's rule; the builder moves to it.
  const another = async () => {
    const nm = window.prompt('A name for your new entry (blank for a default):', '') ;
    if (nm === null) return;
    setBusy(true);
    const r = await addContestEntry(leagueId, nm).catch((e) => ({ ok: false, error: friendlyError(e) } as { ok: boolean; error?: string; roster_id?: number; team?: string }));
    setBusy(false);
    if (!r.ok) { setNote(r.error ?? 'Couldn’t add an entry.'); return; }
    setNote(`✓ ${r.team ?? 'your new entry'} is in — build its squad`);
    setRosterId(r.roster_id ?? null);
  };
  const clearAll = () => {
    const keep: Record<string, string | null> = {};
    for (const d of slots) keep[d.slot] = locked(picks[d.slot]) ? picks[d.slot] : null;
    setPicks(keep);
  };
  const openSheet = (slot: string | 'any') => {
    setActive(slot); setSearch(''); setTeam('');
    const d = slot === 'any' ? null : slots.find((x) => x.slot === slot);
    setTab(d && d.pos.length === 1 ? d.pos[0] : 'ALL');
  };
  // DRAG A CARD (v0.700.0, founder: "Long press on a card and you can drag it to a trash can or any eligible
  // swappable spot. If you move it to a spot that can't swap back trash that card with a info note about what will
  // happen."). Press and hold lifts the card (mouse or finger); it rides the pointer, eligible spots light up, a bar
  // at the top of the felt is the trash. The rule is the engine's contestCardMove; a bump (the spot's player can't
  // stand where the card came from) asks first, in a note under the felt.
  // (the hooks of the drag sit above the early returns, with the other hooks — v0.701.5)
  const overAt = (x: number, y: number): Over => {
    const from = dragRef.current;
    for (const el of document.elementsFromPoint(x, y)) {
      const spot = (el as HTMLElement).dataset?.dropSlot;
      if (spot && spot !== from) return spot;
      if ((el as HTMLElement).dataset?.dropTrash != null) return 'trash';
    }
    return null;
  };
  const endDrag = () => { dragRef.current = null; setDrag(null); if (holdTimer.current != null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; } pressAt.current = null; };
  const dropAt = (over: Over) => {
    const from = dragRef.current;
    endDrag();
    if (!from || !over) return;
    const mover = picks[from] ? byPlayer.get(picks[from]!) : null;
    if (!mover) return;
    if (over === 'trash') { setPicks({ ...picks, [from]: null }); return; }
    const mv = moveOf(from, over);
    if (mv.kind === 'no') { setNote(`${mover.name} can’t go to ${labels[over]} — ${mv.why}`); return; }
    if (mv.kind === 'bump') { setBump({ from, to: over, mv }); return; }
    setPicks(contestApplyCardMove(picks, from, over, mv));
  };
  const onCardPointerDown = (slot: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pressAt.current = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget; const id = e.pointerId; const x = e.clientX; const y = e.clientY;
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      dragRef.current = slot; swallowClick.current = true;
      try { el.setPointerCapture(id); } catch { /* a pointer that already ended */ }
      setDrag({ slot, x, y, over: null });
    }, 320);
  };
  const onCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) { const over = overAt(e.clientX, e.clientY); setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, over } : d)); return; }
    const a = pressAt.current;
    if (a && holdTimer.current != null && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 8) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
  };
  const onCardPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) { dropAt(overAt(e.clientX, e.clientY)); window.setTimeout(() => { swallowClick.current = false; }, 0); return; }
    if (holdTimer.current != null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    pressAt.current = null;
  };
  const dragPlayer = drag && picks[drag.slot] ? byPlayer.get(picks[drag.slot]!) : null;
  // THE GAME LOG FROM ANY CARD (v0.713.10, founder: "in your matchup, my team
  // and when looking at players to swap or add to your lineup we need the
  // ability to see the game logs for players. Maybe tap the card and you get
  // the action (select or replace) and the option to see the game log?").
  const logOf = (p: AskP) => openPlayerCard({ slug: p.slug, name: p.name, pos: p.pos, team: p.team ?? '', week, tab: 'log' });
  const put = (slug: string, slot: string | null) => {
    if (!slot) return;
    if (ghosted(slot)) { setNote('that spot holds a ghost — disarm it to put a player there'); setActive(null); return; }
    const next = { ...picks };
    for (const [s, v] of Object.entries(next)) if (v === slug) next[s] = null;   // he moves, he doesn't double up
    next[slot] = slug;
    setPicks(next);
    setActive(null);
  };
  const rows = active ? rankCandidates(players, ctx, { slot: active === 'any' ? null : active, tab, team: team || null, needle: search, sort: sort ?? undefined, locked, hideIneligible: eligibleOnly, ruledOut, saved }, salaryOf) : [];
  const sortNow: BuilderSort = sort ?? (bull && !isTotal ? 'aim' : 'proj');
  const activeDef = active && active !== 'any' ? slots.find((d) => d.slot === active) ?? null : null;
  const barPct = Math.min(100, Math.round((bl.spent / barBase) * 100));
  const blocked = filled >= n && (bl.over || bl.short > 0);

  return (
    <div style={embedded ? { display: 'grid', gap: 12 } : { maxWidth: 760, margin: '0 auto', padding: '14px 14px 60px', display: 'grid', gap: 12 }}>
      <CardTableCss />
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={onBack} className="mono" style={chip(false)}>← BACK</button>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)' }}>{st.name ?? 'CONTEST'}</span>
          <span className="mono" style={small}>{`Week ${week} · ${CONTEST_WORD[cfg.contest]}`}</span>
        </div>
      )}

      {/* the card, or the rule */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{bull ? 'THIS WEEK’S CARD' : CONTEST_WORD[cfg.contest]}</span>
          {isTotal && theCard && <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--you)' }}>{theCard.total}</span>}
          {/* THE SQUAD'S TOTAL (v0.667.2, founder: "a total projected for
              bullseye weekly leagues"): what the picks add up to, against
              the card's sum — the whole aim of a Bullseye week in one line. */}
          {!st.started && filled > 0 && (
            <span className="mono" style={{ ...small, marginLeft: 'auto' }} title="what your picks project to add up to">
              PROJECTS <b style={{ fontSize: 13, color: 'var(--text)' }}>{projTotal.toFixed(1)}</b>{bull && theCard ? ` · card ${theCard.total} (${projTotal - theCard.total >= 0 ? '+' : ''}${(projTotal - theCard.total).toFixed(1)})` : ''}
            </span>
          )}
          <span className="mono" style={{ ...small, marginLeft: !st.started && filled > 0 ? 0 : 'auto' }}>{`WEEK ${week}`}</span>
        </div>
        {bull && !isTotal && theCard && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {slots.map((d) => (
              <span key={d.slot} className="mono" style={{ fontSize: 11, border: '1px solid var(--bd)', borderRadius: 6, padding: '3px 8px' }}>
                {labels[d.slot]} <b style={{ color: 'var(--you)' }}>{theCard.targets[d.slot]}</b>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.45 }}>{contestHowTo(cfg)}</div>
        {(seatRule || poolFilter?.teams?.length || poolFilter?.min_exp != null || poolFilter?.max_exp != null) && (
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
            {seatRule && <span>⚑ Your seat takes <b style={{ color: 'var(--you)' }}>{seatRuleText(seatRule) || 'some players'}</b> only. </span>}
            {poolFilter?.teams?.length ? <span>{`The pool is ${poolFilter.teams.length} teams. `}</span> : null}
          </div>
        )}
        {myTb && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
            ⚖️ TIE-BREAKER: your <b style={{ color: 'var(--you)' }}>{labels[myTb.slot]}</b> aims at <b style={{ color: 'var(--you)' }}>{myTb.target}</b> — it only counts if you tie, and closer wins.
            {myTbDist != null && <span>{` Now ${myTbDist.toFixed(1)} off.`}</span>}
          </div>
        )}
      </div>

      {/* the score, once the week is on */}
      {st.started && (
        <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{st.matchup?.status === 'final' ? 'FINAL' : 'LIVE'}</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--you)' }}>{myScore != null ? Number(myScore).toFixed(1) : '—'}</span>
          {bull && <span className="mono" style={small}>{`${myPoints.toFixed(1)} pts${isTotal && theCard ? ` · target ${theCard.total} · ${Math.abs(myPoints - theCard.total).toFixed(1)} off` : ''}`}</span>}
          {st.opponent && (
            <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{`vs ${st.opponent.team ?? 'opponent'} · ${theirScore != null ? Number(theirScore).toFixed(1) : '—'}`}</span>
          )}
          <button onClick={() => void share()} className="mono" title="Share your squad — the share sheet, or copied to paste anywhere" style={chip(false)}>{shared ?? '↗ SHARE'}</button>
          {tieBroken && (
            <span className="mono" style={{ ...small, flexBasis: '100%' }}>{`Tied on rings — settled by the tie-breaker (${myTbDist?.toFixed(1) ?? '—'} off vs ${(mySide === 'home' ? st.matchup!.away_tb : st.matchup!.home_tb)?.toFixed(1) ?? '—'} off).`}</span>
          )}
        </div>
      )}

      {/* THE BUDGET BAR */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{bl.capped ? 'BUDGET' : 'SPEND'}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: bl.over || (bl.short > 0 && filled >= n) ? 'var(--warn, #c66)' : 'var(--you)' }}>{bl.capped ? fmt$(bl.left) : fmt$(bl.spent)}</span>
          <span className="mono" style={small}>{bl.capped ? (bl.over ? `over by ${fmt$(-bl.left)}` : `left of ${fmt$(budget)}`) : bl.floor > 0 ? (bl.short > 0 ? `${fmt$(bl.short)} short of the ${fmt$(bl.floor)} minimum` : `✓ past the ${fmt$(bl.floor)} minimum`) : 'no cap'}</span>
          {bl.capped && bl.floor > 0 && <span className="mono" style={small}>{bl.short > 0 ? `· min ${fmt$(bl.floor)} (${fmt$(bl.short)} to go)` : `· ✓ min ${fmt$(bl.floor)}`}</span>}
          <span className="mono" style={{ ...small, marginLeft: 'auto' }}>{bl.open ? (bl.capped ? `${bl.open} open · ${fmtK(bl.perSpot)} each` : `${bl.open} open`) : 'every spot filled'}</span>
        </div>
        <div style={{ height: 10, borderRadius: 999, background: 'var(--bg)', border: '1px solid var(--bd)', overflow: 'hidden', display: 'flex' }}>
          {slots.map((d) => {
            const slug = picks[d.slot];
            if (!slug) return null;
            const w = Math.max(0.5, (salaryOf(slug) / barBase) * 100);
            return <div key={d.slot} title={`${labels[d.slot]} · ${bySlug.get(slug)?.name ?? slug} · ${fmt$(salaryOf(slug))}`} style={{ width: `${w}%`, background: bl.over ? 'var(--warn, #c66)' : `color-mix(in srgb, var(--you) ${55 + (slots.indexOf(d) % 3) * 15}%, var(--bg))`, borderRight: '1px solid var(--surface)' }} />;
          })}
          {!bl.over && barPct < 100 && <div style={{ flex: 1 }} />}
        </div>
        <div className="mono" style={{ ...small, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{`${fmt$(bl.spent)} spent`}</span>
          {!st.started && <span>{`projects ${projTotal.toFixed(1)}${isTotal && theCard ? ` vs ${theCard.total}` : ''}`}</span>}
          {filled > 0 && <span>{`value ${valueOf({ salary: bl.spent, proj: projTotal }).toFixed(2)} per $1k`}</span>}
        </div>
      </div>

      {/* THE SHOP (v0.688.0, founder: "the power ups in a shop and floating hand like in drip leagues"): the shop
          buys a play into the hand. The hand itself sits on MATCHUP since v0.695.0 ("power up store stays in my team"). */}
      {cfg.coin && editable && (
        <div style={{ ...card, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={head}>PLAYS</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--you)' }}>{`◎ ${Math.round(wallet ?? 0)}`}</span>
          <button onClick={() => setShop(true)} className="mono" style={chip(false)}>🛒 SHOP</button>
          <span className="mono" style={small}>{`${Object.values(inventory).reduce((a, b) => a + b, 0)} in hand · ${plays.length} of ${st.play_cap ?? contestPlayCap(cfg.format)} played`}</span>
          {onMatchup && <button onClick={onMatchup} className="mono" style={chip(false)}>▶ PLAY ON MATCHUP</button>}
          <InfoChip title="Plays" info={'Buy a play in the shop; it lands in your hand. The hand sits at the foot of MATCHUP: tap a card there to play it, and tap TAKE BACK to put it back. One a week (two head-to-head).\n\nA spot play goes on until that player’s own kickoff. A squad play (Hail Mary, Pick Six and the other squad bonuses, Curse, Re-deal, Spy) before the week’s first kickoff.'} />
        </div>
      )}
      {shop && (
        <ShopModal onClose={() => setShop(false)} coinsOverride={wallet ?? 0} inventoryOverride={inventory}
          items={contestPlaysFor(cfg.format, cfg.contest, st.plays_off).map(contestPlayAsPowerup)}
          onBuy={async (id) => {
            const r = await contestBuyPlay(leagueId, id, st.roster_id).catch((e) => ({ ok: false, error: friendlyError(e) } as { ok: boolean; error?: string; wallet?: number | null; inventory?: Record<string, number> }));
            if (!r.ok) return r.error ?? 'Couldn’t buy it.';
            setWallet(r.wallet ?? null); setInventory(r.inventory ?? {});
            return true;
          }} />
      )}
      {/* MY SQUAD: the spot cards */}
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={head}>{`MY SQUAD · ${filled} OF ${n}`}</span>
          {/* MY SEATS (v0.682.0): a member with several entries builds one at a time */}
          {(st.seats?.length ?? 0) > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(st.seats ?? []).map((x) => <button key={x.roster_id} disabled={busy} onClick={() => setRosterId(x.roster_id)} className="mono" style={chip(x.roster_id === st.roster_id)}>{x.team ?? `Seat ${x.roster_id}`}</button>)}
            </div>
          )}
          {editable && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(st.max_entries ?? 1) > (st.seats?.length ?? 1) && <button disabled={busy} onClick={() => void another()} className="mono" style={chip(false)} title={`this league allows ${st.max_entries} entries per member`}>＋ ANOTHER ENTRY</button>}
              <button onClick={() => openSheet('any')} className="mono" style={chip(false)}>＋ PLAYERS</button>
              {bl.open > 0 && <button onClick={fill} className="mono" style={chip(false)}>✨ FILL FOR ME</button>}
              {filled > 0 && <button onClick={clearAll} className="mono" style={chip(false, true)}>CLEAR</button>}
            </div>
          )}
        </div>
        {swaps.length > 0 && (
          <div className="mono" style={{ ...small, display: 'grid', gap: 2 }}>
            <button onClick={() => setShowSwaps((v) => !v)} className="mono" style={{ ...chip(false, true), justifySelf: 'start' }}>{`🔁 ${swaps.length} SWAP${swaps.length === 1 ? '' : 'S'} THIS WEEK ${showSwaps ? '▲' : '▼'}`}</button>
            {showSwaps && swaps.map((x) => (
              <span key={x.id}>{`${new Date(x.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${labels[x.slot] ?? x.slot}: ${x.out_name ? `out ${x.out_name}` : 'filled'}${x.in_name ? `, in ${x.in_name}` : ', emptied'}${x.kind === 'commish' ? ' — by the commissioner' : x.kind === 'sub' ? ' — swapped for you (ruled out)' : ''}`}</span>
            ))}
          </div>
        )}
        {/* THE DEAL (v0.681.0, founder: "incorporate the card theme into the
            purchase interaction"): a spot is a card on the felt — yours face
            up, an open one the deck's back with ＋ PICK on it; buying a player
            deals him in. The numbers sit under each card. */}
        <Felt>
          <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', padding: '4px 0' }}>
            {slots.map((d, i) => {
              const landing = drag && drag.slot !== d.slot ? moveOf(drag.slot, d.slot) : null;
              const canLand = !!landing && landing.kind !== 'no';
              const slug = picks[d.slot];
              const p = slug ? byPlayer.get(slug) : null;
              const target = theCard?.targets[d.slot];
              const lv = liveOf(d.slot);
              const isLocked = locked(slug);
              const canTap = editable && !isLocked;
              const changed = slug !== saved[d.slot];
              const hint = d.flt?.teams?.length ? `${d.flt.teams.join('/')} only` : d.flt?.min_exp != null || d.flt?.max_exp != null ? `${d.flt.min_exp === 0 && d.flt.max_exp === 0 ? 'rookies' : `${d.flt.min_exp ?? 0}–${d.flt.max_exp ?? '∞'} yrs`} only` : d.pos.length > 1 ? d.pos.map(posLabel).join('/') : bl.capped ? `up to ${fmtK(Math.max(0, bl.left - (bl.open - 1) * 3000))}` : 'any price';
              const dim = 'color-mix(in srgb, var(--text) 75%, transparent)';
              return (
                <div key={d.slot} data-drop-slot={d.slot} style={{ width: 104, display: 'grid', gap: 4, justifyItems: 'center', alignContent: 'start', opacity: drag?.slot === d.slot ? 0.35 : 1 }}>
                  {/* THE PLAY CHIP rides the label row, above the card (v0.696.6, founder: "Don't even do the power up icon in
                      my team. Put the chip at the top of the card."); tap it for the play's details. */}
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em', color: changed ? 'var(--you)' : dim, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5, height: 16, overflow: 'visible' }}>
                    {`${labels[d.slot]}${bull && !isTotal && target != null ? ` · 🎯 ${target}` : ''}${!bull && d.zeroPts != null ? ` · 0→${d.zeroPts}` : ''}`}
                    {playOn(d.slot) && <InfoChip label="⚡ UP" title={contestPlayById(playOn(d.slot)!.id)?.name ?? playOn(d.slot)!.id} info={playInfo(playOn(d.slot)!)} />}
                  </span>
                  <div style={{ borderRadius: 12, outline: canLand ? `2px ${drag?.over === d.slot ? 'solid' : 'dashed'} var(--you)` : changed ? '2px solid var(--you)' : 'none', outlineOffset: 3, opacity: isLocked && !lv ? 0.8 : 1, touchAction: p && canTap ? 'pan-y' : undefined, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } as CSSProperties}
                    onPointerDown={p && canTap ? onCardPointerDown(d.slot) : undefined} onPointerMove={onCardPointerMove} onPointerUp={onCardPointerUp} onPointerCancel={() => endDrag()}
                    onClickCapture={(e) => { if (swallowClick.current) { e.stopPropagation(); e.preventDefault(); } }}>
                    {p
                      ? <PlayerCard key={p.slug} slug={p.slug} name={p.name} pos={p.pos} team={p.team} flip idx={i} locked={isLocked} bank={lv ? lv.score : undefined} onClick={canTap ? () => setAsk({ p, sub: `${labels[d.slot]} · ${fmt$(p.salary)}`, act: { label: 'Replace', run: () => openSheet(d.slot) } }) : isLocked ? () => logOf(p) : undefined} chip={myTb?.slot === d.slot ? String(myTb.target) : null} onChip={() => setNote(TB_NOTE)} />
                      : ghosted(d.slot)
                        ? <PlayerCard key="ghost" slug={GHOST_PLAYER.id} name={GHOST_CARD.name} pos="FLEX" team={null} flip idx={i} bank={lv ? lv.score : undefined} badge="👻" />
                        : <SealedCard key="open" seed={`${leagueId}|${d.slot}`} idx={i} tag={editable ? `＋ PICK ${labels[d.slot]}` : 'EMPTY'} onClick={canTap ? () => openSheet(d.slot) : undefined} chip={myTb?.slot === d.slot ? String(myTb.target) : null} onChip={() => setNote(TB_NOTE)} />}
                  </div>
                  <span className="mono" style={{ fontSize: 9.5, color: dim, textAlign: 'center', lineHeight: 1.3, minHeight: 25 }}>
                    {p
                      ? (lv ? <>{lv.score.toFixed(1)}{lv.play && lv.raw != null && Math.abs(lv.raw - lv.score) > 1e-9 ? <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{` ${lv.raw.toFixed(1)}`}</span> : null}{lv.aim ? ` · ${ringLabel(lv.aim.dist, radius)} +${lv.aim.ring}` : ''}</> : `${fmt$(p.salary)} · proj ${projWord(p)}${bull && !isTotal && target != null ? ` · aims ${projectedRing(p.proj, target, radius).toFixed(1)}` : ''}`)
                      : ghosted(d.slot) ? `a phantom · ${GHOST_POINTS} flat, no salary` : hint}
                    {p && <InjuryTag key={injTick} week={week} slug={p.slug} />}
                  </span>
                  {p && canTap && (
                    <button onClick={(e) => { e.stopPropagation(); setPicks({ ...picks, [d.slot]: null }); }} title="clear this spot" className="mono"
                      style={{ background: 'none', border: '1px solid color-mix(in srgb, var(--text) 30%, transparent)', borderRadius: 999, color: dim, fontSize: 10, cursor: 'pointer', padding: '2px 8px' }}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
          {/* THE TRASH, while a card is up; and the card itself, riding the pointer */}
          {drag && (
            <div data-drop-trash="" className="mono" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, height: 44, borderRadius: 10, border: `2px dashed ${drag.over === 'trash' ? 'var(--warn, #c66)' : 'rgba(255,255,255,0.8)'}`, background: drag.over === 'trash' ? 'color-mix(in srgb, var(--warn, #c66) 45%, transparent)' : 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em' }}>
              {drag.over === 'trash' ? '🗑 LET GO TO REMOVE' : '🗑 DROP HERE TO REMOVE'}
            </div>
          )}
          {drag && dragPlayer && (
            <div style={{ position: 'fixed', zIndex: 60, left: drag.x - 52, top: drag.y - 75, pointerEvents: 'none', transform: 'scale(1.08) rotate(-3deg)', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.45))' }}>
              <PlayerCard slug={dragPlayer.slug} name={dragPlayer.name} pos={dragPlayer.pos} team={dragPlayer.team} idx={0} />
            </div>
          )}
          </div>
        </Felt>
        {bump && (() => {
          const mover = picks[bump.from] ? byPlayer.get(picks[bump.from]!) : null; const other = byPlayer.get(bump.mv.other);
          return (
            <div className="mono" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 8 }}>
              <span>{`${mover?.name ?? 'He'} takes ${labels[bump.to]}. ${other?.name ?? 'The player there'} can’t move to ${labels[bump.from]} (it ${bump.mv.why}), so he leaves the squad and ${labels[bump.from]} opens up.`}</span>
              <button className="mono" style={chip(true)} onClick={() => { setPicks(contestApplyCardMove(picks, bump.from, bump.to, bump.mv)); setBump(null); }}>MOVE HIM</button>
              <button className="mono" style={chip(false)} onClick={() => setBump(null)}>KEEP IT</button>
            </div>
          );
        })()}
        {editable && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button onClick={() => void save()} disabled={busy || filled < n || blocked || !dirty} className="mono" style={chip(true)}>{dirty ? 'SAVE SQUAD' : 'SAVED'}</button>
            <span className="mono" style={small}>{filled < n ? `${n - filled} to fill` : bl.over ? 'over the budget' : bl.short > 0 ? `${fmt$(bl.short)} under the minimum spend` : dirty ? 'unsaved changes' : 'your squad is in'}</span>
            {note && <span className="mono" style={{ fontSize: 11, color: note.startsWith('✓') ? 'var(--you)' : 'var(--warn, #c66)' }}>{note}</span>}
          </div>
        )}
      </div>

      {/* THEIR SQUAD, SEALED (v0.660.1): each player shows once his game locks. */}
      {st.opponent && (
        <div style={{ ...card, display: 'grid', gap: 2 }}>
          <span className="mono" style={{ ...head, marginBottom: 4 }}>{`${(st.opponent.team ?? 'OPPONENT').toUpperCase()}’S SQUAD`}</span>
          {theirSquad.map((r) => {
            const lv = st.state?.slots?.find((x) => x.side !== mySide && x.slot === r.slot);
            const p = r.slug ? bySlug.get(r.slug) : null;
            return (
              <div key={r.slot} className="mono"
                style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) 70px', gap: 8, fontSize: 12, padding: '4px 0', borderTop: '1px solid var(--bd)' }}>
                <span style={{ color: 'var(--faint)' }}>{labels[r.slot]}{playAt(r.slot).map((x) => ` ${contestPlayById(x.id)?.icon ?? ''}`).join('')}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: r.slug ? 'var(--text)' : 'var(--faint)' }}>{r.slug ? (p?.name ?? r.slug) : playAt(r.slot).some((x) => x.id === 'spy') ? '👁️ nobody there yet' : '🔒 sealed until his game locks'}</span>
                <span style={{ textAlign: 'right' }}>{lv ? lv.score.toFixed(1) : ''}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* THE CARD'S CHOICE (v0.713.10): its move, or his game log — above the pick sheet, below the player card. */}
      {ask && (
        <Sheet title={ask.p.name} subtitle={ask.sub} onClose={() => setAsk(null)} max={360} zIndex={70}>
          <div style={{ display: 'grid', gap: 8 }}>
            {ask.act && (
              <button className="mono" onClick={() => { const a = ask.act!; setAsk(null); a.run(); }}
                style={{ fontSize: 12, fontWeight: 800, padding: '11px 12px', borderRadius: 8, cursor: 'pointer', color: 'var(--on-accent)', background: 'var(--you)', border: '1px solid var(--you)' }}>{ask.act.label.toUpperCase()}</button>
            )}
            <button className="mono" onClick={() => { const p = ask.p; setAsk(null); logOf(p); }}
              style={{ fontSize: 12, fontWeight: 800, padding: '11px 12px', borderRadius: 8, cursor: 'pointer', color: 'var(--you)', background: 'transparent', border: '1px solid var(--you)' }}>GAME LOG</button>
          </div>
        </Sheet>
      )}

      {/* THE PICK SHEET */}
      {active && (
        <div onClick={() => setActive(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, width: 'min(760px, 100%)', height: 'min(88vh, 900px)', borderRadius: '12px 12px 0 0', display: 'grid', gridTemplateRows: 'auto auto auto auto minmax(0,1fr)', gap: 8, padding: '12px 14px' }}>
            {/* which spot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => openSheet('any')} className="mono" style={chip(active === 'any')}>ANY SPOT</button>
              {slots.map((d) => (
                <button key={d.slot} onClick={() => openSheet(d.slot)} disabled={locked(picks[d.slot])} className="mono" title={picks[d.slot] ? bySlug.get(picks[d.slot]!)?.name : 'open'}
                  style={{ ...chip(active === d.slot, !!picks[d.slot]), padding: '4px 9px' }}>{labels[d.slot]}{picks[d.slot] ? ' ·' : ''}</button>
              ))}
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ ...small, fontWeight: 700, color: bl.over ? 'var(--warn, #c66)' : 'var(--you)' }}>{`${fmt$(bl.left)} left`}</span>
              <button onClick={() => setActive(null)} className="mono" style={chip(false)}>✕</button>
            </div>
            {/* position tabs */}
            <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--bd)', overflowX: 'auto' }}>
              {tabs.map((tb) => <button key={tb} onClick={() => setTab(tb)} className="mono" style={tabStyle(tab === tb)}>{posLabel(tb)}</button>)}
            </div>
            {/* search, team, sort */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search players…" autoFocus style={{ ...input, flex: '1 1 160px', minWidth: 120 }} />
              <select value={team} onChange={(e) => setTeam(e.target.value)} className="mono" style={{ ...input, width: 96, fontSize: 11 }}>
                <option value="">ALL TEAMS</option>
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 4 }}>
                {(bull && !isTotal ? [{ id: 'aim' as BuilderSort, label: 'CLOSEST' }, ...BUILDER_SORTS] : BUILDER_SORTS).map((s) => (
                  <button key={s.id} onClick={() => setSort(s.id)} className="mono" style={{ ...chip(sortNow === s.id), padding: '3px 8px', fontSize: 9.5 }}>{s.label}</button>
                ))}
              </div>
              <label className="mono" style={{ ...small, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} /> eligible only
              </label>
            </div>
            <div className="mono" style={small}>
              {activeDef ? `Picking ${labels[activeDef.slot]}${bull && !isTotal && theCard ? ` · aim at ${theCard.targets[activeDef.slot]}` : ''} · room ${fmt$(Math.max(0, roomFor(ctx, activeDef.slot, salaryOf)))}` : 'Any spot: each player lands in the tightest open spot that takes him.'}
              {` · ${rows.length} shown`}
              {slate.size > 0 && <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}>· matchup <InfoChip title="Matchup" info={MATCHUP_GRADE_INFO} /></span>}
            </div>
            {/* the players, dealt as cards (v0.681.0): the price under each; tap to buy */}
            <div style={{ overflowY: 'auto' }}>
              <Felt>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
                  {rows.slice(0, 120).map(({ p, slot, fits, why, afford, over, lock, taken, dist, value }, i) => {
                    const ok = fits && afford && !lock && !taken;
                    const land = slot ? labels[slot] : null;
                    return (
                      <div key={p.slug} onClick={() => {
                        // Select (or swap in for whoever holds the spot) — or, for a card that can't go in, just his log.
                        const holder = slot && picks[slot] && picks[slot] !== p.slug ? bySlug.get(picks[slot]!) : null;
                        const reason = lock ? 'His game has locked' : taken ? `Already in ${labels[taken]}` : why ?? (fits && !afford ? `Over budget by ${fmt$(over)}` : undefined);
                        const mg = opponentMatchupGrade(slate.get(p.team)?.opp, p.pos, dvp);
                        const vs = [gameLine(p.team, slate), mg ? `${MATCHUP_BAND_WORD[mg.band]} matchup ${matchupGradeLabel(mg)}` : ''].filter(Boolean).join(' · ');
                        setAsk({ p, sub: [ok ? `${fmt$(p.salary)} · proj ${projWord(p)}` : reason, vs].filter(Boolean).join(' · ') || undefined,
                          act: ok ? { label: holder ? `Swap in for ${holder.name}` : `Add${land ? ` to ${land}` : ''}`, run: () => put(p.slug, slot) } : null });
                      }} title={`${p.name} · ${p.pos} · ${p.team} ${gameLine(p.team, slate)}`}
                        style={{ width: 104, display: 'grid', gap: 3, justifyItems: 'center', alignContent: 'start', opacity: ok ? 1 : 0.45, cursor: 'pointer' }}>
                        <PlayerCard slug={p.slug} name={p.name} pos={p.pos} team={p.team} slot={active === 'any' && land && ok ? `→ ${land}` : undefined} idx={Math.min(i, 12)} locked={lock} />
                        <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: ok ? 'var(--you)' : 'color-mix(in srgb, var(--text) 60%, transparent)' }}>{fmt$(p.salary)}<InjuryTag key={injTick} week={week} slug={p.slug} /></span>
                        <MatchupLine team={p.team} pos={p.pos} slate={slate} dvp={dvp} />
                        <span className="mono" style={{ fontSize: 9, color: 'color-mix(in srgb, var(--text) 70%, transparent)', textAlign: 'center', lineHeight: 1.3 }}>
                          {lock ? '🔒 his game has locked' : taken ? `already in ${labels[taken]}` : why ?? (fits && !afford ? `over budget by ${fmt$(over)}` : `proj ${projWord(p)} · ${value.toFixed(2)}/$1k${bull && !isTotal && dist != null ? ` · ${dist.toFixed(1)} off` : ''}`)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Felt>
              {!rows.length && <div className="mono" style={{ ...small, padding: 16, textAlign: 'center' }}>Nobody matches — widen the search or show ineligible players.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
