// The draft room — snake and auction — for native leagues.
//
// A straight port of the web DraftRoom (src/screens/NativeLeague.tsx): same
// draft_state poll, same skewed countdowns, same draft_tick self-driving rule.
// The room logic is deliberately identical because the server is the game —
// this screen only ever ASKS (make_draft_pick, nominate, place_bid) and shows
// what draft_state answered. What changed is the layout: the web runs board and
// panel side by side; a phone gets the board as a tab, columns-per-team in a
// horizontal scroll, because a 12-team grid does not fit 360dp any other way.
//
// Self-driving: any member's poll calls draft_tick when a clock is overdue or
// the acting seat is auto. That's what lets a phone-only league draft with no
// worker awake — the room advances as long as ANYONE has it open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  draftState, draftTick, leaguePool, makeDraftPick, myDraftQueue, nativeTeamState, nominate, placeBid,
  setAutodraft, setDraftQueue, setLotProxy, startDraft, seedLeaguePool, leagueGameMode,
  commishPauseDraft, commishResumeDraft, commishForcePick, commishUndoPick, setDraftNight,
  commishResetDraft, commishMoveDraftSlot, leagueAutodrafts, commishEditPick,
  setDraftSetup, setDraftOrder, setDraftStart, setLotteryShares, runDraftLottery, type LotteryPick,
  leaguePoolExp, leaguePoolIds, friendlyError, myQueueMaxes, setQueueMax, auctionMarketValue,
  type DraftState, type DraftPickRow, type LeaguePoolPlayer, type NativeTeamState, type PosCaps, type GameModeInfo,
} from '@drip/core/data/liveApi';
import { leagueSlotDefs, assignSpots, slotDisplayNames, slotAcceptsLabel, leagueEligiblePos, leagueSuperflex, type SpotPlayer } from '@drip/core/engine/classic';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { ADP_2026 } from '@drip/core/data/adp2026';
import { headshot } from '@drip/core/data/media';
import { myFavorites, loadTeamOverrides, playerFlags, leagueMarket, leagueContracts } from '@drip/core/data/liveApi';
import { sortPool, POOL_SORTS, projFor, setLiveAdp, dynFor, setDynFormat, type PoolSort } from '@drip/core/data/poolSort';
import { setSlugSleeperIds } from '@drip/core/data/slugMeta';
import { keeperState, isDynastyContinuity } from '@drip/core/data/liveApi';
import { setLeagueFlags } from '@drip/core/data/commish';
import { setLeagueProjScoring, leagueCatalogOf } from '@drip/core/engine/projScoring';
import { FlagChip } from '../ui/rosterGroup';
import { useTheme, MONO } from '../theme.native';
import { tap, commit, warn } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice, PosPill, PrimaryButton } from '../ui/prims';
import { Overlay } from '../ui/Overlay';
import { openPlayerCard } from '../ui/PlayerCardSheet';
import { starApply, STAR_GOLD, type StarMode } from '../ui/stars';

