// LivePicks, native.
//
// Deliberately the FIRST screen ported: it's the smallest one that exercises
// the whole stack — Supabase reads/writes through core's liveApi, the slate and
// per-window lock logic, the metric catalogue, the premium gate and the coin
// wallet. If this renders and seals a lineup against the real backend, the
// architecture works; the rest is surface area.
//
// Every line of game logic below is imported, not reimplemented: the eligibility
// gating, lock rules, pick shape and power-up prices all come from @drip/core,
// exactly as they do on web. That is the whole point of the extraction — a rule
// change lands in one file and both apps get it.
import { useCallback, useEffect, useMemo, useState, useRef} from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LOCKED_METRIC_UNLOCK } from '@drip/core/data/metrics';
import { windowForTeam, hasSlate, setRuntimeSlate, weekLabel, windowsForWeek, windowDateLabel, windowTimeLabel, gamesInWindow, nflGameForTeam, kickoffLabel, isPreseasonWeek, LOCK_LEAD_MS, windowPhase } from '@drip/core/data/nflSlate';
import { teamLogo } from '@drip/core/data/media';
import { srvBoardTotals } from '@drip/core/engine/liveScore';
import { slugMeta, setSlugMetaOverrides } from '@drip/core/data/slugMeta';
import { shortName } from '@drip/core/data/players';
import { powerupById, POWERUPS, isAmplifier, ampCapacity } from '@drip/core/data/powerups';
import { REG_SEASON_WEEKS } from '@drip/core/data/league';
import { ensurePremiumTier, isFreePowerup, isFreePosition, markGatedAttempt } from '@drip/core/data/premiumClient';
import {
  myRoster, myMatchup, myPool, myPicks, savePicks, myMembership, setTeamController,
  myBuffs, heroSetBuffs, myInventory, consumeInventory, refundInventory, leagueLiveBuffs, leagueGameMode,
  myUnlocks, armUnlock, disarmUnlock, myComboQty,
  myWallet, ensureWallet,
  liveSlate, matchupTeams, matchupPremium, startCheckout, friendlyError,
  getMatchup, getMatchupState, getRevealedPicks, revealedOppBuffs, subscribeMatchup, weekGameFeeds, weekLivePlays, leagueWeeks,
  type LiveMatchup, type PoolPlayer, type PickRow, type Controller, type TeamInfo,
  type WindowScore, type RevealedPick, type GameFeedRow,
  nativeTeamState, loadLiveInjuries, loadTeamOverrides, leaguePool,
} from '@drip/core/data/liveApi';
import { clearLiveInjuries } from '@drip/core/data/injuries';
import { setLiveGameFeed, feedRowsToWeek, gameFeedFor, groupFieldGames } from '@drip/core/data/gameFeed';
import { setLivePlays, liveRowsToPbp } from '@drip/core/data/realPbp';
import { statlineAt, metricDriver } from '@drip/core/engine/sim';
import { Ev, track } from '@drip/core/analytics';
import type { PoolGroup } from '@drip/core/data/poolEntry';
import type { GameWindow, Player, Pos, WindowId } from '@drip/core/types';
import { useTheme, MONO, alpha } from '../theme.native';
import { useLeagueScroll } from '../ui/scrollChrome';
import { tap, commit } from '../ui/feedback';
import { Card, Chip, Display, LinkButton, Mono, Notice } from '../ui/prims';
import { SetupRow } from '../ui/SetupRow';
import { PlayerPicker } from '../ui/PlayerPicker';
import { RosterPanel } from '../ui/RosterPanel';
import { ShopModal } from '../ui/ShopModal';
import { PowerupHand, HAND_TAB_H, type HandCard } from '../ui/PowerupHand';
import { Duel, round1 } from '../ui/Duel';
import { FieldView } from '../ui/FieldView';
import { PlayLog } from '../ui/PlayLog';
import { liveDuelEvents } from '@drip/core/data/duelLog';
import { Overlay } from '../ui/Overlay';
import { CommishKit } from '../ui/CommishKit';
import { ClassicBoard } from '../ui/ClassicBoard';
import { clearLeagueFlags } from '@drip/core/data/commish';

// Live pool entries are slug/full/pos; SetupRow wants a Player. Build a light
// one — the setup board only ever displays name/pos/team.
const ZERO_STATS = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
function poolToPlayer(p: PoolPlayer): Player {
  // The row's own team FIRST: the pool carries the current team exactly so
  // 2026 rookies resolve (the baked slugMeta table is 2025 PBP players only —
  // a rookie like Carson Beck rendered teamless off it).
  return { id: p.slug, name: shortName(p.full), full: p.full, pos: p.pos as Pos, team: p.team || slugMeta(p.slug).team, stats: { ...ZERO_STATS } };
}

// The board used to carry a hardcoded LIVE_UNLOCKS trio here. The shop derives
// the set from `kind: 'metric'` instead, which is the property that decides the
// behaviour anyway — and which does not go stale: the hardcoded list had missed
// `unlock-underdog` since it was added, so its metric gated on an unlock nothing
// in the app could arm.

interface Slot { win: string; winLabel: string; slot: string; key: string }

/** A week's slots, from that week's OWN windows.
 *
 *  Not a module constant. `WINDOWS` in metrics.ts is the regular-season default
 *  — TNF / SUN 1PM x3 / SUN 4PM x2 / SNF / MNF — but a week's real windows are
 *  DERIVED from its actual kickoffs (nflSlate.deriveWeek), and preseason weeks
 *  cluster into a different shape entirely. Building slots from the static list
 *  showed the wrong windows AND hid saved picks, because a pick is keyed by
 *  `game_window` and the ids did not line up. Worse, sealing would have written
 *  rows under window ids the week does not have. */
const slotsFor = (wins: GameWindow[]): Slot[] =>
  wins.flatMap((w) =>
    Array.from({ length: w.slots }, (_, i) => ({ win: w.id, winLabel: w.label, slot: String(i), key: `${w.id}-${i}` })));

/** The real NFL games a window covers. Thin wrapper so the render path reads
 *  cleanly; deriveWeek already memoises per week. */
const slateOf = (week: number, win: WindowId) => gamesInWindow(week, win);