const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60), s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`;
}

/** Countdown at DAY scale — a scheduled start can be a week out, where
 *  fmtCountdown's m:ss would read "10080:00" and mean nothing. */
function fmtLong(secs: number): string {
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return fmtCountdown(secs);
}

/** Small round headshot with a position-pill fallback — the row identity. */
function Face({ slug, pos, size = 26 }: { slug: string; pos: string; size?: number }) {
  const t = useTheme();
  const src = headshot(slug);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: t.sh, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {src
        ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        : <Text style={{ fontFamily: MONO, fontSize: size * 0.32, fontWeight: '700', color: t.faint }}>{pos}</Text>}
    </View>
  );
}

type DraftTab = 'board' | 'players' | 'teams' | 'queue';

export function Draft({ leagueId, onBack }: { leagueId: string; onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<LeaguePoolPlayer[]>([]);
  const [team, setTeam] = useState<NativeTeamState | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [tab, setTab] = useState<DraftTab>('players');
  const [teamView, setTeamView] = useState<number | null>(null);
  // Classic leagues show picks against the ROSTER SPOTS they'll fill; a drip
  // league has no starting spec to map onto, so it keeps the R1..Rn list.
  const [gm, setGm] = useState<GameModeInfo | null>(null);
  const [expMap, setExpMap] = useState<Record<string, number>>({});   // years_exp, only when a spot filters on tenure (0172)
  const [q, setQ] = useState('');
  // Multi-select positions + the sort order (v0.302.0). A position the server
  // caps at ZERO (0195 — no starting spot accepts it) isn't offered at all.
  const [posSel, setPosSel] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<PoolSort>('rank');
  // Show already-drafted players in the list (v0.351.0, founder: "add a
  // filter to show already drafted players") — struck through, no button.
  const [showTaken, setShowTaken] = useState(false);
  // Dynasty league → the board defaults to the DYN order (founder: "sort by
  // dynasty value in dynasty drafts"). One read at mount; a manual sort tap
  // always wins afterward.
  const [dynasty, setDynasty] = useState(false);
  useEffect(() => {
    keeperState(leagueId).then((k) => {
      if (k.ok && isDynastyContinuity(k.continuity)) { setDynasty(true); setSortBy((s) => (s === 'rank' ? 'dyn' : s)); }
    }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [leagueId]);
  const [own, setOwn] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    // ONE CALL, BOTH NUMBERS (v0.306.1): the live market carries ESPN's ADP
    // beside the ownership share. `setLiveAdp` overlays the baked consensus, so
    // a stale feed costs freshness rather than the whole column.
    leagueMarket(leagueId).then((r) => {
      if (!r?.ok) return;
      setOwn(r.own ?? {});
      setLiveAdp(r.adp ?? null);
    }).catch(() => {});
  }, [leagueId]);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [starMode, setStarMode] = useState<StarMode>('off');
  const [, setFlagVer] = useState(0); // commish flags landed in the cache (0141)
  const [proxyDraft, setProxyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [nightOpen, setNightOpen] = useState(false);
  const [ctrlOpen, setCtrlOpen] = useState(false);
  /** Commissioner assign mode: the PLAYERS list drafts FOR the seat on the
   *  clock instead of for me. Deliberately a mode and not a second button on
   *  every row — the row's button must never be ambiguous about whose pick it
   *  is making. */
  const [assign, setAssign] = useState(false);
  const [autos, setAutos] = useState<Record<number, boolean>>({});
  // A MADE PICK, OPENED FOR EDITING (0194, founder: "I need to be able to click
  // on a pick that was made and remove it or replace it with another available
  // player"). Commissioner only; the board cell is the door.
  const [editPick, setEditPick] = useState<DraftPickRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const skew = useRef(0);
  const ticking = useRef(false);
  // ── THE WIN MOMENT (v0.352.0, founder: "We also need a quick UI
  // interaction when you win a player as that's pretty quiet and brief.") —
  // a lot closing in your favour was one poll-cycle of silence: the lot row
  // vanished and the player was just… on your team. Now the room announces
  // it: a banner drops in with the player and the price, haptics fire, and
  // it clears itself. Detection is a watermark on my own picks' `overall` —
  // the first state read sets the baseline so rejoining a room mid-draft
  // doesn't celebrate an hour-old win.
  const [won, setWon] = useState<{ slug: string; price: number } | null>(null);
  const wonMark = useRef<number | null>(null);
  // ── STANDING MAXES (0228, founder: "let's do proxy bidding with the queue
  // as well") — a queued player can carry a ceiling that becomes his lot's
  // hidden proxy the moment the lot opens, whoever nominates him. slug → $.
  const [qMax, setQMax] = useState<Record<string, number>>({});
  const [qMaxDraft, setQMaxDraft] = useState<Record<string, string>>({});

  /** Who is on autodraft, by seat — draft_state carries only my own flag and
   *  the commissioner's per-team switch needs everyone's. */
  const loadAutos = () => { leagueAutodrafts(leagueId).then(setAutos).catch(() => {}); };
  const refresh = async () => {
    try {
      const s = await draftState(leagueId);
      if (s.error) { setErr(friendlyError(s.error)); return; }
      skew.current = Date.parse(s.server_now) - Date.now();
      setSt(s); setErr(null);
    } catch (x) { setErr(friendlyError(x)); }
  };
  useEffect(() => {
    // `alive` guards the async reads that feed the SPOT panel: switching rooms
    // must not let a slower league's lineup spec land on a newer one (the
    // v0.232.0 lesson — an unguarded effect, not a rendering bug).
    let alive = true;
    void refresh();
    loadAutos();
    leaguePool(leagueId).then(setPool).catch(() => {});
    // The pool's slug → Sleeper id map (0205): the DYN column's ID-FIRST join
    // reads it (v0.351.3 — Stathead's board names "Kenneth Gainwell", our slug
    // says kenny-gainwell; the id agrees where the names never will), and the
    // projection join sharpens the same way. A failed read just leaves the
    // name fallback, never an empty column.
    leaguePoolIds(leagueId).then((r) => setSlugSleeperIds(r?.ids ?? {})).catch(() => {});
    myFavorites().then(setFavs).catch(() => {});
    void loadTeamOverrides();
    playerFlags(leagueId).then((f) => { if (Array.isArray(f)) { setLeagueFlags(leagueId, f); setFlagVer((v) => v + 1); } }).catch(() => {});
    // The league's game mode + starting spec (0161/0163/0172/0174). A failed
    // read leaves gm null, which shows the old R1..Rn list — never a guess at
    // a lineup shape.
    leagueGameMode(leagueId).then((g) => {
      if (!alive || !g.ok) return;
      setGm(g);
      // Which dynasty market this league reads (v0.351.1): superflex lineups
      // price QBs on a different curve, and the value column should say what
      // THIS room pays, not what some other format would.
      setDynFormat(leagueSuperflex(g) ? 'sf' : '1qb');
      // The league's own catalog on the projection side (v0.310.0). Set here
      // rather than at each read: every pool on this screen sorts and displays
      // through `projFor`, which reads this module global, so a screen that
      // showed projections without installing would quietly render them under
      // whichever league was opened before it.
      setLeagueProjScoring(leagueCatalogOf(g));
      if ((g.slots ?? []).some((s) => s.min_exp != null || s.max_exp != null)) {
        leaguePoolExp(leagueId).then((m) => { if (alive) setExpMap(m); }).catch(() => {});
      }
    }).catch(() => {});
    nativeTeamState(leagueId).then((tm) => {
      setTeam(tm);
      if (tm.my_roster_id != null) {
        myDraftQueue(leagueId, tm.my_roster_id).then(setQueue).catch(() => {});
        myQueueMaxes(leagueId, tm.my_roster_id).then((m) => { if (alive) setQMax(m); }).catch(() => {});
      }
    }).catch(() => {});
    const poll = setInterval(refresh, 3000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Advance the room when any clock is overdue or the acting seat is auto —
  // identical to the web (see the header comment).
  const allDeadlines = [
    ...(st?.deadline_at ? [Date.parse(st.deadline_at)] : []),
    ...(st?.lots ?? []).map((l) => Date.parse(l.deadline_at)),
  ];
  const deadlineMs = allDeadlines.length ? Math.min(...allDeadlines) : null;
  const overdueMs = deadlineMs != null ? (now + skew.current) - deadlineMs : null;
  useEffect(() => {
    if (st?.status !== 'live' || ticking.current) return;
    // A PAUSED room still advances its AUTODRAFT seats (0191) — the client
    // drives that too, or a phone-only league's pause would freeze the seats
    // that asked not to be waited for until the worker's next sweep.
    const pausedAuto = !!st.paused && st.on_clock != null && !!autos[st.on_clock];
    if (st.paused && !pausedAuto) return;
    if ((overdueMs != null && overdueMs > 1200) || st.on_clock_auto || pausedAuto) {
      ticking.current = true;
      // A failing tick must be VISIBLE — swallowing it freezes the room at 0:00
      // with nothing to go on. The 3s poll clears the banner on recovery.
      draftTick(leagueId).then((r) => {
        if (r.error) setErr(friendlyError(r.error));
        if ((r.autopicks ?? 0) + (r.lots_awarded ?? 0) > 0) void refresh();
      }).catch(() => {})
        .finally(() => { ticking.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, st?.status, st?.on_clock, st?.lots?.length, st?.paused, autos]);

  const byRoster = useMemo(() => {
    const m: Record<number, { team: string | null; avatar: string | null }> = {};
    for (const w of team?.waiver_order ?? []) m[w.roster_id] = { team: w.team, avatar: w.avatar ?? null };
    return m;
  }, [team]);
  const teamName = (rid: number | null | undefined) => (rid == null ? null : byRoster[rid]?.team ?? null);
  const poolBySlug = useMemo(() => new Map(pool.map((p) => [p.slug, p])), [pool]);
  const taken = useMemo(() => new Set((st?.picks ?? []).map((p) => p.slug)), [st?.picks]);
  const myRoster = team?.my_roster_id ?? null;
  const isCommish = !!team?.is_commish;
  const auction = st?.mode === 'auction';
  const myTurn = st?.status === 'live' && !st.paused && st.on_clock != null && st.on_clock === myRoster;
  const myBudget = auction ? st?.budgets?.find((b) => b.roster_id === myRoster) : null;
  /** Assign mode is only meaningful with a snake seat actually on the clock. */
  const assigning = assign && isCommish && !auction && st?.status === 'live' && st.on_clock != null;

  // Position limits: grey out players my roster can't legally take (the server
  // enforces too — this just saves the round trip). Auction counts lots I hold.
  const myPosCount = useMemo(() => {
    const c: Record<string, number> = {};
    if (myRoster == null) return c;
    for (const pk of st?.picks ?? []) {
      if (pk.roster_id !== myRoster) continue;
      const p = poolBySlug.get(pk.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    for (const l of st?.lots ?? []) {
      if (l.roster_id !== myRoster) continue;
      const p = poolBySlug.get(l.slug)?.pos; if (p) c[p] = (c[p] ?? 0) + 1;
    }
    return c;
  }, [st?.picks, st?.lots, myRoster, poolBySlug]);
  const atCap = (p: string) => {
    const cap = st?.pos_caps?.[p as keyof PosCaps];
    return cap != null && (myPosCount[p] ?? 0) >= cap;
  };

  /** A position the league caps at ZERO can't be drafted at all (0195), so it
   *  is neither offered nor listed — "no kickers if there is no kicker spot",
   *  answered off the server's own number. */
  const bannedPos = (p: string) => st?.pos_caps?.[p as keyof PosCaps] === 0;
  // v0.351.0 (founder: "we don't need filters in the draft for positions not
  // in the league roster"): the lineup spec's eligible-position set trims the
  // chips too — a builder league with no K spot shows no K filter.
  const eligPos = useMemo(() => leagueEligiblePos(gm), [gm]);
  const posChips = useMemo(
    () => POS_FILTERS.filter((p) => p !== 'ALL' && !bannedPos(p) && (!eligPos || eligPos.has(p))),
    [st?.pos_caps, eligPos]);
  const avail = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A player on an OPEN LOT is not in picks, so the taken filter missed him
    // and the list still offered NOM (v0.354.14, founder: "The players I am
    // trying to nom are already up for bid") — the lots at the top are where
    // he lives until the bell.
    const onBlock = new Set((st?.lots ?? []).map((l) => l.slug));
    const base = pool.filter((p) => (showTaken || !taken.has(p.slug)) && !onBlock.has(p.slug)
      && (posSel.size ? posSel.has(p.pos) : (!bannedPos(p.pos) && (!eligPos || eligPos.has(p.pos))))
      && (!needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)));
    return sortPool(starApply(base, starMode, favs, (p) => p.slug), sortBy, own);
  }, [pool, taken, st?.lots, q, posSel, st?.pos_caps, eligPos, starMode, favs, sortBy, own, showTaken]);

  useEffect(() => {
    if (!auction || myRoster == null || !st) return;
    const mine = (st.picks ?? []).filter((p) => p.roster_id === myRoster);
    const top = mine.reduce((m, p) => Math.max(m, p.overall), 0);
    if (wonMark.current == null) { wonMark.current = top; return; }
    if (top > wonMark.current) {
      wonMark.current = top;
      const pk = mine.find((p) => p.overall === top);
      if (pk && st.status === 'live') { setWon({ slug: pk.slug, price: pk.price ?? 0 }); commit(); }
    }
  }, [st, myRoster, auction]);
  useEffect(() => {
    if (!won) return;
    const id = setTimeout(() => setWon(null), 3500);
    return () => clearTimeout(id);
  }, [won]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fn();
      if (!r.ok) { warn(); setErr(friendlyError(r.error ?? 'That didn’t work.')); } else commit();
      await refresh();
      loadAutos();
    } catch (x) { warn(); setErr(friendlyError(x)); }
    finally { setBusy(false); }
  };

  const saveQueue = (next: string[]) => {
    setQueue(next);
    if (myRoster != null) setDraftQueue(leagueId, myRoster, next).catch(() => {});
  };
  const toggleQueue = (slug: string) => {
    tap();
    saveQueue(queue.includes(slug) ? queue.filter((s) => s !== slug) : [...queue, slug]);
  };
  // Drag to reorder (v0.354.8, founder: "Let's have drag to change order in
  // the queue in all versions") — the ⠿ handle owns the gesture, the screen's
  // scroll is suspended while a row is in the air, and the drop index is pure
  // arithmetic on the fixed row height.
  const QROW_H = 44;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragFrom = useRef<number | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const dragPan = (i: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { tap(); dragFrom.current = i; setDragIdx(i); dragY.setValue(0); },
    onPanResponderMove: (_, g) => dragY.setValue(g.dy),
    onPanResponderRelease: (_, g) => {
      const from = dragFrom.current;
      dragFrom.current = null; setDragIdx(null); dragY.setValue(0);
      if (from == null) return;
      const q = queueRef.current;
      const to = Math.max(0, Math.min(q.length - 1, from + Math.round(g.dy / QROW_H)));
      if (to === from) return;
      const next = q.slice();
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      saveQueue(next);
    },
    onPanResponderTerminate: () => { dragFrom.current = null; setDragIdx(null); dragY.setValue(0); },
  });

  const act = (slug: string) => {
    // Assign mode makes the pick FOR the seat on the clock (0067's force pick
    // has always taken a slug — until now nothing called it with one).
    if (assigning) { void run(() => commishForcePick(leagueId, slug)); return; }
    // The auction gate used to be a silent return — a paused room or a full
    // lot board made NOM a dead button (v0.354.13, founder: "Everytime I
    // click nom, nothing happens"). Name the reason instead.
    if (auction) {
      if (st?.paused) { warn(); setErr('The draft is paused — nominations resume when the commissioner taps ▶ RESUME.'); return; }
      if (st?.on_clock == null) { warn(); setErr(`All ${st?.max_lots ?? ''} lots are on the block — a new nomination opens at the next bell.`); return; }
      if (st.on_clock !== myRoster) { warn(); setErr(`It's ${teamName(st.on_clock) ?? `Team ${st.on_clock}`}'s nomination, not yours.`); return; }
      void run(() => nominate(leagueId, slug, 1));
      return;
    }
    if (!myTurn) return;  // snake: the clock banner already says whose pick it is
    void run(() => makeDraftPick(leagueId, slug));
  };

  if (!st) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {err ? <Mono size={10.5} tone="opp">{err}</Mono> : <ActivityIndicator color={t.you} />}
        <LinkButton label="← back" onPress={onBack} />
      </View>
    );
  }

  const teams = st.order?.length ?? 0;
  const round = teams ? Math.min(st.rounds, Math.floor((st.current_overall - 1) / teams) + 1) : 1;
  const nomMs = st.deadline_at ? Date.parse(st.deadline_at) : null;
  const nomSecsLeft = st.paused ? null : nomMs != null ? Math.max(0, Math.ceil((nomMs - (now + skew.current)) / 1000)) : null;
  const lotSecsLeft = (l: { deadline_at: string }) =>
    st.paused ? null : Math.max(0, Math.ceil((Date.parse(l.deadline_at) - (now + skew.current)) / 1000));
  const pickRowsFor = (rid: number) => (st.picks ?? []).filter((p) => p.roster_id === rid);

  // The league's starting spots, in the commissioner's own order. Null for a
  // drip league (no starting spec) or while the mode read is outstanding.
  const spotDefs = gm?.mode === 'classic' ? leagueSlotDefs({ roster: gm.roster ?? null, slots: gm.slots ?? null }) : null;
  // Repeats numbered (RB 1 / RB 2) so two identical rows can be told apart —
  // the same names the lineup setter uses, from the same core helper.
  const spotNames = spotDefs ? slotDisplayNames(spotDefs) : [];
  /** A seat's picks mapped onto the spots they'll fill — see assignSpots.
   *  A pick the pool doesn't know (pos '?') matches nothing and benches, so a
   *  missing pool row costs a spot, never a row. */
  const spotsFor = (rid: number) => {
    if (!spotDefs) return null;
    const players: SpotPlayer[] = pickRowsFor(rid).map((pk) => {
      const pl = poolBySlug.get(pk.slug);
      return { id: pk.slug, pos: pl?.pos ?? '?', team: pl?.team ?? null, exp: expMap[pk.slug] ?? null };
    });
    return assignSpots(spotDefs, players);
  };

  const ghost = (label: string, onPress: () => void, tone?: string) => (
    <Pressable key={label} onPress={() => { tap(); onPress(); }} disabled={busy}
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, opacity: busy ? 0.5 : 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: tone ?? t.dim }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} scrollEnabled={dragIdx == null} contentContainerStyle={{ padding: 12, paddingBottom: 40, gap: 10 }}>
      {/* header: mode + state chips */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Display size={17}>⛏ Draft room</Display>
        <Mono size={9} tone="faint" track={0.1}>{auction ? 'AUCTION' : 'SNAKE'}</Mono>
        {st.is_mock && <Mono size={9} tone="warn" track={0.1}>🤖 MOCK</Mono>}
        {st.paused && <Mono size={9} tone="warn" track={0.1}>⏸ PAUSED</Mono>}
        {st.night?.is_night && <Mono size={9} tone="warn" track={0.06}>🌙 quiet hours</Mono>}
        <View style={{ flex: 1 }} />
        <LinkButton label="← back" onPress={onBack} />
      </View>

      {!!err && <Notice tone="opp"><Mono size={10} tone="opp">{err}</Mono></Notice>}

      {st.status === 'pending' && (
        <Card>
          <Display size={15}>Waiting to start</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: 16 }}>
            {auction
              ? `${st.rounds} roster spots · $${st.budget} budget per team · nomination rotates the draft order. Queue players now — empty seats auto-nominate.`
              : `${st.rounds} rounds${(st.keeper_slots ?? 0) > 0 ? ` (+${st.keeper_slots} keepers already on rosters)` : ''} · ${st.pick_seconds}s per pick · snake order (randomized at start). Queue players now — your queue drafts for you if the clock runs out.`}
          </Mono>
          {/* 0177: the countdown is EVERY member's, not the commissioner's —
              knowing when to show up is the whole point of a schedule. Counted
              off the server's own clock so a skewed phone agrees with everyone
              else. */}
          {!!st.start_at && (() => {
            const left = Math.round((Date.parse(st.start_at) - Date.parse(st.server_now)) / 1000);
            const when = new Date(st.start_at).toLocaleString(undefined,
              { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            return (
              <View style={{ marginTop: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: left > 0 ? t.you : t.warn, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
                <Mono size={10} tone={left > 0 ? 'you' : 'warn'} style={{ lineHeight: 15 }}>
                  {left > 0
                    ? `⏱ Drafting in ${fmtLong(left)} — ${when}. It opens on its own; nobody has to press anything.`
                    : `⏱ Scheduled for ${when} — starting now. If it doesn't open shortly, the pool or a seat is missing.`}
                </Mono>
              </View>
            );
          })()}
          {isCommish && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <PrimaryButton label={st.start_at ? '▶ START THE DRAFT NOW' : '▶ START THE DRAFT'} disabled={busy} onPress={() => run(() => startDraft(leagueId))} />
              {pool.length === 0 && (
                <PrimaryButton label="↻ SEED PLAYER POOL (2026 ADP)" disabled={busy}
                  onPress={() => run(async () => {
                    // 0171: seed under the league's enabled positions + filter.
                    const gm = await leagueGameMode(leagueId).catch(() => null);
                    const r = await seedLeaguePool(leagueId, await buildDraftPool(undefined, { positions: gm?.positions ?? null, filter: gm?.pool_filter ?? null }));
                    setPool(await leaguePool(leagueId));
                    return r;
                  })} />
              )}
            </View>
          )}
          {isCommish && (
            <DraftSetupCard leagueId={leagueId} st={st} busy={busy} teamName={teamName}
              seats={(team?.waiver_order ?? []).map((w) => w.roster_id).sort((a, b) => a - b)}
              onDone={(fn) => void run(fn)} />
          )}
        </Card>
      )}

      {st.status === 'live' && (
        <Card style={{ borderLeftWidth: 3, borderLeftColor: t.you }}>
          {/* ── MY WALLET, FIRST (v0.352.0, founder: "In the auction UI also,
              your team is not easy to see as is your remaining budget.") —
              the room's most-consulted number was a 9pt footer. Now it leads
              the card at glance size, with the door to my own roster beside
              it: MY TEAM jumps straight to the TEAMS tab on my seat. */}
          {auction && myBudget && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: (st.lots ?? []).length > 0 || st.on_clock != null ? StyleSheet.hairlineWidth : 0, borderBottomColor: t.bd, paddingBottom: 10, marginBottom: 10 }}>
              <View>
                <Mono size={8} tone="faint" track={0.12}>MY BUDGET</Mono>
                <Text style={{ fontFamily: MONO, fontSize: 24, fontWeight: '700', color: t.you, fontVariant: ['tabular-nums'] }}>
                  ${myBudget.budget}
                </Text>
              </View>
              <View>
                <Mono size={8} tone="faint" track={0.12}>MAX BID</Mono>
                <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.text, fontVariant: ['tabular-nums'], marginTop: 3 }}>
                  ${myBudget.max_bid}
                </Text>
              </View>
              {myBudget.committed > 0 && (
                <View>
                  <Mono size={8} tone="faint" track={0.12}>COMMITTED</Mono>
                  <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '700', color: t.warn, fontVariant: ['tabular-nums'], marginTop: 3 }}>
                    ${myBudget.committed}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              {myRoster != null && (
                <Pressable hitSlop={6} onPress={() => { tap(); setTab('teams'); setTeamView(myRoster); }}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: t.you }}>MY TEAM →</Text>
                </Pressable>
              )}
            </View>
          )}
          {/* auction lots — up to max_lots in parallel, each with its own bell */}
          {auction && (st.lots ?? []).map((lot, li) => {
            const lp = poolBySlug.get(lot.slug);
            const left = lotSecsLeft(lot);
            const iHold = lot.roster_id === myRoster;
            const canBidLot = myRoster != null && !iHold && (lot.my_max ?? 0) > lot.bid && !st.paused;
            // The three raises hold their POSITIONS (v0.355.3, founder: "not
            // have the bids change positions") — a step past your max or on a
            // lot you already hold ghosts instead of vanishing, so a button
            // never moves out from under a reaching thumb mid-auction.
            const steps = myRoster != null ? [lot.bid + 1, lot.bid + 5, lot.bid + 10] : [];
            const pd = proxyDraft[lot.id] ?? '';
            return (
              <View key={lot.id} style={{ borderTopWidth: li ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, paddingTop: li ? 10 : 0, marginTop: li ? 10 : 0, borderLeftWidth: iHold ? 3 : 0, borderLeftColor: t.you, paddingLeft: iHold ? 8 : 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Face slug={lot.slug} pos={lp?.pos ?? '?'} size={40} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: t.text }}>{lp?.full_name ?? lot.slug}</Text>
                    <Mono size={9.5} style={{ marginTop: 2 }}>
                      ${lot.bid} — {teamName(lot.roster_id) ?? `Team ${lot.roster_id}`}{iHold ? ' (you)' : ''}
                    </Mono>
                  </View>
                  {left != null && (
                    <Text style={{ fontFamily: MONO, fontSize: 22, fontWeight: '700', color: left <= 5 ? t.opp : t.you, fontVariant: ['tabular-nums'] }}>
                      {fmtCountdown(left)}
                    </Text>
                  )}
                </View>
                {/* the fuse (v0.354.10): the bell as a bar — full at a fresh
                    window, gone at the gavel, refilled by any bid (a change
                    resets the clock). */}
                {left != null && (
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: t.sh, marginTop: 8, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, (left / Math.max(1, st.lot_seconds)) * 100))}%`, backgroundColor: left <= 5 ? t.opp : t.you, borderRadius: 2 }} />
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {steps.map((a) => {
                    const can = canBidLot && a <= (lot.my_max ?? 0) && !busy;
                    return (
                      <Pressable key={a} disabled={!can}
                        onPress={() => { tap(); myRoster != null && void run(() => placeBid(leagueId, myRoster, a, lot.id)); }}
                        style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, minWidth: 84, alignItems: 'center', opacity: can ? 1 : 0.35 }}>
                        <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: t.onAccent, fontVariant: ['tabular-nums'] }}>BID ${a}</Text>
                      </Pressable>
                    );
                  })}
                  {iHold && (
                    <View style={{ backgroundColor: t.warn, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent, letterSpacing: 0.6 }}>🔨 YOU'RE THE HIGH BIDDER — ${lot.bid}</Text>
                    </View>
                  )}
                  {/* hidden max (proxy): answers rival bids second-price style
                      while you're away — nobody ever sees your ceiling */}
                  {myRoster != null && (lot.my_max ?? 0) > 0 && !iHold && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <Mono size={8.5} tone="faint" track={0.1}>🕶 MAX</Mono>
                      {lot.my_proxy != null ? (
                        <>
                          <Mono size={10} tone="you" weight="700">${lot.my_proxy}</Mono>
                          <LinkButton label="clear" tone="opp" onPress={() => run(() => setLotProxy(leagueId, myRoster, null, lot.id))} />
                        </>
                      ) : (
                        <>
                          <TextInput value={pd} keyboardType="number-pad" placeholder="$" placeholderTextColor={t.faint}
                            onChangeText={(v) => setProxyDraft({ ...proxyDraft, [lot.id]: v.replace(/\D/g, '') })}
                            style={{ width: 54, paddingHorizontal: 7, paddingVertical: 4, fontFamily: MONO, fontSize: 11, color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, backgroundColor: t.bg }} />
                          {ghost('SET', () => {
                            if (!pd) return;
                            void run(() => setLotProxy(leagueId, myRoster, parseInt(pd, 10), lot.id));
                            setProxyDraft({ ...proxyDraft, [lot.id]: '' });
                          }, t.you)}
                        </>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}

          {/* nomination / pick banner */}
          {(!auction || st.on_clock != null) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: auction && (st.lots ?? []).length > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: t.bd, paddingTop: auction && (st.lots ?? []).length > 0 ? 10 : 0, marginTop: auction && (st.lots ?? []).length > 0 ? 10 : 0 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Mono size={9} tone="faint" track={0.12}>
                  {auction ? `NOMINATION ${st.current_overall + (st.lots ?? []).length}` : `ROUND ${round} / ${st.rounds} · PICK ${st.current_overall}`}
                </Mono>
                <Text numberOfLines={2} style={{ fontSize: 15.5, fontWeight: '700', color: myTurn ? t.you : t.text, marginTop: 3 }}>
                  {myTurn ? (auction ? 'YOUR NOMINATION — pick below' : 'YOUR PICK')
                    : `${auction ? 'Nominating' : 'On the clock'}: ${teamName(st.on_clock) ?? `Team ${st.on_clock} (auto)`}`}
                </Text>
              </View>
              {nomSecsLeft != null && (
                <Text style={{ fontFamily: MONO, fontSize: 26, fontWeight: '700', color: nomSecsLeft <= 10 ? t.opp : t.you, fontVariant: ['tabular-nums'] }}>
                  {fmtCountdown(nomSecsLeft)}
                </Text>
              )}
            </View>
          )}
          {auction && (
            <Mono size={9} tone="faint" style={{ marginTop: 8 }}>
              {(st.lots ?? []).length}/{st.max_lots} lots open
            </Mono>
          )}
          {isCommish && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, marginTop: 10 }}>
              <Mono size={8.5} tone="faint" track={0.1}>⚑ COMMISH</Mono>
              {st.paused
                ? ghost('▶ RESUME', () => void run(() => commishResumeDraft(leagueId)))
                : ghost('⏸ PAUSE', () => void run(() => commishPauseDraft(leagueId)))}
              {!auction && ghost('⏭ FORCE PICK', () => void run(() => commishForcePick(leagueId)))}
              {!auction && ghost('↩ UNDO', () => void run(() => commishUndoPick(leagueId)), t.opp)}
              {ghost(st.night ? `🌙 ${fmtNight(st.night)}` : '🌙 QUIET HRS', () => { setNightOpen((v) => !v); })}
              {ghost(ctrlOpen ? '⚑ CONTROLS ▴' : '⚑ CONTROLS ▾', () => { setCtrlOpen((v) => !v); })}
            </View>
          )}
          {isCommish && nightOpen && (
            <NightEditor current={st.night ?? null} busy={busy}
              onSet={(s, e) => { setNightOpen(false); void run(() => setDraftNight(leagueId, s, e)); }}
              onClear={() => { setNightOpen(false); void run(() => setDraftNight(leagueId)); }} />
          )}
          {isCommish && ctrlOpen && (
            <CommishControls leagueId={leagueId} st={st} busy={busy} teamName={teamName} autos={autos}
              assign={assign} onAssign={(v) => { setAssign(v); if (v) setTab('players'); }}
              onRun={(fn) => void run(fn)} />
          )}
        </Card>
      )}

      {st.status === 'complete' && (
        <Card>
          <Display size={15} tone="you">Draft complete.</Display>
          <Mono size={10} style={{ marginTop: 8, lineHeight: 16 }}>
            Rosters are live and weekly lineup pools are built. Waivers and free agency are open — manage your team from the MY TEAM tab.
          </Mono>
          {/* UNDO is snake-only (an auction can't un-sell one lot) — but the
              CONTROLS door must open for EVERY mode: TRASH THE DRAFT lives
              inside, and gating both on mode left a completed auction with
              no way to start over (v0.352.2, founder: "how do I trash the
              draft?"). */}
          {isCommish && (
            <View style={{ marginTop: 10, gap: 8 }}>
              {st.mode !== 'auction' && ghost('↩ UNDO LAST PICK (reopens the draft)', () => void run(() => commishUndoPick(leagueId)))}
              {ghost(ctrlOpen ? '⚑ CONTROLS ▴' : '⚑ CONTROLS ▾', () => { setCtrlOpen((v) => !v); })}
            </View>
          )}
          {isCommish && ctrlOpen && (
            <CommishControls leagueId={leagueId} st={st} busy={busy} teamName={teamName} autos={autos}
              assign={false} onAssign={() => {}} onRun={(fn) => void run(fn)} />
          )}
        </Card>
      )}

      {/* tabs */}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Chip label={`PLAYERS (${avail.length})`} on={tab === 'players'} onPress={() => { tap(); setTab('players'); }} />
        <Chip label="BOARD" on={tab === 'board'} onPress={() => { tap(); setTab('board'); }} />
        <Chip label="TEAMS" on={tab === 'teams'} onPress={() => { tap(); setTab('teams'); }} />
        <Chip label={`QUEUE (${queue.length})`} on={tab === 'queue'} onPress={() => { tap(); setTab('queue'); }} />
      </View>

      {/* PLAYERS — available list with ADP + projections */}
      {tab === 'players' && (
        <Card>
          <TextInput value={q} onChangeText={setQ} placeholder="Search players or teams…" placeholderTextColor={t.faint}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg, marginBottom: 10 }} />
          {/* position filters double as my roster-fill meter: taken/limit */}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <Chip label={`ALL${myRoster == null ? '' : ` ${Object.values(myPosCount).reduce((a, b) => a + b, 0)}/${st.rounds}`}`}
              on={posSel.size === 0} onPress={() => { tap(); setPosSel(new Set()); }} />
            {posChips.map((p) => {
              const fill = myRoster == null ? '' : ` ${myPosCount[p] ?? 0}/${st.pos_caps?.[p as keyof PosCaps] ?? '∞'}`;
              return (
                <Chip key={p} label={`${p}${fill}`} on={posSel.has(p)}
                  onPress={() => { tap(); setPosSel((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; }); }} />
              );
            })}
            <Chip label="★ FIRST" on={starMode === 'first'} onPress={() => { tap(); setStarMode(starMode === 'first' ? 'off' : 'first'); }} />
            <Chip label="★ ONLY" on={starMode === 'only'} onPress={() => { tap(); setStarMode(starMode === 'only' ? 'off' : 'only'); }} />
            <Chip label="✕ TAKEN" on={showTaken} onPress={() => { tap(); setShowTaken((v) => !v); }} />
          </View>
          {/* THE ORDER (v0.302.0). RANK is what the clock's autopick follows,
              so it stays the default even here where ADP and PROJ already
              print beside every name. */}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <Mono size={8} tone="faint">SORT</Mono>
            {POOL_SORTS.map((o) => (
              <Chip key={o.id} label={o.label} on={sortBy === o.id} onPress={() => { tap(); setSortBy(o.id); }} />
            ))}
          </View>
          {assigning && (
            <Notice tone="warn">
              <Mono size={9.5} tone="warn" style={{ lineHeight: 15 }}>
                {`⚑ ASSIGNING FOR ${teamName(st.on_clock) ?? `Team ${st.on_clock}`} — the next player you tap becomes their pick. Tap ⚑ CONTROLS to stop.`}
              </Mono>
            </Notice>
          )}
          {avail.slice(0, 60).map((p) => {
            const adp = ADP_2026.get(p.slug); const proj = projFor(p.slug, p.pos);
            const dyn = dynasty ? dynFor(p.slug) : null;
            const inQ = queue.includes(p.slug);
            const capped = atCap(p.pos);
            const gone = taken.has(p.slug);
            const can = !gone && (assigning ? !busy : (myTurn && !busy && !capped));
            return (
              <View key={p.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, opacity: gone ? 0.5 : 1 }}>
                {!gone && (
                  <Pressable disabled={!can} onPress={() => { tap(); act(p.slug); }}
                    style={{ backgroundColor: can ? (assigning ? t.warn : t.you) : t.sh, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 7, width: 50, alignItems: 'center', opacity: can ? 1 : 0.45 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: can ? t.onAccent : t.faint }}>
                      {assigning ? 'ASSIGN' : capped ? 'LIMIT' : auction ? 'NOM $1' : 'DRAFT'}
                    </Text>
                  </Pressable>
                )}
                {gone && (
                  <View style={{ width: 50, alignItems: 'center' }}>
                    <Mono size={8} tone="opp" weight="700">TAKEN</Mono>
                  </View>
                )}
                <Face slug={p.slug} pos={p.pos} />
                {/* Draft night is the moment a card is worth most — the name
                    opens it, the DRAFT button stays the button (founder). The
                    stats live on the SECOND LINE now (v0.351.0, founder: "most
                    of the names are cut off… more room for names") — the row
                    has no right-hand column to squeeze the name against. */}
                <Pressable style={{ flex: 1, minWidth: 0 }} hitSlop={4}
                  onPress={() => { tap(); openPlayerCard({ slug: p.slug, name: p.full_name, pos: p.pos, team: p.team }); }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text, textDecorationLine: gone ? 'line-through' : 'none' }}>
                    {favs.has(p.slug) && <Text style={{ color: STAR_GOLD }}>★ </Text>}{p.full_name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <PosPill pos={p.pos} size={8} />
                    <Mono size={8.5} tone="faint" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {p.team} · #{p.rank}
                      {dyn != null ? ` · DYN ${dyn}` : ''}
                      {adp != null ? ` · ADP ${adp.toFixed(0)}` : ''}
                      {proj != null ? ` · ${proj.toFixed(1)}p` : ''}
                      {own ? ` · ${own[p.slug] ?? 0}%` : ''}
                    </Mono>
                    <FlagChip slug={p.slug} size={7.5} />
                  </View>
                </Pressable>
                {/* Q, not a star (v0.345.2, founder): the row already carries a
                    GOLD ★ for favorites, and a second star meaning "queued"
                    made the two systems read as one. Q says which one this is. */}
                <Pressable hitSlop={8} onPress={() => toggleQueue(p.slug)}
                  style={{ minWidth: 26, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: inQ ? t.warn : t.bd, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: inQ ? t.warn : 'transparent' }}>
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: inQ ? t.onAccent : t.faint }}>Q</Text>
                </Pressable>
              </View>
            );
          })}
          {avail.length > 60 && <Mono size={9.5} tone="faint" style={{ paddingTop: 8 }}>…{avail.length - 60} more — narrow the search.</Mono>}
        </Card>
      )}

      {/* BOARD — one column per team, horizontal scroll (the only way a
          12-team grid fits a phone). Columns transpose the web's rows. */}
      {tab === 'board' && teams > 0 && (
        <Card style={{ padding: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {(st.order ?? []).map((rid) => (
                <View key={rid} style={{ width: 86, gap: 4 }}>
                  <View style={{ paddingVertical: 3, alignItems: 'center' }}>
                    <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: rid === myRoster ? t.you : t.dim }}>
                      {teamName(rid) ?? `Team ${rid}`}
                    </Text>
                    {auction && st.budgets && (
                      <Mono size={7.5} tone="faint">${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}</Mono>
                    )}
                  </View>
                  {Array.from({ length: st.rounds }, (_, r) => {
                    const c = (st.order ?? []).indexOf(rid);
                    const cell = auction
                      ? pickRowsFor(rid)[r]
                      : (st.picks ?? []).find((pk) => pk.round === r + 1 && pk.roster_id === rid);
                    const onClock = !auction && st.status === 'live'
                      && st.current_overall === r * teams + (r % 2 === 0 ? c + 1 : teams - c);
                    const pl = cell ? poolBySlug.get(cell.slug) : null;
                    const pc = t.pos[(pl?.pos ?? 'WR') as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
                    const nm = (pl?.full_name ?? cell?.slug ?? '').split(' ');
                    const last = nm.length > 1 ? nm.slice(1).join(' ') : nm[0];
                    const canEdit = isCommish && !!cell && !auction;
                    return (
                      <Pressable key={r} disabled={!canEdit}
                        onPress={canEdit ? () => { tap(); setEditPick(cell!); } : undefined}
                        style={{
                        height: 44, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 3, overflow: 'hidden',
                        backgroundColor: cell ? pc.bg : t.bg,
                        borderWidth: onClock ? 1 : StyleSheet.hairlineWidth, borderColor: onClock ? t.you : t.bd,
                      }}>
                        {cell ? (
                          <>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              <Text style={{ fontFamily: MONO, fontSize: 7, fontWeight: '700', color: pc.fg }}>{pl?.pos ?? ''}</Text>
                              <Text style={{ fontFamily: MONO, fontSize: 7, color: pc.fg, opacity: 0.8 }}>
                                {auction ? `$${cell.price ?? 1}` : `${cell.round}.${((cell.overall - 1) % teams) + 1}`}{cell.auto ? ' 🤖' : ''}
                              </Text>
                            </View>
                            <Text numberOfLines={1} style={{ fontSize: 9.5, fontWeight: '700', color: pc.fg, marginTop: 2 }}>{last}</Text>
                          </>
                        ) : (
                          <Text style={{ fontFamily: MONO, fontSize: 7.5, color: onClock ? t.you : t.faint, marginTop: 4 }}>
                            {onClock ? '⏱ clock' : auction ? '—' : `${r + 1}.${r % 2 === 0 ? c + 1 : teams - c}`}
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
          {isCommish && !auction && (
            <Mono size={8} tone="faint" style={{ paddingTop: 6 }}>⚑ tap any made pick to remove or replace it</Mono>
          )}
        </Card>
      )}

      {/* TEAMS — every roster so far */}
      {tab === 'teams' && (
        <Card>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {/* my own seat wears a star and sorts first — "which one am I"
                should never take a search (v0.352.0) */}
            {[...(st.order ?? [])].sort((a, b) => (a === myRoster ? -1 : b === myRoster ? 1 : 0)).map((rid) => (
              <Chip key={rid} on={(teamView ?? myRoster) === rid} onPress={() => { tap(); setTeamView(rid); }}
                label={`${rid === myRoster ? '★ ' : ''}${teamName(rid) ?? `Team ${rid}`}${auction && st.budgets ? ` $${st.budgets.find((b) => b.roster_id === rid)?.budget ?? ''}` : ''}`} />
            ))}
          </View>
          {(() => {
            const rid = teamView ?? myRoster ?? (st.order ?? [])[0];
            if (rid == null) return null;
            const rows = pickRowsFor(rid);
            const pickOf = new Map(rows.map((pk) => [pk.slug, pk]));
            const cost = (pk: DraftPickRow) => (auction ? `$${pk.price ?? 1}` : `R${pk.round}`);
            // One row: a tag on the left (the SPOT it fills, or the round/price
            // when there are no spots to fill), the player, where he came from.
            const row = (key: string | number, tag: string, slug: string, withCost = false) => {
              const pl = poolBySlug.get(slug);
              const pk = pickOf.get(slug);
              return (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                  <Mono size={9} tone="faint" style={{ width: spotDefs ? 72 : 30 }} numberOfLines={1}>{tag}</Mono>
                  <Face slug={slug} pos={pl?.pos ?? '?'} size={22} />
                  <PosPill pos={pl?.pos ?? '?'} size={8} />
                  <Pressable style={{ flex: 1, minWidth: 0 }} hitSlop={4}
                    onPress={() => { tap(); openPlayerCard({ slug, name: pl?.full_name ?? slug, pos: pl?.pos ?? '', team: pl?.team ?? '' }); }}>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: t.text }}>{pl?.full_name ?? slug}</Text>
                  </Pressable>
                  {/* Where he came from — kept on the spot rows, since the left
                      column now says WHERE HE PLAYS rather than which round. */}
                  <Mono size={9} tone="faint">{pl?.team}{withCost && pk ? ` · ${cost(pk)}` : ''}{pk?.auto ? ' 🤖' : ''}</Mono>
                </View>
              );
            };
            const fill = spotsFor(rid);
            // Drip league (or the mode read hasn't landed): the picks, as they came.
            if (!fill) {
              return rows.length === 0
                ? <Mono size={10} tone="faint">No picks yet.</Mono>
                : rows.map((pk) => row(pk.overall, cost(pk), pk.slug));
            }
            const seated = fill.spots.filter((s) => s.player).length;
            return (
              <>
                <Mono size={8.5} tone="faint" track={0.14} style={{ paddingBottom: 4 }}>
                  {`STARTING LINEUP · ${seated}/${fill.spots.length} FILLED`}
                </Mono>
                {fill.spots.map((s, si) => (s.player
                  ? row(s.def.slot, spotNames[si], s.player.id, true)
                  : (
                    <View key={s.def.slot} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, opacity: 0.55 }}>
                      <Mono size={9} tone="faint" style={{ width: 72 }} numberOfLines={1}>{spotNames[si]}</Mono>
                      <Mono size={10} tone="faint" style={{ flex: 1 }} numberOfLines={1}>
                        {`— empty${slotAcceptsLabel(s.def) ? ` · ${slotAcceptsLabel(s.def)}` : ''}`}
                      </Mono>
                    </View>
                  )))}
                <Mono size={8.5} tone="faint" track={0.14} style={{ paddingTop: 10, paddingBottom: 4 }}>
                  {`BENCH${fill.bench.length ? ` · ${fill.bench.length}` : ''}`}
                </Mono>
                {fill.bench.length === 0
                  ? <Mono size={10} tone="faint">{rows.length ? 'Every pick is starting.' : 'No picks yet.'}</Mono>
                  : fill.bench.map((p) => row(`b-${p.id}`, pickOf.get(p.id) ? cost(pickOf.get(p.id)!) : 'BN', p.id))}
              </>
            );
          })()}
        </Card>
      )}

      {/* EDIT A MADE PICK (0194) — the commissioner's fix for "round 3 went to
          the wrong player", which undo could only reach by unwinding every pick
          since. */}
      {editPick && (
        <EditPickSheet leagueId={leagueId} pick={editPick} busy={busy}
          teamName={teamName(editPick.roster_id) ?? `Team ${editPick.roster_id}`}
          player={poolBySlug.get(editPick.slug) ?? null}
          available={avail}
          onClose={() => setEditPick(null)}
          onDone={(fn) => { setEditPick(null); void run(fn); }} />
      )}

      {/* QUEUE — my private wishlist + autodraft */}
      {tab === 'queue' && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Mono size={9} tone="faint" track={0.12}>MY QUEUE</Mono>
            {myRoster != null && (
              <Chip label={`🤖 AUTODRAFT ${st.my_autodraft ? 'ON' : 'OFF'}`} on={!!st.my_autodraft}
                onPress={() => { tap(); void run(() => setAutodraft(leagueId, myRoster, !st.my_autodraft)); }} />
            )}
          </View>
          {queue.length === 0 && (
            <Mono size={10} tone="faint" style={{ lineHeight: 16 }}>
              Empty — tap Q on any player. If your clock runs out (or autodraft is on), your queue picks for you, in order, before best-available.
            </Mono>
          )}
          {auction && queue.length > 0 && (
            <Mono size={8.5} tone="faint" style={{ lineHeight: 13, paddingBottom: 4 }}>
              🕶 MAX bids for you even while you're away: the moment his lot opens — your nomination or anyone's — it becomes your hidden ceiling, answering rivals second-price style. You pay their bid + $1, never your max. Tap a player's mkt price to set it as your max in one tap.
            </Mono>
          )}
          {/* 0191: a pause is time for PEOPLE. A seat that asked not to be
              waited for keeps picking through one. */}
          {!!st.my_autodraft && (
            <Mono size={9} tone="you" style={{ lineHeight: 14, paddingTop: 6 }}>
              🤖 Autodraft is on — your seat keeps picking even while the commissioner has the draft paused.
            </Mono>
          )}
          {queue.map((slug, i) => {
            const p = poolBySlug.get(slug);
            const gone = taken.has(slug);
            const lifted = dragIdx === i;
            return (
              <Animated.View key={slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: QROW_H, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, opacity: gone ? 0.45 : 1, transform: lifted ? [{ translateY: dragY }] : [], zIndex: lifted ? 10 : 0, elevation: lifted ? 6 : 0, backgroundColor: lifted ? t.bg : 'transparent' }}>
                <View {...dragPan(i).panHandlers} hitSlop={8} style={{ width: 18, alignItems: 'center' }}>
                  <Text style={{ color: lifted ? t.you : t.faint, fontSize: 13 }}>⠿</Text>
                </View>
                <Mono size={9} tone="faint" style={{ width: 16 }}>{i + 1}</Mono>
                {p && <Face slug={p.slug} pos={p.pos} size={22} />}
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.text, textDecorationLine: gone ? 'line-through' : 'none' }}>{p?.full_name ?? slug}</Text>
                {gone && <Mono size={8.5} tone="opp">TAKEN</Mono>}
                {auction && !gone && myRoster != null && (() => {
                  const mkt = auctionMarketValue(p?.rank, st.budget);
                  return mkt != null && qMax[slug] !== mkt ? (
                    <Pressable hitSlop={6}
                      onPress={() => { tap(); void setQueueMax(leagueId, myRoster, slug, mkt).then((r) => { if (r.ok) { setQMax((m) => ({ ...m, [slug]: mkt })); setQMaxDraft((d2) => ({ ...d2, [slug]: '' })); } }).catch(() => {}); }}>
                      <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.dim }}>${mkt}</Text>
                    </Pressable>
                  ) : null;
                })()}
                {auction && !gone && myRoster != null && (
                  qMax[slug] != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      {([['▼', -1], ['▲', 1]] as const).map(([sym, dir]) => (
                        <Pressable key={sym} hitSlop={6} onPress={() => {
                          const step = (st.budget ?? 200) >= 500 ? 5 : 1;
                          const v = Math.max(1, (qMax[slug] ?? 1) + dir * step);
                          if (v === qMax[slug]) return;
                          tap();
                          void setQueueMax(leagueId, myRoster, slug, v).then((r) => { if (r.ok) setQMax((m) => ({ ...m, [slug]: v })); }).catch(() => {});
                        }}>
                          <Text style={{ fontFamily: MONO, fontSize: 10, color: t.dim }}>{sym}</Text>
                        </Pressable>
                      ))}
                      <Pressable hitSlop={6}
                        onPress={() => { tap(); void setQueueMax(leagueId, myRoster, slug, null).then((r) => { if (r.ok) setQMax((m) => { const n = { ...m }; delete n[slug]; return n; }); }).catch(() => {}); }}
                        style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.you, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 }}>
                        <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>🕶 ${qMax[slug]} ✕</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <TextInput value={qMaxDraft[slug] ?? ''} keyboardType="number-pad" placeholder="max" placeholderTextColor={t.faint}
                        onChangeText={(v) => setQMaxDraft({ ...qMaxDraft, [slug]: v.replace(/\D/g, '') })}
                        style={{ width: 44, paddingHorizontal: 5, paddingVertical: 3, fontFamily: MONO, fontSize: 10, color: t.text, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 5, backgroundColor: t.bg }} />
                      {!!qMaxDraft[slug] && (
                        <Pressable hitSlop={6} onPress={() => {
                          const v = parseInt(qMaxDraft[slug], 10);
                          if (!v) return;
                          tap();
                          void setQueueMax(leagueId, myRoster, slug, v).then((r) => {
                            if (r.ok) { setQMax((m) => ({ ...m, [slug]: v })); setQMaxDraft((d) => ({ ...d, [slug]: '' })); }
                          }).catch(() => {});
                        }}>
                          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.you }}>SET</Text>
                        </Pressable>
                      )}
                    </View>
                  )
                )}
                <Pressable hitSlop={6} onPress={() => toggleQueue(slug)}><Text style={{ color: t.opp, fontSize: 13 }}>✕</Text></Pressable>
              </Animated.View>
            );
          })}
        </Card>
      )}
    </ScrollView>

    {/* the win banner — drops over everything, dismisses itself or on tap */}
    {won && (() => {
      const wp = poolBySlug.get(won.slug);
      return (
        <Pressable onPress={() => setWon(null)}
          style={{ position: 'absolute', top: 16, left: 12, right: 12, backgroundColor: t.bg, borderWidth: 2, borderColor: t.you, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}>
          <Face slug={won.slug} pos={wp?.pos ?? '?'} size={46} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Mono size={9} tone="you" track={0.16} weight="700">🔨 SOLD — HE'S YOURS</Mono>
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: t.text, marginTop: 2 }}>{wp?.full_name ?? won.slug}</Text>
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 22, fontWeight: '700', color: t.you, fontVariant: ['tabular-nums'] }}>
            ${won.price}
          </Text>
        </Pressable>
      );
    })()}
    </View>
  );
}



// ── one made pick, open for editing (0194) ──────────────────────────────────
/** Two doors, deliberately different weights. REPLACE is the common one — the
 *  pick went to the wrong player — so it is a search over the available pool
 *  and one tap to commit, undoable by doing it again. REMOVE takes a player off
 *  a roster and leaves a hole, so it asks first.
 *
 *  What it does NOT offer is moving a pick to another team: a pick belongs to
 *  the seat that made it, and changing that is a trade, which has its own
 *  machinery with both managers' consent in it. */
function EditPickSheet({ leagueId, pick, player, teamName, available, busy, onClose, onDone }: {
  leagueId: string; pick: DraftPickRow; player: LeaguePoolPlayer | null; teamName: string;
  available: LeaguePoolPlayer[]; busy: boolean;
  onClose: () => void;
  onDone: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [armed, setArmed] = useState(false);
  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return available
      .filter((p) => !needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [available, q]);
  return (
    <Overlay visible title={`⚑ ${player?.full_name ?? pick.slug}`}
      subtitle={`PICK ${pick.round}.${pick.overall} · ${teamName.toUpperCase()}`} onClose={onClose}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
        {/* REMOVE — two taps, because it leaves the seat a player short. */}
        {!armed ? (
          <Pressable onPress={() => { tap(); setArmed(true); }} disabled={busy}
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.opp, borderRadius: 7, paddingVertical: 9, alignItems: 'center' }}>
            <Mono size={9.5} weight="700" tone="opp">✕ REMOVE THIS PICK</Mono>
          </Pressable>
        ) : (
          <View style={{ gap: 8 }}>
            <Mono size={9.5} tone="opp" style={{ lineHeight: 14 }}>
              {`The cell empties, ${teamName} is one player short, and he goes back to the pool. The picks around it don't move.`}
            </Mono>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pressable onPress={() => { tap(); onDone(() => commishEditPick(leagueId, pick.overall, null)); }} disabled={busy}
                style={{ backgroundColor: t.opp, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 9 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>REMOVE</Text>
              </Pressable>
              <Pressable onPress={() => { tap(); setArmed(false); }}><Mono size={9.5} tone="dim">cancel</Mono></Pressable>
            </View>
          </View>
        )}

        {/* REPLACE — the common case, so it is the big half of the sheet. */}
        <Mono size={8.5} tone="faint" track={0.12} style={{ marginTop: 16, marginBottom: 6 }}>REPLACE WITH</Mono>
        <TextInput value={q} onChangeText={setQ} placeholder="Search available players…" placeholderTextColor={t.faint}
          style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: t.text, backgroundColor: t.bg, marginBottom: 8 }} />
        {hits.length === 0 && <Mono size={10} tone="faint">Nobody matches — widen the search.</Mono>}
        {hits.map((p) => (
          <Pressable key={p.slug} disabled={busy}
            onPress={() => { tap(); onDone(() => commishEditPick(leagueId, pick.overall, p.slug)); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
            <Face slug={p.slug} pos={p.pos} size={22} />
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text }}>{p.full_name}</Text>
            <PosPill pos={p.pos} size={8} />
            <Mono size={9} tone="faint">{p.team} · #{p.rank}</Mono>
          </Pressable>
        ))}
      </ScrollView>
    </Overlay>
  );
}

// ── overnight pause (0153) ───────────────────────────────────────────────────
// Hour-granular quiet window, ET — the engine (awake_deadline, 0069) has
// understood these minutes since before they were settable; this is just the
// commissioner's dial. Clocks re-base server-side on save.
const fmtHour = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
};
const fmtNight = (n: { start_min: number; end_min: number }) => `${fmtHour(n.start_min)}–${fmtHour(n.end_min)} ET`;

/** The commissioner's PRE-DRAFT controls (0176/0177), ported to the app.
 *
 *  The live-draft levers — pause, force pick, undo, quiet hours — have been
 *  here for a while; the settings that decide what the draft IS were web-only,
 *  so a commissioner running a league from a phone could start a draft but not
 *  shape one. Same three sections as the web panel, collapsed by default
 *  because most visits to this card are to press START.
 *
 *  THE ONE REAL DIVERGENCE is the scheduler. The web uses <input
 *  type="datetime-local">; React Native has no such control, and pulling in a
 *  native date-picker module for one field means a new native dependency in
 *  every build. Relative day chips plus common draft times cover the actual
 *  use ("tonight at 8", "Sunday at 8") in two taps and no dependency — with
 *  the resolved date spelled out underneath, because "TOMORROW + 8 PM" is only
 *  unambiguous once you can read back what it landed on. */