const fmtLock = (iso: string | null) => {
  if (!iso) return 'kickoff';
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export function LivePicks({ userId, leagueId, rosterId, native, onBack, openShopSignal }: {
  userId: string; leagueId?: string; rosterId?: number;
  /** Native league: check roster legality — an over-limit roster is locked out
   *  of picks and power-ups (0072/0128), and the ban deserves a banner here,
   *  not just an error after a tap. */
  native?: boolean;
  onBack: () => void;
  /** League-home SHOP tile (0182): each bump opens the power-up shop. */
  openShopSignal?: number;
}) {
  const t = useTheme();
  const chromeScroll = useLeagueScroll();   // the shell's folding chrome (v0.356.0)
  const [matchup, setMatchup] = useState<LiveMatchup | null>(null);
  // Classic leagues (0157) swap the whole drip board for the traditional one.
  const [gameMode, setGameMode] = useState<'drip' | 'classic' | null>(null);
  // Readable inside the loader without making it a dependency.
  const gameModeRef = useRef<'drip' | 'classic' | null>(null);
  // Keep the ref in step with the state it mirrors — without this the guard
  // above reads a permanent null and quietly reverts to the old behaviour.
  useEffect(() => { gameModeRef.current = gameMode; }, [gameMode]);
  const [myTeam, setMyTeam] = useState<TeamInfo | null>(null);
  const [oppTeam, setOppTeam] = useState<TeamInfo | null>(null);
  const [roster, setRoster] = useState<{ leagueId: string; rosterId: number } | null>(null);
  // Real-time power-ups league switch (0155) — off refuses arms with a clear line.
  const [liveBuffsOn, setLiveBuffsOn] = useState(true);
  // The live duel log (0193): which pair's log is open, + the opponent's
  // revealed buff set the resolution needs.
  const [logFor, setLogFor] = useState<{ win: string; slot: string } | null>(null);
  const [oppBuffs, setOppBuffs] = useState<string[]>([]);
  const [controller, setController] = useState<Controller>('human');
  // Why this roster is locked out of picks/power-ups (native leagues; null = legal).
  const [rosterIssue, setRosterIssue] = useState<string | null>(null);

  useEffect(() => {
    if (!native || !leagueId) { setRosterIssue(null); return; }
    nativeTeamState(leagueId).then((tm) => setRosterIssue(tm.roster_issue ?? null)).catch(() => {});
  }, [native, leagueId]);
  const [aiBusy, setAiBusy] = useState(false);
  const [pool, setPool] = useState<PoolPlayer[]>([]);
  const [picks, setPicks] = useState<Record<string, { player_slug: string | null; metric_id: string | null }>>({});
  const [buffs, setBuffs] = useState<Set<string>>(new Set());
  const [unlocks, setUnlocks] = useState<Set<string>>(new Set());
  const [comboQty, setComboQty] = useState(0);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [coins, setCoins] = useState(0);
  const [buffBusy, setBuffBusy] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  // PULL TO REFRESH (v0.344.4, founder: "swipe down to refresh your matchup").
  // The board had no RefreshControl at all — the gesture just bounced the list,
  // so the pull looked broken and the reflex was to leave and come back in.
  // `refreshLive` is defined inside the loader effect (it closes over the
  // matchup it loaded); a ref is how the gesture reaches the CURRENT one
  // without re-running the whole load and flashing the spinner.
  const refreshLiveRef = useRef<(() => Promise<void>) | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    // A failed pull keeps what is on screen — the live board is a poor place
    // to blank out on a subway blip. The realtime channel is still attached.
    try { await refreshLiveRef.current?.(); } catch { /* keep prior */ }
    setRefreshing(false);
  }, []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** True once the server's saved picks are in `picks`. Gates the autosave so
   *  the empty first render can never overwrite a real lineup. */
  const [hydrated, setHydrated] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  useEffect(() => { if (openShopSignal) setShopOpen(true); }, [openShopSignal]);
  const [matchPremium, setMatchPremium] = useState(true); // default true = no false locks until we know
  const [weekSel, setWeekSel] = useState<number | null>(null);
  // Every week this league actually scheduled, in play order (v0.279.0). The
  // stepper used to count 1..REG_SEASON_WEEKS, which cannot reach a preseason
  // week — those are numbered from PRESEASON_BASE — so a league playing PRE
  // 1–4 had four boards nobody could open.
  const [weeks, setWeeks] = useState<number[]>([]);
  const [winKickIso, setWinKickIso] = useState<Record<string, string>>({});
  // The VALUE is deliberately discarded — only the re-render matters. `injuryFor`
  // is a synchronous module-cache read (it has to be; the engine calls it too),
  // so a report landing after first paint would never reach the badges on its
  // own. Bumping this state re-renders the board, and the badges with it.
  const [, setInjuryVer] = useState(0);
  // Same contract for commissioner flags: flagFor is a synchronous module-cache
  // read; CommishKit bumps this when the league's flags land or change.
  const [, setCommishVer] = useState(0);
  const [lockedWins, setLockedWins] = useState<Set<string>>(new Set());
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Set only after the live slate is installed below — windowsForWeek() reads
  // that slate, so asking before it lands returns the generic default.
  const [wins, setWins] = useState<GameWindow[]>([]);
  // The opponent's ROSTER is public in this game — what stays hidden is which
  // player they put in which slot. So scouting fetches their pool the same way
  // it fetches yours, and shows only who COULD appear in a window.
  const [oppPool, setOppPool] = useState<PoolPlayer[]>([]);
  const [scoutWin, setScoutWin] = useState<GameWindow | null>(null);
  /** Which window's game slate is open — the real NFL games it covers. */
  const [slateWin, setSlateWin] = useState<GameWindow | null>(null);
  /** Which roster is expanded — one at a time, so the board stays reachable. */
  const [rosterOpen, setRosterOpen] = useState<'you' | 'their' | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false); // ▦ all-fields overlay (web FieldBoard's sibling)

  // ── Live state ──────────────────────────────────────────────────────────────
  // What the WORKER published, not anything resolved here. This screen used to
  // stop at lock — a locked window greyed its cards out and that was the end of
  // it — and the scores lived on a separate LIVE BOARD tab, so on Sunday you set
  // a lineup on one screen and watched it on another. Now a window is SETUP
  // before its kickoff and LIVE after, on this one board, the way the web's
  // Matchup phases.
  const [scores, setScores] = useState<WindowScore[]>([]);
  const [revealed, setRevealed] = useState<RevealedPick[]>([]);
  const [youAreHome, setYouAreHome] = useState(true);
  /** Per-GAME play feeds the worker publishes — what the drive chart reads.
   *  Separate from live_play (the engine's per-player rows): a field needs the
   *  whole game's drives, not one player's touches. */
  const [gameFeeds, setGameFeeds] = useState<GameFeedRow[]>([]);

  useEffect(() => { ensurePremiumTier(); }, []);

  useEffect(() => {
    let alive = true;
    let unsub = () => {};
    (async () => {
      try {
        setState('loading'); setErr(null); setHydrated(false);
        const r = leagueId && rosterId != null ? { leagueId, rosterId } : await myRoster(userId);
        if (!r) { setState('none'); return; }
        setRoster(r);
        // Classic leagues (0157) branch to the traditional board — the drip
        // load below (windows, buffs, shop) never runs for them.
        const gm = await leagueGameMode(r.leagueId).catch(() => null);
        if (!alive) return;
        if (gm?.ok && gm.mode === 'classic') { setGameMode('classic'); setState('ready'); return; }
        // A FAILED READ IS NOT A DRIP LEAGUE (v0.232.0). `gm` is null when the
        // RPC threw — a blip, an auth refresh mid-flight — and treating that
        // as "not classic" silently drops a normie league onto the card board.
        // Only a definitive answer moves the mode; a failure keeps whatever we
        // already knew and lets the next run settle it.
        if (gm?.ok) setGameMode(gm.mode === 'classic' ? 'classic' : 'drip');
        else if (gameModeRef.current == null) setGameMode('drip');
        if (gameModeRef.current === 'classic') { setState('ready'); return; }
        // Live meta for the DUEL LOG's engine call (0200.1): the baked slug
        // table only knows the 2025 demo names, so a 2026 fringe player fell
        // to the WR/no-team fallback and his client-resolved duel banked 0.0
        // with no drip events while the server scored him. The league pool
        // knows every rostered player's pos+team — install it as the slugMeta
        // overlay so the log resolves the same players the worker does.
        if (native) leaguePool(r.leagueId).then((lp) => setSlugMetaOverrides(lp)).catch(() => {});
        leagueLiveBuffs(r.leagueId).then((lb) => { if (lb.ok) setLiveBuffsOn(lb.on !== false); }).catch(() => {});
        // The league's own week list — what the ‹ › stepper walks, so a
        // preseason board is reachable at all (v0.279.0).
        leagueWeeks(r.leagueId).then((w) => { if (w.length) setWeeks(w); }).catch(() => {});
        myMembership(r.leagueId, r.rosterId).then((mm) => { if (mm?.controller) setController(mm.controller); }).catch(() => {});
        const m = await myMatchup(r.leagueId, r.rosterId, weekSel ?? undefined);
        if (!m) { setMatchup(null); setState('none'); return; }
        setMatchup(m);
        matchupPremium(m.id).then(setMatchPremium).catch(() => {});
        matchupTeams(r.leagueId, [m.home_roster_id, m.away_roster_id]).then((tm) => {
          setMyTeam(tm[r.rosterId] ?? null);
          const oppId = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
          setOppTeam(tm[oppId] ?? null);
        }).catch(() => {});
        const [pl, pk, bf, un, slate, cq] = await Promise.all([
          myPool(r.leagueId, m.week, r.rosterId), myPicks(m.id, userId), myBuffs(m.id), myUnlocks(m.id),
          liveSlate(m.week).catch(() => []), myComboQty(m.id, userId).catch(() => 0),
        ]);
        myInventory(m.id).then((inv) => setInventory(inv ?? {})).catch(() => {});
        // The week's NFL injury report. Cleared first so a league or week switch
        // can never show the previous board's designations against this pool.
        // Off the critical path on purpose — it swallows its own failures and
        // resolves into a module cache, so a slow feed delays no part of the
        // board; `injuryVer` bumps to re-render the badges once it lands.
        clearLiveInjuries();
        clearLeagueFlags();
        void loadTeamOverrides(); // global player→team drift (0142); cheap, auth-gated
        loadLiveInjuries(m.week).then((n) => { if (alive && n) setInjuryVer((v) => v + 1); }).catch(() => {});
        {
          const oppRoster = m.home_roster_id === r.rosterId ? m.away_roster_id : m.home_roster_id;
          myPool(r.leagueId, m.week, oppRoster).then(setOppPool).catch(() => setOppPool([]));
        }
        // `kickoff` is NOT optional here, whatever the type says. deriveWeek()
        // clusters a week into its real windows from kickoff times, and it
        // demands a kickoff on EVERY game — one missing and it abandons the
        // whole derivation for the fixed regular-season five (tnf / early /
        // late / snf / mnf). Omitting it therefore fails silently and
        // plausibly: the board renders five sensible-looking windows, and a
        // preseason week that really has (say) seven Thursday-through-Saturday
        // clusters loses the ones with no fallback equivalent.
        //
        // That is not just a cosmetic mismatch. Picks are stored against the
        // DERIVED window id, and repeated buckets get a numeric suffix
        // (tnf, tnf2, tnf3…). Under the fallback the app renders `tnf` and
        // never `tnf2`, so a pick saved on the web is present, correct and
        // invisible — which read as "my picks are gone" when only the one pick
        // that landed in the first cluster survived.
        setRuntimeSlate(m.week, slate.map((g) => ({
          away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId,
          kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
        })));
        // MUST follow setRuntimeSlate: this is what makes a preseason week show
        // its own windows instead of the regular-season five.
        setWins(windowsForWeek(m.week));
        const wkick: Record<string, string> = {};
        for (const g of slate) {
          if (!g.kickoff) continue;
          if (!wkick[g.win] || Date.parse(g.kickoff) < Date.parse(wkick[g.win])) wkick[g.win] = g.kickoff;
        }
        setWinKickIso(wkick);
        setPool(pl);
        const map: Record<string, { player_slug: string | null; metric_id: string | null }> = {};
        const lw = new Set<string>();
        for (const p of pk) {
          if (p.locked) lw.add(p.game_window);
          // Extra slots ('x0','x1'…) are not offered on mobile yet — see the
          // note on the Extra slots card below.
          if (!/^x\d+$/.test(p.roster_slot)) map[`${p.game_window}-${p.roster_slot}`] = { player_slug: p.player_slug, metric_id: p.metric_id };
        }
        setLockedWins(lw);
        setPicks(map);
        setHydrated(true);
        setBuffs(new Set(bf ?? []));
        setUnlocks(new Set(un ?? []));
        setComboQty(Number(cq ?? 0));
        ensureWallet(m.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {});
        setYouAreHome(m.home_roster_id === r.rosterId);

        // Live reads, then a realtime channel. No polling loop: the worker
        // writes matchup_state and Supabase pushes, which is also why the score
        // on the phone cannot drift from the score on the web.
        const refreshLive = async () => {
          const [mm, ss, pk2, gf, lp] = await Promise.all([
            getMatchup(m.id), getMatchupState(m.id), getRevealedPicks(m.id),
            weekGameFeeds(m.week).catch(() => [] as GameFeedRow[]),
            // The week's ingested plays: what lets the duel cards compute the
            // metric DRIVER ("127 pass yd") locally, same engine as the web.
            weekLivePlays(m.week).catch(() => []),
          ]);
          if (!alive) return;
          if (mm) setMatchup(mm);
          setScores(ss); setRevealed(pk2);
          if (lp.length) setLivePlays(m.week, liveRowsToPbp(lp));
          revealedOppBuffs(m.id, userId).then((b) => { if (alive && b) setOppBuffs(b); }).catch(() => {});
          // Install the week's feeds so gameFeedFor() resolves them. The live
          // overlay is exclusive per week — a live board must never fall through
          // to baked 2025 drives, which would draw a plausible, wrong field.
          setLiveGameFeed(m.week, feedRowsToWeek(gf));
          setGameFeeds(gf);
        };
        await refreshLive().catch(() => {});
        if (!alive) return;
        refreshLiveRef.current = refreshLive;
        unsub = subscribeMatchup(m.id, () => { refreshLive().catch(() => {}); });

        setState('ready');
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : 'Failed to load.'); setState('error');
      }
    })();
    return () => { alive = false; unsub(); refreshLiveRef.current = null; };
  }, [userId, leagueId, rosterId, weekSel, attempt]);

  const locked = !!matchup && (matchup.status !== 'scheduled' || (!!matchup.lock_at && new Date(matchup.lock_at) <= new Date()));

  /** Slug → player for the DUEL, covering both sides. The old live board passed
   *  only your own pool, so an opponent's revealed card fell back to a face-down
   *  back whenever their player wasn't also on your roster — which is almost
   *  always. Scouting already loads their pool; merging it here is what makes
   *  the reveal actually show you what you were beaten by. */
  const duelPool = useMemo(
    () => Object.fromEntries([...oppPool, ...pool].map((p) => [p.slug, p])) as Record<string, PoolPlayer>,
    [pool, oppPool]);

  /** Window labels from the week's OWN windows — a preseason cluster has no
   *  entry in the regular-season list and would render as its raw id. */
  const winLabelFor = (id: string) => wins.find((w) => String(w.id) === id)?.label ?? id.toUpperCase();

  // The live duel log (0193): one engine run per open — resolveLiveMatchup
  // over the revealed picks with events captured. The plays are already in
  // the engine (refreshLive's setLivePlays); computing lazily on logFor means
  // a board that never opens a log never pays for the resolution.
  const duelEvents = useMemo(() => {
    if (!logFor || !matchup) return null;
    try {
      return liveDuelEvents(
        revealed.filter((p) => p.app_user_id === userId),
        revealed.filter((p) => p.app_user_id !== userId),
        matchup.week, youAreHome, [...buffs], oppBuffs,
      );
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFor, revealed, matchup?.week, youAreHome, buffs, oppBuffs]);

  /** The field(s) under one duel: the real NFL games the two players are in.
   *
   *  Deduped by team, because the pair is very often IN the same game — a QB
   *  against the opposing RB — and two identical drive charts stacked under one
   *  pair reads as a rendering bug.
   *
   *  clock is MAX_SAFE_INTEGER: a live board always shows the latest play there
   *  is. The demo passes a real clock because it is scrubbing through a finished
   *  week; here "now" is simply the end of the feed.
   *
   *  Returns null when neither team has a published feed, which is also the
   *  honest answer before kickoff — FieldView itself renders nothing without one,
   *  but returning null keeps Duel from laying out an empty container. */
  const slotDetail = (win: string, slot: string) => {
    // Guard on the STATE, not just gameFeedFor: setLiveGameFeed writes a module
    // map, which React cannot see. Reading the row count here is what ties the
    // fields to a re-render when the feeds land.
    if (!gameFeeds.length) return null;
    const mySlug = revealed.find((p) => p.app_user_id === userId && p.game_window === win && p.roster_slot === slot)?.player_slug;
    const theirSlug = revealed.find((p) => p.app_user_id !== userId && p.game_window === win && p.roster_slot === slot)?.player_slug;
    const teams = [...new Set([mySlug, theirSlug]
      .map((sl) => (sl ? duelPool[sl]?.team || slugMeta(sl).team : ''))
      .filter(Boolean))];
    // Dedupe by the GAME the team maps to, not the team: a duel whose two
    // players share a game (DEN RB vs ATL RB in DEN@ATL) is ONE field, and
    // rendering it once per team stacked two identical fields (founder's
    // Fri-slate screenshot).
    const seenGames = new Set<string>();
    const withFeed = teams.filter((tm) => {
      const f = gameFeedFor(week, tm);
      if (!f || seenGames.has(f.key)) return false;
      seenGames.add(f.key);
      return true;
    });
    if (!withFeed.length) return null;
    return (
      <View style={{ gap: 6 }}>
        {withFeed.map((tm) => <FieldView key={tm} week={week} team={tm} clock={Number.MAX_SAFE_INTEGER} />)}
        {/* the live duel log (0193): the founder's minutes view, on demand */}
        <Pressable hitSlop={6} onPress={() => { tap(); setLogFor({ win, slot }); }}
          style={{ alignSelf: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, paddingHorizontal: 11, paddingVertical: 5 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: t.dim }}>▸ DUEL LOG · plays & minutes</Text>
        </Pressable>
      </View>
    );
  };

  // The shared headline rule (engine/liveScore): the sum of the resolver's
  // per-window rows read as you/them — the same function the web board uses,
  // so the two hosts round and sum the SAME way (v0.339.6; was a hand-rolled
  // reduce). Null only when nothing is published yet, hence the 0/0 fallback
  // this screen has always shown pre-kick.
  const totals = useMemo(() => srvBoardTotals(scores, youAreHome) ?? { you: 0, them: 0 }, [scores, youAreHome]);

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** A window's picks are final: the server sealed our rows, or its LOCK time
   *  passed. Once the week starts, a window with no known kickoff is treated as
   *  locked (fail safe).
   *
   *  Lock time, not kickoff. This compared against the raw kickoff, so the board
   *  stayed editable — and kept offering the player picker — through the whole
   *  hour the DB's enforce_window_lock trigger was already rejecting the write.
   *  The lead is LOCK_LEAD_MS in core now, shared with the web board. */
  const winLockMs = (winId: string): number | null => {
    const iso = winKickIso[winId];
    return iso ? Date.parse(iso) - LOCK_LEAD_MS : null;
  };
  const winLocked = (winId: string): boolean => {
    if (!locked) return false;
    if (lockedWins.has(winId)) return true;
    const ms = winLockMs(winId);
    return ms != null ? ms <= nowTs : true;
  };
  const allLocked = !!matchup && locked && wins.every((w) => winLocked(w.id));
  const slots = useMemo(() => slotsFor(wins), [wins]);

  const week = matchup?.week ?? 0;
  /** Every NFL game with a slotted player, deduped by game and ordered by the
   *  board's windows — the ▦ FIELDS overlay's list. Sources: revealed picks
   *  (both sides, kicked windows) plus YOUR own picks (all windows — the
   *  opponent's unkicked picks are sealed and stay out by design). */
  // THE SHARED ALL-GAMES RULE (core groupFieldGames, v0.340.1). This used to
  // list only games with a SLOTTED player — the exact filter the founder
  // struck from the web board in v0.338.2 ("should be all games"), still
  // alive here until now. Every feed game gets a card; the games your picks
  // touch sort first, the rest follow in schedule order — one rule on both
  // hosts, pinned by check-field-board.
  const fieldGames = (() => {
    if (!gameFeeds.length) return [] as { key: string; away: string; home: string; team: string; win: string; mine: boolean }[];
    const entries: { team: string; side: 'you'; clock: number }[] = [];
    const slugs = new Set<string>();
    for (const rp of revealed) if (rp.player_slug) slugs.add(rp.player_slug);
    for (const v of Object.values(picks)) if (v.player_slug) slugs.add(v.player_slug);
    for (const sl of slugs) {
      const tm = duelPool[sl]?.team || pool.find((p) => p.slug === sl)?.team || slugMeta(sl).team;
      if (tm) entries.push({ team: tm, side: 'you', clock: Number.MAX_SAFE_INTEGER });
    }
    return groupFieldGames(week, entries).map((g) => ({
      key: g.feed.key, away: g.feed.away, home: g.feed.home,
      team: g.feed.home, win: String(windowForTeam(week, g.feed.home)), mine: g.mine,
    }));
  })();

  const gateOn = hasSlate(week);
  // readPool resolves the team (the synced row's own first, then the baked 2025
  // table) — this used to consult slugMeta alone, which knows only players who
  // existed in 2025 and returned '' for everyone else, sending them to the
  // 'any' branch below instead of their real window.
  const teamBySlug = useMemo(() => Object.fromEntries(pool.map((p) => [p.slug, p.team || slugMeta(p.slug).team])), [pool]);
  // Slug → roster group. The pool is the manager's WHOLE roster now (starters,
  // bench, IR, taxi), and the group is the only thing distinguishing a fielded
  // RB1 from a taxi rookie in a list that otherwise shows them identically.
  const grpBySlug = useMemo<Record<string, PoolGroup>>(
    () => Object.fromEntries(pool.map((p) => [p.slug, p.grp])), [pool]);
  const oppWinBySlug = useMemo<Record<string, WindowId | 'any' | null>>(() => {
    const m: Record<string, WindowId | 'any' | null> = {};
    for (const p of oppPool) { const tm = p.team || slugMeta(p.slug).team; m[p.slug] = tm ? windowForTeam(week, tm) : 'any'; }
    return m;
  }, [oppPool, week]);
  const oppGrpBySlug = useMemo<Record<string, PoolGroup>>(
    () => Object.fromEntries(oppPool.map((p) => [p.slug, p.grp])), [oppPool]);
  const winBySlug = useMemo<Record<string, WindowId | 'any' | null>>(() => {
    const m: Record<string, WindowId | 'any' | null> = {};
    for (const p of pool) { const tm = teamBySlug[p.slug]; m[p.slug] = tm ? windowForTeam(week, tm) : 'any'; }
    return m;
  }, [pool, teamBySlug, week]);

  const eligibleFor = (winId: string, picked: string | null): PoolPlayer[] => {
    let list = gateOn ? pool.filter((p) => winBySlug[p.slug] === 'any' || winBySlug[p.slug] === winId) : pool;
    if (picked && !list.some((p) => p.slug === picked)) {
      const s = pool.find((p) => p.slug === picked);
      if (s) list = [s, ...list];
    }
    return list;
  };

  const playersBySlug = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of pool) m[p.slug] = poolToPlayer(p);
    return m;
  }, [pool]);

  const slottedInWin = (winId: string, exceptKey: string): Set<string> => {
    const s = new Set<string>();
    for (const sl of slots.filter((x) => x.win === winId)) {
      if (sl.key === exceptKey) continue;
      const slug = picks[sl.key]?.player_slug;
      if (slug) s.add(slug);
    }
    return s;
  };

  const setSlot = (key: string, patch: Partial<{ player_slug: string | null; metric_id: string | null }>) => {
    setSaved(false);
    setPicks((prev) => {
      const cur = prev[key] ?? { player_slug: null, metric_id: null };
      const next = { ...cur, ...patch };
      if (patch.player_slug !== undefined) next.metric_id = null; // reset metric when player changes
      return { ...prev, [key]: next };
    });
  };

  // AUTOSAVE, debounced — there is no manual seal, because sealing is not a
  // player action. A window's picks lock on the real clock, one hour before its
  // first kickoff (server: config.lockLeadMs, written to matchup.lock_at by the
  // sync and enforced by the 0058 trigger). The web board has worked this way
  // all along — "the live board has no LOCK IN button" — and the app shipped a
  // SEAL LINEUP button instead, which was wrong twice over: it named the player
  // as the one who seals, and it meant a lineup you built but didn't press the
  // button on was never saved at all.
  //
  // Only AFTER the saved lineup has hydrated. Autosaving from the first render
  // would write the empty initial `picks` over a returning manager's real
  // lineup, which is a far worse bug than the one being fixed.
  useEffect(() => {
    if (!matchup || !hydrated) return;
    const id = setTimeout(() => {
      const rows: PickRow[] = slots
        .map((sl) => {
          const p = picks[sl.key];
          return { game_window: sl.win, roster_slot: sl.slot, player_slug: p?.player_slug ?? null, metric_id: p?.metric_id ?? null };
        })
        // Only filled slots in still-open windows: a locked window's rows are
        // sealed server-side and would fail the whole upsert (RLS + 0058
        // trigger), and one rejected row discards the entire batch.
        .filter((r) => r.game_window && r.player_slug && !winLocked(r.game_window));
      if (!rows.length) return;
      setSaving(true);
      savePicks(matchup.id, userId, rows)
        // The activation event, and the North Star's input (a week with a
        // lineup in). Fired on the SAVE rather than on each tap, so it counts
        // lineups that reached the server — the autosave debounce above is
        // what keeps one settled edit burst to one event.
        .then(() => { setSaved(true); setErr(null); commit(); track(Ev.lineupSet, { week: matchup.week, slots: rows.length }); })
        // A swallowed failure is the worst outcome here: the board keeps showing
        // the lineup you built while the server holds an older one, and you find
        // out on reload. Say so on the board.
        .catch((e: unknown) => setErr(friendlyError(e)))
        .finally(() => setSaving(false));
    }, 1500);
    return () => clearTimeout(id);
  }, [picks, matchup, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshCoins = () => { if (matchup) myWallet(matchup.id).then((c) => setCoins(Number(c ?? 0))).catch(() => {}); };
  const priceOf = (id: string) => powerupById(id)?.price ?? 0;
  const insufficientMsg = (id: string) => `Not enough drip coin — ${powerupById(id)?.name ?? id} costs ◆${priceOf(id)}, you have ◆${Math.round(coins)}.`;
  const puLocked = (id: string) => !matchPremium && !isFreePowerup(id);
  const upgradeMsg = 'Premium power-up — unlock premium ($5 you · $30 league) to arm it.';

  const checkout = (kind: 'personal' | 'league') => {
    if (!roster) return;
    markGatedAttempt('checkout:' + kind);
    startCheckout(kind, roster.leagueId).catch((e) => setErr(e instanceof Error ? e.message : 'Checkout failed.'));
  };

  /** Arm a card from the hand.
   *
   *  This CONSUMES AN OWNED CARD, it does not charge coin — coin was charged
   *  once, in the shop. The screen previously called `arm_buff`, which charges
   *  at arm time; with a shop in front of it that billed the same power-up
   *  twice. This mirrors the web's live board (store.armBuff →
   *  consumeAndApply + heroSetBuffs).
   *
   *  Amplifier capacity is enforced here as well as server-side, so an
   *  impossible arm is refused before it spends a card. */
  const armFromHand = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    if (!liveBuffsOn) { setErr("Real-time power-ups are turned off in this league (commissioner's setting)."); return; }
    if (buffs.has(id)) return;
    const armed = new Set(buffs);
    if (id === 'amp-3' && !armed.has('amp-2')) { setErr('Third Amp needs Second Amp armed first.'); return; }
    if (isAmplifier(id) && [...armed].filter(isAmplifier).length >= ampCapacity(armed)) {
      setErr('Amplifier capacity reached — arm Second/Third Amp to raise it.'); return;
    }
    if ((inventory[id] ?? 0) <= 0) { setErr('You don’t own that card — buy it in the shop.'); return; }

    setBuffBusy(id); setErr(null);
    try {
      const c = await consumeInventory(matchup.id, id);
      if (!c?.ok) { setErr('Could not play that card.'); return; }
      const next = [...armed, id];
      const r = await heroSetBuffs(matchup.id, next);
      if (r?.ok) {
        commit();
        setBuffs(new Set(next));
        setInventory((inv) => ({ ...inv, [id]: Math.max(0, (inv[id] ?? 1) - 1) }));
      } else {
        // Persisting failed — hand the card back rather than silently eating it.
        await refundInventory(matchup.id, id).catch(() => {});
        setErr(r?.error ?? 'Could not arm that power-up.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not arm that power-up.');
    } finally { setBuffBusy(null); }
  };

  const disarmFromHand = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    if (!buffs.has(id)) return;
    setBuffBusy(id); setErr(null);
    try {
      const next = [...buffs].filter((b) => b !== id);
      const r = await heroSetBuffs(matchup.id, next);
      if (r?.ok) {
        await refundInventory(matchup.id, id).catch(() => {});
        setBuffs(new Set(next));
        setInventory((inv) => ({ ...inv, [id]: (inv[id] ?? 0) + 1 }));
      } else setErr(r?.error ?? 'Could not disarm that power-up.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not disarm that power-up.');
    } finally { setBuffBusy(null); }
  };

  /** The hand: everything owned, plus anything currently armed (an armed card
   *  has left the inventory, so it would otherwise vanish from view). */
  const hand: HandCard[] = POWERUPS
    // Metric unlocks are NOT cards. They arm through arm_unlock and the metric
    // picker gates on `unlocks`; a card played from the hand arms into `buffs`,
    // which nothing reads for these. Left in, a stray inventory row from before
    // the shop stopped selling them would deal a card that costs a card and
    // unlocks nothing.
    .filter((p) => p.kind !== 'metric')
    .filter((p) => (inventory[p.id] ?? 0) > 0 || buffs.has(p.id))
    .map((p) => {
      const armed = buffs.has(p.id);
      const pre = p.timing === 'pre';
      return {
        id: p.id,
        qty: inventory[p.id] ?? 0,
        armed,
        usable: !locked && pre,
        note: locked ? 'The week has started — arms are closed.'
          : pre ? undefined
          : 'Real-time card — playable once this window kicks off.',
      };
    });

  const toggleUnlock = async (id: string) => {
    if (!matchup || locked || buffBusy) return;
    const combo = id === 'unlock-combo-drip';
    const armed = unlocks.has(id) && !combo; // combo: every tap buys another
    if (!armed && puLocked(id)) { markGatedAttempt('powerup:' + id); setErr(upgradeMsg); return; }
    if (!armed && coins < priceOf(id)) { setErr(insufficientMsg(id)); return; }
    setBuffBusy(id); setErr(null);
    try {
      const r = armed ? await disarmUnlock(matchup.id, id) : await armUnlock(matchup.id, id);
      if (r.ok && r.unlocks) {
        setUnlocks(new Set(r.unlocks));
        if (combo && typeof r.comboQty === 'number') setComboQty(r.comboQty);
        refreshCoins();
        // Disarming clears dependent picks server-side — mirror locally.
        if (armed) setPicks((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            const mid = next[k].metric_id;
            if (mid && LOCKED_METRIC_UNLOCK[mid] === id) next[k] = { ...next[k], metric_id: null };
          }
          return next;
        });
      } else setErr(r.error === 'insufficient' ? insufficientMsg(id) : (r.error ?? 'Could not update unlocks.'));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update unlocks.'); }
    finally { setBuffBusy(null); }
  };

  const disarmComboOne = async () => {
    if (!matchup || locked || buffBusy || comboQty <= 0) return;
    setBuffBusy('unlock-combo-drip'); setErr(null);
    try {
      const r = await disarmUnlock(matchup.id, 'unlock-combo-drip');
      if (r.ok) setAttempt((a) => a + 1); // full reload — picks may have been trimmed server-side
      else setErr(r.error ?? 'Could not remove the Combo Drip.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not remove the Combo Drip.'); }
    finally { setBuffBusy(null); }
  };

  const toggleAi = async () => {
    if (!roster || aiBusy) return;
    const next: Controller = controller === 'ai' ? 'human' : 'ai';
    setAiBusy(true);
    try { const r = await setTeamController(roster.leagueId, roster.rosterId, next); if (r.ok) setController(next); }
    catch { /* leave as-is */ }
    finally { setAiBusy(false); }
  };

  const curWeek = matchup?.week ?? weekSel ?? 1;
  // Step through the league's OWN weeks when we know them; the 1..N count is
  // the fallback for a league whose weeks haven't loaded (or failed to).
  const stepWeek = (dir: -1 | 1) => {
    if (weeks.length) {
      const i = weeks.indexOf(curWeek);
      const next = i < 0 ? weeks[0] : weeks[i + dir];
      if (next != null) setWeekSel(next);
      return;
    }
    const n = curWeek + dir;
    if (n >= 1 && n <= REG_SEASON_WEEKS) setWeekSel(n);
  };
  const canStep = (dir: -1 | 1): boolean => {
    if (weeks.length) { const i = weeks.indexOf(curWeek); return i >= 0 && weeks[i + dir] != null; }
    const n = curWeek + dir;
    return n >= 1 && n <= REG_SEASON_WEEKS;
  };
  const WeekNav = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <LinkButton label="‹" onPress={() => canStep(-1) && stepWeek(-1)} />
      <Mono size={10} weight="700" track={0.06}>{weekLabel(curWeek)}</Mono>
      <LinkButton label="›" onPress={() => canStep(1) && stepWeek(1)} />
    </View>
  );

  if (state === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        <Mono size={11}>Loading your matchup…</Mono>
      </View>
    );
  }

  if (gameMode === 'classic' && roster) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ClassicBoard userId={userId} leagueId={roster.leagueId} rosterId={roster.rosterId} />
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <Display size={18}>Couldn’t load your matchup</Display>
          <Mono size={10.5} style={{ marginTop: 10 }}>Check your connection and try again.{err ? `\n— ${err}` : ''}</Mono>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 14 }}>
            <LinkButton label="↻ retry" tone="you" onPress={() => setAttempt((a) => a + 1)} />
            <LinkButton label="← back" onPress={onBack} />
          </View>
        </Card>
      </View>
    );
  }

  if (state === 'none') {
    // BYE OR UNBUILT (v0.364.0)? `weeks` is the league's own week list, so if
    // it holds this week the schedule is fine and this seat is simply the one
    // sitting out — an odd-sized league byes somebody every week. The old copy
    // told that manager their commissioner had not synced a season that had
    // generated correctly.
    const bye = weeks.includes(curWeek);
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, justifyContent: 'center' }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Display size={17} style={{ flex: 1 }}>{bye ? `Week ${curWeek} · bye` : `No week ${curWeek} matchup yet`}</Display>
            <WeekNav />
          </View>
          <Mono size={10.5} style={{ marginTop: 10 }}>
            {bye
              ? `Your league has an odd number of teams, so one sits out each week and this week it’s yours. Nothing to set — your record and your roster carry over untouched. Use ‹ › for the rest of the season.`
              : `Your team is enrolled. Matchups appear here once your commissioner syncs the schedule — use ‹ › to page through the season.`}{err ? `\n— ${err}` : ''}
          </Mono>
          <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>
        </Card>
      </View>
    );
  }

  const filled = slots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      // Bottom padding clears the hand's TAB, which is pinned over this list
      // rather than scrolling with it. Only the tab: the fan is stowed until you
      // ask for it, and reserving a card's height for something that isn't
      // there was 170pt of a phone screen spent on nothing.
      {...chromeScroll}
      // +64 clears the room bar (v0.356.0) pinned over the list's tail.
      contentContainerStyle={{ padding: 12, paddingBottom: (hand.length ? HAND_TAB_H + 24 : 40) + 64 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={t.you} colors={[t.you]} />}
    >
      {/* Week + score on ONE line — the web's slim strip. This was a full card
          headed THIS WEEK with two 38px numerals, which is a lot of screen for
          "0 vs 0" on a Wednesday. The score matters most when it's moving, and
          when it is, it's still right here. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <WeekNav />
        {/* Who's playing, on the week line rather than heading a card of its
            own. It takes the slack that was an empty spacer. */}
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontWeight: '700', color: t.text }}>
          {myTeam?.team_name ?? 'You'} vs {oppTeam?.team_name ?? 'Opponent'}
        </Text>
        {/* SCHEDULED is the default and says nothing a 0–0 score doesn't; it
            cost ~70px on the one line that now has to hold a team name too.
            LIVE and FINAL are worth the room, so they still get it. */}
        {matchup!.status !== 'scheduled' && (
          <Mono size={9} tone="faint" track={0.1}>{matchup!.status.toUpperCase()}</Mono>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontSize: 19, fontWeight: '800', color: t.you }}>{round1(totals.you)}</Text>
          <Mono size={9} tone="faint">vs</Mono>
          <Text style={{ fontSize: 19, fontWeight: '800', color: t.opp }}>{round1(totals.them)}</Text>
        </View>
      </View>

      {/* Three doors, three sheets. No open/closed state on them: a sheet
          covers the board, so a highlight underneath it could never be seen.
          Each roster label carries its own side's colour — the only thing
          that needs distinguishing; ▦ FIELDS (back on the board by founder's
          call — the league-menu tile stays as the second way in) opens the
          all-fields sheet. */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {/* ▦ FIELDS moved up to the auto-pilot / SHOP row (founder) — it is a
            control, not a roster door, and these two are a matched pair. */}
        {([['you', 'YOUR ROSTER', t.you, pool.length], ['their', 'OPPONENT ROSTER', t.opp, oppPool.length]] as const).map(([side, label, accent, n]) => (
          <Pressable
            key={side}
            onPress={() => { tap(); setRosterOpen(side); }}
            android_ripple={{ color: alpha(accent, 20) }}
            style={({ pressed }) => ({
              flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: t.surface, opacity: pressed ? 0.8 : 1,
              borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd,
            })}
          >
            <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.8, color: accent }}>
              {label}{n ? ` ${n}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* Over-limit lockout: the server refuses picks and power-ups for an
          illegal roster (0072/0128) — say so BEFORE the first rejected tap,
          with the reason and the way out. */}
      {!!rosterIssue && (
        <Notice tone="opp">
          <Mono size={10} tone="opp" style={{ lineHeight: 15 }}>
            ⚠ {rosterIssue}. Picks and power-ups are locked until your roster is legal — drops always work, in the MY TEAM tab.
          </Mono>
        </Notice>
      )}

      {/* Commish kit (0141): the league note + the editors behind it, plus the
          player-flag cache load — chips on roster rows re-render off the bump. */}
      {roster && <CommishKit leagueId={roster.leagueId} onChanged={() => setCommishVer((v) => v + 1)} />}

      {/* Header — mirrors the web's title block: who is playing, how much of
          the lineup is set, and the week you are looking at. */}
      <Card style={{ marginBottom: 10 }}>
        {/* No 🏈 PRESEASON chip (founder): the week stepper two rows up
            already reads PRE 3, and a second banner for the same fact was
            what pushed this box onto three lines. */}
        {/* One row: the controls, and how far along you are. The rules used to
            be spelled out here in two paragraphs, which is a fine thing to read
            once and a permanent tax on every visit after that; the board below
            already says LOCKED / SETUP, N eligible and N/M SET on each window,
            which is the same information where it applies. */}
        {/* ONE LINE, and it may not wrap (founder). What bought the room: the
            auto-pilot chip lost its words. It is a toggle — the fill IS the
            state, the same way every other `on` chip in the app reads — and
            the line under this row still spells out what being on means. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'nowrap' }}>
          <Chip
            label={aiBusy ? '…' : '🤖'}
            a11y={`Auto-pilot ${controller === 'ai' ? 'on' : 'off'}`}
            on={controller === 'ai'}
            disabled={aiBusy}
            onPress={toggleAi}
          />
          {/* ▦ FIELDS lives here now (founder): with the controls, not down in
              the roster doors. Unlike SHOP it stays under auto-pilot — watching
              the games is not a thing the robot does for you. */}
          <Chip label="▦ FIELDS" onPress={() => { tap(); setFieldsOpen(true); }} />
          <View style={{ flex: 1, minWidth: 4 }} />
          <Mono size={9.5} weight="700" tone={filled === slots.length ? 'you' : 'faint'} track={0.08} numberOfLines={1}>{filled}/{slots.length} SET</Mono>
          {controller !== 'ai' && (
            <>
              <Mono size={10} tone="you" weight="700" numberOfLines={1}>◆ {Math.round(coins)}</Mono>
              <Pressable
                onPress={() => setShopOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, backgroundColor: t.bg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 6 }}
              >
                <Text style={{ fontSize: 12 }}>🛒</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: t.text }}>SHOP</Text>
              </Pressable>
            </>
          )}
        </View>
        {controller === 'ai' && <Mono size={9} tone="faint" style={{ marginTop: 8 }}>Auto-pilot is on — your manual picks below are paused until you turn it off.</Mono>}

        {/* The metric-unlock chips that used to sit here are in the shop now —
            they were a purchase wearing a control's clothes, and the shop is
            where purchases live. Hidden under auto-pilot for the same reason
            they always were: the AI arms nothing, so the lever attaches to
            nothing.
            What stays is the premium upsell, and only when it applies. */}
        {controller !== 'ai' && !matchPremium && (
          <View style={{ marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd, paddingTop: 10 }}>
            <Notice>
              <Mono size={9.5} tone="you" weight="700">🔒 Premium unlocks K/DST/IDP + the full power-up set + special events. Both sides of a premium matchup get the full set — never pay-to-win.</Mono>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
                <Chip label="Unlock $5 · you" on onPress={() => checkout('personal')} />
                <Chip label="Unlock league · $30" onPress={() => checkout('league')} />
              </View>
            </Notice>
          </View>
        )}
      </Card>

      {/* Windows. Each one phases on its OWN kickoff, which is the whole reason
          this can be one screen: at any moment on a Sunday some windows are
          still yours to set and others are already scoring, and a board split
          by tab could only ever show you one of those at a time. */}
      {wins.map((w) => {
        const winSlots = slots.filter((s) => s.win === w.id);
        const elig = gateOn ? pool.filter((pl) => winBySlug[pl.slug] === 'any' || winBySlug[pl.slug] === w.id).length : pool.length;
        const setN = winSlots.filter((s) => picks[s.key]?.player_slug && picks[s.key]?.metric_id).length;
        const wLocked = winLocked(w.id);

        // Sealed and scoring → the duel, with its own window header. Duel
        // renders nothing at all for a window with no picks and no score, so
        // that case deliberately falls through to the setup card below: a
        // window you left empty still has to appear, reading LOCKED, rather
        // than vanishing off the board.
        const myLive = revealed.filter((p) => p.app_user_id === userId && p.game_window === w.id);
        const theirLive = revealed.filter((p) => p.app_user_id !== userId && p.game_window === w.id);
        const winScores = scores.filter((s) => s.game_window === w.id);
        if (wLocked && (myLive.length || theirLive.length || winScores.length)) {
          return (
            <Duel
              key={w.id}
              mine={myLive} theirs={theirLive} pool={duelPool} scores={winScores}
              youAreHome={youAreHome} status={matchup!.status} week={week} winLabel={winLabelFor}
              userId={userId}
              // Per-window FINAL (the web's wall-clock rule): a window whose
              // games kicked ~4h ago is done, even though the WEEK's matchup
              // row stays 'live' until its last game — without this every past
              // window of a Thu–Sun preseason week wears ● LIVE for days.
              // FINAL detection is core's windowPhase — the SAME machine the
              // web board runs, so a window can't read LIVE on one host and
              // FINAL on the other. (This lambda carried its own copy of the
              // 4-hour literal until v0.340.1.) null = let Duel derive
              // SEALED/LIVE from kickoff + reveal state as before.
              winStatus={(id) => windowPhase(week, id as never, nowTs, { matchupFinal: matchup!.status === 'final' }) === 'final' ? 'FINAL' : null}
              slotDetail={slotDetail}
              // The stat DRIVING the metric ("127 pass yd"), in the card's stat
              // slot. No full statline on the app (founder's call) — just the
              // number the fielded metric is actually counting.
              liveExtras={(win, slot, who) => {
                const rp = revealed.find((p) => p.game_window === win && p.roster_slot === slot
                  && (who === 'you' ? p.app_user_id === userId : p.app_user_id !== userId));
                const pl = rp?.player_slug ? duelPool[rp.player_slug] : null;
                if (!rp || !pl) return null;
                const player = poolToPlayer(pl);
                const d = metricDriver(player.pos, rp.metric_id, statlineAt(player, week, Number.MAX_SAFE_INTEGER, rp.metric_id ?? undefined));
                return d ? { stat: d } : null;
              }}
            />
          );
        }

        return (
          <Card key={w.id} style={{ marginBottom: 10, opacity: wLocked ? 0.75 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: t.text }}>{w.label}</Text>
              <Mono size={10} tone="dim" track={0.1}>{w.sub.toUpperCase()}</Mono>
              <Mono size={10} tone="mid">{windowDateLabel(week, w.id)}</Mono>
              <Mono size={10} tone="faint">{windowTimeLabel(week, w.id)}</Mono>
            </View>

            {/* Slate strip — which real games this window covers. The crests make
                a window scannable at a glance the way a list of abbreviations
                does not. */}
            {slateOf(week, w.id).length > 0 && (
              <Pressable
                onPress={() => setSlateWin(w)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7, flexWrap: 'wrap' }}
              >
                {slateOf(week, w.id).slice(0, 10).flatMap((g) => [g.away, g.home]).map((abbr, i) => {
                  const uri = teamLogo(abbr);
                  return uri
                    ? <Image key={`${abbr}-${i}`} source={{ uri }} style={{ width: 16, height: 16 }} resizeMode="contain" />
                    : <Mono key={`${abbr}-${i}`} size={8} tone="faint">{abbr}</Mono>;
                })}
                <Mono size={9} tone="faint" track={0.08} style={{ marginLeft: 4 }}>
                  SLATE · {slateOf(week, w.id).length} GAME{slateOf(week, w.id).length === 1 ? '' : 'S'} ›
                </Mono>
              </Pressable>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: wLocked ? t.opp : t.you, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Mono size={9} weight="700" tone={wLocked ? 'opp' : 'you'} track={0.08}>{wLocked ? 'LOCKED' : 'SETUP'}</Mono>
              </View>
              <Mono size={9.5} tone={wLocked ? 'opp' : 'warn'} weight="700">
                {wLocked ? '🔒 locked' : (() => {
                  const ms = winLockMs(w.id);
                  return ms != null ? `🔒 locks ${fmtLock(new Date(ms).toISOString())}` : '🔒 locks 1h before kickoff';
                })()}
              </Mono>
              <Mono size={9.5} weight="700" tone={setN === winSlots.length ? 'you' : 'faint'}>{setN}/{winSlots.length} SET</Mono>
              {gateOn && <Mono size={9} tone={elig ? 'faint' : 'opp'}>{elig} eligible</Mono>}
            </View>

            {/* Felt under the pair, so the cards read as dealt onto a table
                rather than floating on the app background. */}
            <View style={{ gap: 10 }}>
              {winSlots.map((s, si) => {
                const p = picks[s.key];
                const pick = p?.player_slug ? { playerId: p.player_slug, metricId: p.metric_id ?? null } : undefined;
                return (
                  <SetupRow
                    key={s.key}
                    idx={si}
                    pick={pick}
                    resolve={(id) => playersBySlug[id]}
                    lockPlayer={wLocked}
                    // Locked metrics only become pickable once their unlock is
                    // armed — same rule as the web's metricsFor().
                    metricFilter={(m) => !m.lock || unlocks.has(m.lock)}
                    hydrated={hydrated}
                    onOpenPicker={() => { if (!wLocked) setPickerSlot({ key: s.key, win: w.id as WindowId }); }}
                    onPickMetric={(mid) => { if (!wLocked) setSlot(s.key, { metric_id: mid }); }}
                    onClearSlot={() => { if (!wLocked) setSlot(s.key, { player_slug: null, metric_id: null }); }}
                    onScout={oppPool.length ? () => setScoutWin(w) : undefined}
                  />
                );
              })}
            </View>
          </Card>
        );
      })}

      {!!err && <Mono size={10.5} tone="opp" style={{ marginVertical: 6 }}>{err}</Mono>}

      {/* Status, not a control. Nothing here to press: changes save themselves
          and each window seals an hour before its own kickoff. */}
      {!allLocked && (
        <Mono size={9.5} tone={saving ? 'faint' : saved ? 'you' : 'faint'} style={{ textAlign: 'center', marginTop: 4 }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓ — each window locks 1h before its kickoff' : 'Changes save automatically — each window locks 1h before its kickoff'}
        </Mono>
      )}
      {allLocked && <Mono size={10.5} style={{ textAlign: 'center' }}>Every window has kicked off — picks are final.</Mono>}

      <View style={{ alignItems: 'center', marginTop: 14 }}><LinkButton label="← back" onPress={onBack} /></View>

      {/* Rosters, in a sheet. They expanded inline before, which meant a
          34-player list pushed the board — the thing you opened the roster to
          reason ABOUT — off the screen. In a sheet the board stays where it
          was, and the two sides become one place you switch between rather
          than two panels competing for the same column. */}
      <Overlay
        visible={fieldsOpen}
        title="All fields"
        subtitle="EVERY GAME THIS WEEK · YOURS FIRST · LIVE DRIVES"
        onClose={() => setFieldsOpen(false)}
      >
        {/* Pull-to-refresh the whole slate here too (founder): the sheet's own
            gesture reaches the SAME refreshLive the board's does — it re-pulls
            every game's feed + plays, so all the fields update at once without
            leaving the sheet. The realtime channel still pushes in the
            background; this is the manual nudge for a stalled feed. */}
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={t.you} colors={[t.you]} />}>
          {fieldGames.length === 0 && (
            <Mono size={10.5} tone="dim" style={{ textAlign: 'center', paddingVertical: 16 }}>No games on the live feed yet.</Mono>
          )}
          {fieldGames.map((g) => (
            <View key={g.key} style={{ gap: 4 }}>
              <Mono size={9.5} weight="700" track={0.08}>{g.away}@{g.home} · {winLabelFor(g.win)}</Mono>
              <FieldView week={week} team={g.team} clock={Number.MAX_SAFE_INTEGER} />
            </View>
          ))}
        </ScrollView>
      </Overlay>

      <Overlay
        visible={!!rosterOpen}
        title={rosterOpen === 'their' ? 'Opponent roster' : 'Your roster'}
        subtitle={rosterOpen === 'their'
          ? `${(oppTeam?.team_name ?? 'THEIR TEAM').toUpperCase()} · WHO THEY COULD FIELD — NOT WHO THEY SLOTTED`
          : `${(myTeam?.team_name ?? 'YOUR TEAM').toUpperCase()} · GROUPED BY THE WINDOW EACH GAME FALLS IN`}
        onClose={() => setRosterOpen(null)}
        footer={
          <Pressable
            onPress={() => setRosterOpen(rosterOpen === 'their' ? 'you' : 'their')}
            style={{
              borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingVertical: 13, alignItems: 'center',
              borderColor: rosterOpen === 'their' ? t.you : t.opp,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: rosterOpen === 'their' ? t.you : t.opp }}>
              {rosterOpen === 'their' ? '◂ YOUR ROSTER' : 'OPPONENT ROSTER ▸'}
            </Text>
          </Pressable>
        }
      >
        {rosterOpen === 'their' ? (
          <RosterPanel
            title="Opponent roster"
            players={oppPool.map(poolToPlayer)}
            wins={wins}
            week={week}
            userId={userId}
            windowOf={(id) => oppWinBySlug[id] ?? null}
            groupOf={(id) => oppGrpBySlug[id] ?? 'start'}
            accent={t.opp}
            open
          />
        ) : (
          <RosterPanel
            title="Your roster"
            players={pool.map(poolToPlayer)}
            wins={wins}
            week={week}
            userId={userId}
            // Same resolver the slate gating uses, so the grouping here and the
            // eligibility counts on each window can never disagree.
            windowOf={(id) => winBySlug[id] ?? null}
            groupOf={(id) => grpBySlug[id] ?? 'start'}
            accent={t.you}
            open
          />
        )}
      </Overlay>

      {/* The window's real NFL games, and who you have in each — the web's
          "· Game Slate" sheet. Reachable by tapping the crest strip, which was
          already showing the same games without saying which ones they were.
          The point is deciding a lineup: "this window is five games, and I
          already have someone in two of them" is the question the strip raises
          and could not answer. */}
      <Overlay
        visible={!!slateWin}
        title={`${slateWin?.label ?? ''} · Game Slate`}
        subtitle={slateWin
          ? `${slateOf(week, slateWin.id).length} GAME${slateOf(week, slateWin.id).length === 1 ? '' : 'S'} · ${windowDateLabel(week, slateWin.id).toUpperCase()} · ${windowTimeLabel(week, slateWin.id).toUpperCase()}`
          : undefined}
        onClose={() => setSlateWin(null)}
      >
        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 12, gap: 7 }}>
          {(() => {
            if (!slateWin) return null;
            const win = slateWin.id;
            const games = slateOf(week, win);
            // Seeded with every real game so the sheet is complete before anyone
            // is slotted — a lone TNF game still has to appear.
            const rows = games.map((g) => ({ g, you: [] as string[], their: [] as string[] }));
            const put = (team: string | null | undefined, name: string, side: 'you' | 'their') => {
              if (!team) return;
              const g = nflGameForTeam(week, team);
              if (!g) return;
              const row = rows.find((r) => r.g.away === g.away && r.g.home === g.home);
              if (row && !row[side].includes(`${name} · ${team}`)) row[side].push(`${name} · ${team}`);
            };
            for (const s of slots.filter((sl) => sl.win === win)) {
              const slug = picks[s.key]?.player_slug;
              if (!slug) continue;
              const row = pool.find((p) => p.slug === slug);
              put(row?.team || slugMeta(slug).team, shortName(row?.full ?? slug), 'you');
            }
            // Theirs ONLY once the window has kicked and their cards are face
            // up. Listing a sealed opponent lineup here would leak exactly what
            // the sealed card exists to hide.
            if (winLocked(win)) {
              for (const rp of revealed.filter((p) => p.app_user_id !== userId && p.game_window === win)) {
                const slug = rp.player_slug;
                if (!slug) continue;
                const row = oppPool.find((p) => p.slug === slug);
                put(row?.team || slugMeta(slug).team, shortName(row?.full ?? slug), 'their');
              }
            }
            if (!rows.length) return <Mono size={10.5} tone="dim">No games on the slate for this window yet.</Mono>;
            return rows.map(({ g, you, their }) => (
              <View key={`${g.away}@${g.home}`} style={{ backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 6, padding: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {([g.away, g.home] as const).map((abbr, i) => {
                    const logo = teamLogo(abbr);
                    return (
                      <View key={abbr} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        {i === 1 && <Mono size={10} weight="700" tone="faint">@</Mono>}
                        {logo
                          ? <Image source={{ uri: logo }} style={{ width: 22, height: 22 }} resizeMode="contain" />
                          : <Mono size={9} tone="faint">{abbr}</Mono>}
                        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{abbr}</Text>
                      </View>
                    );
                  })}
                  <Mono size={8.5} weight="700" tone="dim">
                    {g.kickoff ? kickoffLabel(g.kickoff) : windowTimeLabel(week, win)}
                  </Mono>
                </View>
                {(you.length > 0 || their.length > 0) && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 7, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bd }}>
                    {you.map((n) => <Mono key={n} size={9.5} tone="you">● {n}</Mono>)}
                    {their.map((n) => <Mono key={n} size={9.5} tone="opp">● {n}</Mono>)}
                  </View>
                )}
              </View>
            ));
          })()}
        </ScrollView>
      </Overlay>

      {/* Scout: who the opponent COULD field in this window. Never who they
          actually slotted — that stays sealed until the window kicks off. */}
      <Overlay
        visible={!!scoutWin}
        title={`Scout · ${scoutWin?.label ?? ''}`}
        subtitle={`${(oppTeam?.team_name ?? 'OPPONENT').toUpperCase()} · WHO THEY COULD FIELD — NOT WHO THEY PLAYED`}
        onClose={() => setScoutWin(null)}
      >
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {(() => {
            const win = scoutWin?.id;
            const list = !win ? [] : oppPool
              .filter((op) => {
                if (!gateOn) return true;
                const tm = slugMeta(op.slug).team;
                const w = tm ? windowForTeam(week, tm) : 'any';
                return w === 'any' || w === win;
              })
              .sort((a, b) => a.pos.localeCompare(b.pos) || a.full.localeCompare(b.full));
            if (!list.length) return <Mono size={10.5} tone="dim">Nobody on their roster plays in this window.</Mono>;
            return list.map((op) => (
              <View key={op.slug} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.bd }}>
                <View style={{ backgroundColor: (t.pos[op.pos as keyof typeof t.pos] ?? { bg: t.sh }).bg, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ fontFamily: 'System', fontSize: 9, fontWeight: '700', color: (t.pos[op.pos as keyof typeof t.pos] ?? { fg: t.dim }).fg }}>{op.pos}</Text>
                </View>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: t.text }}>{op.full}</Text>
                <Mono size={9} tone="faint">{slugMeta(op.slug).team}</Mono>
              </View>
            ));
          })()}
        </ScrollView>
      </Overlay>

      {/* the live duel log (0193) — the founder's minutes view, on the phone */}
      <Overlay visible={!!logFor}
        title={logFor ? `⚔ ${winLabelFor(logFor.win)} duel log` : ''}
        subtitle="PLAYS jump · MINUTES shows drip accrue between them · BANK NOW matches the card"
        onClose={() => setLogFor(null)}>
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
          {(() => {
            const evs = logFor ? duelEvents?.get(`${logFor.win}|${logFor.slot}`) : undefined;
            if (!evs?.length) {
              return <Mono size={10} tone="faint">No events yet — the log fills once this window's games kick.</Mono>;
            }
            return <PlayLog events={evs} youName="YOU" theirName="THEM" />;
          })()}
        </ScrollView>
      </Overlay>

      {!!matchup && (
        <ShopModal
          visible={shopOpen}
          matchupId={matchup.id}
          balance={coins}
          // Preseason weeks are practice: the server charges nothing, so the
          // shop must not imply the season wallet moves.
          practice={isPreseasonWeek(matchup.week)}
          // Metric unlocks buy-and-arm inside the shop rather than becoming
          // cards — see the note on these props in ShopModal.
          unlocks={unlocks}
          comboQty={comboQty}
          unlockBusy={buffBusy}
          unlockLocked={puLocked}
          armsClosed={locked}
          onToggleUnlock={toggleUnlock}
          onDisarmCombo={disarmComboOne}
          onClose={() => setShopOpen(false)}
          // Trust the server's balance rather than deducting locally — on a
          // practice week nothing is actually charged.
          // Both, or the hand goes stale: a bought card only reaches the hand
          // through `inventory`, which is otherwise read once on mount.
          onChanged={(bal, inv) => { setCoins(bal); setInventory(inv); }}
        />
      )}

      {pickerSlot && (() => {
        const cur = picks[pickerSlot.key]?.player_slug ?? undefined;
        const slotted = slottedInWin(pickerSlot.win, pickerSlot.key);
        const players = eligibleFor(pickerSlot.win, cur ?? null)
          .filter((p) => !slotted.has(p.slug) || p.slug === cur)
          .map(poolToPlayer);
        return (
          <PlayerPicker
            visible
            players={players}
            currentId={cur}
            week={week}
            userId={userId}
            windowLabel={wins.find((w) => w.id === pickerSlot.win)?.label}
            groupOf={(id) => grpBySlug[id] ?? 'start'}
            gated={(p) => !matchPremium && !isFreePosition(p.pos)}
            onGated={(p) => {
              markGatedAttempt('position:' + p.pos);
              setErr(`Premium position (${p.pos}) — unlock premium ($5 you · $30 league) to field K/DST/IDP.`);
              setPickerSlot(null);
            }}
            onPick={(slug) => { setSlot(pickerSlot.key, { player_slug: slug }); setPickerSlot(null); }}
            onRemove={() => { setSlot(pickerSlot.key, { player_slug: null, metric_id: null }); setPickerSlot(null); }}
            onClose={() => setPickerSlot(null)}
          />
        );
      })()}
    </ScrollView>

    <PowerupHand
      lift={58}
      cards={hand}
      busyId={buffBusy}
      onArm={armFromHand}
      onDisarm={disarmFromHand}
    />
    </View>
  );
}