function DraftSetupCard({ leagueId, st, seats, busy, teamName, onDone }: {
  leagueId: string; st: DraftState; seats: number[]; busy: boolean;
  teamName: (rid: number) => string | null;
  onDone: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'snake' | 'linear' | 'auction'>(st.mode);
  // A contract league's format was decided at creation (0218): bids are the
  // salaries, so the room is an auction and the server refuses anything else
  // (0234). Chips that only earn that refusal don't render.
  const [contractRoom, setContractRoom] = useState(false);
  useEffect(() => { leagueContracts(leagueId).then((c) => setContractRoom(!!c.contracts)).catch(() => {}); }, [leagueId]);
  const slow = st.pick_seconds >= 3600;
  const [clock, setClock] = useState(String(slow ? Math.round(st.pick_seconds / 3600) : st.pick_seconds));
  const [hrs, setHrs] = useState(slow);
  const [budget, setBudget] = useState(String(st.budget ?? 200));
  const [bell, setBell] = useState(String(st.lot_seconds >= 3600 ? Math.round(st.lot_seconds / 3600) : st.lot_seconds));
  const [bellHrs, setBellHrs] = useState(st.lot_seconds >= 3600);
  const [lots, setLots] = useState(String(st.max_lots));
  const [ord, setOrd] = useState<number[] | null>(st.order);
  /** Lottery weights per seat (0189). Absent = 1, i.e. a flat draw. */
  const [shares, setShares] = useState<Record<number, number>>({});
  const [drawn, setDrawn] = useState<LotteryPick[] | null>(null);
  const [days, setDays] = useState(0);        // 0 = today, 1 = tomorrow, …
  const [mins, setMins] = useState(20 * 60);  // local minutes past midnight

  const box = (w: number) => ({
    width: w, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6,
    paddingHorizontal: 9, paddingVertical: 6, fontFamily: MONO, fontSize: 13, color: t.text, backgroundColor: t.bg,
  } as const);

  const saveSetup = () => {
    const c = Math.round(Number(clock) * (hrs ? 3600 : 1));
    const b = Math.round(Number(bell) * (bellHrs ? 3600 : 1));
    if (!Number.isFinite(c) || c <= 0) return;
    onDone(() => setDraftSetup(leagueId, c, mode,
      mode === 'auction' ? Math.round(Number(budget)) : null,
      mode === 'auction' ? b : null,
      mode === 'auction' ? Math.round(Number(lots)) : null));
  };

  // Day + time resolved against the DEVICE's local calendar, which is what a
  // commissioner means by "tomorrow at 8" — then sent as a real instant so
  // every member's countdown agrees regardless of where they are.
  const target = (() => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    return d;
  })();
  const past = target.getTime() <= Date.now();

  // Reorders whatever the rows SHOW, seeding from seat order on the first
  // move — same fix the web panel needed, so hand-setting an order from
  // scratch works before you've ever randomized.
  const rows = ord ?? seats;
  const move = (i: number, d: -1 | 1) => {
    const base = ord ?? seats;
    const j = i + d;
    if (j < 0 || j >= base.length) return;
    const next = [...base];
    [next[i], next[j]] = [next[j], next[i]];
    setOrd(next);
  };

  return (
    <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
      <Pressable onPress={() => { tap(); setOpen((v) => !v); }}>
        <Mono size={9.5} tone="dim" weight="700" track={0.08}>
          {open ? '▾' : '▸'} ⚙ DRAFT SETUP{open ? '' : ' — clock, format, when, order'}
        </Mono>
      </Pressable>
      {open && (
        <View style={{ marginTop: 10, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Mono size={8.5} tone="faint" track={0.1}>FORMAT</Mono>
            {contractRoom ? (
              <>
                <Chip label="AUCTION" on onPress={() => {}} />
                <Mono size={8.5} tone="faint">set by the contract league type</Mono>
              </>
            ) : (
              <>
                <Chip label="SNAKE" on={mode === 'snake'} onPress={() => { tap(); setMode('snake'); }} />
                <Chip label="LINEAR" on={mode === 'linear'} onPress={() => { tap(); setMode('linear'); }} />
                <Chip label="AUCTION" on={mode === 'auction'} onPress={() => { tap(); setMode('auction'); }} />
              </>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Mono size={8.5} tone="faint" track={0.1}>{mode === 'auction' ? 'NOMINATE' : 'PICK CLOCK'}</Mono>
            <TextInput value={clock} keyboardType="number-pad" onChangeText={(v) => setClock(v.replace(/\D/g, ''))} style={box(64)} />
            <Chip label="SEC" on={!hrs} onPress={() => { tap(); setHrs(false); }} />
            <Chip label="HRS" on={hrs} onPress={() => { tap(); setHrs(true); }} />
          </View>
          {mode === 'auction' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="faint" track={0.1}>BUDGET $</Mono>
                <TextInput value={budget} keyboardType="number-pad" onChangeText={(v) => setBudget(v.replace(/\D/g, ''))} style={box(72)} />
                <Mono size={8.5} tone="faint" track={0.1}>LOTS</Mono>
                <TextInput value={lots} keyboardType="number-pad" onChangeText={(v) => setLots(v.replace(/\D/g, ''))} style={box(48)} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Mono size={8.5} tone="faint" track={0.1}>BID BELL</Mono>
                <TextInput value={bell} keyboardType="number-pad" onChangeText={(v) => setBell(v.replace(/\D/g, ''))} style={box(64)} />
                <Chip label="SEC" on={!bellHrs} onPress={() => { tap(); setBellHrs(false); }} />
                <Chip label="HRS" on={bellHrs} onPress={() => { tap(); setBellHrs(true); }} />
              </View>
            </>
          )}
          <PrimaryButton label="SAVE FORMAT" disabled={busy} onPress={saveSetup} />
          <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>
            Roster size and position limits are in ⚑ COMMISH → MODE &amp; SCORING. All of this locks when the draft starts.
          </Mono>

          {/* ── when ── */}
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
            <Mono size={8.5} tone="faint" track={0.1}>SCHEDULED START</Mono>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {[0, 1, 2, 3, 7].map((d) => (
                <Chip key={d} label={d === 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : `+${d}d`}
                  on={days === d} onPress={() => { tap(); setDays(d); }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
              {[18, 19, 20, 21].map((h) => (
                <Chip key={h} label={`${h % 12 || 12} PM`} on={mins === h * 60} onPress={() => { tap(); setMins(h * 60); }} />
              ))}
              <Pressable hitSlop={6} onPress={() => { tap(); setMins((m) => (m + 1410) % 1440); }}>
                <Text style={{ fontFamily: MONO, fontSize: 14, color: t.dim }}>−</Text>
              </Pressable>
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: t.text, minWidth: 52, textAlign: 'center' }}>
                {fmtHour(mins)}
              </Text>
              <Pressable hitSlop={6} onPress={() => { tap(); setMins((m) => (m + 30) % 1440); }}>
                <Text style={{ fontFamily: MONO, fontSize: 14, color: t.dim }}>＋</Text>
              </Pressable>
            </View>
            <Mono size={9} tone={past ? 'opp' : 'you'} style={{ marginTop: 7 }}>
              {past
                ? `${target.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} has already passed — pick a later day or time.`
                : `→ ${target.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
            </Mono>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Pressable disabled={busy || past} onPress={() => { tap(); onDone(() => setDraftStart(leagueId, target.toISOString())); }}
                style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy || past ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>SCHEDULE IT</Text>
              </Pressable>
              {st.start_at && (
                <Pressable disabled={busy} onPress={() => { tap(); onDone(() => setDraftStart(leagueId, null)); }}
                  style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.opp }}>✕ CLEAR</Text>
                </Pressable>
              )}
            </View>
            <Mono size={8.5} tone="faint" style={{ marginTop: 6, lineHeight: 13 }}>
              {st.start_at
                ? 'Armed. The draft opens itself at that time whether or not anyone has the app open, and the league gets a reminder about an hour out.'
                : 'Optional — leave it and the draft starts when you press the button.'}
            </Mono>
          </View>

          {/* ── order ── */}
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
            <Mono size={8.5} tone="faint" track={0.1}>DRAFT ORDER</Mono>
            <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 13 }}>
              {st.order
                ? 'Set — the draft starts on this order, and everyone can see it now.'
                : 'Not set: randomized the moment the draft starts. Draw it here instead and the league sees it first.'}
            </Mono>
            <View style={{ marginTop: 7, gap: 2 }}>
              {rows.map((rid, i) => (
                <View key={rid} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: t.faint, width: 18 }}>{i + 1}.</Text>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.text }}>{teamName(rid) ?? `Team ${rid}`}</Text>
                  <Pressable hitSlop={6} disabled={i === 0} onPress={() => { tap(); move(i, -1); }}>
                    <Text style={{ fontFamily: MONO, fontSize: 13, color: i === 0 ? t.faint : t.dim }}>▲</Text>
                  </Pressable>
                  <Pressable hitSlop={6} disabled={i === rows.length - 1} onPress={() => { tap(); move(i, 1); }}>
                    <Text style={{ fontFamily: MONO, fontSize: 13, color: i === rows.length - 1 ? t.faint : t.dim }}>▼</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Pressable disabled={busy} onPress={() => {
                tap();
                onDone(async () => {
                  const r = await setDraftOrder(leagueId, null);
                  if (r.ok && r.order) setOrd(r.order);
                  return r;
                });
              }} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>🎲 RANDOMIZE</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => { tap(); onDone(() => setDraftOrder(leagueId, rows)); }}
                style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>SAVE ORDER</Text>
              </Pressable>
            </View>
          </View>

          {/* ── THE LOTTERY (0189) ────────────────────────────────────────────
              🎲 RANDOMIZE above is a FLAT shuffle — every seat equal. A dynasty
              league usually wants the opposite: last year's bottom team holding
              more balls than the team that nearly won. Shares are WEIGHTS, not
              percentages ("worst 250, champion 5"), because percentages have to
              be rebalanced every time one changes.

              The DRAW IS RECORDED and shown below, which is the point — a
              weighted lottery nobody can inspect afterwards is indistinguishable
              from a commissioner typing an order, and "the worst team won it
              again" is a sentence that costs leagues members. */}
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
            <Mono size={8.5} tone="faint" track={0.1}>LOTTERY</Mono>
            <Mono size={8.5} tone="faint" style={{ marginTop: 5, lineHeight: 13 }}>
              Give each team a weight and draw the order from it. Leave them all equal for a flat draw; a weight of 0
              means they take a slot behind everyone drawn.
            </Mono>
            <View style={{ marginTop: 7, gap: 2 }}>
              {rows.map((rid) => (
                <View key={`share-${rid}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.bg, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 5 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.text }}>{teamName(rid) ?? `Team ${rid}`}</Text>
                  {(() => {
                    const w = shares[rid] ?? 1;
                    const tot = rows.reduce((n, r2) => n + (shares[r2] ?? 1), 0);
                    return <Mono size={8.5} tone="faint">{tot > 0 ? `${((w / tot) * 100).toFixed(1)}%` : '—'}</Mono>;
                  })()}
                  <TextInput value={String(shares[rid] ?? 1)} keyboardType="number-pad"
                    onChangeText={(v) => setShares((cur) => ({ ...cur, [rid]: Math.max(0, Math.min(1000000, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0)) }))}
                    style={{ width: 62, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 4, color: t.text, fontFamily: MONO, fontSize: 11, paddingHorizontal: 7, paddingVertical: 4, textAlign: 'right' }} />
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Pressable disabled={busy} onPress={() => { tap(); onDone(() => setLotteryShares(leagueId, shares)); }}
                style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.dim }}>SAVE SHARES</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => {
                tap();
                onDone(async () => {
                  const r = await setLotteryShares(leagueId, shares);
                  if (!r.ok) return r;
                  const d = await runDraftLottery(leagueId);
                  if (d.ok && d.order) { setOrd(d.order); setDrawn(d.result ?? null); }
                  return d;
                });
              }} style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy ? 0.5 : 1 }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>🎰 RUN THE LOTTERY</Text>
              </Pressable>
            </View>
            {!!drawn?.length && (
              <View style={{ marginTop: 9, gap: 2 }}>
                <Mono size={8.5} tone="faint" track={0.1}>THE DRAW</Mono>
                {drawn.map((d, i) => (
                  <View key={`drawn-${d.roster_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: i === 0 ? t.you : t.faint, width: 20 }}>{i + 1}.</Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: t.text }}>{teamName(d.roster_id) ?? `Team ${d.roster_id}`}</Text>
                    <Mono size={8.5} tone="faint">{d.share} · {(d.odds * 100).toFixed(1)}%</Mono>
                  </View>
                ))}
                <Mono size={8} tone="faint" style={{ marginTop: 4, lineHeight: 11 }}>
                  The odds shown are the ones each team held on its own draw, not its opening odds.
                </Mono>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function NightEditor({ current, busy, onSet, onClear }: {
  current: { start_min: number; end_min: number } | null;
  busy: boolean;
  onSet: (startMin: number, endMin: number) => void;
  onClear: () => void;
}) {
  const t = useTheme();
  const [start, setStart] = useState(current ? Math.floor(current.start_min / 60) : 22);
  const [end, setEnd] = useState(current ? Math.floor(current.end_min / 60) : 9);
  const step = (v: number, d: number) => (v + d + 24) % 24;
  const dial = (label: string, v: number, set: (n: number) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Mono size={8.5} tone="faint" track={0.1}>{label}</Mono>
      <Pressable hitSlop={6} onPress={() => { tap(); set(step(v, -1)); }}><Text style={{ fontFamily: MONO, fontSize: 13, color: t.dim }}>−</Text></Pressable>
      <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', color: t.text, minWidth: 34, textAlign: 'center' }}>{fmtHour(v * 60)}</Text>
      <Pressable hitSlop={6} onPress={() => { tap(); set(step(v, 1)); }}><Text style={{ fontFamily: MONO, fontSize: 13, color: t.dim }}>＋</Text></Pressable>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 8, backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8 }}>
      <Mono size={8.5} tone="faint" track={0.1}>🌙 PAUSE (ET)</Mono>
      {dial('FROM', start, setStart)}
      {dial('TO', end, setEnd)}
      <Pressable disabled={busy || start === end} onPress={() => { tap(); onSet(start * 60, end * 60); }}
        style={{ backgroundColor: t.you, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, opacity: busy || start === end ? 0.5 : 1 }}>
        <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>SET</Text>
      </Pressable>
      {current && (
        <Pressable disabled={busy} onPress={() => { tap(); onClear(); }}>
          <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.opp }}>✕ OFF</Text>
        </Pressable>
      )}
      <Mono size={8} tone="faint" style={{ width: '100%', lineHeight: 12 }}>
        Clocks only burn awake time — no deadline can expire inside the pause. Acting early is always allowed.
      </Mono>
    </View>
  );
}


// ── the commissioner's mid-draft controls (0191) ─────────────────────────────
/** Everything a commissioner needs once the room is RUNNING and something has
 *  gone wrong: assign a pick by hand, reseat a team, put a seat on autodraft,
 *  or throw the whole draft away and start over.
 *
 *  Pause/force/undo stay in the header row — they're the ones you reach for
 *  mid-sentence. These are the ones you reach for after the room has stopped to
 *  look at you, so they're a drawer rather than five more chips in a row that
 *  already wraps.
 *
 *  MOVING A TEAM SLIDES, it doesn't swap: ▲ on the 4th seat makes it 3rd and
 *  pushes the old 3rd down to 4th, which is what "put him at the end" means and
 *  what a swap would get wrong for every seat in between. */
function CommishControls({ leagueId, st, busy, teamName, autos, assign, onAssign, onRun }: {
  leagueId: string; st: DraftState; busy: boolean;
  teamName: (rid: number | null | undefined) => string | null;
  autos: Record<number, boolean>;
  assign: boolean; onAssign: (on: boolean) => void;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const t = useTheme();
  const [confirm, setConfirm] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const order = st.order ?? [];
  const snake = st.mode === 'snake';
  const live = st.status === 'live';
  const canMove = snake && st.status !== 'complete' && order.length > 1;

  return (
    <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10, gap: 10 }}>
      {snake && live && (
        <View style={{ gap: 6 }}>
          <Mono size={8.5} tone="faint" track={0.12}>ASSIGN A PLAYER</Mono>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Chip label={assign ? '⚑ ASSIGNING — TAP TO STOP' : '⚑ PICK FOR THE SEAT ON THE CLOCK'} on={assign}
              onPress={() => { tap(); onAssign(!assign); }} />
          </View>
          <Mono size={8.5} tone="faint" style={{ lineHeight: 13 }}>
            Turns the PLAYERS list into the on-clock team's board — the next player you tap becomes their pick.
          </Mono>
        </View>
      )}

      {canMove && (
        <View style={{ gap: 4 }}>
          <Mono size={8.5} tone="faint" track={0.12}>DRAFT ORDER · AUTODRAFT</Mono>
          {order.map((rid, i) => (
            <View key={rid} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
              <Mono size={9} tone="faint" style={{ width: 18 }}>{i + 1}</Mono>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: t.text }}>{teamName(rid) ?? `Team ${rid}`}</Text>
              <Chip label={autos[rid] ? '🤖 AUTO' : '🤖 OFF'} on={!!autos[rid]}
                onPress={() => { tap(); onRun(() => setAutodraft(leagueId, rid, !autos[rid])); }} />
              <Pressable hitSlop={6} disabled={busy || i === 0} onPress={() => { tap(); onRun(() => commishMoveDraftSlot(leagueId, rid, i)); }}>
                <Text style={{ color: i === 0 ? t.faint : t.dim, fontSize: 15 }}>↑</Text>
              </Pressable>
              <Pressable hitSlop={6} disabled={busy || i === order.length - 1} onPress={() => { tap(); onRun(() => commishMoveDraftSlot(leagueId, rid, i + 2)); }}>
                <Text style={{ color: i === order.length - 1 ? t.faint : t.dim, fontSize: 15 }}>↓</Text>
              </Pressable>
            </View>
          ))}
          <Mono size={8.5} tone="faint" style={{ lineHeight: 13, paddingTop: 4 }}>
            {live
              ? 'Picks already made keep their seats; everything from the clock forward follows the new order. Autodraft keeps picking even while the draft is paused.'
              : 'Autodraft keeps picking even while the draft is paused — a pause is time for people, not robots.'}
          </Mono>
        </View>
      )}

      {st.status !== 'pending' && (
        <View style={{ gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
          <Mono size={8.5} tone="faint" track={0.12}>START OVER</Mono>
          {!resetOpen ? (
            <Pressable disabled={busy} onPress={() => { tap(); setResetOpen(true); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.opp, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, alignSelf: 'flex-start', opacity: busy ? 0.5 : 1 }}>
              <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.opp }}>🗑 TRASH THE DRAFT</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 6 }}>
              <Mono size={9.5} tone="opp" style={{ lineHeight: 14 }}>
                {`Every pick in this room goes (${(st.picks ?? []).length} so far) and the draft goes back to pending. Keepers, traded picks and everyone's queue survive. Type RESET to confirm.`}
              </Mono>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput value={confirm} onChangeText={setConfirm} placeholder="RESET" placeholderTextColor={t.faint}
                  autoCapitalize="characters" autoCorrect={false}
                  style={{ flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontFamily: MONO, fontSize: 12, color: t.text, backgroundColor: t.bg }} />
                <Pressable disabled={busy || confirm.trim().toLowerCase() !== 'reset'}
                  onPress={() => { tap(); onRun(() => commishResetDraft(leagueId, confirm)); setConfirm(''); setResetOpen(false); }}
                  style={{ backgroundColor: t.opp, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, opacity: busy || confirm.trim().toLowerCase() !== 'reset' ? 0.4 : 1 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: t.onAccent }}>START OVER</Text>
                </Pressable>
                <Pressable hitSlop={6} onPress={() => { tap(); setResetOpen(false); setConfirm(''); }}>
                  <Text style={{ fontFamily: MONO, fontSize: 9.5, color: t.dim }}>CANCEL</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
